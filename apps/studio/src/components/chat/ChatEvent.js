import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { memo, useState } from 'react';
import { useStudio, useUI, useWorld } from '../../app/context';
import { patchChips } from '../../lib/patchSummary';
import { compactCount } from '../../lib/format';
import { CodeBlock } from '../CodeBlock';
import { Icon } from '../Icon';
import { RichText } from '../RichText';
/** Expandable diff chip row for a patch batch. */
const PatchesView = memo(function PatchesView({ event }) {
    const [open, setOpen] = useState(false);
    const s = event.summary;
    const chips = patchChips(s);
    const lists = [
        ['Added', s.added, s.addedCount],
        ['Changed', s.updated, s.updatedCount],
        ['Removed', s.removed, s.removedCount],
    ];
    return (_jsxs("div", { className: "ev ev--patches", children: [_jsxs("button", { type: "button", className: "diff-chips", onClick: () => setOpen((o) => !o), "aria-expanded": open, children: [_jsx(Icon, { name: "cube", className: "diff-chips__icon" }), _jsx("span", { className: "diff-chips__msg", title: event.message || 'World edit', children: event.message || 'World edit' }), _jsx(Icon, { name: open ? 'chevronUp' : 'chevronDown', className: "diff-chips__chev" }), _jsx("span", { className: "diff-chips__list", children: chips.length === 0 ? _jsx("span", { className: "chip", children: "no changes" }) : chips.map((c) => _jsx("span", { className: `chip${c.startsWith('＋') ? ' chip--add' : c.startsWith('−') ? ' chip--remove' : c.startsWith('✎') ? ' chip--edit' : ''}`, children: c }, c)) })] }), open && (_jsxs("div", { className: "diff-detail", children: [lists.map(([label, ids, count]) => count > 0 ? (_jsxs("div", { className: "diff-detail__row", children: [_jsx("span", { className: "diff-detail__label", children: label }), _jsxs("span", { className: "diff-detail__ids", children: [ids.join(', '), count > ids.length ? ` +${count - ids.length} more` : ''] })] }, label)) : null), s.generators.length > 0 && (_jsxs("div", { className: "diff-detail__row", children: [_jsx("span", { className: "diff-detail__label", children: "Generators" }), _jsx("span", { className: "diff-detail__ids", children: s.generators.join(', ') })] })), s.scripts.length > 0 && (_jsxs("div", { className: "diff-detail__row", children: [_jsx("span", { className: "diff-detail__label", children: "Scripts" }), _jsx("span", { className: "diff-detail__ids", children: s.scripts.join(', ') })] }))] })), event.errors.length > 0 && (_jsx("ul", { className: "ev-errors", children: event.errors.map((e, i) => (_jsx("li", { children: e }, i))) }))] }));
});
/** A small edit applied on the spot: what changed, in one glance, with one-click undo / redo. */
const EditView = memo(function EditView({ event }) {
    const studio = useStudio();
    useWorld(); // re-render when the history moves (the buttons follow it)
    const [undone, setUndone] = useState(false);
    const head = event.head;
    const here = studio.history.head;
    const canUndo = !undone && head !== undefined && here === head && studio.history.canUndo();
    const canRedo = undone && head !== undefined && here !== head && studio.history.canRedo();
    const time = event.ms < 1 ? 'under 1 ms' : event.ms < 10 ? `${event.ms.toFixed(1)} ms` : `${Math.round(event.ms)} ms`;
    return (_jsxs("div", { className: "ev ev--edit", "data-testid": "edit-card", children: [_jsxs("div", { className: "edit__head", children: [_jsx(Icon, { name: "check", className: "edit__icon" }), _jsx("span", { className: "edit__summary", "data-testid": "edit-summary", children: event.summary }), event.local && (_jsxs("span", { className: "edit__meta", title: "Applied locally: no model call, only the named property changed", children: [time, " \u00B7 no model call"] }))] }), event.lines.length > 0 && (_jsx("ul", { className: "edit__lines", "aria-label": "What changed", children: event.lines.map((l, i) => (_jsxs("li", { className: `edit__line is-${l.kind}`, children: [l.fromColor && _jsx("span", { className: "swatch", style: { background: l.fromColor }, "aria-hidden": "true" }), l.toColor && _jsx("span", { className: "swatch", style: { background: l.toColor }, "aria-hidden": "true" }), _jsx("span", { children: l.text })] }, i))) })), event.notes.map((n, i) => (_jsx("p", { className: "edit__note", children: n }, i))), (canUndo || canRedo || undone) && (_jsx("div", { className: "edit__actions", children: !undone ? (_jsxs("button", { type: "button", className: "btn btn--sm", disabled: !canUndo, onClick: () => {
                        studio.undo();
                        setUndone(true);
                    }, "data-testid": "edit-undo", children: [_jsx(Icon, { name: "undo" }), " Undo"] })) : (_jsxs("button", { type: "button", className: "btn btn--sm", disabled: !canRedo, onClick: () => {
                        studio.redo();
                        setUndone(false);
                    }, "data-testid": "edit-redo", children: [_jsx(Icon, { name: "redo" }), " Redo"] })) }))] }));
});
/** "Which one?": numbered candidates (outlined in the viewport) to click. */
const ClarifyView = memo(function ClarifyView({ event }) {
    const studio = useStudio();
    const active = useUI((s) => s.clarify !== null && s.clarify.text === event.text);
    return (_jsxs("div", { className: "ev ev--clarify", role: "group", "aria-label": "Which one?", "data-testid": "clarify", children: [_jsx("p", { className: "clarify__text", children: event.text }), _jsx("div", { className: "clarify__choices", children: event.candidates.map((c, i) => (_jsxs("button", { type: "button", className: "chip chip--action", disabled: !active, onClick: () => studio.answerClarify(c.id), onMouseEnter: () => active && studio.simulation?.setCandidates([c.id]), onMouseLeave: () => active && studio.simulation?.setCandidates(event.candidates.map((x) => x.id)), "data-testid": "clarify-choice", children: [_jsx("b", { children: i + 1 }), " ", c.label] }, c.id))) }), active && _jsx("p", { className: "clarify__hint", children: "They are numbered in the viewport: click one there, or pick here." })] }));
});
/**
 * A room rebuilt from a photograph: what is happening, the assumptions as one-tap "adjust" chips (each sends a
 * plain-language edit to the same minimal-patch path as any other message), the swatches read from the picture
 * when no assistant could look at it, and the item-by-item score with what still differs.
 */
const PhotoView = memo(function PhotoView({ event }) {
    const studio = useStudio();
    const busy = useUI((s) => s.agentBusy);
    const [open, setOpen] = useState(false);
    const tone = event.phase === 'done' ? 'ok' : event.phase === 'offline' || event.phase === 'unavailable' ? 'warn' : 'info';
    const label = event.phase === 'analysing' ? 'Reading photo' : event.phase === 'described' ? 'Described' : event.phase === 'building' ? 'Building' : event.phase === 'built' ? 'Built' : event.phase === 'comparing' ? `Comparing${event.round ? ` ${event.round}` : ''}` : event.phase === 'round' ? `Round ${event.round ?? ''}`.trim() : event.phase === 'done' ? 'Matched' : event.phase === 'offline' ? 'Needs a vision model' : 'Not compared';
    const pct = event.score && event.score.total > 0 ? Math.round((event.score.passed / event.score.total) * 100) : null;
    return (_jsxs("div", { className: "ev ev--photo", "data-testid": `photo-${event.phase}`, children: [_jsxs("div", { className: "ev__label", children: [_jsx(Icon, { name: "image" }), " ", _jsx("span", { className: `status-chip is-${tone}`, children: label }), pct !== null && (_jsxs("span", { className: "photo__score", "aria-label": `${event.score?.passed} of ${event.score?.total} items match`, children: [event.score?.passed, "/", event.score?.total, " \u00B7 ", pct, "%", event.score?.objective !== undefined ? ` · look ${Math.round(event.score.objective * 100)}%` : ''] }))] }), _jsx("p", { className: "ev__desc", children: event.text }), event.palette && event.palette.length > 0 && (_jsx("div", { className: "photo__swatches", "aria-label": "Colours read from the picture", children: event.palette.map((c) => (_jsx("span", { className: "photo__swatch", style: { background: c }, title: c }, c))) })), event.assumptions && event.assumptions.length > 0 && (_jsxs("div", { className: "photo__assume", role: "group", "aria-label": "Assumptions", children: [_jsx("p", { className: "clarify__hint", children: "What I assumed (tap one to change it):" }), event.assumptions.map((a) => (_jsxs("div", { className: "photo__row", children: [_jsx("span", { className: "photo__text", children: a.text }), a.adjust && (_jsx("button", { type: "button", className: "chip chip--action", disabled: busy, onClick: () => void studio.send(a.adjust, { intent: 'refine' }), "data-testid": "photo-adjust", title: `Send: ${a.adjust}`, children: a.adjust.length > 38 ? `${a.adjust.slice(0, 36)}…` : a.adjust }))] }, a.id)))] })), event.score && event.score.failing.length > 0 && (_jsxs(_Fragment, { children: [_jsxs("button", { type: "button", className: "diff-chips", onClick: () => setOpen((o) => !o), "aria-expanded": open, children: [_jsxs("span", { className: "diff-chips__msg", children: [event.score.failing.length, " still differ", event.score.failing.length === 1 ? 's' : ''] }), _jsx(Icon, { name: open ? 'chevronUp' : 'chevronDown', className: "diff-chips__chev" })] }), open && (_jsx("ul", { className: "photo__failing", children: event.score.failing.map((f) => (_jsxs("li", { children: [_jsx("b", { children: f.id }), " ", f.note && f.note !== 'not judged' ? f.note : f.text] }, f.id))) }))] }))] }));
});
/** Verification result card with per-test badges. */
const VerifyView = memo(function VerifyView({ event }) {
    const [open, setOpen] = useState(!event.passed);
    const passed = event.results.filter((r) => r.passed).length;
    return (_jsxs("div", { className: `ev ev--verify ${event.passed ? 'is-pass' : 'is-fail'}`, children: [_jsxs("button", { type: "button", className: "verify-head", onClick: () => setOpen((o) => !o), "aria-expanded": open, children: [_jsx("span", { className: `status-chip is-${event.passed ? 'ok' : 'bad'}`, children: event.passed ? 'Checks passed' : 'Checks failed' }), event.results.length > 0 && (_jsxs("span", { className: "ev__meta", children: [passed, "/", event.results.length, " tests"] })), event.diagnostics.length > 0 && _jsxs("span", { className: "ev__meta", children: [event.diagnostics.length, " notes"] }), _jsx(Icon, { name: open ? 'chevronUp' : 'chevronDown' })] }), open && (_jsxs("ul", { className: "test-list", children: [event.results.map((r, i) => (_jsxs("li", { className: r.passed ? 'is-pass' : 'is-fail', children: [_jsx(Icon, { name: r.passed ? 'check' : 'x' }), _jsx("span", { className: "test-list__id", children: r.id }), _jsx("span", { className: "test-list__msg", children: r.message })] }, `${r.id}-${i}`))), event.diagnostics.map((d, i) => (_jsxs("li", { className: `sev-${d.severity}`, children: [_jsx(Icon, { name: d.severity === 'info' ? 'info' : 'alert' }), _jsx("span", { className: "test-list__id", children: d.code }), _jsx("span", { className: "test-list__msg", children: d.message })] }, `d${i}`))), event.results.length === 0 && event.diagnostics.length === 0 && _jsx("li", { className: "test-list__empty", children: event.summary || 'No tests defined.' })] }))] }));
});
/** A notice; when the offline planner could not map the request it also offers the examples and the connect-AI action. */
const NoticeView = memo(function NoticeView({ event }) {
    const studio = useStudio();
    const busy = useUI((s) => s.agentBusy);
    return (_jsxs("div", { className: `ev ev--notice${event.tone === 'warning' ? ' is-warning' : ''}`, role: "status", "data-testid": event.offline ? 'offline-notice' : undefined, children: [_jsx(Icon, { name: event.tone === 'warning' ? 'alert' : 'info' }), " ", _jsx("span", { children: event.text }), event.offline && (_jsxs("div", { className: "clarify__choices", children: [_jsx("button", { type: "button", className: "chip chip--action", onClick: () => studio.store.getState().openSettings('ai'), "data-testid": "offline-connect", children: "Connect an AI" }), event.offline.examples.map((ex) => (_jsx("button", { type: "button", className: "chip chip--action", disabled: busy, onClick: () => void studio.send(ex, { offline: true, intent: 'new' }), children: ex }, ex)))] }))] }));
});
/** Renders one agent event. LLM text goes through the safe RichText renderer only. */
export const ChatEvent = memo(function ChatEvent({ event, live }) {
    switch (event.type) {
        case 'status':
            return (_jsx("div", { className: `ev ev--status${live ? ' is-live' : ''}`, children: _jsx("span", { children: event.text }) }));
        case 'plan':
            return (_jsxs("div", { className: "ev ev--plan", children: [_jsxs("div", { className: "ev__label", children: [_jsx(Icon, { name: "list" }), " Plan"] }), _jsx(RichText, { text: event.text })] }));
        case 'message':
            return (_jsx("div", { className: "ev ev--message", children: _jsx(RichText, { text: event.text }) }));
        case 'error':
            return (_jsxs("div", { className: "ev ev--error", role: "alert", children: [_jsx(Icon, { name: "alert" }), " ", _jsx("span", { children: event.text })] }));
        case 'repair':
            return (_jsxs("div", { className: "ev ev--repair", children: [_jsxs("span", { className: "status-chip is-warn", children: ["Repair ", event.attempt] }), _jsx("span", { className: "ev__text", children: event.text })] }));
        case 'patches':
            return _jsx(PatchesView, { event: event });
        case 'edit':
            return _jsx(EditView, { event: event });
        case 'clarify':
            return _jsx(ClarifyView, { event: event });
        case 'verify':
            return _jsx(VerifyView, { event: event });
        case 'generator':
            return (_jsxs("div", { className: "ev ev--generator", children: [_jsxs("div", { className: "ev__label", children: [_jsx(Icon, { name: "code" }), " Generator ", _jsx("code", { className: "inline-code", children: event.id }), _jsx("span", { className: `status-chip is-${event.ok ? 'ok' : 'bad'}`, children: event.ok ? 'Sandbox ok' : 'Rejected' })] }), event.description && _jsx("p", { className: "ev__desc", children: event.description }), _jsx(CodeBlock, { code: event.source, lang: "js", title: `${event.id}.js` }), event.error && _jsx("p", { className: "ev-errors", children: event.error })] }));
        case 'done': {
            const parts = [];
            if (event.via)
                parts.push(event.via);
            // The built-in planner is not a model: its internal name is not shown as one.
            const named = (event.models ?? []).filter((m) => m !== 'aether-mock');
            if (named.length > 0)
                parts.push(`answered by ${named.join(', ')}`);
            if (event.ms !== undefined)
                parts.push(formatElapsed(event.ms));
            // The offline planner estimates tokens from text length: those are not real model usage, never shown.
            if (event.calls > 0 && event.via !== 'Offline planner')
                parts.push(`${event.calls} model call${event.calls === 1 ? '' : 's'}`, `${compactCount(event.inputTokens)} in / ${compactCount(event.outputTokens)} out tokens`);
            return parts.length > 0 ? _jsx("div", { className: "ev ev--done", children: parts.join(' · ') }) : null;
        }
        case 'notice':
            return _jsx(NoticeView, { event: event });
        case 'quality':
            return _jsx(QualityView, { event: event });
        case 'photo':
            return _jsx(PhotoView, { event: event });
        case 'review': {
            const tone = event.phase === 'approved' ? 'ok' : event.phase === 'stalled' || event.phase === 'limit' ? 'warn' : 'info';
            const label = event.phase === 'checking' ? 'Checking' : event.phase === 'found' ? 'Found' : event.phase === 'fixing' ? 'Fixing' : event.phase === 'approved' ? 'Checked' : 'Stopped';
            return (_jsxs("div", { className: "ev ev--repair", role: "status", children: [_jsxs("span", { className: `status-chip is-${tone === 'ok' ? 'ok' : tone === 'warn' ? 'warn' : 'info'}`, children: [label, " ", event.round > 0 ? event.round : ''] }), _jsxs("span", { className: "ev__text", children: [event.text, event.score !== undefined ? ` (${event.score}/100)` : ''] })] }));
        }
    }
});
/** "12 s" / "1 min 05 s". */
export function formatElapsed(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60)
        return `${s} s`;
    return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
}
/** Quality score with an expandable rubric breakdown. */
const QualityView = memo(function QualityView({ event }) {
    const [open, setOpen] = useState(false);
    const grade = event.score >= 85 ? 'ok' : event.score >= 72 ? 'fair' : 'low';
    const title = event.round === 0 ? 'Quality review' : `Quality after refinement ${event.round}`;
    return (_jsxs("div", { className: `ev ev--quality is-${grade}`, children: [_jsxs("button", { type: "button", className: "quality__head", onClick: () => setOpen((o) => !o), "aria-expanded": open, children: [_jsx("span", { className: "quality__score", "aria-label": `Quality score ${event.score} of 100`, children: event.score }), _jsxs("span", { className: "quality__text", children: [_jsx("span", { className: "quality__title", children: title }), _jsx("span", { className: "quality__summary", children: event.applied.length > 0 ? `Improved: ${event.applied.join(', ')}.` : event.summary }), _jsx("span", { className: "quality__source", children: event.source === 'heuristic' ? 'Measured' : 'Measured + model review' })] }), _jsx(Icon, { name: open ? 'chevronUp' : 'chevronDown', className: "quality__chev" })] }), open && (_jsx("ul", { className: "quality__rubric", children: event.criteria.map((c) => (_jsxs("li", { className: "quality__row", children: [_jsx("span", { className: "quality__label", children: c.label }), _jsx("span", { className: "quality__bar", "aria-hidden": "true", children: _jsx("span", { className: "quality__fill", style: { width: `${Math.round(c.score * 10)}%` } }) }), _jsx("span", { className: "quality__value", children: c.score.toFixed(1) }), c.note && _jsx("span", { className: "quality__note", children: c.note })] }, c.id))) }))] }));
});
