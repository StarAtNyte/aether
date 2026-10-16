import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { memo } from 'react';
import { useHistoryState, useStudio, useUI } from '../../app/context';
import { formatMs } from '../../lib/format';
import { Icon } from '../Icon';
import { RichText } from '../RichText';
import { VerifiedSection } from './VerifiedSection';
/** One line on where and how fast the last run went, e.g. "12 s of physics in 340 ms · 2 parallel workers". */
export function runMeta(v) {
    const parts = [];
    const sim = v.simulatedSeconds ?? 0;
    parts.push(sim > 0 ? `${sim.toFixed(sim >= 10 ? 0 : 1)} s of physics in ${formatMs(v.ms)}` : formatMs(v.ms));
    if (v.worker === true)
        parts.push((v.lanes ?? 1) > 1 ? `${v.lanes} parallel workers` : 'background worker');
    else if (v.worker === false)
        parts.push('main thread');
    return parts.join(' · ');
}
function describeDiagnostic(d) {
    const who = d.entities.length > 0 ? ` (${d.entities.join(', ')})` : '';
    return `${d.code}${who}: ${d.message}${d.suggestion ? ` Suggestion: ${d.suggestion}` : ''}`;
}
/** Verify tab: run headless physics tests, show results + diagnostics, repair with AI. */
export const VerifyPanel = memo(function VerifyPanel() {
    const studio = useStudio();
    const verify = useUI((s) => s.verify);
    const busy = useUI((s) => s.agentBusy);
    const playing = useUI((s) => s.mode === 'play');
    const { head } = useHistoryState();
    const stale = verify.head !== null && verify.head !== head;
    const running = verify.status === 'running';
    const failing = verify.results.filter((r) => !r.passed);
    const live = running ? (verify.live ?? null) : null;
    const decided = live ? live.results.filter((r) => r !== null).length : 0;
    return (_jsxs("div", { className: "verify", children: [_jsx(VerifiedSection, {}), _jsxs("div", { className: "panel-toolbar", children: [_jsxs("button", { type: "button", className: "btn btn--primary btn--sm", disabled: running || playing, onClick: () => void studio.runVerify(), children: [_jsx(Icon, { name: "shield" }), " ", running ? 'Checking…' : 'Run checks'] }), verify.status !== 'idle' && !running && (_jsx("span", { className: `status-chip is-${stale ? 'idle' : verify.status === 'passed' ? 'ok' : 'bad'}`, children: stale ? 'outdated' : verify.status === 'passed' ? 'passed' : verify.status === 'error' ? 'error' : 'failed' })), verify.ms > 0 && !running && (_jsx("span", { className: "panel-toolbar__count", title: runMeta(verify), "data-testid": "verify-meta", children: runMeta(verify) }))] }), live && (_jsxs("section", { className: "logic-section verify-live", "aria-live": "polite", "data-testid": "verify-live", children: [_jsxs("h3", { className: "section-title", children: [live.worker ? (live.lanes > 1 ? `Simulating on ${live.lanes} parallel workers` : 'Simulating in a background worker') : 'Simulating', ' ', _jsxs("span", { className: "muted", children: [decided, "/", live.tests.length] })] }), live.worker && live.lanes > 1 && (_jsx("div", { className: "verify-lanes", "aria-hidden": "true", children: Array.from({ length: live.lanes }, (_, i) => (_jsx("span", { className: "verify-lanes__lane" }, i))) })), _jsx("ul", { className: "test-list", children: live.tests.map((t, i) => {
                            const r = live.results[i] ?? null;
                            return (_jsxs("li", { className: r ? (r.passed ? 'is-pass' : 'is-fail') : 'is-pending', children: [r ? _jsx(Icon, { name: r.passed ? 'check' : 'x' }) : _jsx("span", { className: "test-list__pending" }), _jsx("span", { className: "test-list__id", children: t.id }), _jsx("span", { className: "test-list__msg", children: r ? r.message : t.kind })] }, `${t.id}-${i}`));
                        }) })] })), verify.status === 'idle' && (_jsxs("div", { className: "panel-empty panel-empty--center", children: [_jsx("span", { className: "panel-empty__icon", children: _jsx(Icon, { name: "shield", size: 20 }) }), _jsx("p", { children: "Simulates the world headless with its rules and runs every test \u2014 stability, overlaps, reachability \u2014 plus static diagnostics." })] })), verify.summary && verify.status !== 'running' && (_jsxs("details", { className: "verify-summary", children: [_jsx("summary", { children: "Report summary" }), _jsx(RichText, { text: verify.summary })] })), verify.results.length > 0 && !live && (_jsxs("section", { className: "logic-section", children: [_jsxs("h3", { className: "section-title", children: ["Tests", ' ', _jsxs("span", { className: "muted", children: [verify.results.length - failing.length, "/", verify.results.length, " passing"] })] }), _jsx("ul", { className: "test-list", children: verify.results.map((r, i) => (_jsxs("li", { className: r.passed ? 'is-pass' : 'is-fail', children: [_jsx(Icon, { name: r.passed ? 'check' : 'x' }), _jsx("span", { className: "test-list__id", children: r.id }), _jsx("span", { className: "test-list__msg", children: r.message }), !r.passed && (_jsxs("button", { type: "button", className: "btn btn--sm", disabled: busy || playing, onClick: () => studio.fixWithAI(`test "${r.id}" (${r.kind}) failed: ${r.message}`), children: [_jsx(Icon, { name: "wand" }), " Fix with AI"] }))] }, `${r.id}-${i}`))) })] })), verify.diagnostics.length > 0 && !running && (_jsxs("section", { className: "logic-section", children: [_jsxs("h3", { className: "section-title", children: ["Diagnostics ", _jsx("span", { className: "muted", children: verify.diagnostics.length })] }), _jsx("ul", { className: "diag-list", children: verify.diagnostics.map((d, i) => (_jsxs("li", { className: `diag sev-${d.severity}`, children: [_jsxs("div", { className: "diag__head", children: [_jsx("span", { className: `sev-badge sev-badge--${d.severity}`, children: d.severity }), _jsx("span", { className: "diag__code", children: d.code }), d.entities.slice(0, 4).map((id) => (_jsx("button", { type: "button", className: "tag tag--link", onClick: () => {
                                                studio.pick(id);
                                                studio.focus(id);
                                            }, children: id }, id)))] }), _jsx("p", { className: "diag__msg", children: d.message }), d.suggestion && _jsx("p", { className: "diag__hint", children: d.suggestion }), d.severity !== 'info' && (_jsxs("button", { type: "button", className: "btn btn--sm", disabled: busy || playing, onClick: () => studio.fixWithAI(describeDiagnostic(d)), children: [_jsx(Icon, { name: "wand" }), " Fix with AI"] }))] }, i))) })] })), verify.status !== 'idle' && !running && verify.results.length === 0 && verify.diagnostics.length === 0 && (_jsx("p", { className: "panel-empty", children: "No tests or problems found. Ask the agent to \u201Cadd physics tests\u201D for stronger guarantees." }))] }));
});
