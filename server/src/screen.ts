/**
 * Fixed QR alias — GET /screen always shows the current live login QR behind
 * the panel's own .user accounts, with a 30-day cookie session. The pushed
 * token URLs (/api/qr/view/<token>) keep working unchanged; this is an extra
 * entrance so the admin never has to wait for a fresh push link.
 */
import express from 'express';
import { verifyPassword, generateToken, verifyToken } from './auth.js';
import { getQrLiveState, notePublicOrigin } from './qrRelay.js';

const COOKIE_NAME = 'screen_session';
const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60; // 30 days

function readSessionCookie(req: express.Request): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === COOKIE_NAME) return part.slice(i + 1).trim();
  }
  return null;
}

function screenUser(req: express.Request): string | null {
  const token = readSessionCookie(req);
  return token ? verifyToken(token) : null;
}

// ── Minimal brute-force brake (public endpoint behind the tunnel) ─────────
const loginFails = new Map<string, { n: number; until: number }>();

function loginBlocked(ip: string): boolean {
  const f = loginFails.get(ip);
  return !!f && f.until > Date.now();
}

function noteLoginFail(ip: string): void {
  const f = loginFails.get(ip) || { n: 0, until: 0 };
  f.n += 1;
  if (f.n >= 5) {
    f.until = Date.now() + 60_000;
    f.n = 0;
  }
  loginFails.set(ip, f);
  if (loginFails.size > 500) {
    const now = Date.now();
    for (const [k, v] of loginFails) if (v.until && v.until <= now) loginFails.delete(k);
  }
}

function loginHtml(error = ''): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>微信扫码入口 · 登录</title>
<style>
  body{margin:0;background:#16181d;color:#eee;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh}
  .card{width:min(320px,86vw);background:#1f2229;border-radius:14px;padding:28px 24px;box-shadow:0 8px 32px rgba(0,0,0,.4)}
  h1{font-size:18px;font-weight:600;margin:0 0 4px;text-align:center}
  .sub{font-size:13px;color:#9aa0a6;margin:0 0 20px;text-align:center}
  input{width:100%;box-sizing:border-box;margin-bottom:12px;padding:10px 12px;border-radius:8px;border:1px solid #3a3f4b;background:#16181d;color:#eee;font-size:14px}
  button{width:100%;padding:10px;border:0;border-radius:8px;background:#4c8dff;color:#fff;font-size:14px;cursor:pointer}
  .err{color:#f28b82;font-size:13px;min-height:18px;margin:10px 0 0;text-align:center}
  .hint{color:#9aa0a6;font-size:12px;margin:10px 0 0;text-align:center}
</style>
</head>
<body>
<form class="card" method="post" action="/screen/login">
  <h1>微信扫码入口</h1>
  <p class="sub">请输入管理面板的账号密码</p>
  <input name="username" placeholder="账号" autocomplete="username" required>
  <input name="password" type="password" placeholder="密码" autocomplete="current-password" required>
  <button type="submit">登录</button>
  <p class="err">${error}</p>
  <p class="hint">登录一次，30 天内免登录</p>
</form>
</body>
</html>`;
}

function viewerHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>微信扫码登录</title>
<style>
  body{margin:0;background:#16181d;color:#eee;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh}
  h1{font-size:18px;font-weight:600;margin:0 0 4px}
  .sub{font-size:13px;color:#9aa0a6;margin-bottom:20px}
  #qr{width:min(300px,78vw);height:auto;background:#fff;border-radius:14px;padding:14px;box-shadow:0 8px 32px rgba(0,0,0,.4)}
  #status{margin-top:16px;font-size:13px;color:#9aa0a6;text-align:center;padding:0 16px;line-height:1.8}
  #status.bad{color:#f28b82}
</style>
</head>
<body>
  <h1>微信扫码登录</h1>
  <div class="sub">固定入口 · 二维码实时刷新</div>
  <img id="qr" alt="二维码" style="display:none">
  <div id="status">正在获取状态…</div>
  <script>
    var img=document.getElementById('qr'),st=document.getElementById('status');
    function tick(){
      fetch('/screen/state',{cache:'no-store'}).then(function(r){return r.json()}).then(function(s){
        if(s.hasFrame){
          img.style.display='';
          img.src='/screen/frame.png?t='+Date.now();
          var age=(Date.now()-s.lastUpdate)/1000;
          if(age>110){st.textContent='二维码可能已过期，正在等待微信刷新…';st.className='bad'}
          else{st.textContent='请用微信扫一扫（约 2 分钟过期，页面自动刷新）';st.className=''}
        }else{
          img.style.display='none';
          if(s.lastClearReason==='recovered'){st.textContent='微信已恢复，无需扫码 ✅';st.className=''}
          else if(s.hasSession){st.textContent='微信已掉线，正在等待二维码生成…';st.className='bad'}
          else{st.textContent='当前没有待扫码的二维码（微信在线或尚未生成）。掉线后新码会自动出现在这里，无需等待推送。';st.className=''}
        }
      }).catch(function(){st.textContent='连接服务器失败，重试中…';st.className='bad'});
    }
    setInterval(tick,4000);tick();
  </script>
</body>
</html>`;
}

export function registerScreenRoutes(app: express.Express): void {
  app.get('/screen', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (screenUser(req)) {
      notePublicOrigin(req);
      return res.type('html').send(viewerHtml());
    }
    res.type('html').send(loginHtml());
  });

  app.post('/screen/login', express.urlencoded({ extended: false }), async (req, res) => {
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '')
      .split(',')[0].trim();
    if (loginBlocked(ip)) {
      return res.status(429).type('html').send(loginHtml('尝试过于频繁，请 1 分钟后再试'));
    }
    const { username, password } = (req.body || {}) as { username?: string; password?: string };
    if (typeof username !== 'string' || typeof password !== 'string' ||
        username.length === 0 || password.length === 0 ||
        !(await verifyPassword(username, password))) {
      noteLoginFail(ip);
      return res.status(401).type('html').send(loginHtml('账号或密码错误'));
    }
    loginFails.delete(ip);
    const token = generateToken(username, '30d');
    const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    const secure = proto === 'https' || req.secure;
    res.setHeader(
      'Set-Cookie',
      `${COOKIE_NAME}=${token}; Max-Age=${SESSION_MAX_AGE_S}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`,
    );
    notePublicOrigin(req);
    res.redirect(303, '/screen');
  });

  app.get('/screen/frame.png', (req, res) => {
    if (!screenUser(req)) return res.status(401).end();
    const s = getQrLiveState();
    if (!s.hasFrame) return res.status(404).end();
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(s.framePath, (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  });

  app.get('/screen/state', (req, res) => {
    if (!screenUser(req)) return res.status(401).json({ error: 'unauthorized' });
    const s = getQrLiveState();
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      hasSession: s.hasSession,
      hasFrame: s.hasFrame,
      lastUpdate: s.lastUpdate,
      lastClearReason: s.lastClearReason,
    });
  });
}