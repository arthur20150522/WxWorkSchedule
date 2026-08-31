import 'dotenv/config';
import { app } from './api.js';
import { initDB, getDb, addLog } from './dbManager.js';
import { BotManager } from './botManager.js';
import { startScheduler } from './scheduler.js';
import { wxBridge } from './wxBridge.js';
import { execSync } from 'child_process';
import express from 'express';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const PORT = process.env.PORT || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
/** Check every minute and run at 06:30 each day (after WeChat 6am kick) */
function startAutoRecover() {
    let lastRunDate = '';
    setInterval(async () => {
        const now = new Date();
        const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
        const hour = now.getHours();
        const minute = now.getMinutes();
        if (hour === 6 && minute === 30 && dateStr !== lastRunDate) {
            lastRunDate = dateStr;
            try {
                const db = await getDb();
                let recovered = 0;
                let resetToToday = 0;
                await db.update(({ tasks }) => {
                    for (const t of tasks) {
                        // 1. Recover failed recurring tasks
                        if (t.status === 'failed' && t.recurrence && t.recurrence !== 'once') {
                            t.status = 'pending';
                            t.error = undefined;
                            recovered++;
                        }
                        // 2. Reset tasks that were pushed forward during outage
                        else if (t.status === 'pending' && t.recurrence && t.recurrence !== 'once' &&
                            t.error && t.error.includes('已推到下次')) {
                            const oldTime = new Date(t.scheduleTime);
                            if (!isNaN(oldTime.getTime())) {
                                const today = new Date();
                                today.setHours(0, 0, 0, 0);
                                const newTime = new Date(today);
                                newTime.setHours(oldTime.getHours(), oldTime.getMinutes(), 0, 0);
                                t.scheduleTime = newTime.toISOString();
                                t.error = undefined;
                                resetToToday++;
                            }
                        }
                    }
                });
                if (recovered > 0 || resetToToday > 0) {
                    console.log(`[AutoRecover] 06:30 — recovered ${recovered} failed + ${resetToToday} pushed-back tasks`);
                    await addLog('info', `auto-recover 06:30: ${recovered} 失败恢复 + ${resetToToday} 已推到下次回归今日`);
                }
            }
            catch (e) {
                console.error('[AutoRecover] Failed:', e.message);
            }
        }
    }, 60000);
}
const main = async () => {
    // Polyfill fetch for Node.js < 18
    if (!globalThis.fetch) {
        const { default: nodeFetch } = await import('node-fetch');
        globalThis.fetch = nodeFetch;
    }
    // 1. Initialize database
    await initDB();
    console.log('[Server] Database initialized');
    // 2. Initialize bot (wx4py bridge)
    const connected = await BotManager.init();
    if (connected) {
        console.log('[Server] wx4py bridge connected on startup');
    }
    else {
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
    // 6. Daily auto-recover — reset pushed tasks at 06:30
    startAutoRecover();
    console.log('[AutoRecover] Enabled — runs daily at 06:30');
    // 6b. WeChat auto-restart schedule — continuous suppression during kill→launch window
    // Strategy: while in the closed window, taskkill every 30s to beat WeChat auto-restart.
    setInterval(async () => {
        try {
            const db = await getDb();
            const schedule = db.data.wechatSchedule;
            if (!schedule || !schedule.enabled)
                return;
            // A DB/UI toggle must never be enough on its own to kill WeChat.  The
            // explicit environment gate prevents an accidental 03:00 schedule from
            // looking like a platform/security logout.  Leave this unset for normal
            // always-online operation.
            if (process.env.ALLOW_WECHAT_PROCESS_KILL !== 'true')
                return;
            const now = new Date();
            const hh = now.getHours();
            const mm = now.getMinutes();
            const currentMin = hh * 60 + mm;
            const [kh, km] = schedule.killTime.split(':').map(Number);
            const [lh, lm] = schedule.launchTime.split(':').map(Number);
            const killMin = kh * 60 + km;
            const launchMin = lh * 60 + lm;
            // Are we in the suppressed window? (killTime ≤ now < launchTime)
            const inWindow = killMin < launchMin
                ? (currentMin >= killMin && currentMin < launchMin)
                : (currentMin >= killMin || currentMin < launchMin);
            if (inWindow) {
                // Keep WeChat dead — kill all known exe names
                const exes = ['Weixin.exe', 'WeChatAppEx.exe', 'WeChat.exe'];
                for (const exe of exes) {
                    try {
                        execSync(`taskkill /F /IM ${exe}`, { encoding: 'utf-8', timeout: 3000, stdio: 'pipe' });
                    }
                    catch { /* not running — fine */ }
                }
            }
            else if (hh === lh && mm >= lm && mm < lm + 5) {
                // At launch time + 5m window: retry launch (WeChat may crash)
                try {
                    const result = await wxBridge.fetchBridge('/wechat-launch', 'POST');
                    if (result.launched) {
                        console.log(`[WeChatSched] Launch at ${schedule.launchTime}: ${result.message || 'ok'}`);
                        await addLog('info', `WeChat 定时拉起: ${result.message || 'ok'}`);
                    }
                }
                catch (e) {
                    console.error(`[WeChatSched] Launch failed: ${e.message}`);
                }
            }
        }
        catch (e) {
            // silently ignore
        }
    }, 30000);
    console.log('[WeChatSched] Suppression checker started — every 30s');
    // 7. Health monitor — push notification when WeChat goes offline
    BotManager.startHealthMonitor();
};
main().catch(console.error);
