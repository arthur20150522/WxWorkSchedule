import React, { useState, useEffect } from 'react';
import { Plus, Search, Pencil, Trash2, X, Users, User, BookUser, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import { t } from '../utils/i18n';
import { Contact } from '../types';
import axios from 'axios';

interface ContactsViewProps {
    contacts: Contact[];
    fetchContacts: () => void;
    showToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

interface ScanResult {
    id: string;
    name: string;
    type: 'group' | 'contact';
    category: string;
}

export const ContactsView: React.FC<ContactsViewProps> = ({ contacts, fetchContacts, showToast }) => {
    const [showForm, setShowForm] = useState(false);
    const [editingContact, setEditingContact] = useState<Contact | null>(null);
    const [formData, setFormData] = useState({ name: '', type: 'contact' as 'group' | 'contact', note: '' });

    // Scan modal state
    const [showScan, setShowScan] = useState(false);
    const [scanKeyword, setScanKeyword] = useState('');
    const [scanResults, setScanResults] = useState<ScanResult[]>([]);
    const [selectedScanIds, setSelectedScanIds] = useState<Set<string>>(new Set());
    const [isScanning, setIsScanning] = useState(false);

    const openAdd = () => {
        setEditingContact(null);
        setFormData({ name: '', type: 'contact', note: '' });
        setShowForm(true);
    };

    const openEdit = (c: Contact) => {
        setEditingContact(c);
        setFormData({ name: c.name, type: c.type, note: c.note });
        setShowForm(true);
    };

    const handleSave = async () => {
        if (!formData.name.trim()) {
            showToast('名称不能为空', 'error');
            return;
        }
        try {
            if (editingContact) {
                await axios.put(`/api/contacts/${editingContact.id}`, formData);
                showToast('联系人已更新', 'success');
            } else {
                await axios.post('/api/contacts', formData);
                showToast('联系人已添加', 'success');
            }
            setShowForm(false);
            fetchContacts();
        } catch (e: any) {
            showToast('操作失败: ' + (e.response?.data?.error || e.message), 'error');
        }
    };

    const handleDelete = async (id: string) => {
        if (!window.confirm(t.deleteConfirm)) return;
        try {
            await axios.delete(`/api/contacts/${id}`);
            showToast('已删除', 'success');
            fetchContacts();
        } catch (e: any) {
            showToast('删除失败', 'error');
        }
    };

    const handleScan = async () => {
        if (!scanKeyword.trim()) return;
        setIsScanning(true);
        try {
            const res = await axios.get('/api/contacts/scan', { params: { q: scanKeyword } });
            setScanResults(res.data.results || []);
            setSelectedScanIds(new Set());
        } catch (e: any) {
            showToast('扫描失败: ' + (e.response?.data?.error || e.message), 'error');
        } finally {
            setIsScanning(false);
        }
    };

    const handleAddScanned = async () => {
        const selected = scanResults.filter(r => selectedScanIds.has(r.id));
        if (selected.length === 0) return;

        try {
            for (const r of selected) {
                await axios.post('/api/contacts', {
                    name: r.name,
                    type: r.type,
                    note: '',
                });
            }
            showToast(`已添加 ${selected.length} 个联系人`, 'success');
            setShowScan(false);
            setScanKeyword('');
            setScanResults([]);
            setSelectedScanIds(new Set());
            fetchContacts();
        } catch (e: any) {
            showToast('添加失败', 'error');
        }
    };

    const toggleScanResult = (id: string) => {
        setSelectedScanIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    return (
        <div className="space-y-4">
            <div className="flex justify-between items-center flex-wrap gap-4">
                <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                    <BookUser className="w-7 h-7" />
                    {t.managedContacts}
                </h1>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setShowScan(true)}
                        className="px-4 py-2 bg-blue-50 text-blue-600 rounded-lg text-sm font-medium hover:bg-blue-100 flex items-center gap-1"
                    >
                        <Search className="w-4 h-4" /> {t.tryScan}
                    </button>
                    <button
                        onClick={openAdd}
                        className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 flex items-center gap-1"
                    >
                        <Plus className="w-4 h-4" /> {t.addContact}
                    </button>
                </div>
            </div>

            {/* Contacts list */}
            {contacts.length === 0 ? (
                <div className="text-center py-16 text-gray-400 bg-white rounded-xl border border-gray-200">
                    <BookUser className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                    {t.noContacts}
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {contacts.map(c => (
                        <div key={c.id} className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow">
                            <div className="flex items-start justify-between">
                                <div className="flex items-center gap-3">
                                    <div className={clsx(
                                        "w-10 h-10 rounded-full flex items-center justify-center",
                                        c.type === 'group' ? "bg-blue-100 text-blue-600" : "bg-green-100 text-green-600"
                                    )}>
                                        {c.type === 'group' ? <Users className="w-5 h-5" /> : <User className="w-5 h-5" />}
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-gray-900">{c.name}</h3>
                                        <span className={clsx(
                                            "text-xs px-2 py-0.5 rounded-full",
                                            c.type === 'group' ? "bg-blue-50 text-blue-600" : "bg-green-50 text-green-600"
                                        )}>
                                            {c.type === 'group' ? t.group : t.contact}
                                        </span>
                                    </div>
                                </div>
                                <div className="flex gap-1">
                                    <button onClick={() => openEdit(c)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded">
                                        <Pencil className="w-4 h-4" />
                                    </button>
                                    <button onClick={() => handleDelete(c.id)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded">
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                            {c.note && <p className="mt-2 text-sm text-gray-500">{c.note}</p>}
                        </div>
                    ))}
                </div>
            )}

            {/* Add/Edit Modal */}
            {showForm && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-2xl">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-lg font-bold">{editingContact ? t.editContact : t.addContact}</h3>
                            <button onClick={() => setShowForm(false)} className="p-1 hover:bg-gray-100 rounded">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">{t.contactName}</label>
                                <input
                                    type="text"
                                    value={formData.name}
                                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                                    className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-green-500"
                                    placeholder="群名或联系人名"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">{t.contactType}</label>
                                <select
                                    value={formData.type}
                                    onChange={e => setFormData({ ...formData, type: e.target.value as any })}
                                    className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-green-500"
                                >
                                    <option value="contact">{t.contact}</option>
                                    <option value="group">{t.group}</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">{t.contactNote}</label>
                                <input
                                    type="text"
                                    value={formData.note}
                                    onChange={e => setFormData({ ...formData, note: e.target.value })}
                                    className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-green-500"
                                    placeholder="可选备注"
                                />
                            </div>
                            <button
                                onClick={handleSave}
                                className="w-full py-2 bg-green-600 text-white rounded font-medium hover:bg-green-700"
                            >
                                {editingContact ? '更新' : '添加'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Scan Modal */}
            {showScan && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-6 w-full max-w-lg shadow-2xl">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-lg font-bold">{t.scanContacts}</h3>
                            <button onClick={() => { setShowScan(false); setScanResults([]); setScanKeyword(''); }} className="p-1 hover:bg-gray-100 rounded">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="flex gap-2 mb-4">
                            <input
                                type="text"
                                value={scanKeyword}
                                onChange={e => setScanKeyword(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleScan()}
                                className="flex-1 p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                                placeholder={t.scanKeyword}
                            />
                            <button
                                onClick={handleScan}
                                disabled={isScanning}
                                className="px-4 py-2 bg-blue-600 text-white rounded font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1"
                            >
                                {isScanning ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                                搜索
                            </button>
                        </div>

                        {scanResults.length > 0 && (
                            <div className="max-h-64 overflow-y-auto border border-gray-200 rounded divide-y">
                                {scanResults.map(r => (
                                    <label key={r.id} className="flex items-center gap-3 p-3 hover:bg-gray-50 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={selectedScanIds.has(r.id)}
                                            onChange={() => toggleScanResult(r.id)}
                                            className="rounded text-green-600 focus:ring-green-500"
                                        />
                                        <span className={clsx(
                                            "text-xs px-2 py-0.5 rounded-full",
                                            r.type === 'group' ? "bg-blue-50 text-blue-600" : "bg-green-50 text-green-600"
                                        )}>
                                            {r.type === 'group' ? t.group : t.contact}
                                        </span>
                                        <span className="text-sm font-medium">{r.name}</span>
                                    </label>
                                ))}
                            </div>
                        )}

                        {selectedScanIds.size > 0 && (
                            <button
                                onClick={handleAddScanned}
                                className="w-full mt-4 py-2 bg-green-600 text-white rounded font-medium hover:bg-green-700"
                            >
                                {t.addToContacts} ({selectedScanIds.size})
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

