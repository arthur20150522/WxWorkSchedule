import { JSONFilePreset } from 'lowdb/node';
import path from 'path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '..', 'db.json');
const defaultData = { tasks: [], templates: [], contacts: [], logs: [], liveLogs: [] };

export class DBManager {
    static _db = null;

    static async getDb(_username) {
        if (this._db) return this._db;
        console.log(`Loading DB from ${DB_PATH}`);
        this._db = await JSONFilePreset(DB_PATH, defaultData);
        await this._db.update((data) => {
            if (!data.templates) data.templates = [];
            if (!data.tasks) data.tasks = [];
            if (!data.contacts) data.contacts = [];
            if (!data.logs) data.logs = [];
            if (!data.liveLogs) data.liveLogs = [];
            data.tasks.forEach((t) => {
                if (typeof t.content === 'string') t.content = [t.content];
                if (typeof t.currentContentIndex === 'undefined') t.currentContentIndex = 0;
                if (t.status === 'processing') {
                    console.log(`[DBManager] Recovering stuck task ${t.id} -> pending`);
                    t.status = 'pending';
                }
            });
            data.templates.forEach((t) => {
                if (typeof t.content === 'string') t.content = [t.content];
            });
        });
        return this._db;
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

export const initDB = async () => {
    return DBManager.getDb('default');
};
