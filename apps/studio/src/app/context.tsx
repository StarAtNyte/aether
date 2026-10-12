/**
 * React bindings for the Studio controller: context, store selector hook,
 * and History subscriptions (`useWorld`, `useHistoryState`).
 */
import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { useStore } from 'zustand';
import type { HistoryEntryInfo, WorldDoc } from '@aether/core';
import type { Studio } from '../engine/Studio';
import type { Simulation } from '../engine/Simulation';
import type { StudioState } from '../state/store';

const StudioContext = createContext<Studio | null>(null);

/** Provide the studio controller to the tree. */
export function StudioProvider({ studio, children }: { studio: Studio; children: ReactNode }): ReactNode {
  return <StudioContext.Provider value={studio}>{children}</StudioContext.Provider>;
}

/** The studio controller. */
export function useStudio(): Studio {
  const s = useContext(StudioContext);
  if (!s) throw new Error('useStudio must be used inside <StudioProvider>');
  return s;
}

/** Select a slice of UI state (re-renders only when the slice changes by `Object.is`). */
export function useUI<T>(selector: (s: StudioState) => T): T {
  return useStore(useStudio().store, selector);
}

/** The current world document (re-renders on every history change). */
export function useWorld(): WorldDoc {
  const { history } = useStudio();
  return useSyncExternalStore(
    (fn) => history.subscribe(fn),
    () => history.current,
  );
}

/** History metadata for undo/redo buttons and the timeline. */
export interface HistoryState {
  head: number;
  canUndo: boolean;
  canRedo: boolean;
  entries: ReadonlyArray<HistoryEntryInfo>;
  branches: string[];
  branch: string;
}

/**
 * History metadata, recomputed only when the history changes. Pass a bumped
 * `revision` after operations that do not emit a change (e.g. `branch`).
 */
export function useHistoryState(revision = 0): HistoryState {
  const { history } = useStudio();
  const world = useWorld();
  const head = useSyncExternalStore(
    (fn) => history.subscribe(fn),
    () => history.head,
  );
  const branch = useSyncExternalStore(
    (fn) => history.subscribe(fn),
    () => history.currentBranch(),
  );
  return useMemo(
    () => ({ head, canUndo: history.canUndo(), canRedo: history.canRedo(), entries: history.entries(), branches: history.branches(), branch }),
    // `world` and `head` change on every commit/undo/redo/checkout.
    [history, world, head, branch, revision],
  );
}

/** The simulation once the viewport is ready (null before). */
export function useSimulation(): Simulation | null {
  const studio = useStudio();
  return useSyncExternalStore(
    (fn) => studio.onSimulation(fn),
    () => studio.simulation,
  );
}
