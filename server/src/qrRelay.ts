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
const PUBLIC_BASE = (process.env.PUBLIC_BASE_URL || 'https://wechat.eastpolar.top').replace(/\/+$/, '');

// ── Live-stream state (in-memory; restart regenerates the token, old URLs die) ──
let liveToken: string | null = null;
let liveLastUpdate = 0;

function getOrCreateLiveToken(): string {
  if (!liveToken) liveToken = randomBytes(16).toString('hex');
  return liveToken;
}

function liveFilePath(): string {
  return liveToken ? join(QR_DIR, `live-${liveToken}.png`) : '';
}

function clearLive(): void {
  const f = liveFilePath();
  if (f && existsSync(f)) {
    try { unlinkSync(f); } catch { /* ignore */ }
  }
  liveToken = null;
  liveLastUpdate = 0;
}

/** Public live-page URL — used by botManager for the single offline notice. */
export function getQrViewUrl(): string {
  return `${PUBLIC_BASE}/api/qr/view/${getOrCreateLiveToken()}`;
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

  // Live-session expiry sweep: no frames for LIVE_TTL_MS → destroy session
  setInterval(() => {
    if (liveToken && Date.now() - liveLastUpdate > LIVE_TTL_MS) {
      console.log('[QR] Live session expired (no frames) — clearing');
      clearLive();
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

      console.log(`[QR] Live frame received (${buf.length}B) → view: ${PUBLIC_BASE}/api/qr/view/${token}`);
      res.json({ ok: true, url: `${PUBLIC_BASE}/api/qr/view/${token}` });
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
      clearLive();
      console.log('[QR] Live session cleared (WeChat recovered)');
    }
    res.json({ ok: true });
  });

  // Live viewer page — no auth: the unguessable token is the credential.
  app.get('/api/qr/view/:token', (req, res) => {
    const token = req.params.token;
    if (!/^[a-f0-9]{32}$/.test(token) || token !== liveToken) {
      return res.status(404).end();
    }
    res.setHeader('Cache-Control', 'no-store');
    res.type('html').send(viewPageHtml(token));
  });

  // Latest live frame — no auth: same token credential.
  app.get('/api/qr/live/:file', (req, res) => {
    const file = req.params.file;
    if (!/^[a-f0-9]{32}\.png$/.test(file) || file !== `live-${liveToken}.png`) {
      return res.status(404).end();
    }
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(join(QR_DIR, file), (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  });
}
