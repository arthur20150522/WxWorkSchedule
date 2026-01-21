import { Task } from './dbManager.js';
import { BotManager } from './botManager.js';
import { DBManager, addLog } from './dbManager.js';
import { FileBox } from 'file-box';
import { addDays, addWeeks, addMonths, addMinutes, addHours } from 'date-fns';

export class TaskQueue {
    private static instances: Map<string, TaskQueue> = new Map();
    private queue: Task[] = [];
    private isProcessing = false;
    private username: string;

    private constructor(username: string) {
        this.username = username;
    }

    public static getInstance(username: string): TaskQueue {
        if (!this.instances.has(username)) {
            this.instances.set(username, new TaskQueue(username));
        }
        return this.instances.get(username)!;
    }

    public add(task: Task) {
        // Prevent duplicate queuing if needed, but for now just push
        // Check if task is already in queue to avoid double execution if scheduler picks it up again
        if (!this.queue.find(t => t.id === task.id)) {
            console.log(`[TaskQueue] Adding task ${task.id} to queue for ${this.username}`);
            this.queue.push(task);
            this.process();
        }
    }

    private async process() {
        if (this.isProcessing) return;
        this.isProcessing = true;

        while (this.queue.length > 0) {
            const task = this.queue.shift();
            if (task) {
                try {
                    await this.executeTask(task);
                } catch (e) {
                    console.error(`[TaskQueue] Error executing task ${task.id}:`, e);
                }
                // Wait 500ms between tasks
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

        this.isProcessing = false;
    }

    private async executeTask(task: Task) {
        const username = this.username;
        console.log(`[${username}] Executing task ${task.id}`);
        const bot = BotManager.getBot(username);

        try {
            let target: any;

            if (task.targetType === 'group') {
                target = await bot.Room.find({ id: task.targetId });
                if (!target) {
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

                        // Ensure next schedule is in the future
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
                        t.status = 'pending';
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
    }
}
