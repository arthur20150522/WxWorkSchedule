import 'dotenv/config';
import { app } from './api.js';
import { initDB } from './dbManager.js';
import { BotManager } from './botManager.js';
import { startScheduler } from './scheduler.js';
import express from 'express';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = process.env.PORT || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const main = async () => {
  // Polyfill fetch for Node.js < 18
  if (!globalThis.fetch) {
    const { default: nodeFetch } = await import('node-fetch');
    (globalThis as any).fetch = nodeFetch;
  }

  // 1. Initialize database
  await initDB();
  console.log('[Server] Database initialized');

  // 2. Initialize bot (wx4py bridge)
  const connected = await BotManager.init();
  if (connected) {
    console.log('[Server] wx4py bridge connected on startup');
  } else {
    console.warn('[Server] wx4py bridge not available — will retry on demand');
  }

  // 3. Serve frontend static files
  const clientDist = join(__dirname, '../../client/dist');
  app.use(express.static(clientDist));
  // SPA fallback — only for non-API routes
  app.get(/^(?!\/api).*$/, (_req, res) => {
    res.sendFile(join(clientDist, 'index.html'));
  });

  // CORS preflight
  app.options(/(.*)/, (_req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    res.header('Access-Control-Allow-Headers', 'DNT,X-Mx-ReqToken,Keep-Alive,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Authorization');
    res.sendStatus(204);
  });

  // 4. Start HTTP server
  app.listen(PORT, () => {
    console.log(`[Server] Running at http://localhost:${PORT}`);
  });

  // 5. Start scheduler
  startScheduler();
};

main().catch(console.error);
