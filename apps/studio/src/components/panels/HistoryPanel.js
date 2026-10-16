import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { memo, useReducer, useState } from 'react';
import { useHistoryState, useStudio, useUI } from '../../app/context';
import { Icon } from '../Icon';
const SOURCE_ICON = { agent: 'sparkles', user: 'user', system: 'cube' };
/** History tab: commit timeline (time travel), undo/redo, branches. */
export const HistoryPanel = memo(function HistoryPanel() {
    const studio = useStudio();
    const [revision, bump] = useReducer((x) => x + 1, 0);
    const { entries, head, branches, branch, canUndo, canRedo } = useHistoryState(revision);
    const playing = useUI((s) => s.mode === 'play');
    const agentBusy = useUI((s) => s.agentBusy);
    const [name, setName] = useState('');
    const [error, setError] = useState(null);
    const reversed = [...entries].reverse();
    const createBranch = () => {
        const n = name.trim();
        if (!n)
            return;
        const err = studio.branch(n);
        setError(err);
        if (!err) {
            setName('');
            bump();
        }
    };
    return (_jsxs("div", { className: "history", children: [_jsxs("div", { className: "panel-toolbar", children: [_jsxs("button", { type: "button", className: "btn btn--sm", disabled: !canUndo || playing || agentBusy, onClick: () => studio.undo(), children: [_jsx(Icon, { name: "undo" }), " Undo"] }), _jsxs("button", { type: "button", className: "btn btn--sm", disabled: !canRedo || playing || agentBusy, onClick: () => studio.redo(), children: [_jsx(Icon, { name: "redo" }), " Redo"] }), _jsxs("span", { className: "panel-toolbar__count", children: [entries.length - 1, " edits"] })] }), _jsxs("section", { className: "logic-section", children: [_jsxs("h3", { className: "section-title", children: [_jsx(Icon, { name: "branch" }), " Branches"] }), _jsx("div", { className: "branch-list", children: branches.map((b) => (_jsx("button", { type: "button", className: `branch-chip${b === branch ? ' is-active' : ''}`, disabled: playing, onClick: () => studio.switchBranch(b), "aria-pressed": b === branch, children: b }, b))) }), _jsxs("form", { className: "add-row", onSubmit: (e) => {
                            e.preventDefault();
                            createBranch();
                        }, children: [_jsx("input", { className: "input input--sm", value: name, maxLength: 64, placeholder: "new-branch-name", "aria-label": "New branch name", onChange: (e) => setName(e.target.value) }), _jsxs("button", { type: "submit", className: "btn btn--sm", disabled: !name.trim() || playing, children: [_jsx(Icon, { name: "plus" }), " Branch here"] })] }), error && _jsx("p", { className: "field-error", children: error })] }), _jsxs("section", { className: "logic-section", children: [_jsx("h3", { className: "section-title", children: "Timeline" }), _jsx("ol", { className: "timeline", children: reversed.map((e) => {
                            const current = e.id === head;
                            return (_jsx("li", { className: `timeline__item${current ? ' is-current' : ''}`, children: _jsxs("button", { type: "button", className: "timeline__btn", disabled: playing || current, onClick: () => studio.checkout(e.id), title: current ? 'Current state' : 'Jump to this state', children: [_jsx("span", { className: `timeline__icon src-${e.source}`, children: _jsx(Icon, { name: SOURCE_ICON[e.source] ?? 'cube' }) }), _jsx("span", { className: "timeline__msg", children: e.message }), _jsx("span", { className: "timeline__meta", children: e.patchCount > 0 ? `${e.patchCount} ops` : '' })] }) }, e.id));
                        }) })] })] }));
});
