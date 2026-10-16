import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Dropdown menu: a trigger button and a popover list rendered in a portal
 * (so scroll containers never clip it) at a fixed position computed from
 * the trigger, flipped above / aligned to stay inside the viewport.
 * Keyboard: arrows / Home / End move, Enter / Space select, Esc / Tab close
 * and return focus to the trigger. Closes on outside pointer, scroll and resize.
 */
import { memo, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../Icon';
const GAP = 4;
const EDGE = 8;
/** Dropdown menu. See module docs. */
export const Menu = memo(function Menu({ trigger, items, align = 'start', label, width, }) {
    const [open, setOpen] = useState(false);
    const triggerRef = useRef(null);
    const listRef = useRef(null);
    const id = useId();
    const close = useCallback((focusTrigger) => {
        setOpen(false);
        if (focusTrigger)
            triggerRef.current?.focus();
    }, []);
    useLayoutEffect(() => {
        if (!open)
            return;
        const t = triggerRef.current;
        const list = listRef.current;
        if (!t || !list)
            return;
        const r = t.getBoundingClientRect();
        const w = list.offsetWidth;
        const h = list.offsetHeight;
        const vw = document.documentElement.clientWidth;
        const vh = document.documentElement.clientHeight;
        let left = align === 'end' ? r.right - w : r.left;
        left = Math.max(EDGE, Math.min(left, vw - w - EDGE));
        let top = r.bottom + GAP;
        if (top + h > vh - EDGE && r.top - GAP - h >= EDGE)
            top = r.top - GAP - h;
        top = Math.max(EDGE, Math.min(top, vh - h - EDGE));
        // Positioned with direct writes (no extra render) and made visible before focusing:
        // a `visibility: hidden` element cannot take focus.
        list.style.left = `${Math.round(left)}px`;
        list.style.top = `${Math.round(top)}px`;
        list.style.maxHeight = `${vh - 2 * EDGE}px`;
        list.style.visibility = 'visible';
        const first = list.querySelector('[role^="menuitem"]:not(:disabled)');
        first?.focus({ preventScroll: true });
    }, [open, align]);
    useEffect(() => {
        if (!open)
            return;
        const onDown = (e) => {
            const target = e.target;
            if (listRef.current?.contains(target) || triggerRef.current?.contains(target))
                return;
            close(false);
        };
        const onScroll = (e) => {
            if (listRef.current?.contains(e.target))
                return;
            close(false);
        };
        const onResize = () => close(false);
        const onKey = (e) => {
            if (e.key !== 'Escape')
                return;
            e.preventDefault();
            e.stopPropagation();
            close(true);
        };
        document.addEventListener('keydown', onKey, true);
        document.addEventListener('pointerdown', onDown, true);
        window.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', onResize);
        return () => {
            document.removeEventListener('keydown', onKey, true);
            document.removeEventListener('pointerdown', onDown, true);
            window.removeEventListener('scroll', onScroll, true);
            window.removeEventListener('resize', onResize);
        };
    }, [open, close]);
    const onListKey = (e) => {
        const list = listRef.current;
        if (!list)
            return;
        const buttons = [...list.querySelectorAll('[role^="menuitem"]:not(:disabled)')];
        const i = buttons.indexOf(document.activeElement);
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const n = buttons.length;
            if (n === 0)
                return;
            const next = e.key === 'ArrowDown' ? (i + 1) % n : (i - 1 + n) % n;
            buttons[next]?.focus();
        }
        else if (e.key === 'Home' || e.key === 'End') {
            e.preventDefault();
            (e.key === 'Home' ? buttons[0] : buttons[buttons.length - 1])?.focus();
        }
        else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            close(true);
        }
        else if (e.key === 'Tab') {
            close(false);
        }
    };
    const props = {
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
    return (_jsxs(_Fragment, { children: [trigger(props), open &&
                createPortal(_jsx("div", { ref: listRef, id: id, className: "menu", role: "menu", "aria-label": label, style: { visibility: 'hidden', ...(width ? { width } : {}) }, onKeyDown: onListKey, children: items.map((it) => {
                        if (it.kind === 'separator')
                            return _jsx("div", { className: "menu__sep", role: "separator" }, it.id);
                        if (it.kind === 'heading')
                            return _jsx("div", { className: "menu__heading", children: it.label }, it.id);
                        const checkable = it.checked !== undefined;
                        return (_jsxs("button", { type: "button", role: checkable ? 'menuitemcheckbox' : 'menuitem', "aria-checked": checkable ? it.checked : undefined, className: `menu__item${it.danger ? ' is-danger' : ''}`, disabled: it.disabled, onClick: () => {
                                close(true);
                                it.onSelect();
                            }, children: [_jsx("span", { className: "menu__icon", children: checkable ? it.checked ? _jsx(Icon, { name: "check" }) : null : it.icon ? _jsx(Icon, { name: it.icon }) : null }), _jsx("span", { className: "menu__label", children: it.label }), it.shortcut && _jsx("kbd", { className: "menu__kbd", children: it.shortcut })] }, it.id));
                    }) }), document.body)] }));
});
