import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { memo, useEffect, useMemo } from 'react';
import { useStudio, useUI } from '../app/context';
import { Icon } from './Icon';
const ICON = { error: 'alert', success: 'check', game: 'sparkles', info: 'info' };
const ToastItem = memo(function ToastItem({ toast, onDone }) {
    useEffect(() => {
        const t = setTimeout(() => onDone(toast.id), toast.duration * 1000);
        return () => clearTimeout(t);
    }, [toast.id, toast.duration, onDone]);
    return (_jsxs("div", { className: `toast toast--${toast.kind}`, role: toast.kind === 'error' ? 'alert' : 'status', children: [_jsx(Icon, { name: ICON[toast.kind], className: "toast__icon" }), _jsx("span", { className: "toast__text", children: toast.text }), toast.action && (_jsx("button", { type: "button", className: "btn btn--sm btn--ghost toast__action", onClick: () => {
                    toast.action?.run();
                    onDone(toast.id);
                }, children: toast.action.label })), _jsx("button", { type: "button", className: "icon-btn icon-btn--sm", onClick: () => onDone(toast.id), "aria-label": "Dismiss", children: _jsx(Icon, { name: "x" }) })] }));
});
/** Toast stack (bottom-right; game messages centered over the viewport). */
export const ToastStack = memo(function ToastStack({ toasts, onDismiss }) {
    const game = useMemo(() => toasts.filter((t) => t.kind === 'game'), [toasts]);
    const app = useMemo(() => toasts.filter((t) => t.kind !== 'game'), [toasts]);
    return (_jsxs(_Fragment, { children: [_jsx("div", { className: "toasts toasts--game", "aria-live": "polite", children: game.map((t) => (_jsx(ToastItem, { toast: t, onDone: onDismiss }, t.id))) }), _jsx("div", { className: "toasts", "aria-live": "polite", children: app.map((t) => (_jsx(ToastItem, { toast: t, onDone: onDismiss }, t.id))) })] }));
});
/** The editor's toasts. */
export const Toasts = memo(function Toasts() {
    const studio = useStudio();
    const toasts = useUI((s) => s.toasts);
    return _jsx(ToastStack, { toasts: toasts, onDismiss: studio.store.getState().dismissToast });
});
