import { JSONFilePreset } from 'lowdb/node';
import path from 'path';
import { UserManager } from './userManager.js';
const defaultData = { tasks: [], templates: [], logs: [] };
export class DBManager {
    static instances = new Map();
    static async getDb(username) {
        if (this.instances.has(username)) {
            return this.instances.get(username);
        }
        const userDir = UserManager.getUserDir(username);
        const dbPath = path.join(userDir, 'db.json');
        console.log(`Loading DB for ${username} at ${dbPath}`);
        const db = await JSONFilePreset(dbPath, defaultData);
        // Ensure templates array exists (migration for old DBs)
        await db.update((data) => {
            if (!data.templates) {
                data.templates = [];
            }
            if (!data.tasks) {
                data.tasks = [];
            }
            if (!data.logs) {
                data.logs = [];
            }
            // Migration: Convert string content to string[]
            data.tasks.forEach((t) => {
                if (typeof t.content === 'string') {
                    t.content = [t.content];
                }
                if (typeof t.currentContentIndex === 'undefined') {
                    t.currentContentIndex = 0;
                }
                // Recovery: tasks stuck in 'processing' at startup mean the server
                // crashed mid-execution — reset them so the scheduler picks them up again.
                if (t.status === 'processing') {
                    console.log(`[DBManager] Recovering stuck processing task ${t.id} → pending`);
                    t.status = 'pending';
                }
            });
            data.templates.forEach((t) => {
                if (typeof t.content === 'string') {
                    t.content = [t.content];
                }
            });
        });
        this.instances.set(username, db);
        return db;
    }
}
export const addLog = async (username, level, message, taskId) => {
    const db = await DBManager.getDb(username);
    await db.update(({ logs }) => logs.push({
        id: Date.now().toString(),
        timestamp: new Date().toISOString(),
        level,
        message,
        taskId
    }));
};
