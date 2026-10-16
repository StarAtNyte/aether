import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Modal dialog on the native `<dialog>` element (focus trap, Esc and the
 * top layer come from the browser in Chromium, Firefox and Safari).
 * Clicking the backdrop closes it.
 */
import { memo, useEffect, useId, useRef } from 'react';
import { Icon } from '../Icon';
/** Modal dialog. */
export const Dialog = memo(function Dialog({ open, onClose, title, description, children, footer, size = 'md', className, }) {
    const ref = useRef(null);
    const titleId = useId();
    const descId = useId();
    useEffect(() => {
        const d = ref.current;
        if (!d)
            return;
        if (open && !d.open) {
            try {
                d.showModal();
            }
            catch {
                d.setAttribute('open', '');
            }
        }
        else if (!open && d.open)
            d.close();
    }, [open]);
    return (_jsx("dialog", { ref: ref, className: `dialog dialog--${size}${className ? ` ${className}` : ''}`, role: "dialog", "aria-modal": "true", "aria-labelledby": titleId, "aria-describedby": description ? descId : undefined, onClose: onClose, onCancel: (e) => {
            e.preventDefault();
            onClose();
        }, onMouseDown: (e) => {
            // A press on the backdrop (the dialog box itself, outside its content) closes.
            if (e.target === e.currentTarget)
                onClose();
        }, children: open && (_jsxs("div", { className: "dialog__frame", children: [_jsxs("header", { className: "dialog__header", children: [_jsxs("div", { className: "dialog__titles", children: [_jsx("h2", { id: titleId, className: "dialog__title", children: title }), description && (_jsx("p", { id: descId, className: "dialog__desc", children: description }))] }), _jsx("button", { type: "button", className: "icon-btn", onClick: onClose, "aria-label": "Close", "data-tip": "Close", "data-kbd": "Esc", children: _jsx(Icon, { name: "x" }) })] }), _jsx("div", { className: "dialog__body", children: children }), footer && _jsx("footer", { className: "dialog__footer", children: footer })] })) }));
});
/** Yes/no confirmation dialog. */
export const ConfirmDialog = memo(function ConfirmDialog({ open, title, description, confirmLabel, danger, onConfirm, onClose, }) {
    return (_jsx(Dialog, { open: open, onClose: onClose, title: title, description: description, size: "sm", footer: _jsxs(_Fragment, { children: [_jsx("button", { type: "button", className: "btn", onClick: onClose, children: "Cancel" }), _jsx("button", { type: "button", className: `btn ${danger ? 'btn--danger' : 'btn--primary'}`, autoFocus: true, onClick: () => {
                        onConfirm();
                        onClose();
                    }, children: confirmLabel })] }) }));
});
