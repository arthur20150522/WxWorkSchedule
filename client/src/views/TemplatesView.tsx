import React, { useState } from 'react';
import { RefreshCw, FileText, Trash2 } from 'lucide-react';
import { t } from '../utils/i18n';
import { Template } from '../types';
import axios from 'axios';

interface TemplatesViewProps {
    templates: Template[];
    fetchTemplates: () => void;
    showToast: (msg: string, type: 'success' | 'error' | 'info') => void;
    onGenerateTask: (template: Template) => void;
}

const getDefaultTemplate = (): Partial<Template> => ({
    name: '',
    type: 'text',
    content: [''],
    targets: [],
    recurrence: 'once',
    uiTime: '09:00',
    uiWeekday: '1',
    uiDayOfMonth: '1',
    intervalValue: 30,
    intervalUnit: 'minute'
});

export const TemplatesView: React.FC<TemplatesViewProps> = ({ 
    templates, fetchTemplates, showToast, onGenerateTask 
}) => {
    const [isTemplateEditing, setIsTemplateEditing] = useState(false);
    const [newTemplate, setNewTemplate] = useState<Partial<Template>>(getDefaultTemplate());

    const getIntervalUnitLabel = (unit?: 'minute' | 'hour' | 'day') => {
        if (unit === 'hour') return t.hours;
        if (unit === 'day') return t.days;
        return t.minutes;
    };

    const getRecurrenceLabel = (recurrence?: Template['recurrence'], intervalValue?: number, intervalUnit?: Template['intervalUnit']) => {
        if (recurrence === 'daily') return t.daily;
        if (recurrence === 'weekly') return t.weekly;
        if (recurrence === 'monthly') return t.monthly;
        if (recurrence === 'interval') {
            return `${t.interval}: ${intervalValue}${getIntervalUnitLabel(intervalUnit)}`;
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
                           <div className="flex gap-2">
                               <div className="flex-1">
                                   <label className="block text-sm font-medium text-gray-700 mb-1">{t.dayOfWeek}</label>
                                   <select 
                                    value={newTemplate.uiWeekday ?? '1'}
                                     onChange={e => setNewTemplate({...newTemplate, uiWeekday: e.target.value})}
                                     className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-green-500"
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
                                    value={newTemplate.uiTime ?? '09:00'}
                                     onChange={e => setNewTemplate({...newTemplate, uiTime: e.target.value})}
                                     className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-green-500"
                                     required
                                   />
                               </div>
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
                        <button onClick={fetchTemplates} className="p-2 hover:bg-gray-100 rounded-full" title={t.refresh}>
                            <RefreshCw className="w-5 h-5 text-gray-600" />
                        </button>
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
                                <div className="flex items-center gap-2 text-xs text-gray-500">
                                    <span className="bg-gray-100 px-2 py-1 rounded">{tpl.type}</span>
                                    <span className="bg-blue-50 px-2 py-1 rounded text-blue-600">
                                        {tpl.recurrence === 'interval' 
                                            ? `${t.interval}: ${tpl.intervalValue}${getIntervalUnitLabel(tpl.intervalUnit)}`
                                            : getRecurrenceLabel(tpl.recurrence)}
                                    </span>
                                </div>
                            </div>
                        ))}
                        {templates.length === 0 && <div className="col-span-2 text-center text-gray-500 py-8">{t.noTemplates}</div>}
                    </div>
                </div>
            </div>
    );
};
