import React from 'react';
import { createPortal } from 'react-dom';

interface ConfirmDialogProps {
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void | Promise<void>;
    onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({ isOpen, title, message, onConfirm, onCancel }) => {
    if (!isOpen) return null;

    return createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden transform transition-all scale-100 opacity-100">
            <div className="p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-2">{title}</h3>
              <p className="text-gray-500 mb-6">{message}</p>
              <div className="flex gap-3 justify-end">
                <button 
                  onClick={onCancel}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium transition-colors"
                >
                  取消
                </button>
                <button 
                  onClick={onConfirm}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium shadow-lg shadow-red-900/20 transition-all active:scale-95"
                >
                  确定
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
    );
};
