import React, { useState } from 'react';
import { RefreshCw, FileText, Trash2 } from 'lucide-react';
import { t } from '../utils/i18n';
import { Template, Group } from '../types';
import axios from 'axios';

interface TemplatesViewProps {
    templates: Template[];
    fetchTemplates: () => void;
    groups: Group[];
    contacts: {id: string, name: string}[];
    showToast: (msg: string, type: 'success' | 'error' | 'info') => void;
    onGenerateTask: (template: Template) => void;
}

export const TemplatesView: React.FC<TemplatesViewProps> = ({ 
    templates, fetchTemplates, groups, contacts, showToast, onGenerateTask 
}) => {
    const [isTemplateEditing, setIsTemplateEditing] = useState(false);
    const [newTemplate, setNewTemplate] = useState<Partial<Template>>({
        name: '',
        type: 'text',
        content: [''],
        targets: []
    });

    const createTemplate = async (e: React.FormEvent) => {
        e.preventDefault();
        const contentArray = newTemplate.content?.filter(line => line.trim() !== '') || [];

        if (!newTemplate.name || contentArray.length === 0 || (newTemplate.targets?.length === 0)) {
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
            setNewTemplate({ name: '', type: 'text', content: [''], targets: [] });
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
                                setNewTemplate({ name: '', type: 'text', content: [], contentStr: '', targets: [] });
                            }} className="text-sm text-gray-500 hover:text-gray-700">取消</button>
                        )}
                    </div>
                    <form onSubmit={createTemplate} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">{t.templateName}</label>
                            <input 
                                type="text" 
                                value={newTemplate.name}
                                onChange={e => setNewTemplate({...newTemplate, name: e.target.value})}
                                className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-green-500"
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">{t.content}</label>
                            <textarea 
                                value={newTemplate.content}
                                onChange={e => setNewTemplate({...newTemplate, content: e.target.value})}
                                className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-green-500"
                                rows={3}
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">{t.selectTargets}</label>
                            <div className="max-h-48 overflow-y-auto border border-gray-300 rounded p-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                                {groups.map(g => (
                                    <label key={g.id} className="flex items-center space-x-2 p-1 hover:bg-gray-50 rounded cursor-pointer">
                                        <input 
                                            type="checkbox"
                                            checked={newTemplate.targets?.some(t => t.id === g.id)}
                                            onChange={e => {
                                                const target = { type: 'group' as const, id: g.id, name: g.topic };
                                                setNewTemplate(prev => ({
                                                    ...prev,
                                                    targets: e.target.checked 
                                                        ? [...(prev.targets || []), target]
                                                        : (prev.targets || []).filter(t => t.id !== g.id)
                                                }));
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
                                            checked={newTemplate.targets?.some(t => t.id === c.id)}
                                            onChange={e => {
                                                const target = { type: 'contact' as const, id: c.id, name: c.name };
                                                setNewTemplate(prev => ({
                                                    ...prev,
                                                    targets: e.target.checked 
                                                        ? [...(prev.targets || []), target]
                                                        : (prev.targets || []).filter(t => t.id !== c.id)
                                                }));
                                            }}
                                            className="rounded text-green-600 focus:ring-green-500"
                                        />
                                        <span className="text-sm truncate">{c.name}</span>
                                        <span className="text-xs text-gray-400">({t.contact})</span>
                                    </label>
                                ))}
                            </div>
                            <p className="text-xs text-gray-500 mt-1">已选择 {newTemplate.targets?.length || 0} 个对象</p>
                        </div>
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
                                    <span>关联 {tpl.targets.length} 个对象</span>
                                </div>
                            </div>
                        ))}
                        {templates.length === 0 && <div className="col-span-2 text-center text-gray-500 py-8">{t.noTemplates}</div>}
                    </div>
                </div>
            </div>
    );
};
