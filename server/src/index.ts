import 'dotenv/config';
import { app } from './api.js';
import { initDB, getDb, addLog } from './dbManager.js';
import { BotManager } from './botManager.js';
import { startScheduler } from './scheduler.js';
import express from 'express';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = process.env.PORT || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Check every minute and run at 06:00 each day */
function startAutoRecover() {
  let lastRunDate = '';
  setInterval(async () => {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
    const hour = now.getHours();
    const minute = now.getMinutes();
    if (hour === 6 && minute === 0 && dateStr !== lastRunDate) {
      lastRunDate = dateStr;
      try {
        const db = await getDb();
        let count = 0;
        await db.update(({ tasks }) => {
          for (const t of tasks) {
            if (t.status === 'failed' && t.recurrence && t.recurrence !== 'once') {
              t.status = 'pending';
              t.error = undefined;
              count++;
            }
          }
        });
        if (count > 0) {
          console.log(`[AutoRecover] Recovered ${count} failed recurring tasks → pending`);
          await addLog('info', `自动恢复: ${count} 个失败周期任务 → pending`);
        }
      } catch (e) {
        console.error('[AutoRecover] Failed:', (e as Error).message);
      }
    }
  }, 60000);
}

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

  // 6. Daily auto-recover failed recurring tasks at 06:00
  startAutoRecover();
  console.log('[AutoRecover] Enabled — runs daily at 06:00');
};

main().catch(console.error);
