import { useState, useCallback } from 'react';

interface ConfirmOptions {
    title: string;
    message: string;
    onConfirm: () => void | Promise<void>;
}

export const useConfirmDialog = () => {
    const [confirmDialog, setConfirmDialog] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        onConfirm: () => void | Promise<void>;
    }>({ isOpen: false, title: '', message: '', onConfirm: async () => {} });

    const openConfirm = useCallback((options: ConfirmOptions) => {
        setConfirmDialog({ ...options, isOpen: true });
    }, []);

    const closeConfirm = useCallback(() => {
        setConfirmDialog(prev => ({ ...prev, isOpen: false }));
    }, []);

    return { confirmDialog, openConfirm, closeConfirm };
};
