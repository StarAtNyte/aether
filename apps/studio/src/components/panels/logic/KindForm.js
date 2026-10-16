import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Renders the inputs of one trigger / action / test (see `lib/ruleFields`)
 * and reports a modified copy on every committed change.
 */
import { memo } from 'react';
import { NumberField, SelectField, Switch, TextField } from '../../fields';
import { getField, literalText, OPS, parseLiteral, parsePlace, setField } from '../../../lib/ruleFields';
/** Inputs for the fields of `value`. */
export const KindForm = memo(function KindForm({ fields, value, onChange, disabled, entityIds, }) {
    return (_jsx("div", { className: "kind-form", children: fields.map((f) => {
            const v = getField(value, f.key);
            const set = (x) => onChange(setField(value, f.key, x));
            let control;
            switch (f.kind) {
                case 'number':
                    control = _jsx(NumberField, { label: f.label, value: typeof v === 'number' ? v : 0, disabled: disabled, onCommit: set });
                    break;
                case 'bool':
                    control = _jsx(Switch, { label: f.label, checked: v === true, disabled: disabled, onChange: set });
                    break;
                case 'op':
                    control = _jsx(SelectField, { label: f.label, raw: true, value: (typeof v === 'string' ? v : '=='), options: OPS, disabled: disabled, onChange: set });
                    break;
                case 'enum':
                    control = _jsx(SelectField, { label: f.label, value: typeof v === 'string' ? v : (f.options?.[0] ?? ''), options: f.options ?? [], disabled: disabled, onChange: set });
                    break;
                case 'entity': {
                    const ids = typeof v === 'string' && !entityIds.includes(v) ? [v, ...entityIds] : entityIds;
                    control = ids.length > 0 ? _jsx(SelectField, { label: f.label, raw: true, value: typeof v === 'string' ? v : ids[0], options: ids, disabled: disabled, onChange: set }) : _jsx(TextField, { label: f.label, value: typeof v === 'string' ? v : '', mono: true, disabled: disabled, onCommit: set });
                    break;
                }
                case 'vec3': {
                    const vec = Array.isArray(v) && v.length === 3 ? v : [0, 0, 0];
                    control = (_jsx("div", { className: "vec3", children: ['x', 'y', 'z'].map((axis, i) => (_jsx(NumberField, { axis: axis, label: `${f.label} ${axis}`, value: vec[i] ?? 0, disabled: disabled, onCommit: (n) => {
                                const next = [vec[0] ?? 0, vec[1] ?? 0, vec[2] ?? 0];
                                next[i] = n;
                                set(next);
                            } }, axis))) }));
                    break;
                }
                case 'place':
                    control = (_jsx(TextField, { label: f.label, value: Array.isArray(v) ? v.join(', ') : typeof v === 'string' ? v : '', placeholder: f.optional ? 'x, y, z or object (optional)' : 'x, y, z or object', mono: true, disabled: disabled, onCommit: (t) => set(t.trim() === '' && f.optional ? undefined : parsePlace(t)) }));
                    break;
                case 'value':
                    control = _jsx(TextField, { label: f.label, value: literalText(v), placeholder: "10, true or text", mono: true, disabled: disabled, onCommit: (t) => set(parseLiteral(t)) });
                    break;
                default:
                    control = _jsx(TextField, { label: f.label, value: typeof v === 'string' ? v : '', mono: f.kind === 'selector', placeholder: f.kind === 'selector' ? 'id, #tag, player or *' : '', disabled: disabled, onCommit: set });
            }
            return (_jsxs("label", { className: "kind-form__row", children: [_jsx("span", { className: "kind-form__label", children: f.label }), _jsx("span", { className: "kind-form__control", children: control })] }, f.key));
        }) }));
});
