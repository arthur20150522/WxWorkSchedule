import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { verifyPassword, generateToken, verifyToken } from './auth.js';
import { BotManager } from './botManager.js';
import { DBManager, addLog, initDB } from './dbManager.js';
import { wxBridge } from './wxBridge.js';

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));

const handleError = (res, e) => {
    console.error(e);
    res.status(500).json({ error: e.message || 'Internal error' });
};

function auth(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) return res.status(401).json({ error: '未登录' });
    const user = verifyToken(header.slice(7));
    if (!user) return res.status(401).json({ error: '登录过期' });
    req.user = user;
    next();
}

// ── Login/Logout ──────────────────────────────────────────
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: '缺少用户名或密码' });
        const ok = await verifyPassword(username, password);
        if (!ok) return res.status(401).json({ error: '用户名或密码错误' });
        res.json({ token: generateToken(username), username });
    } catch (e) { handleError(res, e); }
});

app.post('/api/logout', auth, async (req, res) => {
    try { res.json({ success: true }); } catch (e) { handleError(res, e); }
});

// ── Status ────────────────────────────────────────────────
app.get('/api/status', auth, async (req, res) => {
    try {
        const db = await DBManager.getDb('default');
        const tasks = db.data.tasks || [];
        let connected = false, error = null, bridgeState = 'unknown';
        try {
            const s = await wxBridge.status();
            connected = s.connected;
            bridgeState = s.state || 'unknown';
            if (s.error) error = s.error;
        } catch (e) { error = e.message; }
        let taskStats = { total: tasks.length, once: 0, daily: 0, weekly: 0, monthly: 0, interval: 0, pending: 0, failed: 0, overduePending: 0 };
        tasks.forEach(t => {
            taskStats[t.recurrence || 'once'] = (taskStats[t.recurrence || 'once'] || 0) + 1;
            if (t.status === 'pending') taskStats.pending++;
            if (t.status === 'failed') taskStats.failed++;
        });
        res.json({
            online: connected, bridgeState, status: connected ? 'logged_in' : 'offline', ready: connected,
            user: connected ? { name: 'WeChat User', id: 'wx4py_user' } : null,
            loginTime: null, error,
            queueLength: 0, currentTarget: null, lastError: error,
            taskStats,
        });
    } catch (e) { handleError(res, e); }
});

// ── Bridge Recover ────────────────────────────────────────
app.post('/api/bridge/recover', auth, async (req, res) => {
    try {
        const result = await wxBridge.recover();
        await addLog(req.user, 'info', `手动触发微信恢复`);
        res.json(result);
    } catch (e) { handleError(res, e); }
});

// ── Contacts ──────────────────────────────────────────────
app.get('/api/contacts', auth, async (req, res) => {
    try { const db = await DBManager.getDb('default'); res.json(db.data.contacts || []); }
    catch (e) { handleError(res, e); }
});
app.post('/api/contacts', auth, async (req, res) => {
    try {
        const db = await DBManager.getDb('default');
        const contact = { id: Date.now().toString(), createdAt: new Date().toISOString(), ...req.body };
        await db.update(({ contacts }) => contacts.push(contact));
        res.json(contact);
    } catch (e) { handleError(res, e); }
});
app.put('/api/contacts/:id', auth, async (req, res) => {
    try {
        const db = await DBManager.getDb('default');
        let updated = null;
        await db.update(({ contacts }) => {
            const idx = contacts.findIndex(c => c.id === req.params.id);
            if (idx >= 0) { contacts[idx] = { ...contacts[idx], ...req.body }; updated = contacts[idx]; }
        });
        updated ? res.json(updated) : res.status(404).json({ error: 'not found' });
    } catch (e) { handleError(res, e); }
});
app.delete('/api/contacts/:id', auth, async (req, res) => {
    try {
        const db = await DBManager.getDb('default');
        await db.update(({ contacts }) => contacts.splice(contacts.findIndex(c => c.id === req.params.id), 1));
        res.json({ success: true });
    } catch (e) { handleError(res, e); }
});
app.get('/api/contacts/scan', auth, async (req, res) => {
    try {
        const q = req.query.q || '';
        const results = wxBridge.search ? await wxBridge.search(q, 'all') : [];
        res.json(results);
    } catch (e) { res.json([]); }
});

// ── Tasks ─────────────────────────────────────────────────
app.get('/api/tasks', auth, async (req, res) => {
    try { const db = await DBManager.getDb('default'); res.json(db.data.tasks || []); }
    catch (e) { handleError(res, e); }
});
app.post('/api/tasks', auth, async (req, res) => {
    try {
        const db = await DBManager.getDb('default');
        const task = { id: Date.now().toString(), createdAt: new Date().toISOString(), status: 'pending', currentContentIndex: 0, ...req.body };
        await db.update(({ tasks }) => tasks.push(task));
        res.json(task);
    } catch (e) { handleError(res, e); }
});
app.put('/api/tasks/:id', auth, async (req, res) => {
    try {
        const db = await DBManager.getDb('default');
        let updated = null;
        await db.update(({ tasks }) => {
            const idx = tasks.findIndex(t => t.id === req.params.id);
            if (idx >= 0) { tasks[idx] = { ...tasks[idx], ...req.body }; updated = tasks[idx]; }
        });
        updated ? res.json(updated) : res.status(404).json({ error: 'not found' });
    } catch (e) { handleError(res, e); }
});
app.delete('/api/tasks/:id', auth, async (req, res) => {
    try {
        const db = await DBManager.getDb('default');
        await db.update(({ tasks }) => tasks.splice(tasks.findIndex(t => t.id === req.params.id), 1));
        res.json({ success: true });
    } catch (e) { handleError(res, e); }
});
app.delete('/api/tasks/batch-delete', auth, async (req, res) => {
    try {
        const { ids } = req.body;
        const db = await DBManager.getDb('default');
        const deleted = [];
        await db.update(({ tasks }) => {
            for (const id of ids) {
                const idx = tasks.findIndex(t => t.id === id);
                if (idx >= 0) { deleted.push(tasks[idx]); tasks.splice(idx, 1); }
            }
        });
        res.json({ deleted: deleted.length });
    } catch (e) { handleError(res, e); }
});
app.post('/api/tasks/cancel-pending', auth, async (req, res) => {
    try {
        const db = await DBManager.getDb('default');
        let cancelled = 0, rescheduled = 0;
        await db.update(({ tasks }) => {
            tasks.forEach(t => {
                if (t.status === 'pending' || t.status === 'processing') {
                    if (t.recurrence && t.recurrence !== 'once') { t.status = 'pending'; rescheduled++; }
                    else { t.status = 'failed'; cancelled++; }
                }
            });
        });
        res.json({ cancelled, rescheduled });
    } catch (e) { handleError(res, e); }
});
app.post('/api/tasks/recover-failed', auth, async (req, res) => {
    try {
        const db = await DBManager.getDb('default');
        let count = 0;
        await db.update(({ tasks }) => tasks.forEach(t => { if (t.status === 'failed' && t.recurrence && t.recurrence !== 'once') { t.status = 'pending'; count++; } }));
        res.json({ recovered: count });
    } catch (e) { handleError(res, e); }
});

// ── Templates ─────────────────────────────────────────────
app.get('/api/templates', auth, async (req, res) => {
    try { const db = await DBManager.getDb('default'); res.json(db.data.templates || []); }
    catch (e) { handleError(res, e); }
});
app.post('/api/templates', auth, async (req, res) => {
    try {
        const db = await DBManager.getDb('default');
        const tpl = { id: Date.now().toString(), createdAt: new Date().toISOString(), ...req.body };
        await db.update(({ templates }) => templates.push(tpl));
        res.json(tpl);
    } catch (e) { handleError(res, e); }
});
app.put('/api/templates/:id', auth, async (req, res) => {
    try {
        const db = await DBManager.getDb('default');
        let updated = null;
        await db.update(({ templates }) => {
            const idx = templates.findIndex(t => t.id === req.params.id);
            if (idx >= 0) { templates[idx] = { ...templates[idx], ...req.body }; updated = templates[idx]; }
        });
        updated ? res.json(updated) : res.status(404).json({ error: 'not found' });
    } catch (e) { handleError(res, e); }
});
app.delete('/api/templates/:id', auth, async (req, res) => {
    try {
        const db = await DBManager.getDb('default');
        await db.update(({ templates }) => templates.splice(templates.findIndex(t => t.id === req.params.id), 1));
        res.json({ success: true });
    } catch (e) { handleError(res, e); }
});

// ── Logs ──────────────────────────────────────────────────
app.get('/api/logs', auth, async (req, res) => {
    try { const db = await DBManager.getDb('default'); res.json(db.data.logs || []); }
    catch (e) { handleError(res, e); }
});
app.get('/api/live-logs', auth, async (req, res) => {
    try { const db = await DBManager.getDb('default'); res.json(db.data.liveLogs || []); }
    catch (e) { handleError(res, e); }
});

// ── Live Send ─────────────────────────────────────────────
app.post('/api/send-live', auth, async (req, res) => {
    try {
        const { target, message, targetType } = req.body;
        const start = Date.now();
        const result = await wxBridge.send(target, message, targetType);
        const duration = Date.now() - start;
        const db = await DBManager.getDb('default');
        const logEntry = { id: Date.now().toString() + Math.random().toString(36).slice(2, 8), timestamp: new Date().toISOString(), targetName: target, targetType: targetType || 'contact', content: message, success: true, duration };
        await db.update(({ liveLogs }) => liveLogs.push(logEntry));
        res.json({ success: true, duration, ...result });
    } catch (e) {
        const db = await DBManager.getDb('default');
        const logEntry = { id: Date.now().toString() + Math.random().toString(36).slice(2, 8), timestamp: new Date().toISOString(), targetName: req.body.target, targetType: req.body.targetType || 'contact', content: req.body.message, success: false, duration: 0, error: e.message };
        await db.update(({ liveLogs }) => liveLogs.push(logEntry));
        handleError(res, e);
    }
});

// ── Data Export/Import ────────────────────────────────────
app.get('/api/data/export', auth, async (req, res) => {
    try { const db = await DBManager.getDb('default'); res.json({ contacts: db.data.contacts, tasks: db.data.tasks, templates: db.data.templates }); }
    catch (e) { handleError(res, e); }
});
app.post('/api/data/import', auth, async (req, res) => {
    try {
        const { contacts, tasks, templates } = req.body;
        const db = await DBManager.getDb('default');
        await db.update(d => {
            if (contacts) d.contacts = contacts;
            if (tasks) d.tasks = tasks;
            if (templates) d.templates = templates;
        });
        res.json({ success: true });
    } catch (e) { handleError(res, e); }
});

export { app };
