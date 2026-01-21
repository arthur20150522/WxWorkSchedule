import { useState, useEffect } from 'react';
import { DebugLog } from '../types';

export const useDebugLogs = () => {
    const [debugLogs, setDebugLogs] = useState<DebugLog[]>([]);
    
    useEffect(() => {
        const originalLog = console.log;
        const originalError = console.error;
        const originalWarn = console.warn;

        const addLog = (type: 'log' | 'error' | 'warn', args: any[]) => {
            const message = args.map(a => {
                try {
                    return typeof a === 'object' ? JSON.stringify(a) : String(a);
                } catch (e) {
                    return '[Circular]';
                }
            }).join(' ');
            
            setDebugLogs(prev => [{
                id: Date.now().toString() + Math.random(),
                type,
                message,
                timestamp: new Date().toISOString()
            }, ...prev].slice(0, 100)); // Keep last 100 logs
        };

        console.log = (...args) => {
            originalLog(...args);
            addLog('log', args);
        };

        console.error = (...args) => {
            originalError(...args);
            addLog('error', args);
        };

        console.warn = (...args) => {
            originalWarn(...args);
            addLog('warn', args);
        };

        return () => {
            console.log = originalLog;
            console.error = originalError;
            console.warn = originalWarn;
        };
    }, []);

    return { debugLogs, setDebugLogs };
};
