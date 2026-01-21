import { useState, useEffect } from 'react';
import { RefreshCw, Trash2, FileText } from 'lucide-react';
import clsx from 'clsx';
import { t } from '../utils/i18n';
import { Task, Group, Template } from '../types';
import axios from 'axios';

interface TasksViewProps {
    tasks: Task[];
    templates: Template[];
    fetchTasks: () => Promise<void>;
    groups: Group[];
    contacts: {id: string, name: string}[];
    showToast: (msg: string, type: 'success' | 'error' | 'info') => void;
    initialDraft?: Partial<Task>;
}

export const TasksView: React.FC<TasksViewProps> = ({ 
    tasks, templates, fetchTasks, groups, contacts, showToast, initialDraft
}) => {
    // Task Form State
    type TaskDraft = Partial<Task> & {
        uiTime: string;
        uiWeekday: string;
        uiDayOfMonth: string;
        intervalValue: number;
        intervalUnit: 'minute' | 'hour' | 'day';
    };

    const initialNewTask: TaskDraft = {
      type: 'text',
      targetType: 'group',
      targetId: '',
      content: [''],
      scheduleTime: '', 
      recurrence: 'once',
      uiTime: '09:00',
      uiWeekday: '1', 
      uiDayOfMonth: '1',
      intervalValue: 30,
      intervalUnit: 'minute'
    };
    
    const [newTask, setNewTask] = useState<TaskDraft>({
        ...initialNewTask,
        ...(initialDraft || {}),
        content: initialDraft?.content && initialDraft.content.length > 0 ? initialDraft.content : initialNewTask.content
    });

    useEffect(() => {
        if (initialDraft) {
            setNewTask(prev => ({ 
                ...prev, 
                ...initialDraft,
                content: initialDraft.content && initialDraft.content.length > 0 ? initialDraft.content : ['']
            }));
        }
    }, [initialDraft]);
    const [isEditing, setIsEditing] = useState(false);
    const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
    const [taskSearchQuery, setTaskSearchQuery] = useState('');
    const [taskFilter, setTaskFilter] = useState<'all' | 'pending' | 'success' | 'failed'>('all');
    const [selectedTargets, setSelectedTargets] = useState<{ type: 'group' | 'contact'; id: string; name: string }[]>([]);

    const getIntervalUnitLabel = (unit?: 'minute' | 'hour' | 'day') => {
        if (unit === 'hour') return t.hours;
        if (unit === 'day') return t.days;
        return t.minutes;
    };

    const getRecurrenceLabel = (recurrence?: Task['recurrence'], intervalValue?: number, intervalUnit?: Task['intervalUnit']) => {
        if (recurrence === 'daily') return t.daily;
        if (recurrence === 'weekly') return t.weekly;
        if (recurrence === 'monthly') return t.monthly;
        if (recurrence === 'interval') {
            return `${t.interval}: ${intervalValue}${getIntervalUnitLabel(intervalUnit)}`;
        }
        return t.once;
    };

    const resetForm = () => {
        setNewTask({ ...initialNewTask });
        setSelectedTargets([]);
        setIsEditing(false);
    };

    const createTask = async (e: React.FormEvent) => {
        e.preventDefault();
        const contentArray = newTask.content?.filter(line => line.trim() !== '') || [];
        
        if (selectedTargets.length === 0 || contentArray.length === 0) {
            showToast('请选择目标并输入内容', 'error');
            return;
        }
    
        // Calculate Schedule Time based on Recurrence
        let finalScheduleTime = newTask.scheduleTime;
        const now = new Date();
        
        if (newTask.recurrence === 'interval') {
             if (!finalScheduleTime) finalScheduleTime = now.toISOString();
        } else if (newTask.recurrence !== 'once') {
            const [hours, minutes] = newTask.uiTime.split(':').map(Number);
            let nextRun = new Date();
            nextRun.setHours(hours, minutes, 0, 0);
    
            if (newTask.recurrence === 'daily') {
                if (nextRun <= now) nextRun.setDate(nextRun.getDate() + 1);
            } else if (newTask.recurrence === 'weekly') {
                const targetDay = parseInt(newTask.uiWeekday);
                const jsTargetDay = targetDay === 7 ? 0 : targetDay;
                const currentDay = nextRun.getDay();
                let daysToAdd = (jsTargetDay - currentDay + 7) % 7;
                if (daysToAdd === 0 && nextRun <= now) daysToAdd = 7;
                nextRun.setDate(nextRun.getDate() + daysToAdd);
            } else if (newTask.recurrence === 'monthly') {
                const targetDate = parseInt(newTask.uiDayOfMonth);
                nextRun.setDate(targetDate);
                if (nextRun <= now) nextRun.setMonth(nextRun.getMonth() + 1);
            }
            finalScheduleTime = nextRun.toISOString();
        } else {
            // Recurrence is once
            if (!finalScheduleTime) {
                 // If no time specified for 'once', assume immediate (or required field handles it)
                 // But <input type="datetime-local" required /> should handle it.
                 // If logic falls here, it might be empty.
                 return;
            }
        }
    
        try {
            if (isEditing && newTask.id) {
                // Editing mode - only supports single task editing (the one selected)
                // We assume in editing mode, selectedTargets has exactly 1 item (the task's target)
                // If user selected more, it's ambiguous. But let's support updating the current task's target if changed.
                // Actually, batch update is complex. Let's restrict editing to single target.
                const target = selectedTargets[0];
                await axios.put(`/api/tasks/${newTask.id}`, {
                    ...newTask,
                    content: contentArray,
                    scheduleTime: finalScheduleTime,
                    targetType: target.type,
                    targetId: target.id,
                    targetName: target.name
                });
                showToast('任务更新成功', 'success');
            } else {
                // Batch Creation
                let count = 0;
                for (const target of selectedTargets) {
                    await axios.post('/api/tasks', {
                        ...newTask,
                        content: contentArray,
                        scheduleTime: finalScheduleTime,
                        targetType: target.type,
                        targetId: target.id,
                        targetName: target.name
                    });
                    count++;
                }
                showToast(`成功创建 ${count} 个任务`, 'success');
            }
          
          await fetchTasks();
          resetForm();
        } catch (e) {
          showToast(isEditing ? '更新失败' : t.createFailed, 'error');
        }
    };

    const editTask = (task: Task) => {
        const date = new Date(task.scheduleTime);
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');
        
        setNewTask({
            ...task,
            content: task.content.length > 0 ? task.content : [''],
            uiTime: `${hours}:${minutes}`,
            uiWeekday: task.recurrence === 'weekly' ? (date.getDay() === 0 ? '7' : date.getDay().toString()) : '1',
            uiDayOfMonth: date.getDate().toString(),
            intervalValue: task.intervalValue || 30,
            intervalUnit: task.intervalUnit || 'minute'
        });
        
        setSelectedTargets([{
            type: task.targetType,
            id: task.targetId,
            name: task.targetName
        }]);

        setIsEditing(true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const deleteTask = async (id: string) => {
        if (!window.confirm(t.deleteConfirm)) return;
        try {
            const res = await axios.delete(`/api/tasks/${id}`);
            if (res.data.success) {
                await fetchTasks();
                showToast('删除成功', 'success');
            } else {
                showToast('删除失败，服务器返回异常', 'error');
            }
        } catch (e: any) {
            let errMsg = e.message;
            if (e.response) {
                errMsg = `Server Error (${e.response.status}): ${JSON.stringify(e.response.data)}`;
            }
            showToast(`删除请求失败: ${errMsg}`, 'error');
        }
    };

    const batchDeleteTasks = async () => {
        if (selectedTaskIds.size === 0) return;
        if (!window.confirm(`确定要删除选中的 ${selectedTaskIds.size} 个任务吗？`)) return;
        
        try {
            await axios.delete('/api/tasks/batch-delete', { data: { ids: Array.from(selectedTaskIds) } });
            setSelectedTaskIds(new Set());
            await fetchTasks();
            showToast('批量删除成功', 'success');
        } catch (e) {
            showToast('批量删除失败', 'error');
        }
    };

    // Filtered Tasks
    const filteredTasks = tasks
      .filter(t => taskFilter === 'all' || t.status === taskFilter)
      .filter(t => 
          t.content.some(c => c.toLowerCase().includes(taskSearchQuery.toLowerCase())) || 
          t.targetName.toLowerCase().includes(taskSearchQuery.toLowerCase())
      );

    return (
          <div className="space-y-8">
            {/* Create Task Form */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
              <div className="flex justify-between items-center mb-4">
                  <h2 className="text-lg font-bold">{isEditing ? '编辑任务' : t.scheduleNew}</h2>
                  {isEditing && (
                      <button onClick={resetForm} className="text-sm text-gray-500 hover:text-gray-700">
                          取消编辑
                      </button>
                  )}
              </div>
              <form onSubmit={createTask} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {!isEditing && (
                    <div className="md:col-span-2">
                         <label className="block text-sm font-medium text-gray-700 mb-1">{t.loadFromTemplate}</label>
                         <select 
                            onChange={e => {
                                const tplId = e.target.value;
                                if (!tplId) return;
                                const tpl = templates.find(t => t.id === tplId);
                                if (tpl) {
                                    setNewTask(prev => ({
                                        ...prev,
                                        content: tpl.content,
                                        recurrence: tpl.recurrence,
                                        intervalValue: tpl.intervalValue ?? prev.intervalValue,
                                        intervalUnit: tpl.intervalUnit ?? prev.intervalUnit,
                                        uiTime: tpl.uiTime ?? prev.uiTime,
                                        uiWeekday: tpl.uiWeekday ?? prev.uiWeekday,
                                        uiDayOfMonth: tpl.uiDayOfMonth ?? prev.uiDayOfMonth
                                    }));
                                }
                            }}
                            className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-green-500"
                         >
                             <option value="">{t.selectTemplate}</option>
                             {templates.map(tpl => (
                                 <option key={tpl.id} value={tpl.id}>{tpl.name}</option>
                             ))}
                         </select>
                    </div>
                )}

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t.selectTargets}</label>
                  <div className="max-h-48 overflow-y-auto border border-gray-300 rounded p-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                    {groups.map(g => (
                        <label key={g.id} className="flex items-center space-x-2 p-1 hover:bg-gray-50 rounded cursor-pointer">
                            <input 
                                type="checkbox"
                                checked={selectedTargets.some(t => t.id === g.id)}
                                onChange={e => {
                                    const target = { type: 'group' as const, id: g.id, name: g.topic };
                                    setSelectedTargets(prev => 
                                        e.target.checked 
                                            ? [...prev, target]
                                            : prev.filter(t => t.id !== g.id)
                                    );
                                }}
                                className="rounded text-green-600 focus:ring-green-500"
                            />
                            <span className="text-sm truncate">{g.topic}</span>
                            <span className="text-xs text-gray-400">({t.group})</span>
                        </label>
                    ))}
                    {contacts.map(c => (
                        <label key={c.id} className="flex items-center space-x-2 p-1 hover:bg-gray-50 rounded cursor-pointer">
                            <input 
                                type="checkbox"
                                checked={selectedTargets.some(t => t.id === c.id)}
                                onChange={e => {
                                    const target = { type: 'contact' as const, id: c.id, name: c.name };
                                    setSelectedTargets(prev => 
                                        e.target.checked 
                                            ? [...prev, target]
                                            : prev.filter(t => t.id !== c.id)
                                    );
                                }}
                                className="rounded text-green-600 focus:ring-green-500"
                            />
                            <span className="text-sm truncate">{c.name}</span>
                            <span className="text-xs text-gray-400">({t.contact})</span>
                        </label>
                    ))}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">已选择 {selectedTargets.length} 个对象</p>
                </div>
                
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t.content} (支持多条消息，循环发送)</label>
                  <div className="space-y-2">
                    {newTask.content?.map((item, index) => (
                        <div key={index} className="flex gap-2 items-start">
                            <span className="mt-2 text-xs text-gray-400 w-4">{index + 1}.</span>
                            <textarea 
                                value={item}
                                onChange={e => {
                                    const newContent = [...(newTask.content || [])];
                                    newContent[index] = e.target.value;
                                    setNewTask({...newTask, content: newContent});
                                }}
                                className="flex-1 p-2 border border-gray-300 rounded focus:ring-2 focus:ring-green-500 focus:border-green-500"
                                rows={2}
                                placeholder="输入消息内容..."
                            />
                            <button 
                                type="button"
                                onClick={() => {
                                    const newContent = newTask.content?.filter((_, i) => i !== index);
                                    setNewTask({...newTask, content: newContent?.length ? newContent : ['']});
                                }}
                                className="mt-1 p-2 text-red-500 hover:bg-red-50 rounded"
                                title="删除此条"
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    ))}
                  </div>
                  <button 
                    type="button"
                    onClick={() => setNewTask({...newTask, content: [...(newTask.content || []), '']})}
                    className="mt-2 text-sm text-green-600 hover:text-green-700 font-medium flex items-center gap-1"
                  >
                    + 添加下一条消息
                  </button>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t.recurrence}</label>
                  <select 
                    value={newTask.recurrence}
                    onChange={e => setNewTask({...newTask, recurrence: e.target.value as any})}
                    className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-green-500 focus:border-green-500"
                  >
                    <option value="once">{t.once}</option>
                    <option value="daily">{t.daily}</option>
                    <option value="weekly">{t.weekly}</option>
                    <option value="monthly">{t.monthly}</option>
                    <option value="interval">{t.interval}</option>
                  </select>
                </div>

                <div>
                   {newTask.recurrence === 'once' && (
                       <>
                           <label className="block text-sm font-medium text-gray-700 mb-1">{t.scheduleTime}</label>
                           <input 
                             type="datetime-local"
                             value={newTask.scheduleTime}
                             onChange={e => setNewTask({...newTask, scheduleTime: e.target.value})}
                             className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-green-500 focus:border-green-500"
                             required
                           />
                       </>
                   )}

                   {newTask.recurrence === 'interval' && (
                       <div className="space-y-4">
                            <div>
                               <label className="block text-sm font-medium text-gray-700 mb-1">{t.startTime}</label>
                               <input 
                                 type="datetime-local"
                                 value={newTask.scheduleTime}
                                 onChange={e => setNewTask({...newTask, scheduleTime: e.target.value})}
                                 className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-green-500 focus:border-green-500"
                                 required
                               />
                            </div>
                           <div className="flex gap-2">
                               <div className="flex-1">
                                   <label className="block text-sm font-medium text-gray-700 mb-1">{t.intervalValue}</label>
                                   <input 
                                     type="number"
                                     min="1"
                                     value={newTask.intervalValue}
                                     onChange={e => setNewTask({...newTask, intervalValue: parseInt(e.target.value) || 1})}
                                     className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-green-500 focus:border-green-500"
                                     required
                                   />
                               </div>
                               <div className="flex-1">
                                   <label className="block text-sm font-medium text-gray-700 mb-1">{t.intervalUnit}</label>
                                   <select 
                                     value={newTask.intervalUnit}
                                     onChange={e => setNewTask({...newTask, intervalUnit: e.target.value as any})}
                                     className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-green-500 focus:border-green-500"
                                   >
                                       <option value="minute">{t.minutes}</option>
                                       <option value="hour">{t.hours}</option>
                                       <option value="day">{t.days}</option>
                                   </select>
                               </div>
                           </div>
                       </div>
                   )}

                   {newTask.recurrence === 'daily' && (
                       <>
                           <label className="block text-sm font-medium text-gray-700 mb-1">{t.everyDayAt}</label>
                           <input 
                             type="time"
                             value={newTask.uiTime}
                             onChange={e => setNewTask({...newTask, uiTime: e.target.value})}
                             className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-green-500 focus:border-green-500"
                             required
                           />
                       </>
                   )}

                   {newTask.recurrence === 'weekly' && (
                       <div className="flex gap-2">
                           <div className="flex-1">
                               <label className="block text-sm font-medium text-gray-700 mb-1">{t.dayOfWeek}</label>
                               <select 
                                 value={newTask.uiWeekday}
                                 onChange={e => setNewTask({...newTask, uiWeekday: e.target.value})}
                                 className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-green-500 focus:border-green-500"
                               >
                                   <option value="1">{t.monday}</option>
                                   <option value="2">{t.tuesday}</option>
                                   <option value="3">{t.wednesday}</option>
                                   <option value="4">{t.thursday}</option>
                                   <option value="5">{t.friday}</option>
                                   <option value="6">{t.saturday}</option>
                                   <option value="7">{t.sunday}</option>
                               </select>
                           </div>
                           <div className="flex-1">
                               <label className="block text-sm font-medium text-gray-700 mb-1">{t.time}</label>
                               <input 
                                 type="time"
                                 value={newTask.uiTime}
                                 onChange={e => setNewTask({...newTask, uiTime: e.target.value})}
                                 className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-green-500 focus:border-green-500"
                                 required
                               />
                           </div>
                       </div>
                   )}

                   {newTask.recurrence === 'monthly' && (
                       <div className="flex gap-2">
                           <div className="flex-1">
                               <label className="block text-sm font-medium text-gray-700 mb-1">{t.dayOfMonth}</label>
                               <select 
                                 value={newTask.uiDayOfMonth}
                                 onChange={e => setNewTask({...newTask, uiDayOfMonth: e.target.value})}
                                 className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-green-500 focus:border-green-500"
                               >
                                   {Array.from({length: 31}, (_, i) => i + 1).map(d => (
                                       <option key={d} value={d}>{d}日</option>
                                   ))}
                               </select>
                           </div>
                           <div className="flex-1">
                               <label className="block text-sm font-medium text-gray-700 mb-1">{t.time}</label>
                               <input 
                                 type="time"
                                 value={newTask.uiTime}
                                 onChange={e => setNewTask({...newTask, uiTime: e.target.value})}
                                 className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-green-500 focus:border-green-500"
                                 required
                               />
                           </div>
                       </div>
                   )}
                </div>

                <div className="flex items-end md:col-span-2">
                  <button type="submit" className={clsx(
                      "w-full py-2 text-white rounded font-medium transition-colors",
                      isEditing ? "bg-blue-600 hover:bg-blue-700" : "bg-green-600 hover:bg-green-700"
                  )}>
                    {isEditing ? '更新任务' : t.scheduleTask}
                  </button>
                </div>
              </form>
            </div>

            {/* Task List */}
            <div className="space-y-4">
                <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                    <h2 className="text-lg font-bold">{t.scheduledTasks}</h2>
                    <div className="flex items-center gap-2 w-full md:w-auto">
                        {selectedTaskIds.size > 0 && (
                            <button 
                                onClick={batchDeleteTasks}
                                className="px-3 py-2 bg-red-100 text-red-600 rounded hover:bg-red-200 text-sm font-medium flex items-center gap-1"
                            >
                                <Trash2 className="w-4 h-4" />
                                {t.batchDelete} ({selectedTaskIds.size})
                            </button>
                        )}
                        <input 
                            type="text" 
                            placeholder="搜索任务内容/目标..."
                            className="p-2 border border-gray-300 rounded text-sm flex-1 md:w-64"
                            value={taskSearchQuery}
                            onChange={e => setTaskSearchQuery(e.target.value)}
                        />
                        <select 
                            value={taskFilter}
                            onChange={e => setTaskFilter(e.target.value as any)}
                            className="p-2 border border-gray-300 rounded text-sm"
                        >
                            <option value="all">{t.allTasks}</option>
                            <option value="pending">{t.pending}</option>
                            <option value="success">{t.success}</option>
                            <option value="failed">{t.failed}</option>
                        </select>
                        <button onClick={fetchTasks} className="p-2 hover:bg-gray-100 rounded-full">
                            <RefreshCw className="w-4 h-4 text-gray-500" />
                        </button>
                    </div>
                </div>
                
                <div className="hidden md:block bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-gray-50 text-gray-500">
                            <tr>
                                <th className="p-4 w-10">
                                    <input 
                                        type="checkbox"
                                        checked={filteredTasks.length > 0 && selectedTaskIds.size === filteredTasks.length}
                                        onChange={e => {
                                            if (e.target.checked) {
                                                setSelectedTaskIds(new Set(filteredTasks.map(t => t.id)));
                                            } else {
                                                setSelectedTaskIds(new Set());
                                            }
                                        }}
                                        className="rounded text-green-600 focus:ring-green-500"
                                    />
                                </th>
                                <th className="p-4">{t.target}</th>
                                <th className="p-4">{t.content}</th>
                                <th className="p-4">{t.scheduleTime}</th>
                                <th className="p-4">{t.recurrence}</th>
                                <th className="p-4">{t.status}</th>
                                <th className="p-4">{t.actions}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {filteredTasks.map(task => (
                                <tr key={task.id} className="hover:bg-gray-50">
                                    <td className="p-4">
                                        <input 
                                            type="checkbox"
                                            checked={selectedTaskIds.has(task.id)}
                                            onChange={e => {
                                                const newSet = new Set(selectedTaskIds);
                                                if (e.target.checked) {
                                                    newSet.add(task.id);
                                                } else {
                                                    newSet.delete(task.id);
                                                }
                                                setSelectedTaskIds(newSet);
                                            }}
                                            className="rounded text-green-600 focus:ring-green-500"
                                        />
                                    </td>
                                    <td className="p-4 font-medium">{task.targetName}</td>
                                    <td className="p-4 truncate max-w-xs">{task.content}</td>
                                    <td className="p-4">{new Date(task.scheduleTime).toLocaleString()}</td>
                                    <td className="p-4">
                                        <span className="px-2 py-1 rounded-full text-xs bg-gray-100 text-gray-700">
                                            {task.recurrence === 'interval' 
                                                ? `${t.interval}: ${task.intervalValue}${getIntervalUnitLabel(task.intervalUnit)}`
                                                : getRecurrenceLabel(task.recurrence)}
                                        </span>
                                    </td>
                                    <td className="p-4">
                                        <span className={clsx(
                                            "px-2 py-1 rounded-full text-xs font-medium",
                                            task.status === 'success' ? "bg-green-100 text-green-700" :
                                            task.status === 'pending' ? "bg-blue-100 text-blue-700" :
                                            "bg-red-100 text-red-700"
                                        )}>
                                            {task.status === 'success' ? t.success :
                                             task.status === 'pending' ? t.pending : t.failed}
                                        </span>
                                        {task.error && <p className="text-xs text-red-500 mt-1">{task.error}</p>}
                                    </td>
                                    <td className="p-4 flex items-center gap-2">
                                        <button onClick={() => editTask(task)} className="text-blue-500 hover:text-blue-700">
                                            <FileText className="w-4 h-4" />
                                        </button>
                                        <button onClick={() => deleteTask(task.id)} className="text-red-500 hover:text-red-700">
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {filteredTasks.length === 0 && (
                                <tr>
                                    <td colSpan={7} className="p-8 text-center text-gray-500">
                                        {tasks.length === 0 ? t.noTasks : '没有找到匹配的任务'}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Mobile Card View */}
                <div className="md:hidden space-y-4">
                    {filteredTasks.length > 0 && (
                         <div className="flex justify-end px-2">
                            <label className="flex items-center space-x-2 text-sm text-gray-600">
                                <input 
                                    type="checkbox"
                                    checked={filteredTasks.length > 0 && selectedTaskIds.size === filteredTasks.length}
                                    onChange={e => {
                                        if (e.target.checked) {
                                            setSelectedTaskIds(new Set(filteredTasks.map(t => t.id)));
                                        } else {
                                            setSelectedTaskIds(new Set());
                                        }
                                    }}
                                    className="rounded text-green-600 focus:ring-green-500"
                                />
                                <span>全选当前页</span>
                            </label>
                        </div>
                    )}
                    
                    {filteredTasks.map(task => (
                        <div key={task.id} className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 space-y-3">
                            <div className="flex justify-between items-start">
                                <div className="flex items-center gap-3">
                                    <input 
                                        type="checkbox"
                                        checked={selectedTaskIds.has(task.id)}
                                        onChange={e => {
                                            const newSet = new Set(selectedTaskIds);
                                            if (e.target.checked) {
                                                newSet.add(task.id);
                                            } else {
                                                newSet.delete(task.id);
                                            }
                                            setSelectedTaskIds(newSet);
                                        }}
                                        className="rounded text-green-600 focus:ring-green-500"
                                    />
                                    <div>
                                        <div className="font-bold text-gray-900">{task.targetName}</div>
                                        <div className="text-xs text-gray-500 mt-0.5">
                                            {new Date(task.scheduleTime).toLocaleString()}
                                        </div>
                                    </div>
                                </div>
                                <span className={clsx(
                                    "px-2 py-1 rounded-full text-xs font-medium",
                                    task.status === 'success' ? "bg-green-100 text-green-700" :
                                    task.status === 'pending' ? "bg-blue-100 text-blue-700" :
                                    "bg-red-100 text-red-700"
                                )}>
                                    {task.status === 'success' ? t.success :
                                     task.status === 'pending' ? t.pending : t.failed}
                                </span>
                            </div>
                            
                            <div className="bg-gray-50 p-3 rounded-lg text-sm text-gray-700 break-words">
                                {Array.isArray(task.content) ? (
                                    <ul className="list-decimal list-inside space-y-1">
                                        {task.content.map((c, i) => (
                                            <li key={i} className="line-clamp-2">{c}</li>
                                        ))}
                                    </ul>
                                ) : task.content}
                            </div>

                            <div className="flex justify-between items-center pt-2 border-t border-gray-100">
                                <span className="px-2 py-1 rounded-full text-xs bg-gray-100 text-gray-600">
                                    {task.recurrence === 'interval' 
                                        ? `${t.interval}: ${task.intervalValue}${getIntervalUnitLabel(task.intervalUnit)}`
                                        : getRecurrenceLabel(task.recurrence)}
                                </span>
                                <div className="flex gap-3">
                                    <button onClick={() => editTask(task)} className="p-2 text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100">
                                        <FileText className="w-4 h-4" />
                                    </button>
                                    <button onClick={() => deleteTask(task.id)} className="p-2 text-red-600 bg-red-50 rounded-lg hover:bg-red-100">
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                            {task.error && <p className="text-xs text-red-500">{task.error}</p>}
                        </div>
                    ))}
                    
                    {filteredTasks.length === 0 && (
                        <div className="text-center text-gray-500 py-12 bg-white rounded-xl border border-gray-200">
                            {tasks.length === 0 ? t.noTasks : '没有找到匹配的任务'}
                        </div>
                    )}
                </div>
            </div>
          </div>
    );
};
