import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, AlertTriangle, Info, XCircle, X } from 'lucide-react';

export interface ToastMessage {
  id: string;
  title: string;
  description?: string;
  type?: 'success' | 'warning' | 'error' | 'info';
}

export interface ToastState {
  show: boolean;
  title: string;
  desc?: string;
  type?: 'success' | 'warning' | 'error' | 'info';
}

interface SingleToastProps {
  toast: ToastState;
  onClose: () => void;
}

export const Toast: React.FC<SingleToastProps> = ({ toast, onClose }) => {
  const { show, title, desc, type = 'info' } = toast;

  return (
    <div className="fixed bottom-5 right-5 z-50 pointer-events-none max-w-sm w-full px-4">
      <AnimatePresence>
        {show && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            className={`pointer-events-auto rounded-2xl p-4 shadow-2xl border backdrop-blur-md flex items-start gap-3 text-sm ${
              type === 'success'
                ? 'bg-[#141416]/95 border-emerald-500/40 text-emerald-100 shadow-black/60'
                : type === 'warning'
                ? 'bg-[#141416]/95 border-amber-500/40 text-amber-100 shadow-black/60'
                : type === 'error'
                ? 'bg-[#141416]/95 border-rose-500/40 text-rose-100 shadow-black/60'
                : 'bg-[#141416]/95 border-[#C084FC]/40 text-[#F3F4F6] shadow-black/60'
            }`}
          >
            <div className="mt-0.5 shrink-0">
              {type === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-400" />}
              {type === 'warning' && <AlertTriangle className="w-5 h-5 text-amber-400" />}
              {type === 'error' && <XCircle className="w-5 h-5 text-rose-400" />}
              {type === 'info' && <Info className="w-5 h-5 text-[#C084FC]" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-serif font-semibold text-white text-xs sm:text-sm">{title}</div>
              {desc && (
                <div className="mt-0.5 text-xs text-[#9CA3AF] leading-relaxed">
                  {desc}
                </div>
              )}
            </div>
            <button
              onClick={onClose}
              className="text-[#6B7280] hover:text-white transition-colors p-1 -mr-1 -mt-1 rounded-md"
              aria-label="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export const ToastContainer: React.FC<{ toasts: ToastMessage[]; onDismiss: (id: string) => void }> = ({
  toasts,
  onDismiss
}) => {
  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 pointer-events-none max-w-sm w-full px-4">
      <AnimatePresence>
        {toasts.map((toast) => {
          const type = toast.type || 'info';
          return (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              className={`pointer-events-auto rounded-xl p-4 shadow-xl border backdrop-blur-md flex items-start gap-3 text-sm ${
                type === 'success'
                  ? 'bg-emerald-950/90 border-emerald-600/40 text-emerald-100'
                  : type === 'warning'
                  ? 'bg-amber-950/90 border-amber-600/40 text-amber-100'
                  : type === 'error'
                  ? 'bg-rose-950/90 border-rose-600/40 text-rose-100'
                  : 'bg-slate-900/90 border-slate-700/60 text-slate-100'
              }`}
            >
              <div className="mt-0.5 shrink-0">
                {type === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-400" />}
                {type === 'warning' && <AlertTriangle className="w-5 h-5 text-amber-400" />}
                {type === 'error' && <XCircle className="w-5 h-5 text-rose-400" />}
                {type === 'info' && <Info className="w-5 h-5 text-sky-400" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-slate-100">{toast.title}</div>
                {toast.description && (
                  <div className="mt-0.5 text-xs text-slate-300 leading-relaxed">
                    {toast.description}
                  </div>
                )}
              </div>
              <button
                onClick={() => onDismiss(toast.id)}
                className="text-slate-400 hover:text-slate-200 transition-colors p-1 -mr-1 -mt-1 rounded-md"
                aria-label="Dismiss"
              >
                <X className="w-4 h-4" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
};
