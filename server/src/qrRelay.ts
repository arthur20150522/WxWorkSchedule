/**
 * QR login relay — receives live QR frames from bridge.py (localhost),
 * hosts an HTML page that shows the current WeChat QR code in near-real-time,
 * and hands the page URL to botManager for the single offline push.
 *
 * Lifecycle:
 *   - bridge.py detects the QR login window → starts a 4s/frame screenshot
 *     stream → POST /api/qr/live per frame
 *   - Node keeps only the latest frame (live-<token>.png); the page polls it
 *   - WeChat recovers → bridge.py POST /api/qr/clear (or frames stop arriving)
 *     → image deleted after LIVE_TTL_MS, old URLs die
 *
 * Security model: the random 32-hex token in the URL IS the secret. Frames
 * require QR_PUSH_SECRET on upload; the token is regenerated on restart and
 * on clear, so any previously leaked URL stops working.
 */
import express from 'express';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, unlinkSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// dist/qrRelay.js → server/data/qr (same pattern as dbManager: resolve from __dirname, not cwd)
const QR_DIR = join(__dirname, '..', 'data', 'qr');
const LIVE_TTL_MS = 5 * 60 * 1000; // no frames for 5min → live session expires
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const QR_SECRET = process.env.QR_PUSH_SECRET || '';
const ENV_BASE = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');

// ── Public base resolution ───────────────────────────────────────────────
// PUBLIC_BASE_URL can silently go stale: when the domain is moved/expired the
// DNS lands on a parking page and every pushed QR link dies with it (seen
// 2026-11-08 — eastpolar.top started resolving to a parking IP while the config
// still said wechat.eastpolar.top). So the admin's own browser teaches us the
// real origin: whenever a *verified* authenticated request arrives we remember
// the host it came in on. The observed origin wins over the configured one, and
// a periodic reachability probe keeps the actually-working base selected.
const PRIVATE_HOST_RE =
  /^(localhost|127\.|0\.0\.0\.0|\[?::1\]?|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[01])\.)/i;
const PROBE_INTERVAL_MS = 5 * 60 * 1000;
const PROBE_TIMEOUT_MS = 4000;

let observedBase = '';
let activeBase = ENV_BASE;
let lastProbeAt = 0;

/** Public origin currently used to build pushed links. */
function publicBase(): string {
  return activeBase || observedBase || ENV_BASE || `http://127.0.0.1:${process.env.PORT || 3000}`;
}

function probeBase(base: string): Promise<boolean> {
  if (!base) return Promise.resolve(false);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  return fetch(`${base}/api/qr/ping`, { signal: ctrl.signal as never })
    .then((resp) => resp.ok)
    .catch(() => false)
    .finally(() => clearTimeout(timer));
}

async function probeBases(): Promise<void> {
  const cands: string[] = [];
  if (observedBase) cands.push(observedBase);
  if (ENV_BASE && !cands.includes(ENV_BASE)) cands.push(ENV_BASE);
  if (!cands.length) return;
  for (const base of cands) {
    if (await probeBase(base)) {
      if (activeBase !== base) console.log(`[QR] Public base → ${base} (reachable)`);
      activeBase = base;
      lastProbeAt = Date.now();
      return;
    }
    console.warn(`[QR] Public base unreachable: ${base}`);
  }
  lastProbeAt = Date.now();
  console.warn('[QR] No reachable public base — pushed QR links will not open. Check PUBLIC_BASE_URL / DNS.');
}

/**
 * Called after a token verified (authMiddleware) and on successful /api/login:
 * records the origin the admin's browser actually reached us on.
 */
export function notePublicOrigin(req: express.Request): void {
  const raw = String((req.headers['x-forwarded-host'] as string) || req.headers.host || '')
    .split(',')[0].trim();
  if (!raw) return;
  const bare = raw.replace(/:\d+$/, '');
  if (!bare.includes('.') || PRIVATE_HOST_RE.test(bare)) return;

  const protoRaw = String(
    (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https',
  ).split(',')[0].trim().toLowerCase();
  const base = `${protoRaw === 'http' ? 'http' : 'https'}://${raw}`;
  if (base === observedBase) return;

  observedBase = base;
  activeBase = base; // optimistic — the very next push uses it
  console.log(
    `[QR] Public origin observed from admin session: ${base}` +
      (ENV_BASE && ENV_BASE !== base ? ` (PUBLIC_BASE_URL=${ENV_BASE} is stale)` : ''),
  );
  // Confirm in the background; falls back to the other candidate if this one is dead.
  if (Date.now() - lastProbeAt > 30_000) void probeBases();
}

// ── Live-stream state (in-memory; restart regenerates the token, old URLs die) ──
let liveToken: string | null = null;
let liveLastUpdate = 0;
// Why the previous session ended — lets a dead link explain itself precisely
let lastClearedToken: string | null = null;
let lastClearReason: 'recovered' | 'expired' | null = null;

function getOrCreateLiveToken(): string {
  if (!liveToken) liveToken = randomBytes(16).toString('hex');
  return liveToken;
}

function liveFilePath(): string {
  return liveToken ? join(QR_DIR, `live-${liveToken}.png`) : '';
}

function clearLive(reason: 'recovered' | 'expired'): void {
  const f = liveFilePath();
  if (f && existsSync(f)) {
    try { unlinkSync(f); } catch { /* ignore */ }
  }
  lastClearedToken = liveToken;
  lastClearReason = reason;
  liveToken = null;
  liveLastUpdate = 0;
}

function deadLinkPageHtml(title: string, detail: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>` +
    `<body style="margin:0;background:#16181d;color:#eee;font-family:sans-serif;display:flex;` +
    `flex-direction:column;align-items:center;justify-content:center;min-height:100vh">` +
    `<h1 style="font-size:18px">${title}</h1>` +
    `<p style="font-size:13px;color:#9aa0a6;padding:0 24px;text-align:center;line-height:1.8">${detail}</p>` +
    `</body></html>`;
}

/** Public live-page URL — used by botManager for the single offline notice. */
export function getQrViewUrl(): string {
  return `${publicBase()}/api/qr/view/${getOrCreateLiveToken()}`;
}

function viewPageHtml(token: string): string {
  const imgBase = `/api/qr/live/${token}.png`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>微信扫码登录</title>
<style>
  body{margin:0;background:#16181d;color:#eee;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh}
  h1{font-size:18px;font-weight:600;margin:0 0 4px}
  .sub{font-size:13px;color:#9aa0a6;margin-bottom:20px}
  #qr{width:min(300px,78vw);height:auto;background:#fff;border-radius:14px;padding:14px;box-shadow:0 8px 32px rgba(0,0,0,.4)}
  #status{margin-top:16px;font-size:13px;color:#9aa0a6;text-align:center;padding:0 16px}
  #status.bad{color:#f28b82}
</style>
</head>
<body>
  <h1>微信扫码登录</h1>
  <div class="sub">服务器微信已退出登录，请扫码</div>
  <img id="qr" alt="二维码加载中…" src="${imgBase}">
  <div id="status">正在等待二维码…</div>
  <script>
    var img=document.getElementById('qr'),st=document.getElementById('status'),base='${imgBase}',last=0;
    function ts(){return new Date().getTime()}
    function load(){img.src=base+'?t='+ts()}
    img.onload=function(){last=ts();st.textContent='二维码已更新，请用微信扫一扫（约 2 分钟过期）';st.className=''}
    img.onerror=function(){st.textContent='正在等待微信二维码刷新…';st.className='bad'}
    setInterval(load,4000);
    setInterval(function(){
      var sec=(ts()-last)/1000;
      if(sec>110){st.textContent='二维码已过期，正在等待微信刷新新二维码…';st.className='bad'}
    },5000);
    load();
  </script>
</body>
</html>`;
}

export function registerQrRoutes(app: express.Express): void {
  mkdirSync(QR_DIR, { recursive: true });
  // Fresh boot: wipe leftovers from a previous run — the old token died with
  // the old process, so any live-*.png there is unreachable garbage.
  for (const f of readdirSync(QR_DIR)) {
    try { unlinkSync(join(QR_DIR, f)); } catch { /* ignore */ }
  }
  if (!QR_SECRET) {
    console.warn('[QR] QR_PUSH_SECRET not set in .env — /api/qr/live will reject all uploads');
  }

  // Cheap liveness endpoint used by the base probe (and by the admin to eyeball
  // which domain the pushed links currently use).
  app.get('/api/qr/ping', (_req, res) => {
    res.json({ ok: true, base: publicBase(), configured: ENV_BASE || null });
  });

  // Startup + periodic probe: keeps a working base selected even when the
  // configured domain has gone stale (parked DNS, expired cert, dead tunnel).
  setTimeout(() => { void probeBases(); }, 5000).unref();
  setInterval(() => { void probeBases(); }, PROBE_INTERVAL_MS).unref();

  // Live-session expiry sweep: no frames for LIVE_TTL_MS → destroy session.
  // Zero-frame sessions never expire: the link is pushed before the QR window
  // even appears (recover must click "进入微信" first), so killing them here
  // would dead-link the only pushed URL.
  setInterval(() => {
    if (liveToken && liveLastUpdate && Date.now() - liveLastUpdate > LIVE_TTL_MS) {
      console.log('[QR] Live session expired (no frames) — clearing');
      clearLive('expired');
    }
  }, 60_000).unref();

  // Called by bridge.py every ~4s while WeChat shows the QR login window.
  app.post('/api/qr/live', async (req, res) => {
    try {
      const { secret, image } = req.body || {};
      if (!QR_SECRET || secret !== QR_SECRET) {
        return res.status(403).json({ error: 'forbidden' });
      }
      if (!image || typeof image !== 'string') {
        return res.status(400).json({ error: 'image required (base64 png)' });
      }
      const buf = Buffer.from(image, 'base64');
      if (buf.length < 100 || buf.length > MAX_IMAGE_BYTES) {
        return res.status(400).json({ error: `bad image size: ${buf.length}` });
      }

      const token = getOrCreateLiveToken();
      writeFileSync(liveFilePath(), buf);
      liveLastUpdate = Date.now();

      console.log(`[QR] Live frame received (${buf.length}B) → view: ${publicBase()}/api/qr/view/${token}`);
      res.json({ ok: true, url: `${publicBase()}/api/qr/view/${token}` });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // Called by bridge.py when WeChat is back online — immediately revoke the page.
  app.post('/api/qr/clear', (req, res) => {
    const { secret } = req.body || {};
    if (!QR_SECRET || secret !== QR_SECRET) {
      return res.status(403).json({ error: 'forbidden' });
    }
    if (liveToken) {
      clearLive('recovered');
      console.log('[QR] Live session cleared (WeChat recovered)');
    }
    res.json({ ok: true });
  });

  // Live viewer page — no auth: the unguessable token is the credential.
  app.get('/api/qr/view/:token', (req, res) => {
    const token = req.params.token;
    if (!/^[a-f0-9]{32}$/.test(token) || token !== liveToken) {
      // Dead link — explain precisely WHY it died instead of a cryptic 404
      if (token === lastClearedToken && lastClearReason === 'recovered') {
        res.status(404).type('html').send(deadLinkPageHtml(
          '微信已恢复，无需扫码 ✅',
          '这个二维码链接在你扫码成功后已被服务器主动作废（安全设计）。<br>当前微信登录正常。',
        ));
      } else {
        res.status(404).type('html').send(deadLinkPageHtml(
          '链接已失效',
          '二维码会话已结束（超过 5 分钟无刷新，或服务重启）。<br>如微信仍未登录，请等待下一次掉线推送的新链接。',
        ));
      }
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.type('html').send(viewPageHtml(token));
  });

  // Latest live frame — no auth: same token credential.
  // URL: /api/qr/live/<token>.png → :file is "<token>.png" (the "live-" prefix
  // only exists in the DISK filename live-<token>.png, not in the route param!)
  app.get('/api/qr/live/:file', (req, res) => {
    const file = req.params.file;
    const m = /^([a-f0-9]{32})\.png$/.exec(file);
    if (!m || m[1] !== liveToken) {
      return res.status(404).end();
    }
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(join(QR_DIR, `live-${m[1]}.png`), (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  });
}
