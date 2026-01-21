import React from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle, XCircle, FileText } from 'lucide-react';
import clsx from 'clsx';
import { ToastMsg } from '../types';

interface ToastContainerProps {
    toasts: ToastMsg[];
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts }) => {
    return createPortal(
        <div className="fixed top-4 right-4 z-[10000] flex flex-col gap-2 pointer-events-none">
          {toasts.map(t => (
            <div key={t.id} className={clsx(
              "px-4 py-3 rounded-lg shadow-lg text-white font-medium min-w-[200px] animate-in slide-in-from-right pointer-events-auto flex items-center gap-2",
              t.type === 'success' ? "bg-green-600" : t.type === 'error' ? "bg-red-600" : "bg-blue-600"
            )}>
               {t.type === 'success' && <CheckCircle className="w-5 h-5" />}
               {t.type === 'error' && <XCircle className="w-5 h-5" />}
               {t.type === 'info' && <FileText className="w-5 h-5" />}
               {t.message}
            </div>
          ))}
        </div>,
        document.body
    );
};
