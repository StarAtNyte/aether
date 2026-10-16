import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * The proof seal: after a verification run, a small stamp settles over the
 * top of the viewport — a ring that draws itself closed around a check
 * ("Proved", n of n checks, seconds simulated) — while the ghost replay of
 * the run plays in the world. A failed run gets a quieter chip that points
 * at the Checks panel. It dismisses itself; "Replay" plays the motion again.
 * Announced to screen readers through a polite live region.
 */
import { memo, useEffect } from 'react';
import { useStudio, useUI } from '../../app/context';
import { Icon } from '../Icon';
/** Seconds the seal stays before it dismisses itself. */
export const SEAL_SECONDS = 6;
/** One-line summary of a seal (also the live-region text). Pure. */
export function sealText(seal) {
    if (seal.title !== undefined)
        return { title: seal.title, detail: seal.detail ?? '' };
    const sim = seal.seconds > 0 ? ` · ${seal.seconds.toFixed(1)} s simulated` : '';
    if (seal.passed) {
        const checks = seal.tests === 0 ? 'Settles cleanly' : `${seal.passedTests} of ${seal.tests} check${seal.tests === 1 ? '' : 's'}`;
        return { title: 'Proved', detail: `${checks}${sim}` };
    }
    const failed = Math.max(0, seal.tests - seal.passedTests);
    return { title: 'Not proved yet', detail: `${failed > 0 ? `${failed} of ${seal.tests} check${seal.tests === 1 ? '' : 's'} failed` : 'Physics problems found'}${sim}` };
}
/** The seal (renders nothing when there is none). */
export const ProofSeal = memo(function ProofSeal() {
    const studio = useStudio();
    const seal = useUI((s) => s.proofSeal);
    const playing = useUI((s) => s.mode === 'play');
    const id = seal?.id ?? 0;
    useEffect(() => {
        if (id === 0)
            return;
        let t;
        // Stays while its replay runs, then dismisses itself.
        const expire = () => {
            if (studio.simulation?.renderer.proofActive) {
                t = setTimeout(expire, 1000);
                return;
            }
            const cur = studio.store.getState().proofSeal;
            if (cur?.id === id)
                studio.store.getState().setProofSeal(null);
        };
        t = setTimeout(expire, SEAL_SECONDS * 1000);
        return () => clearTimeout(t);
    }, [id, studio]);
    if (!seal || playing)
        return null;
    const { title, detail } = sealText(seal);
    return (_jsxs("div", { className: `proof-seal${seal.passed ? ' is-passed' : ' is-failed'}`, role: "status", "aria-live": "polite", "data-testid": "proof-seal", "data-kind": seal.kind ?? 'physics', children: [_jsx("span", { className: "proof-seal__mark", "aria-hidden": "true", children: seal.passed ? (_jsxs("svg", { viewBox: "0 0 40 40", width: "40", height: "40", focusable: "false", children: [_jsx("circle", { className: "proof-seal__ring", cx: "20", cy: "20", r: "17", pathLength: "1" }), _jsx("circle", { className: "proof-seal__ticks", cx: "20", cy: "20", r: "13.5", pathLength: "1" }), _jsx("path", { className: "proof-seal__check", d: "M13 20.5l5 5 9-10", pathLength: "1" })] })) : (_jsx(Icon, { name: "alert", size: 18 })) }), _jsxs("span", { className: "proof-seal__text", children: [_jsx("span", { className: "proof-seal__title", children: title }), _jsx("span", { className: "proof-seal__detail", children: detail })] }), seal.passed && seal.replay ? (_jsx("button", { type: "button", className: "proof-seal__btn", onClick: () => (seal.kind === 'playtest' ? void studio.playtest.startReplay() : void studio.presentProof()), "aria-label": seal.kind === 'playtest' ? "Replay the bot's run" : 'Replay the physics proof', "data-tip": seal.kind === 'playtest' ? "Watch the bot's run again" : 'Replay the proof', children: _jsx(Icon, { name: "refresh" }) })) : !seal.passed ? (_jsx("button", { type: "button", className: "proof-seal__btn proof-seal__btn--text", onClick: () => studio.store.getState().showLeftView('verify'), children: "Details" })) : null, _jsx("button", { type: "button", className: "proof-seal__btn", onClick: () => studio.dismissProof(), "aria-label": "Dismiss the proof seal", children: _jsx(Icon, { name: "x" }) })] }, seal.id));
});
