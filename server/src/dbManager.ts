import { JSONFilePreset } from 'lowdb/node';
import { Low } from 'lowdb';
import path from 'path';
import { UserManager } from './userManager.js';

export interface Template {
  id: string;
  name: string;
  type: 'text' | 'image' | 'file';
  content: string;
  targets: { type: 'group' | 'contact', id: string, name: string }[]; // Associated targets
  createdAt: string;
}

export interface Task {
  id: string;
  templateId?: string; // Optional reference to template
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
  updatedAt?: string;
  error?: string;
}

export interface Log {
  id: string;
  timestamp: string;
  level: 'info' | 'error' | 'warn';
  message: string;
  taskId?: string;
}

export interface Data {
  tasks: Task[];
  templates: Template[];
  logs: Log[];
}

const defaultData: Data = { tasks: [], templates: [], logs: [] };

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
        });

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
