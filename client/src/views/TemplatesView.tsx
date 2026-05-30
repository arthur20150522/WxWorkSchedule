import React, { useState, useRef } from 'react';
import { RefreshCw, FileText, Trash2, Upload, Download } from 'lucide-react';
import { t } from '../utils/i18n';
import { Template, Contact } from '../types';
import axios from 'axios';

interface TemplatesViewProps {
    templates: Template[];
    fetchTemplates: () => void;
    showToast: (msg: string, type: 'success' | 'error' | 'info') => void;
    onGenerateTask: (template: Template) => void;
    contacts: Contact[];
}

const getDefaultTemplate = (): Partial<Template> => ({
    name: '',
    type: 'text',
    content: [''],
    targets: [],
    recurrence: 'once',
    uiTime: '09:00',
    weeklySlots: [{ days: ['1'], time: '09:00' }],
    uiDayOfMonth: '1',
    intervalValue: 30,
    intervalUnit: 'minute'
});

export const TemplatesView: React.FC<TemplatesViewProps> = ({
    templates, fetchTemplates, showToast, onGenerateTask, contacts
}) => {
    const [isTemplateEditing, setIsTemplateEditing] = useState(false);
    const [newTemplate, setNewTemplate] = useState<Partial<Template>>(getDefaultTemplate());
    const fileInputRef = useRef<HTMLInputElement>(null);

    // 全量导出 — 一个 JSON 包含 contacts + templates + tasks
    const handleExport = async () => {
        try {
            const res = await axios.get('/api/data/export');
            const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `wxschedule-backup-${new Date().toISOString().slice(0,10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
            const ct = res.data.contacts?.length || 0;
            const tp = res.data.templates?.length || 0;
            const tk = res.data.tasks?.length || 0;
            showToast(`Exported: ${ct} contacts + ${tp} templates + ${tk} tasks`, 'success');
        } catch {
            showToast('Export failed', 'error');
        }
    };

    // 全量导入 — 服务端合并（同 id 跳过，新数据追加）
    const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            const text = await file.text();
            const data = JSON.parse(text);
            const res = await axios.post('/api/data/import', data);
            const r = res.data;
            showToast(`Imported: ${r.total || 0} total (${r.contacts || 0}C + ${r.templates || 0}T + ${r.tasks || 0}K)`, 'success');
            fetchTemplates();
            window.location.reload();
        } catch (e: any) {
            showToast('Import failed: ' + (e.response?.data?.error || e.message), 'error');
        }

        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const getIntervalUnitLabel = (unit?: 'minute' | 'hour' | 'day') => {
        if (unit === 'hour') return t.hours;
        if (unit === 'day') return t.days;
        return t.minutes;
    };

    const getRecurrenceLabel = (tpl: Template) => {
        const recurrence = tpl.recurrence;
        if (recurrence === 'daily') return t.daily;
        if (recurrence === 'weekly') {
            const slots = tpl.weeklySlots || [];
            const names = ['一','二','三','四','五','六','日'];
            const parts = slots.map(s => {
                const dayStr = (s.days || []).map((d: string) => names[Number(d)-1]).join('');
                return `周${dayStr} ${s.time}`;
            });
            return parts.join(', ') || t.weekly;
        }
        if (recurrence === 'monthly') return t.monthly;
        if (recurrence === 'interval') {
            return `${t.interval}: ${tpl.intervalValue}${getIntervalUnitLabel(tpl.intervalUnit)}`;
        }
        return t.once;
    };

    const createTemplate = async (e: React.FormEvent) => {
        e.preventDefault();
        const contentArray = newTemplate.content?.filter(line => line.trim() !== '') || [];

        if (!newTemplate.name || contentArray.length === 0) {
            showToast('请填写完整模板信息', 'error');
            return;
        }

        const templateData = { ...newTemplate, content: contentArray };

        try {
            if (isTemplateEditing && newTemplate.id) {
                await axios.put(`/api/templates/${newTemplate.id}`, templateData);
                showToast('模板更新成功', 'success');
            } else {
                await axios.post('/api/templates', templateData);
                showToast('模板创建成功', 'success');
            }
            fetchTemplates();
            setIsTemplateEditing(false);
            setNewTemplate(getDefaultTemplate());
        } catch (e) {
            showToast('操作失败', 'error');
        }
    };

    const deleteTemplate = async (id: string) => {
        if (!window.confirm(t.deleteConfirm)) return;
        try {
            await axios.delete(`/api/templates/${id}`);
            fetchTemplates();
            showToast('删除成功', 'success');
        } catch (e) {
            showToast('删除失败', 'error');
        }
    };

    return (
            <div className="space-y-8">
                {/* Template Form */}
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-lg font-bold">{isTemplateEditing ? '编辑模板' : t.createTemplate}</h2>
                        {isTemplateEditing && (
                            <button onClick={() => {
                                setIsTemplateEditing(false);
                                setNewTemplate(getDefaultTemplate());
                            }} className="text-sm text-gray-500 hover:text-gray-700">取消</button>
                        )}
                    </div>
                    <form onSubmit={createTemplate} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">{t.templateName}</label>
                            <input
                                type="text"
                                value={newTemplate.name ?? ''}
                                onChange={e => setNewTemplate({...newTemplate, name: e.target.value})}
                                className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-green-500"
                                required
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">{t.content}</label>
                            <div className="space-y-2">
                                {newTemplate.content?.map((item, index) => (
                                    <div key={index} className="flex gap-2 items-start">
                                        <span className="mt-2 text-xs text-gray-400 w-4">{index + 1}.</span>
                                        <textarea
                                            value={item}
                                            onChange={e => {
                                                const newContent = [...(newTemplate.content || [])];
                                                newContent[index] = e.target.value;
                                                setNewTemplate({...newTemplate, content: newContent});
                                            }}
                                            className="flex-1 p-2 border border-gray-300 rounded focus:ring-2 focus:ring-green-500"
                                            rows={2}
                                            placeholder="输入模板内容..."
                                        />
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const newContent = newTemplate.content?.filter((_, i) => i !== index);
                                                setNewTemplate({...newTemplate, content: newContent?.length ? newContent : ['']});
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
                                onClick={() => setNewTemplate({...newTemplate, content: [...(newTemplate.content || []), '']})}
                                className="mt-2 text-sm text-green-600 hover:text-green-700 font-medium flex items-center gap-1"
                            >
                                + 添加下一条内容
                            </button>
                        </div>

                        {/* 关联对象 — 从通讯录选择 */}
                        {contacts.length > 0 && (
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">{t.associatedTargets}</label>
                                <div className="max-h-32 overflow-y-auto border border-gray-300 rounded p-2 grid grid-cols-2 gap-2">
                                    {contacts.map(c => (
                                        <label key={c.id} className="flex items-center space-x-2 p-1 hover:bg-gray-50 rounded cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={(newTemplate.targets || []).some(tgt => tgt.name === c.name)}
                                                onChange={e => {
                                                    const target = { name: c.name, type: c.type };
                                                    const currentTargets = newTemplate.targets || [];
                                                    setNewTemplate({
                                                        ...newTemplate,
                                                        targets: e.target.checked
                                                            ? [...currentTargets, target]
                                                            : currentTargets.filter(tgt => tgt.name !== c.name)
                                                    });
                                                }}
                                                className="rounded text-green-600 focus:ring-green-500"
                                            />
                                            <span className="text-sm truncate">{c.name}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">{t.recurrence}</label>
                            <select
                                value={newTemplate.recurrence ?? 'once'}
                                onChange={e => setNewTemplate({...newTemplate, recurrence: e.target.value as any})}
                                className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-green-500"
                            >
                                <option value="once">{t.once}</option>
                                <option value="daily">{t.daily}</option>
                                <option value="weekly">{t.weekly}</option>
                                <option value="monthly">{t.monthly}</option>
                                <option value="interval">{t.interval}</option>
                            </select>
                        </div>

                        {newTemplate.recurrence === 'interval' && (
                           <div className="flex gap-2">
                               <div className="flex-1">
                                   <label className="block text-sm font-medium text-gray-700 mb-1">{t.intervalValue}</label>
                                   <input
                                     type="number"
                                     min="1"
                                    value={newTemplate.intervalValue ?? 1}
                                     onChange={e => setNewTemplate({...newTemplate, intervalValue: parseInt(e.target.value) || 1})}
                                     className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-green-500"
                                     required
                                   />
                               </div>
                               <div className="flex-1">
                                   <label className="block text-sm font-medium text-gray-700 mb-1">{t.intervalUnit}</label>
                                   <select
                                    value={newTemplate.intervalUnit ?? 'minute'}
                                     onChange={e => setNewTemplate({...newTemplate, intervalUnit: e.target.value as any})}
                                     className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-green-500"
                                   >
                                       <option value="minute">{t.minutes}</option>
                                       <option value="hour">{t.hours}</option>
                                       <option value="day">{t.days}</option>
                                   </select>
                               </div>
                           </div>
                        )}

                        {newTemplate.recurrence === 'daily' && (
                           <div>
                               <label className="block text-sm font-medium text-gray-700 mb-1">{t.everyDayAt}</label>
                               <input
                                 type="time"
                                value={newTemplate.uiTime ?? '09:00'}
                                 onChange={e => setNewTemplate({...newTemplate, uiTime: e.target.value})}
                                 className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-green-500"
                                 required
                               />
                           </div>
                        )}

                        {newTemplate.recurrence === 'weekly' && (
                           <div>
                               <label className="block text-sm font-medium text-gray-700 mb-2">{t.dayOfWeek}</label>
                               <div className="space-y-2">
                                   {(newTemplate.weeklySlots || [{ days: ['1'], time: '09:00' }]).map((slot: any, rowIdx: number) => {
                                       const usedDays = new Set<string>();
                                       (newTemplate.weeklySlots || []).forEach((s: any, i: number) => {
                                           if (i !== rowIdx) (s.days || []).forEach((d: string) => usedDays.add(d));
                                       });
                                       const names = ['一','二','三','四','五','六','日'];
                                       return (
                                           <div key={rowIdx} className="flex items-center gap-2 flex-wrap p-2 bg-gray-50 rounded">
                                               {names.map((name, idx) => {
                                                   const d = String(idx + 1);
                                                   const disabled = usedDays.has(d);
                                                   const checked = (slot.days || []).includes(d);
                                                   return (
                                                       <label key={d} className={`flex items-center gap-0.5 text-xs ${disabled ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'}`}>
                                                           <input type="checkbox" checked={checked} disabled={disabled}
                                                               onChange={e => {
                                                                   const slots = [...(newTemplate.weeklySlots || [{ days: ['1'], time: '09:00' }])];
                                                                   const s = { ...slots[rowIdx] };
                                                                   s.days = e.target.checked
                                                                       ? [...(s.days || []), d].sort()
                                                                       : (s.days || []).filter((x: string) => x !== d);
                                                                   slots[rowIdx] = s;
                                                                   setNewTemplate({...newTemplate, weeklySlots: slots});
                                                               }}
                                                               className="rounded text-green-600"
                                                           />{name}
                                                       </label>
                                                   );
                                               })}
                                               <button type="button" onClick={() => {
                                                   const slots = [...(newTemplate.weeklySlots || [{ days: ['1'], time: '09:00' }])];
                                                   slots[rowIdx] = { ...slots[rowIdx], days: ['1','2','3','4','5'].filter((d: string) => !usedDays.has(d)) };
                                                   setNewTemplate({...newTemplate, weeklySlots: slots});
                                               }} className="text-xs px-1.5 py-0.5 bg-white rounded border hover:bg-gray-100">工作日</button>
                                               <button type="button" onClick={() => {
                                                   const slots = [...(newTemplate.weeklySlots || [{ days: ['1'], time: '09:00' }])];
                                                   slots[rowIdx] = { ...slots[rowIdx], days: ['6','7'].filter((d: string) => !usedDays.has(d)) };
                                                   setNewTemplate({...newTemplate, weeklySlots: slots});
                                               }} className="text-xs px-1.5 py-0.5 bg-white rounded border hover:bg-gray-100">周末</button>
                                               <button type="button" onClick={() => {
                                                   const slots = [...(newTemplate.weeklySlots || [{ days: ['1'], time: '09:00' }])];
                                                   slots[rowIdx] = { ...slots[rowIdx], days: ['1','2','3','4','5','6','7'].filter((d: string) => !usedDays.has(d)) };
                                                   setNewTemplate({...newTemplate, weeklySlots: slots});
                                               }} className="text-xs px-1.5 py-0.5 bg-white rounded border hover:bg-gray-100">全选</button>
                                               <input type="time" value={slot.time || '09:00'}
                                                   onChange={e => {
                                                       const slots = [...(newTemplate.weeklySlots || [{ days: ['1'], time: '09:00' }])];
                                                       slots[rowIdx] = { ...slots[rowIdx], time: e.target.value };
                                                       setNewTemplate({...newTemplate, weeklySlots: slots});
                                                   }}
                                                   className="p-1 border rounded text-sm w-24"
                                               />
                                               {(newTemplate.weeklySlots || []).length > 1 && (
                                                   <button type="button" onClick={() => {
                                                       setNewTemplate({...newTemplate, weeklySlots: (newTemplate.weeklySlots || []).filter((_: any, i: number) => i !== rowIdx)});
                                                   }} className="text-red-400 hover:text-red-600 text-xs ml-1">✕</button>
                                               )}
                                           </div>
                                       );
                                   })}
                               </div>
                              {(() => {
                                  const usedAll = new Set((newTemplate.weeklySlots || []).flatMap((s: any) => s.days));
                                  if (usedAll.size >= 7) return null;
                                  return (
                                      <button type="button" onClick={() => {
                                          const firstFree = ['1','2','3','4','5','6','7'].find(d => !usedAll.has(d)) || '1';
                                          setNewTemplate({...newTemplate, weeklySlots: [...(newTemplate.weeklySlots || []), { days: [firstFree], time: '09:00' }]});
                                      }} className="text-xs text-blue-600 hover:text-blue-800 mt-1">+ 添加时段</button>
                              )})()}
                           </div>
                        )}

                        {newTemplate.recurrence === 'monthly' && (
                           <div className="flex gap-2">
                               <div className="flex-1">
                                   <label className="block text-sm font-medium text-gray-700 mb-1">{t.dayOfMonth}</label>
                                   <select
                                    value={newTemplate.uiDayOfMonth ?? '1'}
                                     onChange={e => setNewTemplate({...newTemplate, uiDayOfMonth: e.target.value})}
                                     className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-green-500"
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
                                    value={newTemplate.uiTime ?? '09:00'}
                                     onChange={e => setNewTemplate({...newTemplate, uiTime: e.target.value})}
                                     className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-green-500"
                                     required
                                   />
                               </div>
                           </div>
                        )}
                        <button type="submit" className="w-full py-2 bg-green-600 text-white rounded hover:bg-green-700">
                            {isTemplateEditing ? '更新模板' : '创建模板'}
                        </button>
                    </form>
                </div>

                {/* Template List */}
                <div className="space-y-4">
                    <div className="flex justify-between items-center">
                        <h2 className="text-lg font-bold">{t.templateList}</h2>
                        <div className="flex items-center gap-1">
                            <button onClick={handleExport} className="p-2 hover:bg-gray-100 rounded-full" title="导出 JSON">
                                <Download className="w-4 h-4 text-gray-600" />
                            </button>
                            <button onClick={() => fileInputRef.current?.click()} className="p-2 hover:bg-gray-100 rounded-full" title="导入 JSON">
                                <Upload className="w-4 h-4 text-gray-600" />
                            </button>
                            <input ref={fileInputRef} type="file" accept=".json" onChange={handleImport} className="hidden" />
                            <button onClick={fetchTemplates} className="p-2 hover:bg-gray-100 rounded-full" title={t.refresh}>
                                <RefreshCw className="w-5 h-5 text-gray-600" />
                            </button>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {templates.map(tpl => (
                            <div key={tpl.id} className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
                                <div className="flex justify-between items-start mb-2">
                                    <h3 className="font-bold text-lg">{tpl.name}</h3>
                                    <div className="flex gap-2">
                                        <button onClick={() => onGenerateTask(tpl)} className="text-green-600 hover:text-green-800" title={t.quickGenerate}>
                                            <RefreshCw className="w-5 h-5" />
                                        </button>
                                        <button onClick={() => {
                                            setNewTemplate({
                                                ...getDefaultTemplate(),
                                                ...tpl,
                                                content: tpl.content.length > 0 ? tpl.content : ['']
                                            });
                                            setIsTemplateEditing(true);
                                            window.scrollTo({ top: 0, behavior: 'smooth' });
                                        }} className="text-blue-600 hover:text-blue-800">
                                            <FileText className="w-5 h-5" />
                                        </button>
                                        <button onClick={() => deleteTemplate(tpl.id)} className="text-red-600 hover:text-red-800">
                                            <Trash2 className="w-5 h-5" />
                                        </button>
                                    </div>
                                </div>
                                <p className="text-gray-600 text-sm mb-2 line-clamp-3 whitespace-pre-line">
                                    {Array.isArray(tpl.content)
                                        ? tpl.content.map((c, i) => `${i+1}. ${c}`).join('\n')
                                        : tpl.content}
                                </p>
                                <div className="flex items-center gap-2 text-xs text-gray-500 flex-wrap">
                                    <span className="bg-gray-100 px-2 py-1 rounded">{tpl.type}</span>
                                    <span className="bg-blue-50 px-2 py-1 rounded text-blue-600">
                                        {getRecurrenceLabel(tpl)}
                                    </span>
                                    {tpl.recurrence !== 'interval' && tpl.uiTime && (
                                        <span className="bg-cyan-50 px-2 py-1 rounded text-cyan-700">
                                            {tpl.uiTime}
                                        </span>
                                    )}
                                    {tpl.targets && tpl.targets.length > 0 && (
                                        <span className="bg-green-50 px-2 py-1 rounded text-green-600">
                                            {tpl.targets.length} 个目标
                                        </span>
                                    )}
                                </div>
                            </div>
                        ))}
                        {templates.length === 0 && <div className="col-span-2 text-center text-gray-500 py-8">{t.noTemplates}</div>}
                    </div>
                </div>
            </div>
    );
};
