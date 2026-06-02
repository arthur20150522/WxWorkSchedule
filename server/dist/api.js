import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { verifyPassword, generateToken, verifyToken } from './auth.js';
import { BotManager } from './botManager.js';
import { addLog } from './dbManager.js';
import { wxBridge } from './wxBridge.js';

const app = express();
app.use(cors());
app.use(bodyParser.json());

const handleError = (res, e) => {
    console.error(e);
    res.status(500).json({ error: e.message || 'Internal error' });
};

// ── Auth middleware ─────────────────────────────────────────
function auth(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
        return res.status(401).json({ error: '未登录' });
    }
    const user = verifyToken(header.slice(7));
    if (!user) return res.status(401).json({ error: '登录过期' });
    req.user = user;
    next();
}

// ── Login ──────────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: '缺少用户名或密码' });
        const ok = await verifyPassword(username, password);
        if (!ok) return res.status(401).json({ error: '用户名或密码错误' });
        const token = generateToken(username);
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        await addLog(username, 'info', `User ${username} logged in from ${ip}`);
        res.json({ token, username });
    } catch (e) { handleError(res, e); }
});

// ── Logout ─────────────────────────────────────────────────
app.post('/api/logout', auth, async (req, res) => {
    try {
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        await addLog(req.user, 'info', `User ${req.user} logged out from ${ip}`);
        res.json({ success: true });
    } catch (e) { handleError(res, e); }
});

// ── Bot Status ─────────────────────────────────────────────
app.get('/api/status', auth, async (req, res) => {
    try {
        let connected = false, error = null, bridgeState = 'unknown';
        try {
            const s = await wxBridge.status();
            connected = s.connected;
            bridgeState = s.state || 'unknown';
            if (s.error) error = s.error;
        } catch (e) { error = e.message; }
        const loginTime = BotManager.getLoginTime();
        res.json({
            online: connected, bridgeState,
            status: connected ? 'logged_in' : 'offline',
            ready: connected,
            user: connected ? { name: 'WeChat User', id: 'wx4py_user' } : null,
            loginTime: connected ? loginTime : null,
            error,
        });
    } catch (e) { handleError(res, e); }
});

// ── Bridge Recover (尝试登录) ──────────────────────────────
app.post('/api/bridge/recover', auth, async (req, res) => {
    try {
        const result = await wxBridge.recover();
        await addLog(req.user, 'info', `手动触发微信恢复: ${JSON.stringify(result)}`);
        res.json(result);
    } catch (e) { handleError(res, e); }
});

// ── Tasks ──────────────────────────────────────────────────
let TaskQueue = null;
let DBManager = null;
async function getDB() {
    if (!DBManager) {
        const mod = await import('./dbManager.js');
        DBManager = mod;
    }
    return DBManager;
}

app.get('/api/tasks', auth, async (req, res) => {
    try { res.json(TaskQueue ? TaskQueue.getAll() : []); }
    catch (e) { handleError(res, e); }
});

app.post('/api/tasks/cancel-pending', auth, async (req, res) => {
    try {
        if (!TaskQueue) return res.json({ cancelled: 0, rescheduled: 0 });
        const r = TaskQueue.cancelPending?.() || { cancelled: 0, rescheduled: 0 };
        res.json(r);
    } catch (e) { handleError(res, e); }
});

// ── Lazy init TaskQueue on first DB use ────────────────────
import('./dbManager.js').then(async (db) => {
    const { initDB } = db;
    await initDB();
    import('./taskQueue.js').then(({ TaskQueue: TQ }) => {
        TaskQueue = TQ;
        TQ.setDB?.(db);
    }).catch(() => {});
}).catch(() => {});

export { app };
