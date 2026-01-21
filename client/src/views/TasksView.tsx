import React, { useState } from 'react';
import { RefreshCw, Trash2, FileText } from 'lucide-react';
import clsx from 'clsx';
import { t } from '../utils/i18n';
import { Task, Group } from '../types';
import axios from 'axios';

interface TasksViewProps {
    tasks: Task[];
    fetchTasks: () => Promise<void>;
    groups: Group[];
    contacts: {id: string, name: string}[];
    showToast: (msg: string, type: 'success' | 'error' | 'info') => void;
    initialDraft?: Partial<Task>;
}

export const TasksView: React.FC<TasksViewProps> = ({ 
    tasks, fetchTasks, groups, contacts, showToast, initialDraft
}) => {
    // Task Form State
    const initialNewTask: Partial<Task> & {
      uiTime: string;
      uiWeekday: string;
      uiDayOfMonth: string;
      intervalValue: number;
      intervalUnit: 'minute' | 'hour' | 'day';
    } = {
      type: 'text',
      targetType: 'group',
      targetId: '',
      content: '',
      scheduleTime: '', 
      recurrence: 'once',
      uiTime: '09:00',
      uiWeekday: '1', 
      uiDayOfMonth: '1',
      intervalValue: 30,
      intervalUnit: 'minute'
    };
  
    const [newTask, setNewTask] = useState({ ...initialNewTask, ...initialDraft });

    React.useEffect(() => {
        if (initialDraft) {
            setNewTask(prev => ({ ...prev, ...initialDraft }));
        }
    }, [initialDraft]);
    const [isEditing, setIsEditing] = useState(false);
    const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
    const [taskSearchQuery, setTaskSearchQuery] = useState('');
    const [taskFilter, setTaskFilter] = useState<'all' | 'pending' | 'success' | 'failed'>('all');

    const resetForm = () => {
        setNewTask({ ...initialNewTask });
        setIsEditing(false);
    };

    const createTask = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newTask.targetId || !newTask.content) return;
    
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
            if (!finalScheduleTime) return;
        }
    
        let targetName = 'Unknown';
        if (newTask.targetType === 'group') {
            targetName = groups.find(g => g.id === newTask.targetId)?.topic || 'Unknown';
        } else {
            targetName = contacts.find(c => c.id === newTask.targetId)?.name || 'Unknown';
        }
        
        try {
          if (isEditing && newTask.id) {
              await axios.put(`/api/tasks/${newTask.id}`, {
                  ...newTask,
                  scheduleTime: finalScheduleTime,
                  targetName
              });
              showToast('任务更新成功', 'success');
          } else {
              await axios.post('/api/tasks', {
                  ...newTask,
                  scheduleTime: finalScheduleTime,
                  targetName
              });
              showToast('任务创建成功', 'success');
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
            uiTime: `${hours}:${minutes}`,
            uiWeekday: task.recurrence === 'weekly' ? (date.getDay() === 0 ? '7' : date.getDay().toString()) : '1',
            uiDayOfMonth: date.getDate().toString(),
            intervalValue: task.intervalValue || 30,
            intervalUnit: task.intervalUnit || 'minute'
        });
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
          t.content.toLowerCase().includes(taskSearchQuery.toLowerCase()) || 
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
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t.targetType}</label>
                  <select 
                    value={newTask.targetType}
                    onChange={e => setNewTask({...newTask, targetType: e.target.value as 'group' | 'contact', targetId: ''})}
                    className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-green-500 focus:border-green-500"
                  >
                    <option value="group">{t.group}</option>
                    <option value="contact">{t.contact}</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t.selectTarget}</label>
                  <select 
                    value={newTask.targetId}
                    onChange={e => setNewTask({...newTask, targetId: e.target.value})}
                    className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-green-500 focus:border-green-500"
                    required
                  >
                    <option value="">{t.select}</option>
                    {newTask.targetType === 'group' ? (
                        groups.map(g => (
                            <option key={g.id} value={g.id}>{g.topic}</option>
                        ))
                    ) : (
                        contacts.map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                        ))
                    )}
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t.messageType}</label>
                  <select 
                    value={newTask.type}
                    onChange={e => setNewTask({...newTask, type: e.target.value as any})}
                    className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-green-500 focus:border-green-500"
                  >
                    <option value="text">{t.text}</option>
                    <option value="image">{t.image}</option>
                    <option value="file">{t.file}</option>
                  </select>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t.content}</label>
                  <textarea 
                    value={newTask.content}
                    onChange={e => setNewTask({...newTask, content: e.target.value})}
                    className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-green-500 focus:border-green-500"
                    rows={3}
                    required
                    placeholder={newTask.type === 'text' ? "Hello world..." : "https://example.com/image.png"}
                  />
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
                
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
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
                                                ? `${t.interval}: ${task.intervalValue}${t[task.intervalUnit + 's'] || task.intervalUnit}`
                                                : t[task.recurrence || 'once']}
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
            </div>
          </div>
    );
};
