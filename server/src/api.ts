import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { BotManager } from './botManager.js';
import { DBManager, Task, addLog } from './dbManager.js';
import { UserManager } from './userManager.js';
import { authenticateToken, generateToken, AuthRequest } from './authMiddleware.js';
import fs from 'fs';
import path from 'path';

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Login API
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    
    // Legacy support removed, require username
    if (!username) {
         return res.status(400).json({ error: 'Username is required' });
    }
    
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    if (UserManager.verifyUser(username, password)) {
        const token = generateToken(username);
        // Ensure bot is initialized for this user
        BotManager.getBot(username);
        
        await addLog(username, 'info', `User ${username} logged in from ${ip}`);
        res.json({ success: true, token, username: username });
    } else {
        console.warn(`Failed login attempt for ${username} from ${ip}`);
        res.status(401).json({ error: 'Invalid credentials' });
    }
});

// Protected Routes Middleware
const apiRouter = express.Router();
apiRouter.use(authenticateToken);

// Logout API
apiRouter.post('/logout', async (req, res) => {
    const user = (req as AuthRequest).user!;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    await addLog(user, 'info', `User ${user} logged out from ${ip}`);
    res.json({ success: true });
});

// Bot Status
apiRouter.get('/status', (req, res) => {
    const user = (req as AuthRequest).user!;
    const bot = BotManager.getBot(user);
    
    // Simple status for now
    let currentUserData = null;
    try {
        if (bot.isLoggedIn) {
             currentUserData = { name: bot.currentUser.name(), id: bot.currentUser.id };
        }
    } catch (e) {
        // Ignore error if currentUser is not ready
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
    } catch (e: any) {
        await addLog(user, 'error', `Bot restart failed: ${e.message}`);
        res.status(500).json({ error: e.message });
    }
});

// QR Code
apiRouter.get('/qr', (req, res) => {
     const user = (req as AuthRequest).user!;
     const qr = BotManager.getQrCode(user);
     
     // Check if we have a QR code, if so status is likely waiting_for_scan
     // But client relies on /status API to know if it should fetch QR
     // We can improve /status API to return waiting_for_scan if QR exists and not logged in
     
     res.json({ qr }); 
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
    } catch (e: any) {
        res.status(500).json({ error: e.message });
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
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// Tasks
apiRouter.get('/tasks', async (req, res) => {
    const user = (req as AuthRequest).user!;
    const db = await DBManager.getDb(user);
    res.json(db.data.tasks);
});

apiRouter.post('/tasks', async (req, res) => {
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
});

apiRouter.delete('/tasks/:id', async (req, res) => {
    const user = (req as AuthRequest).user!;
    const db = await DBManager.getDb(user);
    const { id } = req.params;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  
    await db.update(({ tasks }) => {
        const index = tasks.findIndex(t => t.id === id);
        if (index > -1) {
            tasks.splice(index, 1);
        }
    });
    await addLog(user, 'info', `Task ${id} deleted by admin from ${ip}`);
    res.json({ success: true });
});

// Logs
apiRouter.get('/logs', async (req, res) => {
    const user = (req as AuthRequest).user!;
    const db = await DBManager.getDb(user);
    const logs = db.data.logs.slice(-100).reverse();
    res.json(logs);
});

// Mount protected routes
app.use('/api', apiRouter);

export { app };
