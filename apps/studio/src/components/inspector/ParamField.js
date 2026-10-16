import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * One typed parameter control, driven by a generator `ParamSpec` or a
 * behaviour parameter spec: sliders for bounded numbers (live `onPreview`
 * while dragging, `onCommit` on release), toggles, colour pickers, enum
 * selects, vec3 inputs and a small JSON field for lists. Values are
 * validated before they are committed.
 */
import { memo, useEffect, useState } from 'react';
import { fieldNumber } from '../../lib/format';
import { ColorField, NumberField, SelectField, Switch, TextField, humanize, parseNumberInput } from '../fields';
const HEX = /^#[0-9a-fA-F]{6}$/;
/** A live slider: previews while dragging, commits on release. */
const LiveSlider = memo(function LiveSlider({ label, value, min, max, step, disabled, onPreview, onCommit }) {
    const [draft, setDraft] = useState(value);
    const [text, setText] = useState(fieldNumber(value));
    useEffect(() => {
        setDraft(value);
        setText(fieldNumber(value));
    }, [value]);
    const commit = (v) => {
        const n = Math.min(max, Math.max(min, v));
        if (n !== value)
            onCommit(n);
    };
    const pct = max > min ? ((draft - min) / (max - min)) * 100 : 0;
    return (_jsxs("div", { className: "slider-field slider-field--edit", children: [_jsx("input", { type: "range", className: "slider", min: min, max: max, step: step, value: draft, disabled: disabled, "aria-label": label, style: { ['--pct']: `${pct}%` }, onChange: (e) => {
                    const v = Number(e.target.value);
                    setDraft(v);
                    setText(fieldNumber(v));
                    onPreview?.(v);
                }, onPointerUp: () => commit(draft), onKeyUp: () => commit(draft), onBlur: () => commit(draft) }), _jsx("input", { className: "slider-field__input", type: "text", inputMode: "decimal", value: text, disabled: disabled, "aria-label": `${label} value`, onChange: (e) => setText(e.target.value), onBlur: () => {
                    const n = parseNumberInput(text);
                    if (n === null)
                        setText(fieldNumber(value));
                    else
                        commit(n);
                }, onKeyDown: (e) => {
                    if (e.key === 'Enter')
                        e.target.blur();
                    else if (e.key === 'Escape')
                        setText(fieldNumber(value));
                } })] }));
});
/** JSON list editor (vec3[] / string[] params). */
const JsonField = memo(function JsonField({ label, value, disabled, onCommit, validate }) {
    const initial = JSON.stringify(value);
    const [draft, setDraft] = useState(initial);
    const [bad, setBad] = useState(false);
    useEffect(() => {
        setDraft(JSON.stringify(value));
        setBad(false);
    }, [value]);
    return (_jsx("input", { className: `input input--sm input--mono${bad ? ' has-error' : ''}`, value: draft, maxLength: 4000, disabled: disabled, "aria-label": label, "aria-invalid": bad, onChange: (e) => setDraft(e.target.value), onBlur: () => {
            if (draft === initial)
                return;
            try {
                const v = JSON.parse(draft);
                if (!validate(v))
                    throw new Error('invalid');
                setBad(false);
                onCommit(v);
            }
            catch {
                setBad(true);
            }
        }, onKeyDown: (e) => e.key === 'Enter' && e.target.blur() }));
});
const isVec3 = (v) => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
const isVec3List = (v) => Array.isArray(v) && v.length <= 64 && v.every(isVec3);
const isStringList = (v) => Array.isArray(v) && v.length <= 64 && v.every((s) => typeof s === 'string' && s.length <= 120);
/** Default slider bounds for unbounded numbers: around the default value. */
function bounds(spec, value) {
    if (typeof spec.min === 'number' && typeof spec.max === 'number' && spec.max > spec.min)
        return { min: spec.min, max: spec.max };
    return Number.isFinite(value) ? null : null;
}
/**
 * Field for one parameter. `onPreview` (optional) receives slider values
 * while dragging; `onCommit` receives the final value.
 */
export const ParamField = memo(function ParamField({ name, spec, value, disabled, onCommit, onPreview, }) {
    const v = value === undefined ? spec.default : value;
    const label = humanize(name);
    let control;
    switch (spec.type) {
        case 'number':
        case 'int': {
            const n = typeof v === 'number' ? v : typeof spec.default === 'number' ? spec.default : 0;
            const b = bounds(spec, n);
            const step = spec.type === 'int' ? 1 : b ? Math.max(0.001, Number(((b.max - b.min) / 100).toPrecision(1))) : 0.1;
            const round = (x) => (spec.type === 'int' ? Math.round(x) : x);
            control = b ? (_jsx(LiveSlider, { label: label, value: n, min: b.min, max: b.max, step: step, disabled: disabled, onPreview: onPreview ? (x) => onPreview(round(x)) : undefined, onCommit: (x) => onCommit(round(x)) })) : (_jsx(NumberField, { label: label, value: n, step: step, ...(typeof spec.min === 'number' ? { min: spec.min } : {}), ...(typeof spec.max === 'number' ? { max: spec.max } : {}), disabled: disabled, onCommit: (x) => onCommit(round(x)) }));
            break;
        }
        case 'boolean':
            control = _jsx(Switch, { label: label, checked: v === true, disabled: disabled, onChange: (b) => onCommit(b) });
            break;
        case 'color':
            control = _jsx(ColorField, { label: label, value: typeof v === 'string' && HEX.test(v) ? v : '#cccccc', disabled: disabled, onCommit: (c) => onCommit(c) });
            break;
        case 'enum': {
            const options = spec.options && spec.options.length > 0 ? spec.options : [String(v)];
            control = _jsx(SelectField, { label: label, value: typeof v === 'string' && options.includes(v) ? v : options[0], options: options, disabled: disabled, onChange: (o) => onCommit(o) });
            break;
        }
        case 'vec3': {
            const vec = isVec3(v) ? v : isVec3(spec.default) ? spec.default : [0, 0, 0];
            control = (_jsx("div", { className: "vec3", children: ['x', 'y', 'z'].map((axis, i) => (_jsx(NumberField, { axis: axis, label: `${label} ${axis}`, value: vec[i], disabled: disabled, onCommit: (x) => {
                        const next = [vec[0], vec[1], vec[2]];
                        next[i] = x;
                        onCommit(next);
                    } }, axis))) }));
            break;
        }
        case 'vec3[]':
            control = _jsx(JsonField, { label: label, value: v, disabled: disabled, onCommit: onCommit, validate: isVec3List });
            break;
        case 'string[]':
            control = _jsx(JsonField, { label: label, value: v, disabled: disabled, onCommit: onCommit, validate: isStringList });
            break;
        default:
            control = _jsx(TextField, { label: label, value: typeof v === 'string' ? v : JSON.stringify(v ?? ''), maxLength: 200, disabled: disabled, mono: spec.type === 'selector', onCommit: (s) => onCommit(s.slice(0, 200)) });
    }
    return (_jsxs("div", { className: "field-row", title: spec.description ?? name, children: [_jsx("span", { className: "field-row__label", title: spec.description ?? name, children: label }), _jsx("div", { className: "field-row__control", children: control })] }));
});
