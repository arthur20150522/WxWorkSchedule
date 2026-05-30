import React from 'react';
import { QrCode, BookUser, MessageSquare, List, FileText, Layout, Send } from 'lucide-react';
import clsx from 'clsx';
import { t } from '../utils/i18n';

type TabId = 'dashboard' | 'contacts' | 'liveSend' | 'templates' | 'tasks' | 'logs';

interface SidebarProps {
    activeTab: TabId;
    setActiveTab: (tab: TabId) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab }) => {
    const menuItems = [
        { id: 'dashboard', label: t.dashboard, icon: QrCode },
        { id: 'contacts', label: t.contacts, icon: BookUser },
        { id: 'liveSend', label: t.liveSend, icon: Send },
        { id: 'templates', label: t.templates, icon: Layout },
        { id: 'tasks', label: t.tasks, icon: List },
        { id: 'logs', label: t.logs, icon: FileText },
    ];

    return (
      <div className="bg-[#0f172a] text-slate-300 w-full md:w-72 flex-shrink-0 flex flex-col shadow-2xl z-20">
        <div className="p-8 border-b border-slate-800 font-bold text-2xl text-white flex items-center gap-4">
          <div className="p-2.5 bg-gradient-to-br from-green-500 to-emerald-600 rounded-xl shadow-lg shadow-green-900/30">
            <MessageSquare className="w-6 h-6 text-white" />
          </div>
          <span className="tracking-tight">WxBot</span>
        </div>

        <nav className="flex md:flex-col overflow-x-auto md:overflow-visible flex-1 p-6 gap-3">
          {menuItems.map(item => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id as TabId)}
              className={clsx(
                "flex items-center gap-4 px-5 py-3.5 text-sm font-semibold transition-all rounded-xl min-w-[140px] md:min-w-0 group",
                activeTab === item.id
                  ? "bg-gradient-to-r from-green-600 to-emerald-600 text-white shadow-lg shadow-green-900/20 translate-x-1"
                  : "hover:bg-slate-800 hover:text-white hover:translate-x-1"
              )}
            >
              <item.icon className={clsx("w-5 h-5 transition-colors", activeTab === item.id ? "text-white" : "text-slate-500 group-hover:text-white")} />
              {item.label}
            </button>
          ))}
        </nav>
      </div>
    );
};
