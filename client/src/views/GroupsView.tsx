import React, { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { t } from '../utils/i18n';
import { Group, BotStatus } from '../types';

interface GroupsViewProps {
    groups: Group[];
    fetchGroups: () => void;
    botStatus: BotStatus;
    onSendMessage: (group: Group) => void;
}

export const GroupsView: React.FC<GroupsViewProps> = ({ groups, fetchGroups, botStatus, onSendMessage }) => {
    const [searchQuery, setSearchQuery] = useState('');
    const filteredGroups = groups.filter(g => g.topic.toLowerCase().includes(searchQuery.toLowerCase()));

    return (
          <div className="space-y-4">
             <div className="flex justify-between items-center flex-wrap gap-4">
                <h1 className="text-2xl font-bold text-gray-800">{t.managedGroups}</h1>
                <div className="flex items-center gap-2">
                    <input 
                        type="text" 
                        placeholder={t.searchGroups}
                        className="p-2 border border-gray-300 rounded"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                    />
                    <button onClick={fetchGroups} className="p-2 hover:bg-gray-100 rounded-full">
                        <RefreshCw className="w-5 h-5 text-gray-600" />
                    </button>
                </div>
             </div>
             
             {botStatus.status !== 'logged_in' ? (
                 <div className="text-center py-12 text-gray-500">{t.pleaseLogin}</div>
             ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredGroups.map(group => (
                    <div key={group.id} className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow">
                      <h3 className="font-bold text-gray-900 truncate" title={group.topic}>{group.topic}</h3>
                      <p className="text-sm text-gray-500 mt-1">{group.memberCount} {t.members}</p>
                      <button 
                        onClick={() => onSendMessage(group)}
                        className="mt-4 w-full py-2 bg-green-50 text-green-600 rounded text-sm hover:bg-green-100"
                      >
                        {t.sendMessage}
                      </button>
                    </div>
                  ))}
                </div>
             )}
          </div>
    );
};
