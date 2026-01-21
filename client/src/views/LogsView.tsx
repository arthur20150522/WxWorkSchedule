import React, { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import { t } from '../utils/i18n';
import { Log } from '../types';
import axios from 'axios';

export const LogsView: React.FC = () => {
    const [logs, setLogs] = useState<Log[]>([]);

    const fetchLogs = async () => {
        try {
            const res = await axios.get('/api/logs');
            setLogs(res.data);
        } catch (e) {
            console.error(e);
        }
    }

    useEffect(() => {
        fetchLogs();
        const interval = setInterval(fetchLogs, 5000);
        return () => clearInterval(interval);
    }, []);

    return (
            <div className="space-y-4">
                 <div className="flex justify-between items-center">
                    <h1 className="text-2xl font-bold text-gray-800">{t.systemLogs}</h1>
                    <button onClick={fetchLogs} className="p-2 hover:bg-gray-100 rounded-full">
                        <RefreshCw className="w-5 h-5 text-gray-600" />
                    </button>
                 </div>
                 <div className="bg-gray-900 text-gray-300 p-4 rounded-lg font-mono text-sm h-96 overflow-y-auto">
                     {logs.map(log => (
                         <div key={log.id} className="mb-1 border-b border-gray-800 pb-1">
                             <span className="text-gray-500">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                             <span className={clsx(
                                 "ml-2 font-bold",
                                 log.level === 'error' ? "text-red-400" : "text-blue-400"
                             )}>{log.level.toUpperCase()}</span>: 
                             <span className="ml-2 text-white">{log.message}</span>
                         </div>
                     ))}
                     {logs.length === 0 && <div className="text-gray-600">{t.noLogs}</div>}
                 </div>
            </div>
    );
};
