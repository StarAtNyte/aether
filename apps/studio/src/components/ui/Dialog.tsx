/**
 * Modal dialog on the native `<dialog>` element (focus trap, Esc and the
 * top layer come from the browser in Chromium, Firefox and Safari).
 * Clicking the backdrop closes it.
 */
import { memo, useEffect, useId, useRef, type ReactElement, type ReactNode } from 'react';
import { Icon } from '../Icon';

/** Modal dialog. */
export const Dialog = memo(function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}): ReactElement {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      try {
        d.showModal();
      } catch {
        d.setAttribute('open', '');
      }
    } else if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`dialog dialog--${size}${className ? ` ${className}` : ''}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onMouseDown={(e) => {
        // A press on the backdrop (the dialog box itself, outside its content) closes.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {open && (
        <div className="dialog__frame">
          <header className="dialog__header">
            <div className="dialog__titles">
              <h2 id={titleId} className="dialog__title">
                {title}
              </h2>
              {description && (
                <p id={descId} className="dialog__desc">
                  {description}
                </p>
              )}
            </div>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close" data-tip="Close" data-kbd="Esc">
              <Icon name="x" />
            </button>
          </header>
          <div className="dialog__body">{children}</div>
          {footer && <footer className="dialog__footer">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
});

/** Yes/no confirmation dialog. */
export const ConfirmDialog = memo(function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}): ReactElement {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={`btn ${danger ? 'btn--danger' : 'btn--primary'}`}
            autoFocus
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </button>
        </>
      }
    />
  );
});
