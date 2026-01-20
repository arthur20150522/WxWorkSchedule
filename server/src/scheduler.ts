import { DBManager, addLog, Task } from './dbManager.js';
import { BotManager } from './botManager.js';
import { FileBox } from 'file-box';
import { UserManager } from './userManager.js';
import { addDays, addWeeks, addMonths, addMinutes, addHours } from 'date-fns';

export const startScheduler = () => {
  // Check every 10 seconds
  setInterval(async () => {
    // Iterate over all configured users
    const users = Object.keys(UserManager.getUsers());
    
    for (const username of users) {
        try {
            // Check if bot instance exists before calling getBot
            // BotManager doesn't have a hasBot method, but getBot will initialize it.
            // However, we should be careful about initializing bots that are not logged in.
            // For now, let's just use getBot which is safe as it returns existing or new.
            const bot = BotManager.getBot(username);
            
            // Skip if bot not logged in or puppet not ready
            // Wechaty might throw "NOPUPPET" if we access properties too early
            if (!bot.isLoggedIn) continue;

            const now = new Date();
            const db = await DBManager.getDb(username);
            const { tasks } = db.data;
            
            // Find pending tasks that are due
            const dueTasks = tasks.filter(t => t.status === 'pending' && new Date(t.scheduleTime) <= now);

            for (const task of dueTasks) {
              await executeTask(username, task);
            }
        } catch (e) {
            console.error(`Scheduler error for user ${username}:`, e);
        }
    }
  }, 10000);
};


const executeTask = async (username: string, task: Task) => {
  console.log(`[${username}] Executing task ${task.id}`);
  const bot = BotManager.getBot(username);
  
  try {
    let target: any;
    
    if (task.targetType === 'group') {
      target = await bot.Room.find({ id: task.targetId });
      if (!target) {
        // Try searching by name if ID changed (less reliable but fallback)
        target = await bot.Room.find({ topic: task.targetName });
      }
    } else {
      target = await bot.Contact.find({ id: task.targetId });
      if (!target) {
        target = await bot.Contact.find({ name: task.targetName });
      }
    }

    if (!target) {
      throw new Error(`Target not found: ${task.targetName} (${task.targetId})`);
    }

    // Send content
    if (task.type === 'text') {
      await target.say(task.content);
    } else if (task.type === 'image' || task.type === 'file') {
        // Assume content is a URL or local path
        // For local files, content should be absolute path
        const fileBox = FileBox.fromFile(task.content);
        await target.say(fileBox);
    }

    // Update status or Reschedule
    const db = await DBManager.getDb(username);
    await db.update(({ tasks }) => {
      const t = tasks.find(x => x.id === task.id);
      if (t) {
          if (t.recurrence && t.recurrence !== 'once') {
              // Calculate next run time
              const currentSchedule = new Date(t.scheduleTime);
              let nextSchedule = currentSchedule;
              
              if (t.recurrence === 'daily') nextSchedule = addDays(currentSchedule, 1);
              else if (t.recurrence === 'weekly') nextSchedule = addWeeks(currentSchedule, 1);
              else if (t.recurrence === 'monthly') nextSchedule = addMonths(currentSchedule, 1);
              else if (t.recurrence === 'interval' && t.intervalValue && t.intervalUnit) {
                  const val = t.intervalValue;
                  if (t.intervalUnit === 'minute') nextSchedule = addMinutes(currentSchedule, val);
                  else if (t.intervalUnit === 'hour') nextSchedule = addHours(currentSchedule, val);
                  else if (t.intervalUnit === 'day') nextSchedule = addDays(currentSchedule, val);
              }
              
              // Ensure next schedule is in the future (in case of catch-up)
              const now = new Date();
              while (nextSchedule <= now) {
                  if (t.recurrence === 'daily') nextSchedule = addDays(nextSchedule, 1);
                  else if (t.recurrence === 'weekly') nextSchedule = addWeeks(nextSchedule, 1);
                  else if (t.recurrence === 'monthly') nextSchedule = addMonths(nextSchedule, 1);
                  else if (t.recurrence === 'interval' && t.intervalValue && t.intervalUnit) {
                      const val = t.intervalValue;
                      if (t.intervalUnit === 'minute') nextSchedule = addMinutes(nextSchedule, val);
                      else if (t.intervalUnit === 'hour') nextSchedule = addHours(nextSchedule, val);
                      else if (t.intervalUnit === 'day') nextSchedule = addDays(nextSchedule, val);
                  }
              }

              t.scheduleTime = nextSchedule.toISOString();
              t.status = 'pending'; // Keep pending for next run
              console.log(`[${username}] Rescheduled task ${t.id} to ${t.scheduleTime}`);
          } else {
              t.status = 'success';
          }
      }
    });
    
    await addLog(username, 'info', `Task ${task.id} executed successfully. Recurrence: ${task.recurrence || 'once'}`, task.id);

  } catch (error: any) {
    console.error(`[${username}] Task ${task.id} failed:`, error);
    
    const db = await DBManager.getDb(username);
    await db.update(({ tasks }) => {
      const t = tasks.find(x => x.id === task.id);
      if (t) {
        t.status = 'failed';
        t.error = error.message;
      }
    });

    await addLog(username, 'error', `Task ${task.id} failed: ${error.message}`, task.id);
  }
};
