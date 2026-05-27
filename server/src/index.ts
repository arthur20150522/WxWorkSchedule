import 'dotenv/config';
import { app } from './api.js';
import { startScheduler } from './scheduler.js';
import { BotManager } from './botManager.js';
import express from 'express';

const PORT = process.env.PORT || 3000;

const main = async () => {
  // Try to connect to wx4py bridge at startup
  const connected = await BotManager.initBridge();
  if (connected) {
    console.log('[Server] wx4py bridge connected on startup');
  } else {
    console.warn('[Server] wx4py bridge not available on startup — will retry on first API call');
  }

  app.use((_req, _res, next) => {
    next();
  });

  app.options(/(.*)/, (_req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    res.header('Access-Control-Allow-Headers', 'DNT,X-Mx-ReqToken,Keep-Alive,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Authorization');
    res.sendStatus(204);
  });

  app.listen(PORT, () => {
    console.log(`API Server running at http://localhost:${PORT}`);
  });

  startScheduler();
};

main().catch(console.error);
