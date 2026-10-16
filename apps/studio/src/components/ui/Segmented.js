import { jsx as _jsx } from "react/jsx-runtime";
/** Segmented control (radio group) with arrow-key navigation. */
import { useRef } from 'react';
/** Segmented control. Options are `[value, label]` pairs; a label may be a node (icon + text). */
export function Segmented({ value, options, onChange, label, stretch, size = 'md', disabled, titles, }) {
    const ref = useRef(null);
    const onKey = (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')
            return;
        e.preventDefault();
        const i = options.findIndex(([v]) => v === value);
        const n = options.length;
        const next = options[(i + (e.key === 'ArrowRight' ? 1 : -1) + n) % n];
        if (!next)
            return;
        onChange(next[0]);
        requestAnimationFrame(() => ref.current?.querySelector('[aria-checked="true"]')?.focus());
    };
    return (_jsx("div", { ref: ref, className: `segmented segmented--${size}${stretch ? ' segmented--stretch' : ''}`, role: "radiogroup", "aria-label": label, onKeyDown: onKey, children: options.map(([v, text]) => (_jsx("button", { type: "button", role: "radio", "aria-checked": value === v, tabIndex: value === v ? 0 : -1, className: "segmented__btn", disabled: disabled, onClick: () => onChange(v), "data-tip": titles?.[v], children: text }, v))) }));
}
