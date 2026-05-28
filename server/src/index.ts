import 'dotenv/config';
import { app } from './api.js';
import { startScheduler } from './scheduler.js';
import { BotManager } from './botManager.js';
import express from 'express';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = process.env.PORT || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const main = async () => {
  // Try to connect to wx4py bridge at startup
  const connected = await BotManager.initBridge();
  if (connected) {
    console.log('[Server] wx4py bridge connected on startup');
  } else {
    console.warn('[Server] wx4py bridge not available on startup — will retry on first API call');
  }

  // Serve frontend static files (no separate Nginx needed)
  const clientDist = join(__dirname, '../../client/dist');
  app.use(express.static(clientDist));
  // SPA fallback — only for non-API routes
  app.get(/^(?!\/api).*$/, (_req, res) => {
    res.sendFile(join(clientDist, 'index.html'));
  });

  app.options(/(.*)/, (_req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    res.header('Access-Control-Allow-Headers', 'DNT,X-Mx-ReqToken,Keep-Alive,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Authorization');
    res.sendStatus(204);
  });

  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });

  startScheduler();
};

main().catch(console.error);
