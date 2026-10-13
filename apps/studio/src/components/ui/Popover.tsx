/**
 * Popover: a trigger button and a small panel of controls rendered in a
 * portal at a fixed position next to the trigger (flipped to stay inside
 * the viewport). Esc closes and returns focus; an outside pointer press or a
 * resize closes it.
 */
import { memo, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Props passed to the trigger renderer. */
export interface PopoverTriggerProps {
  ref: (el: HTMLButtonElement | null) => void;
  onClick: () => void;
  'aria-haspopup': 'dialog';
  'aria-expanded': boolean;
  'aria-controls': string;
}

const GAP = 6;
const EDGE = 8;

/** Popover. See module docs. */
export const Popover = memo(function Popover({
  trigger,
  children,
  label,
  side = 'top',
  width = 260,
}: {
  trigger: (props: PopoverTriggerProps) => ReactNode;
  children: ReactNode;
  label: string;
  side?: 'top' | 'bottom';
  width?: number;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const id = useId();
  const close = useCallback((focus: boolean) => {
    setOpen(false);
    if (focus) triggerRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    const t = triggerRef.current;
    const p = panelRef.current;
    if (!t || !p) return;
    const r = t.getBoundingClientRect();
    const h = p.offsetHeight;
    const w = p.offsetWidth;
    let top = side === 'top' ? r.top - GAP - h : r.bottom + GAP;
    if (top < EDGE) top = r.bottom + GAP;
    if (top + h > window.innerHeight - EDGE) top = Math.max(EDGE, r.top - GAP - h);
    const left = Math.min(Math.max(EDGE, r.left + r.width / 2 - w / 2), window.innerWidth - w - EDGE);
    p.style.top = `${Math.round(top)}px`;
    p.style.left = `${Math.round(left)}px`;
  }, [open, side]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent): void => {
      const t = e.target as Node | null;
      if (t && (panelRef.current?.contains(t) || triggerRef.current?.contains(t))) return;
      close(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(true);
      }
    };
    const onResize = (): void => close(false);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open, close]);

  return (
    <>
      {trigger({
        ref: (el) => {
          triggerRef.current = el;
        },
        onClick: () => setOpen((o) => !o),
        'aria-haspopup': 'dialog',
        'aria-expanded': open,
        'aria-controls': id,
      })}
      {open &&
        createPortal(
          <div ref={panelRef} id={id} className="popover" role="dialog" aria-label={label} style={{ width }}>
            {children}
          </div>,
          document.body,
        )}
    </>
  );
});
