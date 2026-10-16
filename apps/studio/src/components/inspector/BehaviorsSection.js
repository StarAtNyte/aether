import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Behaviours with full parameter forms (one typed control per parameter of
 * the behaviour catalog), enable switches, reorder, remove and add.
 */
import { memo, useState } from 'react';
import { BEHAVIOR_CATALOG } from '@aether/logic';
import { defaultParams } from '../../lib/entityEdit';
import { Icon } from '../Icon';
import { Section, SelectField, Switch } from '../fields';
import { ParamField } from './ParamField';
const BEHAVIOR_TYPES = BEHAVIOR_CATALOG.map((b) => b.type);
/** The behaviours section. */
export const BehaviorsSection = memo(function BehaviorsSection({ e, update, disabled }) {
    const [adding, setAdding] = useState(BEHAVIOR_TYPES[0] ?? 'spin');
    const [open, setOpen] = useState(null);
    const name = e.name || e.id;
    const setList = (list, message) => update({ behaviors: list }, message);
    const setParam = (i, key, v) => {
        const b = e.behaviors[i];
        if (!b)
            return;
        setList(e.behaviors.map((x, j) => (j === i ? { ...x, params: { ...x.params, [key]: v } } : x)), `Set ${b.type} ${key} on ${name}`);
    };
    return (_jsxs(Section, { title: "Behaviours", right: _jsx("span", { className: "count-badge", children: e.behaviors.length }), children: [e.behaviors.length === 0 && _jsx("p", { className: "section__note", children: "No behaviours. Add one below or ask the agent." }), e.behaviors.map((b, i) => {
                const entry = BEHAVIOR_CATALOG.find((c) => c.type === b.type);
                const specs = (entry?.params ?? {});
                const expanded = open === i;
                return (_jsxs("div", { className: `behavior${b.enabled ? '' : ' is-disabled'}`, children: [_jsxs("div", { className: "behavior__head", children: [_jsxs("button", { type: "button", className: "behavior__toggle", "aria-expanded": expanded, onClick: () => setOpen(expanded ? null : i), title: entry?.description ?? b.type, children: [_jsx(Icon, { name: expanded ? 'chevronDown' : 'chevronRight', size: 14 }), _jsx("span", { className: "behavior__type", children: b.type })] }), _jsx(Switch, { label: `Enable ${b.type}`, checked: b.enabled, disabled: disabled, onChange: (v) => setList(e.behaviors.map((x, j) => (j === i ? { ...x, enabled: v } : x)), `${v ? 'Enable' : 'Disable'} ${b.type} on ${name}`) }), _jsx("button", { type: "button", className: "icon-btn icon-btn--sm", disabled: disabled || i === 0, "aria-label": `Move ${b.type} up`, "data-tip": "Move up", onClick: () => setList([...e.behaviors.slice(0, i - 1), b, e.behaviors[i - 1], ...e.behaviors.slice(i + 1)], `Reorder behaviours of ${name}`), children: _jsx(Icon, { name: "chevronUp" }) }), _jsx("button", { type: "button", className: "icon-btn icon-btn--sm", disabled: disabled, "aria-label": `Remove ${b.type}`, "data-tip": "Remove", onClick: () => setList(e.behaviors.filter((_, j) => j !== i), `Remove ${b.type} from ${name}`), children: _jsx(Icon, { name: "trash" }) })] }), expanded && (_jsxs("div", { className: "behavior__form", children: [entry?.requires && _jsxs("p", { className: "section__note", children: ["Needs ", entry.requires, "."] }), Object.keys(specs).length === 0 && _jsx("p", { className: "section__note", children: "No parameters." }), Object.keys(specs).map((k) => (_jsx(ParamField, { name: k, spec: specs[k], value: b.params[k], disabled: disabled, onCommit: (v) => setParam(i, k, v) }, k)))] }))] }, `${b.type}-${i}`));
            }), _jsxs("div", { className: "add-row", children: [_jsx(SelectField, { label: "Behaviour type", value: adding, options: BEHAVIOR_TYPES, disabled: disabled, onChange: setAdding }), _jsxs("button", { type: "button", className: "btn btn--sm", disabled: disabled, onClick: () => {
                            const entry = BEHAVIOR_CATALOG.find((c) => c.type === adding);
                            if (!entry)
                                return;
                            setList([...e.behaviors, { type: entry.type, params: defaultParams(entry.params), enabled: true }], `Add ${entry.type} to ${name}`);
                            setOpen(e.behaviors.length);
                        }, children: [_jsx(Icon, { name: "plus" }), " Add"] })] })] }));
});
