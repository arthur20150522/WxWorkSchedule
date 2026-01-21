import { useState, useCallback } from 'react';
import { ToastMsg } from '../types';

export const useToast = () => {
    const [toasts, setToasts] = useState<ToastMsg[]>([]);

    const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
        const id = Date.now().toString() + Math.random();
        setToasts(prev => [...prev, { id, type, message }]);
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, 5000);
    }, []);

    return { toasts, showToast };
};
