/**
 * The three-step editor tour: describe → proved → play. Shown once, the
 * first time an editor opens (after the first-run AI screen is answered);
 * dismissible at any step and replayable from the command palette. The
 * "seen" marker lives in localStorage (`aether.tour.v1`) and is validated
 * on read. Pure helpers are exported for tests.
 */
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { readJson, writeJson } from '../lib/storage';
/** localStorage key of the "tour seen" marker. */
export const TOUR_KEY = 'aether.tour.v1';
/** The steps, in order. */
export const TOUR_STEPS = Object.freeze([
    { id: 'describe', title: 'Describe a world', body: 'Type what you imagine, in plain words. The agent plans it, builds it and keeps every change undoable.', anchor: '#prompt-input' },
    { id: 'prove', title: 'Watch it get proved', body: 'Each world is simulated headless and its physics checked. A ghost replay shows what will happen, then the seal lands.', anchor: '.viewport .pill--button' },
    { id: 'play', title: 'Press Play', body: 'Walk, drive or play the world you described. Esc brings you back to editing, exactly where you were.', anchor: '.play-btn' },
]);
/** True when the tour was already seen (or dismissed). */
export function tourSeen(storage) {
    const v = readJson(storage, TOUR_KEY);
    return typeof v === 'object' && v !== null && !Array.isArray(v) && v['done'] === true;
}
/** Remember that the tour was seen. */
export function markTourSeen(storage, now = Date.now()) {
    writeJson(storage, TOUR_KEY, { done: true, at: Math.max(0, Math.floor(now)) });
}
/** Side of the anchor the card goes on, for an anchor rect in a viewport. Pure. */
export function cardPlacement(anchor, view, card, gap = 12) {
    const clampX = (x) => Math.max(gap, Math.min(view.width - card.width - gap, x));
    const clampY = (y) => Math.max(gap, Math.min(view.height - card.height - gap, y));
    if (!anchor || anchor.width <= 0 || anchor.height <= 0 || anchor.left > view.width || anchor.top > view.height || anchor.left + anchor.width < 0 || anchor.top + anchor.height < 0) {
        return { left: clampX((view.width - card.width) / 2), top: clampY((view.height - card.height) / 2), side: 'center' };
    }
    const right = anchor.left + anchor.width + gap;
    if (right + card.width + gap <= view.width)
        return { left: right, top: clampY(anchor.top + anchor.height / 2 - card.height / 2), side: 'right' };
    const below = anchor.top + anchor.height + gap;
    if (below + card.height + gap <= view.height)
        return { left: clampX(anchor.left + anchor.width / 2 - card.width / 2), top: below, side: 'below' };
    const above = anchor.top - gap - card.height;
    if (above >= gap)
        return { left: clampX(anchor.left + anchor.width / 2 - card.width / 2), top: above, side: 'above' };
    const left = anchor.left - gap - card.width;
    if (left >= gap)
        return { left, top: clampY(anchor.top + anchor.height / 2 - card.height / 2), side: 'left' };
    return { left: clampX((view.width - card.width) / 2), top: clampY((view.height - card.height) / 2), side: 'center' };
}
/** Page-wide tour store. */
export const tourStore = createStore()(() => ({ step: null }));
/** React access to the tour. */
export function useTour(selector) {
    return useStore(tourStore, selector);
}
/** Open the tour at the first step. */
export function startTour() {
    tourStore.setState({ step: 0 });
}
/** Close the tour and remember it. */
export function endTour(storage) {
    tourStore.setState({ step: null });
    markTourSeen(storage);
}
