import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { memo, useState } from 'react';
import { Icon } from './Icon';
const COLLAPSED_LINES = 6;
/** Monospace code block with optional collapse and copy-to-clipboard. Content is rendered as text only. */
export const CodeBlock = memo(function CodeBlock({ code, lang, title, collapsible = true }) {
    const lineCount = code.split('\n').length;
    const canCollapse = collapsible && lineCount > COLLAPSED_LINES;
    const [open, setOpen] = useState(!canCollapse);
    const [copied, setCopied] = useState(false);
    const copy = () => {
        void navigator.clipboard
            ?.writeText(code)
            .then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
        })
            .catch(() => undefined);
    };
    return (_jsxs("div", { className: `code-block${open ? ' is-open' : ''}`, children: [_jsxs("div", { className: "code-block__bar", children: [_jsx("span", { className: "code-block__lang", children: title ?? (lang || 'code') }), _jsxs("span", { className: "code-block__meta", children: [lineCount, " lines"] }), _jsx("button", { type: "button", className: "icon-btn icon-btn--xs", onClick: copy, title: "Copy code", "aria-label": "Copy code", children: _jsx(Icon, { name: copied ? 'check' : 'copy' }) }), canCollapse && (_jsx("button", { type: "button", className: "icon-btn icon-btn--xs", onClick: () => setOpen((o) => !o), "aria-expanded": open, title: open ? 'Collapse' : 'Expand', children: _jsx(Icon, { name: open ? 'chevronUp' : 'chevronDown' }) }))] }), _jsx("pre", { className: "code-block__pre", children: _jsx("code", { children: open ? code : code.split('\n').slice(0, COLLAPSED_LINES).join('\n') }) })] }));
});
