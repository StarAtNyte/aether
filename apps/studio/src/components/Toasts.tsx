import { memo, useEffect, useMemo, type ReactElement } from 'react';
import { useStudio, useUI } from '../app/context';
import { Icon, type IconName } from './Icon';

/** Minimal toast shape shared by the editor and app stores. */
export interface ToastView {
  id: number;
  kind: 'info' | 'success' | 'error' | 'game';
  text: string;
  duration: number;
  action?: { label: string; run: () => void };
}

const ICON: Record<ToastView['kind'], IconName> = { error: 'alert', success: 'check', game: 'sparkles', info: 'info' };

const ToastItem = memo(function ToastItem({ toast, onDone }: { toast: ToastView; onDone: (id: number) => void }): ReactElement {
  useEffect(() => {
    const t = setTimeout(() => onDone(toast.id), toast.duration * 1000);
    return () => clearTimeout(t);
  }, [toast.id, toast.duration, onDone]);
  return (
    <div className={`toast toast--${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'}>
      <Icon name={ICON[toast.kind]} className="toast__icon" />
      <span className="toast__text">{toast.text}</span>
      {toast.action && (
        <button
          type="button"
          className="btn btn--sm btn--ghost toast__action"
          onClick={() => {
            toast.action?.run();
            onDone(toast.id);
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button type="button" className="icon-btn icon-btn--sm" onClick={() => onDone(toast.id)} aria-label="Dismiss">
        <Icon name="x" />
      </button>
    </div>
  );
});

/** Toast stack (bottom-right; game messages centered over the viewport). */
export const ToastStack = memo(function ToastStack({ toasts, onDismiss }: { toasts: readonly ToastView[]; onDismiss: (id: number) => void }): ReactElement {
  const game = useMemo(() => toasts.filter((t) => t.kind === 'game'), [toasts]);
  const app = useMemo(() => toasts.filter((t) => t.kind !== 'game'), [toasts]);
  return (
    <>
      <div className="toasts toasts--game" aria-live="polite">
        {game.map((t) => (
          <ToastItem key={t.id} toast={t} onDone={onDismiss} />
        ))}
      </div>
      <div className="toasts" aria-live="polite">
        {app.map((t) => (
          <ToastItem key={t.id} toast={t} onDone={onDismiss} />
        ))}
      </div>
    </>
  );
});

/** The editor's toasts. */
export const Toasts = memo(function Toasts(): ReactElement {
  const studio = useStudio();
  const toasts = useUI((s) => s.toasts);
  return <ToastStack toasts={toasts} onDismiss={studio.store.getState().dismissToast} />;
});
