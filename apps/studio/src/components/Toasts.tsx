import { memo, useEffect, type ReactElement } from 'react';
import { useStudio, useUI } from '../app/context';
import type { Toast } from '../state/store';
import { Icon } from './Icon';

const ToastItem = memo(function ToastItem({ toast, onDone }: { toast: Toast; onDone: (id: number) => void }): ReactElement {
  useEffect(() => {
    const t = setTimeout(() => onDone(toast.id), toast.duration * 1000);
    return () => clearTimeout(t);
  }, [toast.id, toast.duration, onDone]);
  const icon = toast.kind === 'error' ? 'alert' : toast.kind === 'success' ? 'check' : toast.kind === 'game' ? 'sparkles' : 'info';
  return (
    <div className={`toast toast--${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'}>
      <Icon name={icon} size={14} />
      <span className="toast__text">{toast.text}</span>
      <button type="button" className="icon-btn icon-btn--xs" onClick={() => onDone(toast.id)} aria-label="Dismiss">
        <Icon name="x" size={12} />
      </button>
    </div>
  );
});

/** Toast stack (game messages appear centered over the viewport). */
export const Toasts = memo(function Toasts(): ReactElement {
  const studio = useStudio();
  const toasts = useUI((s) => s.toasts);
  const dismiss = studio.store.getState().dismissToast;
  const game = toasts.filter((t) => t.kind === 'game');
  const app = toasts.filter((t) => t.kind !== 'game');
  return (
    <>
      <div className="toasts toasts--game" aria-live="polite">
        {game.map((t) => (
          <ToastItem key={t.id} toast={t} onDone={dismiss} />
        ))}
      </div>
      <div className="toasts" aria-live="polite">
        {app.map((t) => (
          <ToastItem key={t.id} toast={t} onDone={dismiss} />
        ))}
      </div>
    </>
  );
});
