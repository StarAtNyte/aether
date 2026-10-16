import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Logic panel: rules as readable WHEN / IF / THEN cards that open into a
 * visual editor (trigger and action dropdowns with typed fields, conditions
 * and actions added / removed), world variables, physics tests that are
 * editable with a "Run checks" button, and the live rule trace while
 * playing. Every edit is validated against the World IR and committed as
 * one undoable change.
 */
import { memo, useMemo, useState } from 'react';
import { patchesBetween } from '@aether/core';
import { useSimulation, useStudio, useUI, useWorld } from '../../app/context';
import { formatRule, formatTest, formatValue } from '../../lib/ruleFormat';
import { ACTION_FIELDS, ACTION_LABELS, defaultAction, defaultTest, defaultTrigger, OPS, parseLiteral, literalText, TEST_FIELDS, TEST_LABELS, TRIGGER_FIELDS, TRIGGER_LABELS, validateRule, validateTest } from '../../lib/ruleFields';
import { Icon } from '../Icon';
import { SelectField, Switch, TextField } from '../fields';
import { KindForm } from './logic/KindForm';
const MAX_LOG_LINES = 40;
const TRIGGER_KINDS = Object.keys(TRIGGER_FIELDS);
const ACTION_KINDS = Object.keys(ACTION_FIELDS);
const TEST_KINDS = Object.keys(TEST_FIELDS);
/** Commit a world with replaced rules / tests as the minimal patches. */
function commitWorld(studio, next, message) {
    const patches = patchesBetween(studio.history.current, next);
    return patches.length > 0 ? studio.commitUser(patches, message) : null;
}
/** Visual editor of one rule. */
const RuleEditor = memo(function RuleEditor({ rule, entityIds, onClose }) {
    const studio = useStudio();
    const [draft, setDraft] = useState(rule);
    const [error, setError] = useState(null);
    const save = () => {
        const v = validateRule(draft);
        if (!v.ok) {
            setError(v.error);
            return;
        }
        const world = studio.history.current;
        const rules = world.rules.map((r) => (r.id === rule.id ? v.rule : r));
        const err = commitWorld(studio, { ...world, rules }, `Edit rule ${rule.id}`);
        setError(err);
        if (!err)
            onClose();
    };
    const setCond = (i, c) => setDraft({ ...draft, if: draft.if.map((x, j) => (j === i ? c : x)) });
    const setAction = (i, a) => setDraft({ ...draft, then: draft.then.map((x, j) => (j === i ? a : x)) });
    return (_jsxs("div", { className: "rule-editor", "data-testid": "rule-editor", children: [_jsxs("div", { className: "rule-editor__block", children: [_jsx("span", { className: "kw kw--when", children: "When" }), _jsx(SelectField, { label: "Trigger", value: draft.when.on, options: TRIGGER_KINDS, onChange: (on) => setDraft({ ...draft, when: defaultTrigger(on) }) }), _jsx("span", { className: "rule-editor__hint", children: TRIGGER_LABELS[draft.when.on] }), _jsx(KindForm, { fields: TRIGGER_FIELDS[draft.when.on], value: draft.when, entityIds: entityIds, onChange: (t) => setDraft({ ...draft, when: t }) })] }), _jsxs("div", { className: "rule-editor__block", children: [_jsx("span", { className: "kw kw--if", children: "If" }), draft.if.length === 0 && _jsx("span", { className: "rule-editor__hint", children: "always" }), draft.if.map((c, i) => (_jsxs("div", { className: "rule-editor__cond", children: [_jsx(TextField, { label: "Variable", value: c.key, mono: true, placeholder: "score", onCommit: (k) => setCond(i, { ...c, key: k }) }), _jsx(SelectField, { label: "Compare", raw: true, value: c.op, options: OPS, onChange: (op) => setCond(i, { ...c, op }) }), _jsx(TextField, { label: "Value", value: literalText(c.value), mono: true, onCommit: (t) => setCond(i, { ...c, value: parseLiteral(t) }) }), _jsx("button", { type: "button", className: "icon-btn icon-btn--xs", "aria-label": "Remove condition", onClick: () => setDraft({ ...draft, if: draft.if.filter((_, j) => j !== i) }), children: _jsx(Icon, { name: "x" }) })] }, i))), _jsxs("button", { type: "button", className: "btn btn--xs", onClick: () => setDraft({ ...draft, if: [...draft.if, { key: 'score', op: '>=', value: 1 }] }), children: [_jsx(Icon, { name: "plus", size: 14 }), " Condition"] })] }), _jsxs("div", { className: "rule-editor__block", children: [_jsx("span", { className: "kw kw--then", children: "Then" }), draft.then.map((a, i) => (_jsxs("div", { className: "rule-editor__action", children: [_jsxs("div", { className: "rule-editor__action-head", children: [_jsx("span", { className: "rule-editor__select", "data-tip": ACTION_LABELS[a.do], children: _jsx(SelectField, { label: "Action", value: a.do, options: ACTION_KINDS, onChange: (kind) => setAction(i, defaultAction(kind)) }) }), _jsx("button", { type: "button", className: "icon-btn icon-btn--xs", disabled: draft.then.length <= 1, "aria-label": "Remove action", onClick: () => setDraft({ ...draft, then: draft.then.filter((_, j) => j !== i) }), children: _jsx(Icon, { name: "x" }) })] }), _jsx(KindForm, { fields: ACTION_FIELDS[a.do], value: a, entityIds: entityIds, onChange: (next) => setAction(i, next) })] }, i))), _jsxs("button", { type: "button", className: "btn btn--xs", onClick: () => setDraft({ ...draft, then: [...draft.then, defaultAction('message')] }), children: [_jsx(Icon, { name: "plus", size: 14 }), " Action"] })] }), _jsxs("div", { className: "rule-editor__footer", children: [_jsxs("label", { className: "rule-editor__flag", children: [_jsx(Switch, { label: "Only once", checked: draft.once, onChange: (once) => setDraft({ ...draft, once }) }), _jsx("span", { children: "Only once" })] }), _jsx(TextField, { label: "Description", value: draft.description ?? '', placeholder: "What it does (optional)", onCommit: (d) => setDraft({ ...draft, description: d.trim() ? d.slice(0, 200) : undefined }) })] }), error && (_jsx("p", { className: "field-error", role: "alert", children: error })), _jsxs("div", { className: "add-row add-row--end", children: [_jsx("button", { type: "button", className: "btn btn--sm", onClick: onClose, children: "Cancel" }), _jsx("button", { type: "button", className: "btn btn--sm btn--primary", onClick: save, "data-testid": "rule-save", children: "Save rule" })] })] }));
});
/** One rule as a readable "WHEN … → …" card that opens into the editor. */
const RuleCard = memo(function RuleCard({ rule, disabled, entityIds }) {
    const studio = useStudio();
    const [editing, setEditing] = useState(false);
    const c = useMemo(() => formatRule(rule), [rule]);
    const toggle = () => void studio.commitUser([{ op: 'updateRule', id: rule.id, set: { enabled: !rule.enabled } }], `${rule.enabled ? 'Disable' : 'Enable'} rule ${rule.id}`);
    const remove = () => void studio.commitUser([{ op: 'removeRule', id: rule.id }], `Delete rule ${rule.id}`);
    return (_jsxs("article", { className: `rule-card${c.enabled ? '' : ' is-disabled'}${editing ? ' is-editing' : ''}`, "data-rule": rule.id, children: [_jsxs("header", { className: "rule-card__head", children: [_jsx("span", { className: "rule-card__id", children: c.id }), c.once && _jsx("span", { className: "chip chip--quiet chip--xs", children: "once" }), _jsx("button", { type: "button", className: "icon-btn icon-btn--xs", disabled: disabled, onClick: () => setEditing((e) => !e), title: "Edit rule", "aria-label": `Edit ${c.id}`, "data-testid": `rule-edit-${rule.id}`, children: _jsx(Icon, { name: "pencil" }) }), _jsx("button", { type: "button", className: "icon-btn icon-btn--xs", disabled: disabled, onClick: toggle, title: c.enabled ? 'Disable rule' : 'Enable rule', "aria-label": c.enabled ? `Disable ${c.id}` : `Enable ${c.id}`, children: _jsx(Icon, { name: c.enabled ? 'eye' : 'eyeOff' }) }), _jsx("button", { type: "button", className: "icon-btn icon-btn--xs", disabled: disabled, onClick: remove, title: "Delete rule", "aria-label": `Delete ${c.id}`, children: _jsx(Icon, { name: "trash" }) })] }), editing && !disabled ? (_jsx(RuleEditor, { rule: rule, entityIds: entityIds, onClose: () => setEditing(false) })) : (_jsxs(_Fragment, { children: [c.description && _jsx("p", { className: "rule-card__desc", children: c.description }), _jsxs("div", { className: "rule-line", children: [_jsx("span", { className: "kw kw--when", children: "When" }), _jsx("span", { children: c.when })] }), c.conditions.length > 0 && (_jsxs("div", { className: "rule-line", children: [_jsx("span", { className: "kw kw--if", children: "If" }), _jsx("span", { children: c.conditions.join(' and ') })] })), _jsxs("div", { className: "rule-line", children: [_jsx("span", { className: "kw kw--then", children: "Then" }), _jsx("span", { className: "rule-actions", children: c.actions.map((a, i) => (_jsx("span", { className: "action-chip", children: a }, i))) })] })] }))] }));
});
/** One test: kind + fields, last result, edit / delete. */
const TestRow = memo(function TestRow({ test, result, disabled, entityIds }) {
    const studio = useStudio();
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(test);
    const [error, setError] = useState(null);
    const save = () => {
        const v = validateTest(draft);
        if (!v.ok) {
            setError(v.error);
            return;
        }
        const world = studio.history.current;
        const err = commitWorld(studio, { ...world, tests: world.tests.map((t) => (t.id === test.id ? v.test : t)) }, `Edit test ${test.id}`);
        setError(err);
        if (!err)
            setEditing(false);
    };
    return (_jsxs("li", { className: `test-item${result ? (result.passed ? ' is-pass' : ' is-fail') : ''}`, children: [_jsxs("div", { className: "test-list__row", children: [_jsx(Icon, { name: result ? (result.passed ? 'check' : 'x') : 'shield' }), _jsx("span", { className: "test-list__id", children: test.id }), _jsx("span", { className: "test-list__msg", children: result ? result.message : formatTest(test) }), _jsx("button", { type: "button", className: "icon-btn icon-btn--xs", disabled: disabled, "aria-label": `Edit ${test.id}`, onClick: () => {
                            setDraft(test);
                            setEditing((e) => !e);
                        }, children: _jsx(Icon, { name: "pencil" }) }), _jsx("button", { type: "button", className: "icon-btn icon-btn--xs", disabled: disabled, "aria-label": `Delete ${test.id}`, onClick: () => void studio.commitUser([{ op: 'removeTest', id: test.id }], `Delete test ${test.id}`), children: _jsx(Icon, { name: "trash" }) })] }), editing && !disabled && (_jsxs("div", { className: "rule-editor", children: [_jsx(SelectField, { label: "Test kind", value: draft.kind, options: TEST_KINDS, onChange: (k) => setDraft(defaultTest(k, test.id)) }), _jsx("span", { className: "rule-editor__hint", children: TEST_LABELS[draft.kind] }), _jsx(KindForm, { fields: TEST_FIELDS[draft.kind], value: draft, entityIds: entityIds, onChange: (next) => setDraft(next) }), error && (_jsx("p", { className: "field-error", role: "alert", children: error })), _jsxs("div", { className: "add-row add-row--end", children: [_jsx("button", { type: "button", className: "btn btn--sm", onClick: () => setEditing(false), children: "Cancel" }), _jsx("button", { type: "button", className: "btn btn--sm btn--primary", onClick: save, children: "Save test" })] })] }))] }));
});
/** Live rule trace while playing (refreshes with the 4 Hz HUD tick). */
const LiveLog = memo(function LiveLog() {
    const sim = useSimulation();
    const time = useUI((s) => s.game.time);
    const playing = useUI((s) => s.mode === 'play');
    if (!playing || !sim?.logic)
        return null;
    const lines = sim.logic.log.slice(-MAX_LOG_LINES).reverse();
    return (_jsxs("section", { className: "logic-section", children: [_jsxs("h3", { className: "section-title", children: ["Live trace ", _jsxs("span", { className: "muted", children: ["t = ", time.toFixed(1), "s"] })] }), lines.length === 0 ? (_jsx("p", { className: "muted small", children: "Nothing has fired yet." })) : (_jsx("ol", { className: "trace", children: lines.map((l, i) => (_jsxs("li", { children: [_jsx("span", { className: "trace__t", children: l.t.toFixed(2) }), _jsx("span", { className: "trace__text", children: l.text })] }, `${l.t}-${i}`))) }))] }));
});
function freeId(existing, base) {
    if (!existing.includes(base))
        return base;
    for (let n = 2; n < 10_000; n++)
        if (!existing.includes(`${base}-${n}`))
            return `${base}-${n}`;
    return `${base}-${Date.now()}`;
}
/** Logic tab: rules (editable), state, tests (editable, runnable), live trace. */
export const LogicPanel = memo(function LogicPanel() {
    const studio = useStudio();
    const world = useWorld();
    const playing = useUI((s) => s.mode === 'play');
    const results = useUI((s) => s.verify.results);
    const verifying = useUI((s) => s.verify.status === 'running');
    const resultById = useMemo(() => new Map(results.map((r) => [r.id, r])), [results]);
    const stateKeys = Object.keys(world.state);
    const entityIds = useMemo(() => {
        const all = Object.values(world.entities);
        return [...all.filter((e) => e.template).map((e) => e.id), ...all.filter((e) => !e.template).map((e) => e.id)].slice(0, 500);
    }, [world.entities]);
    const addRule = () => {
        const id = freeId(world.rules.map((r) => r.id), 'rule');
        const v = validateRule({ id, when: { on: 'start' }, then: [{ do: 'message', text: 'The game begins!' }] });
        if (v.ok)
            studio.commitUser([{ op: 'addRule', rule: v.rule }], `Add rule ${id}`);
    };
    const addTest = () => {
        const id = freeId(world.tests.map((t) => t.id), 'check');
        studio.commitUser([{ op: 'addTest', test: defaultTest('stable', id) }], `Add test ${id}`);
    };
    return (_jsxs("div", { className: "logic", children: [_jsx(LiveLog, {}), _jsxs("section", { className: "logic-section", children: [_jsxs("h3", { className: "section-title", children: ["Rules ", _jsx("span", { className: "muted", children: world.rules.length }), _jsxs("button", { type: "button", className: "btn btn--xs section-title__action", disabled: playing, onClick: addRule, "data-testid": "rule-add", children: [_jsx(Icon, { name: "plus", size: 14 }), " Rule"] })] }), world.rules.length === 0 ? _jsx("p", { className: "muted small", children: "No rules yet. Add one, or try \u201Cadd a score that goes up when I touch a coin\u201D." }) : world.rules.map((r) => _jsx(RuleCard, { rule: r, disabled: playing, entityIds: entityIds }, r.id))] }), _jsxs("section", { className: "logic-section", children: [_jsxs("h3", { className: "section-title", children: ["State ", _jsx("span", { className: "muted", children: stateKeys.length })] }), stateKeys.length === 0 ? (_jsx("p", { className: "muted small", children: "No world variables." })) : (_jsx("dl", { className: "kv", children: stateKeys.map((k) => (_jsxs("div", { children: [_jsx("dt", { children: k }), _jsx("dd", { children: formatValue(world.state[k]) })] }, k))) }))] }), _jsxs("section", { className: "logic-section", children: [_jsxs("h3", { className: "section-title", children: ["Tests ", _jsx("span", { className: "muted", children: world.tests.length }), _jsxs("span", { className: "section-title__action", children: [_jsxs("button", { type: "button", className: "btn btn--xs", disabled: playing, onClick: addTest, children: [_jsx(Icon, { name: "plus", size: 14 }), " Test"] }), _jsxs("button", { type: "button", className: "btn btn--xs btn--primary", disabled: playing || verifying, onClick: () => void studio.runVerify(), "data-testid": "run-checks", children: [_jsx(Icon, { name: "play", size: 14 }), " ", verifying ? 'Checking…' : 'Run checks'] })] })] }), world.tests.length === 0 ? (_jsx("p", { className: "muted small", children: "No physics tests. Add one, or the agent adds them when it builds contraptions." })) : (_jsx("ul", { className: "test-list", children: world.tests.map((t) => (_jsx(TestRow, { test: t, result: resultById.get(t.id), disabled: playing, entityIds: entityIds }, t.id))) }))] })] }));
});
