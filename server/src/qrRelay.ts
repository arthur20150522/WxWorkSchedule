/**
 * QR login relay — receives login-QR screenshots from bridge.py (localhost),
 * hosts them at a short-lived public URL, and pushes via both channels.
 *
 * Security model: the random 32-hex token filename IS the secret.
 * Files auto-delete after QR_TTL_MS and on every new upload.
 */
import express from 'express';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, unlinkSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pushNotify } from './pushNotify.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// dist/qrRelay.js → server/data/qr (same pattern as dbManager: resolve from __dirname, not cwd)
const QR_DIR = join(__dirname, '..', 'data', 'qr');
const QR_TTL_MS = 10 * 60 * 1000; // 10min — WeChat QR itself expires in ~2min
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const QR_SECRET = process.env.QR_PUSH_SECRET || '';
const PUBLIC_BASE = (process.env.PUBLIC_BASE_URL || 'https://wechat.eastpolar.top').replace(/\/+$/, '');

export function registerQrRoutes(app: express.Express): void {
  mkdirSync(QR_DIR, { recursive: true });
  if (!QR_SECRET) {
    console.warn('[QR] QR_PUSH_SECRET not set in .env — /api/qr-notify will reject all uploads');
  }

  // Called by bridge.py over localhost when WeChat shows the QR login window.
  app.post('/api/qr-notify', async (req, res) => {
    try {
      const { secret, image, reason } = req.body || {};
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

      // Only keep the latest QR — wipe previous files
      for (const f of readdirSync(QR_DIR)) {
        try { unlinkSync(join(QR_DIR, f)); } catch { /* ignore */ }
      }

      const file = `${randomBytes(16).toString('hex')}.png`;
      writeFileSync(join(QR_DIR, file), buf);
      setTimeout(() => {
        try { unlinkSync(join(QR_DIR, file)); } catch { /* already gone */ }
      }, QR_TTL_MS);

      const url = `${PUBLIC_BASE}/api/qr/${file}`;
      console.log(`[QR] Login QR received (${buf.length}B) → ${url}`);
      await pushNotify(
        '微信掉线，请扫码重登',
        reason || '服务器微信已退出登录。二维码约 2 分钟有效，请尽快用微信扫一扫（可从相册选择图片）',
        url,
      );
      res.json({ ok: true, url, ttlMinutes: QR_TTL_MS / 60000 });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // Public image serving — no auth: the unguessable token filename is the credential.
  app.get('/api/qr/:file', (req, res) => {
    const file = req.params.file;
    if (!/^[a-f0-9]{32}\.png$/.test(file)) {
      return res.status(404).end();
    }
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(join(QR_DIR, file), (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  });
}
