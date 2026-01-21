import 'dotenv/config'; // Load .env file
import { app } from './api.js';
import { startScheduler } from './scheduler.js';
import express from 'express';

const PORT = process.env.PORT || 3000;

const main = async () => {
  // 全局请求日志中间件 - 放在最前面
  app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${req.method} ${req.url} - Headers: ${JSON.stringify(req.headers['authorization'] ? {...req.headers, authorization: '***'} : req.headers)}`);
    next();
  });

  // 显式处理 OPTIONS 请求 (防御性编程，以防 Nginx 未拦截)
  app.options(/(.*)/, (req, res) => {
    console.log(`[${new Date().toISOString()}] Handling OPTIONS request in Express`);
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    res.header('Access-Control-Allow-Headers', 'DNT,X-Mx-ReqToken,Keep-Alive,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Authorization');
    res.sendStatus(204);
  });

  // Start Express API
  app.listen(PORT, () => {
    console.log(`API Server running at http://localhost:${PORT}`);
  });

  // Start Scheduler
  startScheduler();
};

main().catch(console.error);
