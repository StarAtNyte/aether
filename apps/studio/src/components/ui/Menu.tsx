/**
 * Dropdown menu: a trigger button and a popover list rendered in a portal
 * (so scroll containers never clip it) at a fixed position computed from
 * the trigger, flipped above / aligned to stay inside the viewport.
 * Keyboard: arrows / Home / End move, Enter / Space select, Esc / Tab close
 * and return focus to the trigger. Closes on outside pointer, scroll and resize.
 */
import { memo, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from '../Icon';

/** One menu entry. */
export type MenuEntry =
  | { kind?: 'item'; id: string; label: string; icon?: IconName; shortcut?: string; danger?: boolean; disabled?: boolean; checked?: boolean; onSelect: () => void }
  | { kind: 'separator'; id: string }
  | { kind: 'heading'; id: string; label: string };

/** Props passed to the trigger renderer. */
export interface MenuTriggerProps {
  ref: (el: HTMLButtonElement | null) => void;
  onClick: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
  'aria-haspopup': 'menu';
  'aria-expanded': boolean;
  'aria-controls': string;
}

const GAP = 4;
const EDGE = 8;

/** Dropdown menu. See module docs. */
export const Menu = memo(function Menu({
  trigger,
  items,
  align = 'start',
  label,
  width,
}: {
  trigger: (props: MenuTriggerProps) => ReactNode;
  items: readonly MenuEntry[];
  align?: 'start' | 'end';
  label: string;
  width?: number;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' });
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const id = useId();
  const close = useCallback((focusTrigger: boolean) => {
    setOpen(false);
    if (focusTrigger) triggerRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    const t = triggerRef.current;
    const list = listRef.current;
    if (!t || !list) return;
    const r = t.getBoundingClientRect();
    const w = list.offsetWidth;
    const h = list.offsetHeight;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    let left = align === 'end' ? r.right - w : r.left;
    left = Math.max(EDGE, Math.min(left, vw - w - EDGE));
    let top = r.bottom + GAP;
    if (top + h > vh - EDGE && r.top - GAP - h >= EDGE) top = r.top - GAP - h;
    top = Math.max(EDGE, Math.min(top, vh - h - EDGE));
    setStyle({ left: Math.round(left), top: Math.round(top), maxHeight: vh - 2 * EDGE });
    const first = list.querySelector<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)');
    first?.focus();
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent): void => {
      const target = e.target as Node | null;
      if (listRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    };
    const onScroll = (e: Event): void => {
      if (listRef.current?.contains(e.target as Node | null)) return;
      close(false);
    };
    const onResize = (): void => close(false);
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open, close]);

  const onListKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    const list = listRef.current;
    if (!list) return;
    const buttons = [...list.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)')];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = buttons.length;
      if (n === 0) return;
      const next = e.key === 'ArrowDown' ? (i + 1) % n : (i - 1 + n) % n;
      buttons[next]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      (e.key === 'Home' ? buttons[0] : buttons[buttons.length - 1])?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === 'Tab') {
      close(false);
    }
  };

  const props: MenuTriggerProps = {
    ref: (el) => {
      triggerRef.current = el;
    },
    onClick: () => setOpen((o) => !o),
    onKeyDown: (e) => {
      if (e.key === 'ArrowDown' && !open) {
        e.preventDefault();
        setOpen(true);
      }
    },
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    'aria-controls': id,
  };

  return (
    <>
      {trigger(props)}
      {open &&
        createPortal(
          <div ref={listRef} id={id} className="menu" role="menu" aria-label={label} style={{ ...style, ...(width ? { width } : {}) }} onKeyDown={onListKey}>
            {items.map((it) => {
              if (it.kind === 'separator') return <div key={it.id} className="menu__sep" role="separator" />;
              if (it.kind === 'heading') return <div key={it.id} className="menu__heading">{it.label}</div>;
              const checkable = it.checked !== undefined;
              return (
                <button
                  key={it.id}
                  type="button"
                  role={checkable ? 'menuitemcheckbox' : 'menuitem'}
                  aria-checked={checkable ? it.checked : undefined}
                  className={`menu__item${it.danger ? ' is-danger' : ''}`}
                  disabled={it.disabled}
                  onClick={() => {
                    close(true);
                    it.onSelect();
                  }}
                >
                  <span className="menu__icon">{checkable ? it.checked ? <Icon name="check" /> : null : it.icon ? <Icon name={it.icon} /> : null}</span>
                  <span className="menu__label">{it.label}</span>
                  {it.shortcut && <kbd className="menu__kbd">{it.shortcut}</kbd>}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
});
