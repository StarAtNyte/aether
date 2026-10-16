import { jsx as _jsx } from "react/jsx-runtime";
/**
 * React bindings for the Studio controller: context, store selector hook,
 * and History subscriptions (`useWorld`, `useHistoryState`).
 */
import { createContext, useContext, useMemo, useSyncExternalStore } from 'react';
import { useStore } from 'zustand';
const StudioContext = createContext(null);
/** Provide the studio controller to the tree. */
export function StudioProvider({ studio, children }) {
    return _jsx(StudioContext.Provider, { value: studio, children: children });
}
/** The studio controller. */
export function useStudio() {
    const s = useContext(StudioContext);
    if (!s)
        throw new Error('useStudio must be used inside <StudioProvider>');
    return s;
}
/** Select a slice of UI state (re-renders only when the slice changes by `Object.is`). */
export function useUI(selector) {
    return useStore(useStudio().store, selector);
}
/** The current world document (re-renders on every history change). */
export function useWorld() {
    const { history } = useStudio();
    return useSyncExternalStore((fn) => history.subscribe(fn), () => history.current);
}
/**
 * History metadata, recomputed only when the history changes. Pass a bumped
 * `revision` after operations that do not emit a change (e.g. `branch`).
 */
export function useHistoryState(revision = 0) {
    const { history } = useStudio();
    const world = useWorld();
    const head = useSyncExternalStore((fn) => history.subscribe(fn), () => history.head);
    const branch = useSyncExternalStore((fn) => history.subscribe(fn), () => history.currentBranch());
    return useMemo(() => ({ head, canUndo: history.canUndo(), canRedo: history.canRedo(), entries: history.entries(), branches: history.branches(), branch }), 
    // `world` and `head` change on every commit/undo/redo/checkout.
    [history, world, head, branch, revision]);
}
/** The simulation once the viewport is ready (null before). */
export function useSimulation() {
    const studio = useStudio();
    return useSyncExternalStore((fn) => studio.onSimulation(fn), () => studio.simulation);
}
