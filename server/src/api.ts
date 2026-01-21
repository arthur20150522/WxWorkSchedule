import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { BotManager } from './botManager.js';
import { DBManager, Task, addLog, Template } from './dbManager.js';
import { UserManager } from './userManager.js';
import { authenticateToken, generateToken, AuthRequest } from './authMiddleware.js';

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Helper for error handling
const handleError = (res: express.Response, e: unknown) => {
    console.error(e);
    const message = e instanceof Error ? e.message : 'Unknown internal server error';
    res.status(500).json({ error: message });
};

// Login API
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    
    if (!username) {
         return res.status(400).json({ error: 'Username is required' });
    }
    
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    try {
        // Await the async verification (handles bcrypt and migration)
        const isValid = await UserManager.verifyUser(username, password);
        if (isValid) {
            const token = generateToken(username);
            // Ensure bot is initialized for this user
            BotManager.getBot(username);
            
            await addLog(username, 'info', `User ${username} logged in from ${ip}`);
            res.json({ success: true, token, username: username });
        } else {
            console.warn(`Failed login attempt for ${username} from ${ip}`);
            res.status(401).json({ error: 'Invalid credentials' });
        }
    } catch (e) {
        handleError(res, e);
    }
});

// Protected Routes Middleware
const apiRouter = express.Router();
apiRouter.use(authenticateToken);

// Logout API
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
apiRouter.get('/status', (req, res) => {
    try {
        const user = (req as AuthRequest).user!;
        const bot = BotManager.getBot(user);
        
        // Simple status for now
        let currentUserData = null;
        try {
            if (bot.isLoggedIn) {
                 currentUserData = { name: bot.currentUser.name(), id: bot.currentUser.id };
            }
        } catch (e) {
            console.warn('Failed to get currentUser info', e);
        }

        let status = 'offline';
        if (bot.isLoggedIn) {
            status = 'logged_in';
        } else if (BotManager.getQrCode(user)) {
            status = 'waiting_for_scan';
        }

        res.json({
            status,
            ready: bot.isLoggedIn,
            user: currentUserData,
            loginTime: bot.isLoggedIn ? BotManager.getLoginTime(user) : null
        });
    } catch (e) {
        handleError(res, e);
    }
});

// Restart Bot
apiRouter.post('/bot/restart', async (req, res) => {
    const user = (req as AuthRequest).user!;
    try {
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        await addLog(user, 'info', `Bot restart requested from ${ip}`);
        
        await BotManager.stopBot(user);
        BotManager.getBot(user); // Start again
        
        res.json({ success: true, message: 'Bot restarting...' });
    } catch (e) {
        await addLog(user, 'error', `Bot restart failed: ${e instanceof Error ? e.message : String(e)}`);
        handleError(res, e);
    }
});

// QR Code
apiRouter.get('/qr', (req, res) => {
    try {
         const user = (req as AuthRequest).user!;
         const qr = BotManager.getQrCode(user);
         res.json({ qr }); 
    } catch (e) {
        handleError(res, e);
    }
});

// Get Groups (Rooms)
apiRouter.get('/groups', async (req, res) => {
    const user = (req as AuthRequest).user!;
    const bot = BotManager.getBot(user);

    if (!bot.isLoggedIn) {
        return res.status(503).json({ error: 'Bot not logged in' });
    }
    try {
        const rooms = await bot.Room.findAll();
        const roomData = await Promise.all(rooms.map(async (room) => {
            const topic = await room.topic();
            return {
                id: room.id,
                topic: topic,
                memberCount: (await room.memberAll()).length
            };
        }));
        res.json(roomData);
    } catch (e) {
        handleError(res, e);
    }
});

// Get Contacts (Friends)
apiRouter.get('/contacts', async (req, res) => {
    const user = (req as AuthRequest).user!;
    const bot = BotManager.getBot(user);

    if (!bot.isLoggedIn) {
        return res.status(503).json({ error: 'Bot not logged in' });
    }
    try {
        const contacts = await bot.Contact.findAll();
        const validContacts = contacts.filter(c => c.friend());
        
        const contactData = validContacts.map(c => ({
            id: c.id,
            name: c.name(),
            type: c.type()
        }));
        res.json(contactData);
    } catch (e) {
        handleError(res, e);
    }
});

// Template Management
apiRouter.get('/templates', async (req, res) => {
    try {
        const user = (req as AuthRequest).user!;
        const db = await DBManager.getDb(user);
        res.json(db.data.templates || []);
    } catch (e) {
        handleError(res, e);
    }
});

apiRouter.post('/templates', async (req, res) => {
    try {
        const user = (req as AuthRequest).user!;
        const db = await DBManager.getDb(user);
        
        const template: Template = {
            id: Date.now().toString(),
            ...req.body,
            createdAt: new Date().toISOString()
        };
        
        await db.update(({ templates }) => {
            if (!templates) templates = [];
            templates.push(template);
        });
        
        await addLog(user, 'info', `Created template ${template.name}`);
        res.json(template);
    } catch (e) {
        handleError(res, e);
    }
});

apiRouter.put('/templates/:id', async (req, res) => {
    try {
        const user = (req as AuthRequest).user!;
        const db = await DBManager.getDb(user);
        const { id } = req.params;
        const updates = req.body;
        
        let updated: Template | null = null;
        await db.update(({ templates }) => {
            const index = templates.findIndex(t => t.id === id);
            if (index > -1) {
                templates[index] = { ...templates[index], ...updates, id };
                updated = templates[index];
            }
        });
        
        if (updated) {
            await addLog(user, 'info', `Updated template ${id}`);
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
        const user = (req as AuthRequest).user!;
        const db = await DBManager.getDb(user);
        const { id } = req.params;
        
        await db.update(({ templates }) => {
            const index = templates.findIndex(t => t.id === id);
            if (index > -1) templates.splice(index, 1);
        });
        
        await addLog(user, 'info', `Deleted template ${id}`);
        res.json({ success: true });
    } catch (e) {
        handleError(res, e);
    }
});

// Tasks
apiRouter.get('/tasks', async (req, res) => {
    try {
        const user = (req as AuthRequest).user!;
        const db = await DBManager.getDb(user);
        res.json(db.data.tasks);
    } catch (e) {
        handleError(res, e);
    }
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
    } catch (e) {
        handleError(res, e);
    }
});

apiRouter.put('/tasks/:id', async (req, res) => {
    try {
        const user = (req as AuthRequest).user!;
        const db = await DBManager.getDb(user);
        const { id } = req.params;
        const updates = req.body;

        let updatedTask: Task | null = null;
        await db.update(({ tasks }) => {
            const index = tasks.findIndex(t => String(t.id) === String(id));
            if (index > -1) {
                // Keep original ID and createdAt, update other fields
                tasks[index] = {
                    ...tasks[index],
                    ...updates,
                    id: tasks[index].id, // Ensure ID doesn't change
                    updatedAt: new Date().toISOString()
                };
                updatedTask = tasks[index];
            }
        });

        if (updatedTask) {
            await addLog(user, 'info', `Updated task ${id}`);
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
        const user = (req as AuthRequest).user!;
        const db = await DBManager.getDb(user);
        const { ids } = req.body;
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: 'Invalid or empty ids array' });
        }
        
        let deletedCount = 0;
        await db.update(({ tasks }) => {
            const initialLength = tasks.length;
            // Filter out tasks that are in the ids list
            const newTasks = tasks.filter(t => !ids.includes(t.id));
            deletedCount = initialLength - newTasks.length;
            
            // Re-assign tasks array (lowdb requires modifying the array in place or reassigning property)
            // But since tasks is a reference from the callback, we can't just reassign `tasks = ...` if it's destructured.
            // Wait, lowdb update callback receives data object or part of it.
            // If we destructure `({ tasks })`, we can modify `tasks`.
            // `tasks.splice(...)` works.
            // To do batch delete efficiently with splice is tricky.
            // Better to use filter and reassign if possible, or splice one by one backwards.
            for (let i = tasks.length - 1; i >= 0; i--) {
                if (ids.includes(tasks[i].id)) {
                    tasks.splice(i, 1);
                }
            }
        });
        
        await addLog(user, 'info', `Batch deleted ${deletedCount} tasks from ${ip}`);
        res.json({ success: true, count: deletedCount });
    } catch (e) {
        handleError(res, e);
    }
});

apiRouter.delete('/tasks/:id', async (req, res) => {
        try {
            const user = (req as AuthRequest).user!;
            const db = await DBManager.getDb(user);
            const { id } = req.params;
            const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
          
            console.log(`[API] Deleting task ${id} for user ${user}`);

            let deleted = false;
            await db.update(({ tasks }) => {
                // Use loose comparison to handle string/number ID mismatch issues
                const index = tasks.findIndex(t => String(t.id) === String(id));
                console.log(`[API] Task index found: ${index} for id: ${id}. Total tasks: ${tasks.length}`);
                if (index > -1) {
                    tasks.splice(index, 1);
                    deleted = true;
                }
            });

            if (deleted) {
                await addLog(user, 'info', `Task ${id} deleted by admin from ${ip}`);
                res.json({ success: true });
            } else {
                console.warn(`[API] Task ${id} not found for deletion`);
                res.status(404).json({ error: 'Task not found' });
            }
        } catch (e) {
            handleError(res, e);
        }
    });

// Logs
apiRouter.get('/logs', async (req, res) => {
    try {
        const user = (req as AuthRequest).user!;
        const db = await DBManager.getDb(user);
        const logs = db.data.logs.slice(-100).reverse();
        res.json(logs);
    } catch (e) {
        handleError(res, e);
    }
});

// Mount protected routes
app.use('/api', apiRouter);

export { app };
