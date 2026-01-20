import { JSONFilePreset } from 'lowdb/node';
import { Low } from 'lowdb';
import path from 'path';
import { UserManager } from './userManager.js';

export interface Task {
  id: string;
  type: 'text' | 'image' | 'file';
  targetType: 'group' | 'contact';
  targetId: string; // Group ID or Contact ID
  targetName: string; // For display
  content: string; // Text content or file path
  scheduleTime: string; // ISO String
  recurrence?: 'once' | 'daily' | 'weekly' | 'monthly' | 'interval';
  intervalValue?: number; // e.g. 30
  intervalUnit?: 'minute' | 'hour' | 'day'; // e.g. 'minute'
  status: 'pending' | 'success' | 'failed';
  createdAt: string;
  error?: string;
}

export interface Log {
  id: string;
  timestamp: string;
  level: 'info' | 'error';
  message: string;
  taskId?: string;
}

export interface Data {
  tasks: Task[];
  logs: Log[];
}

const defaultData: Data = { tasks: [], logs: [] };

export class DBManager {
    private static instances: Map<string, Low<Data>> = new Map();

    static async getDb(username: string): Promise<Low<Data>> {
        if (this.instances.has(username)) {
            return this.instances.get(username)!;
        }

        const userDir = UserManager.getUserDir(username);
        const dbPath = path.join(userDir, 'db.json');
        
        console.log(`Loading DB for ${username} at ${dbPath}`);
        const db = await JSONFilePreset<Data>(dbPath, defaultData);
        
        this.instances.set(username, db);
        return db;
    }
}

export const addLog = async (username: string, level: 'info' | 'error', message: string, taskId?: string) => {
    const db = await DBManager.getDb(username);
    await db.update(({ logs }) => logs.push({
        id: Date.now().toString(),
        timestamp: new Date().toISOString(),
        level,
        message,
        taskId
    }));
};
