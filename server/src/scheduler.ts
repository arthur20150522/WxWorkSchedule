import { getDb, addLog } from './dbManager.js';
import { taskQueue } from './taskQueue.js';
import { addMinutes, addHours, addDays } from 'date-fns';

/** Tasks overdue beyond this threshold will be auto-skipped (minutes) */
const MAX_DELAY_MINUTES = parseInt(process.env.MAX_TASK_DELAY_MINUTES || '30', 10);

function advanceScheduleTime(task: any): string | null {
  const now = new Date();
  let next = new Date(task.scheduleTime);
  if (isNaN(next.getTime())) return null;

  // 最多向前推进 1000 次防止死循环
  for (let i = 0; i < 1000; i++) {
    if (next > now) return next.toISOString();

    switch (task.recurrence) {
      case 'daily':
        next = addDays(next, 1);
        break;
      case 'weekly':
        next = addDays(next, 7);
        break;
      case 'monthly':
        next = new Date(next.getFullYear(), next.getMonth() + 1, next.getDate());
        break;
      case 'interval': {
        const val = task.intervalValue || 1;
        switch (task.intervalUnit) {
          case 'minute': next = addMinutes(next, val); break;
          case 'hour': next = addHours(next, val); break;
          default: next = addDays(next, val); break;
        }
        break;
      }
      default:
        return null; // once → don't advance
    }
  }
  return null; // safety: exceeded max iterations
}

export const startScheduler = () => {
  setInterval(async () => {
    try {
      const db = await getDb();
      const { tasks } = db.data;
      const now = new Date();

      const dueTasks = tasks
        .filter(t => t.status === 'pending' && new Date(t.scheduleTime) <= now)
        .sort((a, b) => new Date(a.scheduleTime).getTime() - new Date(b.scheduleTime).getTime());

      for (const task of dueTasks) {
        const delayMs = now.getTime() - new Date(task.scheduleTime).getTime();
        const delayMin = Math.round(delayMs / 60000);

        // Only fail one-time tasks that are too old
        if (delayMin > MAX_DELAY_MINUTES) {
          if (!task.recurrence || task.recurrence === 'once') {
            console.log(`[Scheduler] Skipping overdue one-time task ${task.id}: ${delayMin}min late`);
            const db2 = await getDb();
            await db2.update(({ tasks: tarr }) => {
              const t = tarr.find(x => x.id === task.id);
              if (t) {
                t.status = 'failed';
                t.error = `逾期 ${delayMin} 分钟，已自动跳过`;
              }
            });
            await addLog('warn', `Task ${task.id}【${task.targetName}】逾期 ${delayMin} 分钟 → 已跳过（一次性任务）`, task.id);
          } else {
            // Recurring tasks: auto-advance to next scheduled time
            const nextTime = advanceScheduleTime(task);
            if (nextTime) {
              const db2 = await getDb();
              await db2.update(({ tasks: tarr }) => {
                const t = tarr.find(x => x.id === task.id);
                if (t) t.scheduleTime = nextTime;
              });
              console.log(`[Scheduler] Advanced recurring task ${task.id} from ${delayMin}min overdue → next: ${nextTime}`);
              await addLog('info', `Task ${task.id}【${task.targetName}】逾期 ${delayMin} 分钟 → 自动推进到下次`, task.id);
            }
          }
          continue;
        }

        taskQueue.add(task);
      }

      if (dueTasks.filter(t => new Date().getTime() - new Date(t.scheduleTime).getTime() <= MAX_DELAY_MINUTES * 60000).length > 5) {
        console.warn(`[Scheduler] ${dueTasks.length} overdue tasks being queued — check if WeChat was disconnected`);
        await addLog('warn', `${dueTasks.length} 个过期任务进入队列，可能因微信断联导致。`);
      }
    } catch (e) {
      console.error('[Scheduler] Error:', e);
    }
  }, 10000);

  console.log(`[Scheduler] Started (10s interval, max delay: ${MAX_DELAY_MINUTES}min)`);
};
