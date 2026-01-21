import { DBManager } from './dbManager.js';
import { BotManager } from './botManager.js';
import { UserManager } from './userManager.js';
import { TaskQueue } from './taskQueue.js';

export const startScheduler = () => {
  // Check every 10 seconds
  setInterval(async () => {
    // Iterate over all configured users
    const users = Object.keys(UserManager.getUsers());
    
    for (const username of users) {
        try {
            // Check if bot instance exists before calling getBot
            const bot = BotManager.getBot(username);
            
            // Skip if bot not logged in
            if (!bot.isLoggedIn) continue;

            const now = new Date();
            const db = await DBManager.getDb(username);
            const { tasks } = db.data;
            
            // Find pending tasks that are due
            const dueTasks = tasks.filter(t => t.status === 'pending' && new Date(t.scheduleTime) <= now);

            if (dueTasks.length > 0) {
                const queue = TaskQueue.getInstance(username);
                for (const task of dueTasks) {
                    // Mark as processing logic is handled in queue execution or we can trust the queue
                    // However, to prevent double adding, TaskQueue handles dedup in queue list.
                    // But we might want to prevent scheduler from picking it up again next tick if it's still in queue.
                    // The simple way is: if it's in the queue, don't add. TaskQueue.add checks this.
                    queue.add(task);
                }
            }
        } catch (e) {
            console.error(`Scheduler error for user ${username}:`, e);
        }
    }
  }, 10000);
};

