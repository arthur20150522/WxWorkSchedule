import { JSONFilePreset } from 'lowdb/node';
import { Low } from 'lowdb';
import fs from 'fs';
import path from 'path';
import { Data, Task, Template, Contact, Log } from './types.js';

export type { Task, Template, Contact, Log, Data };

const DB_PATH = path.resolve(process.cwd(), 'db.json');
const MAX_LOG_ENTRIES = 500;

const defaultData: Data = {
  contacts: [],
  tasks: [],
  templates: [],
  logs: [],
};

let dbInstance: Low<Data> | null = null;

export async function initDB(): Promise<Low<Data>> {
  if (dbInstance) return dbInstance;

  console.log(`[DB] Initializing at ${DB_PATH}`);
  const db = await JSONFilePreset<Data>(DB_PATH, defaultData);

  // Ensure all arrays exist
  await db.update((data) => {
    if (!data.contacts) data.contacts = [];
    if (!data.tasks) data.tasks = [];
    if (!data.templates) data.templates = [];
    if (!data.logs) data.logs = [];

    // Migration: string content → string[]
    data.tasks.forEach((t: any) => {
      if (typeof t.content === 'string') t.content = [t.content];
      if (typeof t.currentContentIndex === 'undefined') t.currentContentIndex = 0;
      // Recovery: tasks stuck in 'processing' at startup → reset to pending
      if (t.status === 'processing') {
        console.log(`[DB] Recovering stuck task ${t.id} → pending`);
        t.status = 'pending';
      }
    });

    data.templates.forEach((t: any) => {
      if (typeof t.content === 'string') t.content = [t.content];
    });

    // Trim logs to prevent DB bloat
    if (data.logs && data.logs.length > MAX_LOG_ENTRIES) {
      const trimmed = data.logs.length - MAX_LOG_ENTRIES;
      data.logs = data.logs.slice(-MAX_LOG_ENTRIES);
      console.log(`[DB] Trimmed ${trimmed} old log entries (keeping last ${MAX_LOG_ENTRIES})`);
    }
  });

  // Migrate from legacy multi-user directories
  await migrateFromLegacy(db);

  dbInstance = db;
  return db;
}

export async function getDb(): Promise<Low<Data>> {
  if (!dbInstance) {
    return initDB();
  }
  return dbInstance;
}

async function migrateFromLegacy(db: Low<Data>): Promise<void> {
  const usersDir = path.resolve(process.cwd(), 'users');
  if (!fs.existsSync(usersDir)) return;

  console.log('[DB] Detected legacy users/ directory, migrating...');

  try {
    const userDirs = fs.readdirSync(usersDir);
    let migratedTasks = 0;
    let migratedTemplates = 0;

    for (const userDir of userDirs) {
      const oldDbPath = path.join(usersDir, userDir, 'db.json');
      if (!fs.existsSync(oldDbPath)) continue;

      try {
        const oldData = JSON.parse(fs.readFileSync(oldDbPath, 'utf-8'));

        if (oldData.tasks) {
          for (const task of oldData.tasks) {
            // Skip if already exists (by id)
            if (db.data.tasks.find(t => t.id === task.id)) continue;
            if (typeof task.content === 'string') task.content = [task.content];
            if (typeof task.currentContentIndex === 'undefined') task.currentContentIndex = 0;
            db.data.tasks.push(task);
            migratedTasks++;
          }
        }

        if (oldData.templates) {
          for (const tpl of oldData.templates) {
            if (db.data.templates.find(t => t.id === tpl.id)) continue;
            if (typeof tpl.content === 'string') tpl.content = [tpl.content];
            db.data.templates.push(tpl);
            migratedTemplates++;
          }
        }
      } catch (e) {
        console.error(`[DB] Failed to migrate from ${oldDbPath}:`, e);
      }
    }

    await db.write();
    console.log(`[DB] Migration complete: ${migratedTasks} tasks, ${migratedTemplates} templates`);
    console.log('[DB] Legacy users/ directory kept for safety — you can delete it manually');
  } catch (e) {
    console.error('[DB] Legacy migration failed:', e);
  }
}

export async function addLog(
  level: 'info' | 'error' | 'warn',
  message: string,
  taskId?: string
): Promise<void> {
  const db = await getDb();
  await db.update(({ logs }) => {
    logs.push({
      id: Date.now().toString() + Math.random().toString(36).slice(2),
      timestamp: new Date().toISOString(),
      level,
      message,
      taskId,
    });
    // Keep only the latest N entries
    if (logs.length > MAX_LOG_ENTRIES) {
      logs.splice(0, logs.length - MAX_LOG_ENTRIES);
    }
  });
}
