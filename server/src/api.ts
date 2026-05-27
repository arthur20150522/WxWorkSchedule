import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { BotManager } from './botManager.js';
import { DBManager, Task, addLog, Template } from './dbManager.js';
import { UserManager } from './userManager.js';
import { authenticateToken, generateToken, AuthRequest } from './authMiddleware.js';
import { wxBridge } from './wxBridge.js';

const app = express();
app.use(cors());
app.use(bodyParser.json());

const DEFAULT_USER = 'admin';

const handleError = (res: express.Response, e: unknown) => {
    console.error(e);
    const message = e instanceof Error ? e.message : 'Unknown internal server error';
    res.status(500).json({ error: message });
};

// ── Login ──────────────────────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username) return res.status(400).json({ error: 'Username is required' });

    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    try {
        const isValid = await UserManager.verifyUser(username, password);
        if (isValid) {
            const token = generateToken(username);
            BotManager.getBot(username);
            await addLog(username, 'info', `User ${username} logged in from ${ip}`);

            // Background cache warm
            try {
                const groups = await wxBridge.groups();
                BotManager.cacheRooms(username, groups);
                const contacts = await wxBridge.contacts();
                BotManager.cacheContacts(username, contacts);
            } catch (e) {
                console.warn('[Login] Cache warm skipped:', (e as Error).message);
            }

            res.json({ success: true, token, username });
        } else {
            console.warn(`Failed login attempt for ${username} from ${ip}`);
            res.status(401).json({ error: 'Invalid credentials' });
        }
    } catch (e) {
        handleError(res, e);
    }
});

// ── Server IP ──────────────────────────────────────────────────────────
app.get('/api/server-ip', async (_req, res) => {
    try {
        const resp = await fetch('https://api.ipify.org?format=json');
        const data = await resp.json() as { ip: string };
        res.json({ ip: data.ip });
    } catch {
        res.json({ ip: 'unknown' });
    }
});

// ── Protected routes ───────────────────────────────────────────────────
const apiRouter = express.Router();
apiRouter.use(authenticateToken);

// Logout
apiRouter.post('/logout', async (req, res) => {
    try {
        const user = (req as AuthRequest).user!;
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        await addLog(user, 'info', `User ${user} logged out from ${ip}`);
        res.json({ success: true });
    } catch (e) {
        handleError(res, e);
    }
});

// Bot Status
apiRouter.get('/status', async (req, res) => {
    try {
        const user = (req as AuthRequest).user!;
        let connected = false;
        let error: string | null = null;
        try {
            const s = await wxBridge.status();
            connected = s.connected;
            if (s.error) error = s.error;
        } catch (e) {
            error = (e as Error).message;
        }

        const loginTime = BotManager.getLoginTime();
        const status = connected ? 'logged_in' : 'offline';

        res.json({
            status,
            ready: connected,
            user: connected ? { name: 'WeChat User', id: 'wx4py_user' } : null,
            loginTime: connected ? loginTime : null,
            error,
        });
    } catch (e) {
        handleError(res, e);
    }
});

// Restart bridge
apiRouter.post('/bot/restart', async (req, res) => {
    const user = (req as AuthRequest).user!;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    try {
        await addLog(user, 'info', `Bridge restart requested from ${ip}`);
        await BotManager.stopBot(user);
        BotManager.clearCache(user);
        const ok = await BotManager.initBridge();
        res.json({ success: ok, message: ok ? 'Bridge reconnected' : 'Bridge not reachable' });
    } catch (e) {
        await addLog(user, 'error', `Bridge restart failed: ${e instanceof Error ? e.message : String(e)}`);
        handleError(res, e);
    }
});

// QR — always null with wx4py (WeChat is pre-logged-in)
apiRouter.get('/qr', (_req, res) => {
    res.json({ qr: null });
});

// Search groups & contacts
apiRouter.get('/search', async (req, res) => {
    const user = (req as AuthRequest).user!;
    const q = (req.query.q as string) || '';
    const type = (req.query.type as string) || 'all';
    if (!q || q.length < 1) {
        return res.json({ results: [] });
    }
    try {
        const results = await wxBridge.search(q, type as any);
        res.json({ results });
    } catch (e) {
        handleError(res, e);
    }
});

// Get Groups — via bridge scan
apiRouter.get('/groups', async (req, res) => {
    const user = (req as AuthRequest).user!;
    try {
        const groups = await wxBridge.groups();
        BotManager.cacheRooms(user, groups);
        res.json(groups);
    } catch (e) {
        handleError(res, e);
    }
});

// Get Contacts — via bridge scan
apiRouter.get('/contacts', async (req, res) => {
    const user = (req as AuthRequest).user!;
    try {
        const contacts = await wxBridge.contacts();
        BotManager.cacheContacts(user, contacts);
        res.json(contacts);
    } catch (e) {
        handleError(res, e);
    }
});

// ── Templates (unchanged) ──────────────────────────────────────────────
apiRouter.get('/templates', async (req, res) => {
    try {
        const user = (req as AuthRequest).user!;
        const db = await DBManager.getDb(user);
        res.json(db.data.templates || []);
    } catch (e) { handleError(res, e); }
});

apiRouter.post('/templates', async (req, res) => {
    try {
        const user = (req as AuthRequest).user!;
        const db = await DBManager.getDb(user);
        const template: Template = { id: Date.now().toString(), ...req.body, createdAt: new Date().toISOString() };
        await db.update(({ templates }) => { if (!templates) templates = []; templates.push(template); });
        await addLog(user, 'info', `Created template ${template.name}`);
        res.json(template);
    } catch (e) { handleError(res, e); }
});

apiRouter.put('/templates/:id', async (req, res) => {
    try {
        const user = (req as AuthRequest).user!;
        const db = await DBManager.getDb(user);
        const { id } = req.params;
        let updated: Template | null = null;
        await db.update(({ templates }) => {
            const index = templates.findIndex(t => t.id === id);
            if (index > -1) { templates[index] = { ...templates[index], ...req.body, id }; updated = templates[index]; }
        });
        if (updated) { await addLog(user, 'info', `Updated template ${id}`); res.json(updated); }
        else res.status(404).json({ error: 'Template not found' });
    } catch (e) { handleError(res, e); }
});

apiRouter.delete('/templates/:id', async (req, res) => {
    try {
        const user = (req as AuthRequest).user!;
        const db = await DBManager.getDb(user);
        const { id } = req.params;
        await db.update(({ templates }) => { const idx = templates.findIndex(t => t.id === id); if (idx > -1) templates.splice(idx, 1); });
        await addLog(user, 'info', `Deleted template ${id}`);
        res.json({ success: true });
    } catch (e) { handleError(res, e); }
});

// ── Tasks ──────────────────────────────────────────────────────────────
apiRouter.get('/tasks', async (req, res) => {
    try {
        const user = (req as AuthRequest).user!;
        const db = await DBManager.getDb(user);
        res.json(db.data.tasks);
    } catch (e) { handleError(res, e); }
});

apiRouter.post('/tasks', async (req, res) => {
    try {
        const user = (req as AuthRequest).user!;
        const db = await DBManager.getDb(user);
        const task: Task = {
            id: Date.now().toString(),
            ...req.body,
            recurrence: req.body.recurrence || 'once',
            status: 'pending',
            createdAt: new Date().toISOString()
        };
        await db.update(({ tasks }) => tasks.push(task));
        await addLog(user, 'info', `Created task ${task.id} for ${task.targetName} (${task.recurrence})`);
        res.json(task);
    } catch (e) { handleError(res, e); }
});

apiRouter.put('/tasks/:id', async (req, res) => {
    try {
        const user = (req as AuthRequest).user!;
        const db = await DBManager.getDb(user);
        const { id } = req.params;
        let updatedTask: Task | null = null;
        await db.update(({ tasks }) => {
            const index = tasks.findIndex(t => String(t.id) === String(id));
            if (index > -1) {
                const existing = tasks[index];
                const merged: Task = { ...existing, ...req.body, id: existing.id, createdAt: existing.createdAt, updatedAt: new Date().toISOString() };
                if (['success', 'failed', 'processing'].includes(existing.status)) {
                    merged.status = 'pending';
                    merged.error = undefined;
                }
                tasks[index] = merged;
                updatedTask = merged;
            }
        });
        if (updatedTask) { await addLog(user, 'info', `Updated task ${id}`); res.json(updatedTask); }
        else res.status(404).json({ error: 'Task not found' });
    } catch (e) { handleError(res, e); }
});

apiRouter.delete('/tasks/batch-delete', async (req, res) => {
    try {
        const user = (req as AuthRequest).user!;
        const db = await DBManager.getDb(user);
        const { ids } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'Invalid or empty ids array' });
        let deletedCount = 0;
        await db.update(({ tasks }) => {
            for (let i = tasks.length - 1; i >= 0; i--) {
                if (ids.includes(tasks[i].id)) { tasks.splice(i, 1); deletedCount++; }
            }
        });
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        await addLog(user, 'info', `Batch deleted ${deletedCount} tasks from ${ip}`);
        res.json({ success: true, count: deletedCount });
    } catch (e) { handleError(res, e); }
});

apiRouter.delete('/tasks/:id', async (req, res) => {
    try {
        const user = (req as AuthRequest).user!;
        const db = await DBManager.getDb(user);
        const { id } = req.params;
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        let deleted = false;
        await db.update(({ tasks }) => {
            const index = tasks.findIndex(t => String(t.id) === String(id));
            if (index > -1) { tasks.splice(index, 1); deleted = true; }
        });
        if (deleted) { await addLog(user, 'info', `Task ${id} deleted from ${ip}`); res.json({ success: true }); }
        else res.status(404).json({ error: 'Task not found' });
    } catch (e) { handleError(res, e); }
});

// ── Logs ───────────────────────────────────────────────────────────────
apiRouter.get('/logs', async (req, res) => {
    try {
        const user = (req as AuthRequest).user!;
        const db = await DBManager.getDb(user);
        res.json(db.data.logs.slice(-100).reverse());
    } catch (e) { handleError(res, e); }
});

app.use('/api', apiRouter);
export { app };
