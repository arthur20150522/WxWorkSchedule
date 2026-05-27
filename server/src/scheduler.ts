import { DBManager } from './dbManager.js';
import { BotManager } from './botManager.js';
import { UserManager } from './userManager.js';
import { TaskQueue } from './taskQueue.js';

export const startScheduler = () => {
  setInterval(async () => {
    const users = Object.keys(UserManager.getUsers());
    for (const username of users) {
        try {
            const bot = BotManager.getBot(username);
            if (!bot.isLoggedIn) continue;

            const now = new Date();
            const db = await DBManager.getDb(username);
            const { tasks } = db.data;

            const dueTasks = tasks.filter(t => t.status === 'pending' && new Date(t.scheduleTime) <= now);

            if (dueTasks.length > 0) {
                const queue = TaskQueue.getInstance(username);
                for (const task of dueTasks) queue.add(task);
            }
        } catch (e) {
            console.error(`Scheduler error for user ${username}:`, e);
        }
    }
  }, 10000);
};
