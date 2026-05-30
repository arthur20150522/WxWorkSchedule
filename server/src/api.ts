import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { BotManager } from './botManager.js';
import { getDb, addLog, Task, Template, Contact } from './dbManager.js';
import { verifyPassword, generateToken } from './auth.js';
import { authenticateToken, AuthRequest } from './authMiddleware.js';
import { wxBridge } from './wxBridge.js';
import { taskQueue } from './taskQueue.js';

const app = express();
app.use(cors());
app.use(bodyParser.json());

const handleError = (res: express.Response, e: unknown) => {
  console.error(e);
  const message = e instanceof Error ? e.message : 'Unknown internal server error';
  res.status(500).json({ error: message });
};

// ── Login ────────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  try {
    const isValid = await verifyPassword(username, password);
    if (isValid) {
      const token = generateToken(username);
      await addLog('info', `User "${username}" logged in from ${ip}`);
      res.json({ success: true, token, username });
    } else {
      console.warn(`[Auth] Failed login for "${username}" from ${ip}`);
      res.status(401).json({ error: 'Invalid credentials' });
    }
  } catch (e) {
    handleError(res, e);
  }
});

// ── Protected routes ─────────────────────────────────────
const apiRouter = express.Router();
apiRouter.use(authenticateToken);

// Logout
apiRouter.post('/logout', async (req, res) => {
  try {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    await addLog('info', `Admin logged out from ${ip}`);
    res.json({ success: true });
  } catch (e) {
    handleError(res, e);
  }
});

// ── Bot Status (含队列信息 + 任务大盘) ───────────────────
apiRouter.get('/status', async (_req, res) => {
  try {
    let online = false;
    let error: string | null = null;
    try {
      const s = await wxBridge.status();
      online = s.connected;
      if (s.error) error = s.error;
    } catch (e) {
      error = (e as Error).message;
    }

    const botStatus = BotManager.getStatus();
    const lastError = taskQueue.lastError || error;

    // 任务大盘 — 按重复类型统计
    const db = await getDb();
    const all = db.data.tasks;
    const now = new Date();
    const taskStats = {
      total: all.length,
      once: all.filter(t => (t.recurrence || 'once') === 'once').length,
      daily: all.filter(t => t.recurrence === 'daily').length,
      weekly: all.filter(t => t.recurrence === 'weekly').length,
      monthly: all.filter(t => t.recurrence === 'monthly').length,
      interval: all.filter(t => t.recurrence === 'interval').length,
      pending: all.filter(t => t.status === 'pending').length,
      failed: all.filter(t => t.status === 'failed').length,
      overduePending: all.filter(t => t.status === 'pending' && new Date(t.scheduleTime) <= now).length,
    };

    res.json({
      online: online && botStatus.online,
      queueLength: taskQueue.length,
      currentTarget: taskQueue.currentTarget,
      lastError: lastError || undefined,
      loginTime: botStatus.loginTime,
      taskStats,
    });
  } catch (e) {
    handleError(res, e);
  }
});

// Restart bridge
apiRouter.post('/bot/restart', async (req, res) => {
  try {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    await addLog('info', `Bridge restart requested from ${ip}`);
    const ok = await BotManager.restart();
    res.json({ success: ok, message: ok ? 'Bridge reconnected' : 'Bridge not reachable' });
  } catch (e) {
    await addLog('error', `Bridge restart failed: ${e instanceof Error ? e.message : String(e)}`);
    handleError(res, e);
  }
});

// ── Contacts (通讯录 CRUD) ───────────────────────────────
apiRouter.get('/contacts', async (_req, res) => {
  try {
    const db = await getDb();
    res.json(db.data.contacts || []);
  } catch (e) {
    handleError(res, e);
  }
});

apiRouter.post('/contacts', async (req, res) => {
  try {
    const db = await getDb();
    const contact: Contact = {
      id: Date.now().toString(),
      name: req.body.name,
      type: req.body.type || 'contact',
      note: req.body.note || '',
      createdAt: new Date().toISOString(),
    };
    await db.update(({ contacts }) => contacts.push(contact));
    await addLog('info', `Added contact: ${contact.name} (${contact.type})`);
    res.json(contact);
  } catch (e) {
    handleError(res, e);
  }
});

apiRouter.put('/contacts/:id', async (req, res) => {
  try {
    const db = await getDb();
    const { id } = req.params;
    let updated: Contact | null = null;
    await db.update(({ contacts }) => {
      const index = contacts.findIndex(c => c.id === id);
      if (index > -1) {
        contacts[index] = { ...contacts[index], ...req.body, id };
        updated = contacts[index];
      }
    });
    if (updated) {
      await addLog('info', `Updated contact: ${id}`);
      res.json(updated);
    } else {
      res.status(404).json({ error: 'Contact not found' });
    }
  } catch (e) {
    handleError(res, e);
  }
});

apiRouter.delete('/contacts/:id', async (req, res) => {
  try {
    const db = await getDb();
    const { id } = req.params;
    await db.update(({ contacts }) => {
      const idx = contacts.findIndex(c => c.id === id);
      if (idx > -1) contacts.splice(idx, 1);
    });
    await addLog('info', `Deleted contact: ${id}`);
    res.json({ success: true });
  } catch (e) {
    handleError(res, e);
  }
});

// Scan helper — search WeChat contacts/groups by keyword
apiRouter.get('/contacts/scan', async (req, res) => {
  const q = (req.query.q as string) || '';
  if (!q) return res.json({ results: [] });
  try {
    const results = await wxBridge.search(q, 'all');
    res.json({ results });
  } catch (e) {
    handleError(res, e);
  }
});

// ── Templates ────────────────────────────────────────────
apiRouter.get('/templates', async (_req, res) => {
  try {
    const db = await getDb();
    res.json(db.data.templates || []);
  } catch (e) {
    handleError(res, e);
  }
});

apiRouter.post('/templates', async (req, res) => {
  try {
    const db = await getDb();
    const template: Template = {
      id: Date.now().toString(),
      ...req.body,
      createdAt: new Date().toISOString(),
    };
    await db.update(({ templates }) => {
      if (!templates) (templates as any) = [];
      templates.push(template);
    });
    await addLog('info', `Created template: ${template.name}`);
    res.json(template);
  } catch (e) {
    handleError(res, e);
  }
});

apiRouter.put('/templates/:id', async (req, res) => {
  try {
    const db = await getDb();
    const { id } = req.params;
    let updated: Template | null = null;
    await db.update(({ templates }) => {
      const index = templates.findIndex(t => t.id === id);
      if (index > -1) {
        templates[index] = { ...templates[index], ...req.body, id };
        updated = templates[index];
      }
    });
    if (updated) {
      await addLog('info', `Updated template: ${id}`);
      res.json(updated);
    } else {
      res.status(404).json({ error: 'Template not found' });
    }
  } catch (e) {
    handleError(res, e);
  }
});

apiRouter.delete('/templates/:id', async (req, res) => {
  try {
    const db = await getDb();
    const { id } = req.params;
    await db.update(({ templates }) => {
      const idx = templates.findIndex(t => t.id === id);
      if (idx > -1) templates.splice(idx, 1);
    });
    await addLog('info', `Deleted template: ${id}`);
    res.json({ success: true });
  } catch (e) {
    handleError(res, e);
  }
});

// ── Tasks ────────────────────────────────────────────────
apiRouter.get('/tasks', async (_req, res) => {
  try {
    const db = await getDb();
    res.json(db.data.tasks);
  } catch (e) {
    handleError(res, e);
  }
});

apiRouter.post('/tasks', async (req, res) => {
  try {
    const db = await getDb();
    const task: Task = {
      id: Date.now().toString(),
      ...req.body,
      recurrence: req.body.recurrence || 'once',
      status: 'pending',
      currentContentIndex: 0,
      createdAt: new Date().toISOString(),
    };
    await db.update(({ tasks }) => tasks.push(task));
    await addLog('info', `Task ${task.id}【${task.targetName}】已创建 (${task.recurrence})`);
    res.json(task);
  } catch (e) {
    handleError(res, e);
  }
});

apiRouter.put('/tasks/:id', async (req, res) => {
  try {
    const db = await getDb();
    const { id } = req.params;
    let updatedTask: Task | null = null;
    await db.update(({ tasks }) => {
      const index = tasks.findIndex(t => String(t.id) === String(id));
      if (index > -1) {
        const existing = tasks[index];
        const merged: Task = {
          ...existing,
          ...req.body,
          id: existing.id,
          createdAt: existing.createdAt,
          updatedAt: new Date().toISOString(),
        };
        // Reset failed/success tasks to pending
        if (['success', 'failed', 'processing'].includes(existing.status)) {
          merged.status = 'pending';
          merged.error = undefined;
        }
        tasks[index] = merged;
        updatedTask = merged;
      }
    });
    if (updatedTask) {
      await addLog('info', `Updated task ${id}`);
      res.json(updatedTask);
    } else {
      res.status(404).json({ error: 'Task not found' });
    }
  } catch (e) {
    handleError(res, e);
  }
});

apiRouter.delete('/tasks/batch-delete', async (req, res) => {
  try {
    const db = await getDb();
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Invalid or empty ids array' });
    }
    let deletedCount = 0;
    await db.update(({ tasks }) => {
      for (let i = tasks.length - 1; i >= 0; i--) {
        if (ids.includes(tasks[i].id)) {
          tasks.splice(i, 1);
          deletedCount++;
        }
      }
    });
    await addLog('info', `Batch deleted ${deletedCount} tasks`);
    res.json({ success: true, count: deletedCount });
  } catch (e) {
    handleError(res, e);
  }
});

apiRouter.delete('/tasks/:id', async (req, res) => {
  try {
    const db = await getDb();
    const { id } = req.params;
    let deleted = false;
    await db.update(({ tasks }) => {
      const index = tasks.findIndex(t => String(t.id) === String(id));
      if (index > -1) {
        tasks.splice(index, 1);
        deleted = true;
      }
    });
    if (deleted) {
      await addLog('info', `Task ${id} deleted`);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Task not found' });
    }
  } catch (e) {
    handleError(res, e);
  }
});

// ── Logs ─────────────────────────────────────────────────
apiRouter.get('/logs', async (_req, res) => {
  try {
    const db = await getDb();
    res.json(db.data.logs.slice(-100).reverse());
  } catch (e) {
    handleError(res, e);
  }
});

// ── Data Export / Import ─────────────────────────────────
// 全量导出（不含日志）
apiRouter.get('/data/export', async (_req, res) => {
  try {
    const db = await getDb();
    const { logs, ...rest } = db.data;
    res.json(rest);
  } catch (e) {
    handleError(res, e);
  }
});

// 全量导入（合并模式：同 id 跳过，新数据追加）
apiRouter.post('/data/import', async (req, res) => {
  try {
    const incoming = req.body;
    if (!incoming || typeof incoming !== 'object') {
      return res.status(400).json({ error: 'Invalid data format' });
    }

    const db = await getDb();
    let added = { contacts: 0, templates: 0, tasks: 0 };

    await db.update((data) => {
      if (Array.isArray(incoming.contacts)) {
        for (const c of incoming.contacts) {
          if (!c.id || !c.name) continue;
          if (!data.contacts.find(x => x.id === c.id)) {
            data.contacts.push(c);
            added.contacts++;
          }
        }
      }
      if (Array.isArray(incoming.templates)) {
        for (const t of incoming.templates) {
          if (!t.id || !t.name) continue;
          if (!data.templates.find(x => x.id === t.id)) {
            data.templates.push(t);
            added.templates++;
          }
        }
      }
      if (Array.isArray(incoming.tasks)) {
        for (const t of incoming.tasks) {
          if (!t.id || !t.targetName) continue;
          if (!data.tasks.find(x => x.id === t.id)) {
            data.tasks.push(t);
            added.tasks++;
          }
        }
      }
    });

    const total = added.contacts + added.templates + added.tasks;
    await addLog('info', `Data imported: ${added.contacts}C + ${added.templates}T + ${added.tasks}K = ${total}`);
    res.json({ success: true, ...added, total });
  } catch (e) {
    handleError(res, e);
  }
});

// ── Live Send ────────────────────────────────────────────
apiRouter.post('/send-live', async (req, res) => {
  const { targetName, targetType, content } = req.body;
  if (!targetName || !targetType || !content) {
    return res.status(400).json({ success: false, error: 'targetName, targetType, and content are required' });
  }
  if (!['group', 'contact'].includes(targetType)) {
    return res.status(400).json({ success: false, error: 'targetType must be "group" or "contact"' });
  }

  const startTime = Date.now();
  try {
    const result = await wxBridge.send(targetName, content, targetType);
    const duration = Date.now() - startTime;

    if (result.success) {
      await addLog('info', `Live send to [${targetType}] ${targetName}: success (${duration}ms)`);
    } else {
      await addLog('error', `Live send to [${targetType}] ${targetName}: failed — ${result.error || 'unknown'}`);
    }

    res.json({ success: result.success, duration, error: result.error || null });
  } catch (e) {
    const duration = Date.now() - startTime;
    const error = (e as Error).message;
    await addLog('error', `Live send to [${targetType}] ${targetName}: exception — ${error}`);
    res.json({ success: false, duration, error });
  }
});

app.use('/api', apiRouter);
export { app };
