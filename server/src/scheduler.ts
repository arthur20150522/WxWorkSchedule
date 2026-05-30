import { getDb, addLog } from './dbManager.js';
import { taskQueue } from './taskQueue.js';

/** Tasks overdue beyond this threshold will be auto-skipped (minutes) */
const MAX_DELAY_MINUTES = parseInt(process.env.MAX_TASK_DELAY_MINUTES || '30', 10);

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

        // 逾期熔断：超过阈值的任务不执行
        if (delayMin > MAX_DELAY_MINUTES) {
          console.log(`[Scheduler] Skipping overdue task ${task.id}: ${delayMin}min late (>${MAX_DELAY_MINUTES}min threshold)`);

          const db2 = await getDb();
          await db2.update(({ tasks: tarr }) => {
            const t = tarr.find(x => x.id === task.id);
            if (t) {
              t.status = 'failed';
              t.error = `逾期 ${delayMin} 分钟，已自动跳过（阈值 ${MAX_DELAY_MINUTES} 分钟）。`;
            }
          });
          await addLog('warn', `Task ${task.id}【${task.targetName}】逾期 ${delayMin} 分钟 → 已跳过`, task.id);
          continue;
        }

        taskQueue.add(task);
      }

      // 告警：超过 5 个任务同时进入队列
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
