import React from 'react';
import { createPortal } from 'react-dom';
import { Terminal } from 'lucide-react';
import clsx from 'clsx';
import { DebugLog } from '../types';

interface DebugConsoleProps {
    isOpen: boolean;
    logs: DebugLog[];
    onClose: () => void;
    onClear: () => void;
}

export const DebugConsole: React.FC<DebugConsoleProps> = ({ isOpen, logs, onClose, onClear }) => {
    if (!isOpen) return null;

    return createPortal(
        <div className="fixed bottom-0 left-0 right-0 h-64 bg-black/90 text-green-400 font-mono text-xs z-[9999] overflow-hidden flex flex-col border-t border-gray-700">
            <div className="flex justify-between items-center px-4 py-2 bg-gray-800 border-b border-gray-700">
                <div className="flex items-center gap-2">
                    <Terminal className="w-4 h-4" />
                    <span className="font-bold">Debug Console</span>
                </div>
                <div className="flex gap-2">
                    <button onClick={onClear} className="text-gray-400 hover:text-white">Clear</button>
                    <button onClick={onClose} className="text-gray-400 hover:text-white">Close</button>
                </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-1">
                {logs.length === 0 && <div className="text-gray-600 italic">No logs yet...</div>}
                {logs.map(log => (
                    <div key={log.id} className="break-all border-b border-gray-800/50 pb-0.5">
                        <span className="text-gray-500">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                        <span className={clsx(
                            "mx-2 font-bold uppercase w-12 inline-block",
                            log.type === 'error' ? "text-red-500" : log.type === 'warn' ? "text-yellow-500" : "text-blue-500"
                        )}>{log.type}</span>
                        <span className="text-gray-300 whitespace-pre-wrap">{log.message}</span>
                    </div>
                ))}
            </div>
        </div>,
        document.body
    );
};
