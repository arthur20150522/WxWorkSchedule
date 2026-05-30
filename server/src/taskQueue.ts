import { Task, getDb, addLog } from './dbManager.js';
import { wxBridge } from './wxBridge.js';
import { pushNotify } from './pushNotify.js';
import { addDays, addWeeks, addMonths, addMinutes, addHours } from 'date-fns';

/** Random delay between min and max milliseconds */
function randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Calculate next schedule time for recurring tasks */
export function calculateNextTime(task: Task): string {
  const current = new Date(task.scheduleTime);
  let next = current;

  switch (task.recurrence) {
    case 'daily':    next = addDays(current, 1); break;
    case 'weekly':   next = addWeeks(current, 1); break;
    case 'monthly':  next = addMonths(current, 1); break;
    case 'interval': {
      const val = task.intervalValue || 1;
      switch (task.intervalUnit) {
        case 'minute': next = addMinutes(current, val); break;
        case 'hour':   next = addHours(current, val); break;
        case 'day':    next = addDays(current, val); break;
      }
      break;
    }
    default: return current.toISOString();
  }

  // Skip past times for recurring tasks (max 1000 iterations to prevent infinite loop)
  const now = new Date();
  let iterations = 0;
  while (next <= now && iterations < 1000) {
    iterations++;
    switch (task.recurrence) {
      case 'daily':    next = addDays(next, 1); break;
      case 'weekly':   next = addWeeks(next, 1); break;
      case 'monthly':  next = addMonths(next, 1); break;
      case 'interval': {
        const val = task.intervalValue || 1;
        switch (task.intervalUnit) {
          case 'minute': next = addMinutes(next, val); break;
          case 'hour':   next = addHours(next, val); break;
          case 'day':    next = addDays(next, val); break;
          default:       next = addDays(next, 1); break; // safety fallback
        }
        break;
      }
      default: return next.toISOString();
    }
  }

  return next.toISOString();
}

class TaskQueue {
  private queue: Task[] = [];
  private isProcessing = false;
  private _currentTarget: string | null = null;
  private _lastError: string | null = null;

  get length(): number { return this.queue.length; }
  get currentTarget(): string | null { return this._currentTarget; }
  get lastError(): string | null { return this._lastError; }

  async add(task: Task) {
    // Deduplicate: skip if already in queue
    if (this.queue.find(t => t.id === task.id)) return;

    // Immediately mark processing in DB to prevent scheduler re-pickup
    try {
      const db = await getDb();
      await db.update(({ tasks }) => {
        const t = tasks.find(x => x.id === task.id);
        if (t && t.status === 'pending') t.status = 'processing';
      });
    } catch (e) {
      console.error(`[TaskQueue] Failed to mark task ${task.id} processing:`, e);
    }

    console.log(`[TaskQueue] Enqueue task ${task.id} → ${task.targetName}`);
    this.queue.push(task);
    this.process();
  }

  private async process() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    while (this.queue.length > 0) {
      const task = this.queue.shift()!;
      this._currentTarget = task.targetName;

      try {
        await this.executeTask(task);
      } catch (e) {
        console.error(`[TaskQueue] Unexpected error on task ${task.id}:`, e);
      }

      // Random 5~10s delay between tasks
      if (this.queue.length > 0) {
        const delay = randomDelay(5000, 10000);
        console.log(`[TaskQueue] Waiting ${(delay / 1000).toFixed(1)}s before next task...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }

    this._currentTarget = null;
    this.isProcessing = false;
  }

  private async executeTask(task: Task) {
    console.log(`[TaskQueue] Executing task ${task.id} → ${task.targetName}`);

    // Mark as processing
    const db = await getDb();
    await db.update(({ tasks }) => {
      const t = tasks.find(x => x.id === task.id);
      if (t) t.status = 'processing';
    });

    // Read currentContentIndex from DB (not snapshot) to avoid stale data
    let currentIndex = task.currentContentIndex || 0;
    try {
      const dbFresh = await getDb();
      const fresh = dbFresh.data.tasks.find(t => t.id === task.id);
      if (fresh) currentIndex = fresh.currentContentIndex || 0;
    } catch { /* use snapshot value as fallback */ }

    const contentToSend = task.content[currentIndex];

    if (!contentToSend) {
      this._lastError = `no content at index ${currentIndex}`;
      await this.markFailed(task.id, this._lastError);
      await addLog('error', `Task ${task.id}【${task.targetName}】失败: ${this._lastError}`, task.id);
      return;
    }

    let success = false;

    // First attempt
    try {
      console.log(`[TaskQueue] Sending to [${task.targetType}] ${task.targetName}: ${contentToSend.substring(0, 50)}...`);
      const result = await wxBridge.send(task.targetName, contentToSend, task.targetType);
      if (result.success) {
        success = true;
      } else {
        throw new Error(result.error || 'wx4py send failed');
      }
    } catch (e: any) {
      // Retry once after 2s
      console.warn(`[TaskQueue] First attempt failed for task ${task.id}: ${e.message}, retrying in 2s...`);
      await new Promise(r => setTimeout(r, 2000));

      try {
        const result = await wxBridge.send(task.targetName, contentToSend, task.targetType);
        if (result.success) {
          success = true;
        } else {
          throw new Error(result.error || 'wx4py send failed on retry');
        }
      } catch (retryErr: any) {
        this._lastError = `${retryErr.message}`;
        await this.markFailed(task.id, this._lastError);
        await addLog('error', `Task ${task.id}【${task.targetName}】失败(已重试): ${this._lastError}`, task.id);
        pushNotify('消息发送失败', `[${task.targetType === 'group' ? '群' : '人'}] ${task.targetName}: ${this._lastError}`);
        return;
      }
    }

    if (success) {
      // Update status / reschedule
      const db2 = await getDb();
      await db2.update(({ tasks }) => {
        const t = tasks.find(x => x.id === task.id);
        if (!t) return;

        if (t.recurrence && t.recurrence !== 'once') {
          t.scheduleTime = calculateNextTime(t);
          t.status = 'pending';
          t.currentContentIndex = (currentIndex + 1) % t.content.length;
          console.log(`[TaskQueue] Rescheduled task ${t.id} → ${t.scheduleTime}, content index: ${t.currentContentIndex}`);
        } else {
          t.status = 'success';
        }
      });

      const nextLabel = task.recurrence && task.recurrence !== 'once' ? ' → 已排下次' : ' → 完成';
      await addLog('info', `Task ${task.id}【${task.targetName}】${nextLabel}`, task.id);
    }
  }

  private async markFailed(taskId: string, error: string) {
    const db = await getDb();
    await db.update(({ tasks }) => {
      const t = tasks.find(x => x.id === taskId);
      if (t) {
        t.status = 'failed';
        t.error = error;
      }
    });
  }
}

/** Global singleton task queue */
export const taskQueue = new TaskQueue();
