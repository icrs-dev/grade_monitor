import { useEffect } from 'react';
import { CheckCircle2, AlertCircle, Info } from 'lucide-react';

interface ToastProps {
  message: string | null;
  type: 'info' | 'ok' | 'err';
  onClose: () => void;
  duration?: number;
}

export default function Toast({ message, type, onClose, duration = 3000 }: ToastProps) {
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => {
      onClose();
    }, duration);
    return () => clearTimeout(timer);
  }, [message, duration, onClose]);

  if (!message) return null;

  const icons = {
    info: <Info size={14} className="text-apple-blue-light dark:text-apple-blue-dark" />,
    ok: <CheckCircle2 size={14} className="text-emerald-500" />,
    err: <AlertCircle size={14} className="text-red-500" />,
  };

  return (
    <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 animate-bounce-short">
      <div className="flex items-center gap-2 px-4 py-2 rounded-full border border-neutral-100 dark:border-neutral-800 bg-white/90 dark:bg-apple-bg-darkSec/90 backdrop-blur-md shadow-[0_8px_32px_rgba(0,0,0,0.06)] text-xs font-medium text-apple-text-lightPrimary dark:text-apple-text-darkPrimary">
        {icons[type]}
        <span>{message}</span>
      </div>
    </div>
  );
}
