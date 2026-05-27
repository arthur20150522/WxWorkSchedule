import { Task } from './dbManager.js';
import { BotManager } from './botManager.js';
import { DBManager, addLog } from './dbManager.js';
import { wxBridge } from './wxBridge.js';
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
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

        this.isProcessing = false;
    }

    private async executeTask(task: Task) {
        const username = this.username;
        console.log(`[${username}] Executing task ${task.id}`);

        // Mark as processing
        try {
            const dbPre = await DBManager.getDb(username);
            await dbPre.update(({ tasks }) => {
                const t = tasks.find(x => x.id === task.id);
                if (t) t.status = 'processing';
            });
        } catch (e) {
            console.error(`[${username}] Failed to mark task ${task.id} as processing:`, e);
        }

        try {
            const targetName = task.targetName || task.targetId;
            const targetType = task.targetType;
            const currentIndex = task.currentContentIndex || 0;
            const contentToSend = task.content[currentIndex];

            if (!contentToSend) {
                console.warn(`[${username}] Task ${task.id} has no content at index ${currentIndex}`);
            } else {
                // Prefer cached target with .say() (works for MockBot and cached bridge results)
                let sent = false;
                let target: any = null;

                if (targetType === 'group') {
                    target = BotManager.getCachedRoom(username, task.targetId);
                } else {
                    target = BotManager.getCachedContact(username, task.targetId);
                }

                if (target && typeof target.say === 'function') {
                    console.log(`[${username}] Using cached target for ${targetName}`);
                    await target.say(contentToSend);
                    sent = true;
                } else {
                    // Fall back to wxBridge direct send
                    console.log(`[${username}] Sending via wxBridge to [${targetType}] ${targetName}: ${contentToSend.substring(0, 50)}...`);
                    const result = await wxBridge.send(targetName, contentToSend, targetType);
                    if (!result.success) {
                        throw new Error(result.error || 'wx4py send failed');
                    }
                    sent = true;
                }

                if (!sent) {
                    throw new Error(`No way to send to ${targetName} — target not cached and bridge unavailable`);
                }
            }

            // Update status / reschedule
            const db = await DBManager.getDb(username);
            await db.update(({ tasks }) => {
                const t = tasks.find(x => x.id === task.id);
                if (t) {
                    if (t.recurrence && t.recurrence !== 'once') {
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
                        t.currentContentIndex = (currentIndex + 1) % t.content.length;
                        console.log(`[${username}] Rescheduled task ${t.id} to ${t.scheduleTime}. Next content index: ${t.currentContentIndex}`);
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
                if (t) { t.status = 'failed'; t.error = error.message; }
            });
            await addLog(username, 'error', `Task ${task.id} failed: ${error.message}`, task.id);
        }
    }
}
