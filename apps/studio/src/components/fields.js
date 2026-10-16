import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Small form controls for the Inspector. Fields keep a local draft and only
 * commit on blur / Enter, so every edit is one undoable patch.
 */
import { memo, useEffect, useId, useState } from 'react';
import { fieldNumber } from '../lib/format';
/** Labeled on/off switch row (label left, switch right). */
export const Toggle = memo(function Toggle({ label, hint, checked, onChange, disabled }) {
    const id = useId();
    return (_jsxs("label", { className: `toggle${hint ? ' toggle--hint' : ''}`, htmlFor: id, children: [_jsxs("span", { className: "toggle__text", children: [_jsx("span", { className: "toggle__label", children: label }), hint && _jsx("span", { className: "toggle__hint", children: hint })] }), _jsx("input", { id: id, className: "toggle__input", type: "checkbox", role: "switch", checked: checked, disabled: disabled, onChange: (e) => onChange(e.target.checked) }), _jsx("span", { className: "switch", "aria-hidden": "true", children: _jsx("span", { className: "switch__thumb" }) })] }));
});
/** Parse a user-typed number; null when not finite. */
export function parseNumberInput(text) {
    const t = text.trim().replace(',', '.');
    if (t === '' || t.length > 32)
        return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
}
/** Numeric input with draft state, clamping and Enter/blur commit. */
export const NumberField = memo(function NumberField({ value, onCommit, label, min, max, step = 0.1, disabled, axis, }) {
    const [draft, setDraft] = useState(fieldNumber(value));
    useEffect(() => setDraft(fieldNumber(value)), [value]);
    const commit = () => {
        const n = parseNumberInput(draft);
        if (n === null) {
            setDraft(fieldNumber(value));
            return;
        }
        const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
        setDraft(fieldNumber(clamped));
        if (clamped !== value)
            onCommit(clamped);
    };
    return (_jsxs("label", { className: `num-field${axis ? ` num-field--${axis}` : ''}`, children: [axis && (_jsx("span", { className: "num-field__axis", "aria-hidden": "true", children: axis.toUpperCase() })), _jsx("input", { type: "text", inputMode: "decimal", value: draft, disabled: disabled, "aria-label": label, onChange: (e) => setDraft(e.target.value), onBlur: commit, onKeyDown: (e) => {
                    if (e.key === 'Enter')
                        e.target.blur();
                    else if (e.key === 'Escape')
                        setDraft(fieldNumber(value));
                    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                        e.preventDefault();
                        const base = parseNumberInput(draft) ?? value;
                        const d = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
                        const next = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, Math.round((base + d) * 1e6) / 1e6));
                        setDraft(fieldNumber(next));
                        onCommit(next);
                    }
                } })] }));
});
/** Three numeric inputs for a Vec3. */
export const Vec3Field = memo(function Vec3Field({ label, value, onCommit, step, min, disabled }) {
    const set = (i, n) => {
        const next = [value[0], value[1], value[2]];
        next[i] = n;
        onCommit(next);
    };
    return (_jsxs("div", { className: "field-row", children: [_jsx("span", { className: "field-row__label", title: label, children: label }), _jsx("div", { className: "vec3", children: ['x', 'y', 'z'].map((axis, i) => (_jsx(NumberField, { axis: axis, label: `${label} ${axis}`, value: value[i], step: step, min: min, disabled: disabled, onCommit: (n) => set(i, n) }, axis))) })] }));
});
/** Labeled row wrapper. */
export function FieldRow({ label, children }) {
    return (_jsxs("div", { className: "field-row", children: [_jsx("span", { className: "field-row__label", title: label, children: label }), _jsx("div", { className: "field-row__control", children: children })] }));
}
/** Text input committing on blur/Enter. */
export const TextField = memo(function TextField({ value, onCommit, label, maxLength = 200, disabled, placeholder, mono }) {
    const [draft, setDraft] = useState(value);
    useEffect(() => setDraft(value), [value]);
    return (_jsx("input", { className: `input input--sm${mono ? ' input--mono' : ''}`, value: draft, maxLength: maxLength, disabled: disabled, placeholder: placeholder, "aria-label": label, onChange: (e) => setDraft(e.target.value), onBlur: () => {
            if (draft !== value)
                onCommit(draft);
        }, onKeyDown: (e) => {
            if (e.key === 'Enter')
                e.target.blur();
            else if (e.key === 'Escape')
                setDraft(value);
        } }));
});
/** Human label for an enum value: "thirdPerson" → "Third person", "lamp-post" → "Lamp post". */
export function humanize(value) {
    const s = value
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[-_]+/g, ' ')
        .toLowerCase()
        .trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : value;
}
/** Native select over string options (labels are humanized unless `raw`). */
export function SelectField({ value, options, onChange, label, disabled, raw }) {
    return (_jsx("select", { className: "select select--sm", value: value, "aria-label": label, disabled: disabled, onChange: (e) => onChange(e.target.value), children: options.map((o) => (_jsx("option", { value: o, children: raw ? o : humanize(o) }, o))) }));
}
/** Color swatch + hex input. */
export const ColorField = memo(function ColorField({ value, onCommit, label, disabled }) {
    const valid = /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#ffffff';
    const [draft, setDraft] = useState(valid);
    useEffect(() => setDraft(valid), [valid]);
    return (_jsxs("div", { className: "color-field", children: [_jsx("input", { className: "color-field__swatch", type: "color", value: draft, "aria-label": label, disabled: disabled, onChange: (e) => setDraft(e.target.value), onBlur: () => draft !== valid && onCommit(draft.toLowerCase()) }), _jsx("input", { className: "input input--sm input--mono", value: draft, maxLength: 7, disabled: disabled, "aria-label": `${label} hex`, onChange: (e) => setDraft(e.target.value), onBlur: () => {
                    if (/^#[0-9a-fA-F]{6}$/.test(draft)) {
                        if (draft.toLowerCase() !== valid.toLowerCase())
                            onCommit(draft.toLowerCase());
                    }
                    else
                        setDraft(valid);
                }, onKeyDown: (e) => e.key === 'Enter' && e.target.blur() })] }));
});
/**
 * Collapsible inspector section: a 32 px header row (chevron + title, with
 * optional controls on the right, e.g. an enable switch) and a body of
 * label/value rows. Open state is remembered per title for the session.
 */
const openSections = new Map();
export function Section({ title, children, right, defaultOpen = true, icon }) {
    const [open, setOpen] = useState(() => openSections.get(title) ?? defaultOpen);
    const id = useId();
    return (_jsxs("section", { className: `section${open ? ' is-open' : ''}`, children: [_jsxs("div", { className: "section__head", children: [_jsxs("button", { type: "button", className: "section__toggle", onClick: () => setOpen((o) => {
                            openSections.set(title, !o);
                            return !o;
                        }), "aria-expanded": open, "aria-controls": id, children: [_jsx("svg", { className: "section__chev", width: "16", height: "16", viewBox: "0 0 24 24", "aria-hidden": "true", focusable: "false", children: _jsx("path", { d: "M9 6l6 6-6 6", fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round" }) }), icon, _jsx("span", { className: "section__title", children: title })] }), right && _jsx("div", { className: "section__right", children: right })] }), open && (_jsx("div", { className: "section__body", id: id, children: children }))] }));
}
/** Compact switch without a label row (for section headers and table cells). */
export const Switch = memo(function Switch({ label, checked, onChange, disabled }) {
    return (_jsx("button", { type: "button", role: "switch", "aria-checked": checked, "aria-label": label, className: "switch", disabled: disabled, onClick: () => onChange(!checked), children: _jsx("span", { className: "switch__thumb", "aria-hidden": "true" }) }));
});
/**
 * Range slider with a numeric readout that is itself editable. The value
 * commits on release / Enter (one undoable edit), not on every drag step.
 */
export const SliderField = memo(function SliderField({ label, value, min, max, step, onCommit, disabled, format, }) {
    const [draft, setDraft] = useState(value);
    useEffect(() => setDraft(value), [value]);
    const commit = (v) => {
        const n = Math.min(max, Math.max(min, v));
        if (n !== value)
            onCommit(n);
    };
    const pct = max > min ? ((draft - min) / (max - min)) * 100 : 0;
    return (_jsxs("div", { className: "slider-field", children: [_jsx("input", { type: "range", className: "slider", min: min, max: max, step: step, value: draft, disabled: disabled, "aria-label": label, style: { ['--pct']: `${pct}%` }, onChange: (e) => setDraft(Number(e.target.value)), onPointerUp: () => commit(draft), onKeyUp: () => commit(draft), onBlur: () => commit(draft) }), _jsx("span", { className: "slider-field__value", "aria-hidden": "true", children: format ? format(draft) : fieldNumber(draft, 2) })] }));
});
