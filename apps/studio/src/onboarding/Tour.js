import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Tour coach marks: a small card beside the element each step is about,
 * with a soft ring around that element. Non-modal (the page stays usable:
 * nothing covers the controls, the ring ignores the pointer); Esc or "Skip"
 * ends it, Enter / → go on, ← goes back. Opens itself once per browser when
 * an editor is ready and the first-run AI screen is not showing.
 */
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStudio, useUI } from '../app/context';
import { browserStorage } from '../lib/storage';
import { isTypingTarget } from '../engine/input';
import { useFirstRun } from './firstRun';
import { cardPlacement, endTour, startTour, TOUR_STEPS, tourSeen, tourStore, useTour } from './tour';
/** Delay before the tour opens on its own (lets the world appear first). */
const AUTO_START_MS = 1600;
const CARD_W = 300;
/** Move the tour by `delta` steps (past the last step ends it). */
function go(delta) {
    const s = tourStore.getState().step;
    if (s === null)
        return;
    const n = s + delta;
    if (n >= TOUR_STEPS.length)
        endTour(browserStorage());
    else if (n >= 0)
        tourStore.setState({ step: n });
}
/** Auto-starts the tour for a first-time editor. */
function useAutoStart() {
    const studio = useStudio();
    const ready = useUI((s) => s.loading === null && s.fatal === null && !s.viewer);
    const busy = useUI((s) => s.agentBusy);
    const firstRunOpen = useFirstRun((s) => !s.ready || s.open);
    useEffect(() => {
        if (!ready || busy || firstRunOpen || tourStore.getState().step !== null || tourSeen(browserStorage()))
            return;
        const t = setTimeout(() => {
            const st = studio.store.getState();
            if (st.mode === 'edit' && !st.agentBusy && !st.paletteOpen && !st.settingsOpen && !document.querySelector('dialog[open]') && !isTypingTarget(document.activeElement))
                startTour();
        }, AUTO_START_MS);
        return () => clearTimeout(t);
    }, [ready, busy, firstRunOpen, studio]);
}
/** The tour (renders nothing while closed). */
export const Tour = memo(function Tour() {
    useAutoStart();
    const step = useTour((s) => s.step);
    const playing = useUI((s) => s.mode === 'play');
    const cardRef = useRef(null);
    const nextRef = useRef(null);
    const [rect, setRect] = useState(null);
    const [pos, setPos] = useState({ left: -9999, top: 0, side: 'center' });
    const current = step === null ? null : TOUR_STEPS[step];
    // Follow the anchor (layout changes, panel toggles, resizes): cheap rect reads at 4 Hz while open.
    useLayoutEffect(() => {
        if (!current)
            return;
        const measure = () => {
            const found = document.querySelector(current.anchor);
            // A field is highlighted with its whole control (the composer around the prompt).
            const el = found?.closest('.composer') ?? found;
            const r = el instanceof HTMLElement && el.offsetParent !== null ? el.getBoundingClientRect() : null;
            setRect((prev) => (prev && r && prev.x === r.x && prev.y === r.y && prev.width === r.width && prev.height === r.height ? prev : r));
            const card = cardRef.current;
            const size = { width: card?.offsetWidth ?? CARD_W, height: card?.offsetHeight ?? 160 };
            const p = cardPlacement(r, { width: window.innerWidth, height: window.innerHeight }, size);
            setPos((prev) => (prev.left === p.left && prev.top === p.top && prev.side === p.side ? prev : p));
        };
        measure();
        const id = window.setInterval(measure, 250);
        window.addEventListener('resize', measure);
        return () => {
            window.clearInterval(id);
            window.removeEventListener('resize', measure);
        };
    }, [current]);
    useEffect(() => {
        if (current)
            nextRef.current?.focus({ preventScroll: true });
    }, [current]);
    useEffect(() => {
        if (step === null)
            return;
        const onKey = (e) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                endTour(browserStorage());
                return;
            }
            // Arrow keys only when focus is inside the card (never steal them from fields or the viewport).
            if (!cardRef.current?.contains(document.activeElement))
                return;
            if (e.key === 'ArrowRight') {
                e.preventDefault();
                go(1);
            }
            else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                go(-1);
            }
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [step]);
    if (step === null || !current || playing)
        return null;
    const last = step === TOUR_STEPS.length - 1;
    return createPortal(_jsxs(_Fragment, { children: [rect && _jsx("span", { className: "tour-ring", "aria-hidden": "true", style: { left: rect.left - 4, top: rect.top - 4, width: rect.width + 8, height: rect.height + 8 } }), _jsxs("section", { ref: cardRef, className: `tour-card is-${pos.side}`, "aria-label": "Quick tour", "aria-live": "polite", style: { left: pos.left, top: pos.top, width: CARD_W }, "data-testid": "tour", children: [_jsxs("span", { className: "tour-card__step", children: ["Step ", step + 1, " of ", TOUR_STEPS.length] }), _jsx("h2", { className: "tour-card__title", children: current.title }), _jsx("p", { className: "tour-card__body", children: current.body }), _jsxs("div", { className: "tour-card__bar", children: [_jsx("span", { className: "tour-card__dots", "aria-hidden": "true", children: TOUR_STEPS.map((s, i) => (_jsx("span", { className: `tour-card__dot${i === step ? ' is-on' : ''}` }, s.id))) }), _jsx("button", { type: "button", className: "btn btn--ghost btn--sm", onClick: () => endTour(browserStorage()), children: "Skip" }), step > 0 && (_jsx("button", { type: "button", className: "btn btn--sm", onClick: () => go(-1), children: "Back" })), _jsx("button", { ref: nextRef, type: "button", className: "btn btn--primary btn--sm", onClick: () => go(1), children: last ? 'Done' : 'Next' })] })] })] }), document.body);
});
