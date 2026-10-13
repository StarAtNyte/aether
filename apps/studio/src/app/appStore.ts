/**
 * App-level state shared by the home dashboard and the editor: the current
 * route, the persisted settings (theme first of all), home-page toasts and
 * the command palette. The editor keeps its own per-project store
 * (`state/store.ts`); settings changed there are mirrored here.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import { MAX_TOASTS } from '../config';
import { parseRoute, type Route } from '../lib/router';
import { browserStorage, loadSettings, saveSettings, systemPrefersDark, type StorageLike, type StudioSettings } from '../lib/storage';

/** Action button of a toast (e.g. "Undo"). */
export interface ToastAction {
  label: string;
  run: () => void;
}

/** A transient notification. */
export interface AppToast {
  id: number;
  kind: 'info' | 'success' | 'error' | 'game';
  text: string;
  duration: number;
  action?: ToastAction;
}

/** App state + actions. */
export interface AppState {
  route: Route;
  settings: StudioSettings;
  toasts: AppToast[];
  paletteOpen: boolean;
  /** Home: "New project" dialog open. */
  newProjectOpen: boolean;
  setRoute(route: Route): void;
  updateSettings(patch: Partial<StudioSettings>): void;
  /** Replace settings without writing them (mirrored from the editor, which already saved). */
  mirrorSettings(settings: StudioSettings): void;
  toast(text: string, kind?: AppToast['kind'], duration?: number, action?: ToastAction): number;
  dismissToast(id: number): void;
  setPaletteOpen(open: boolean): void;
  setNewProjectOpen(open: boolean): void;
}

/** Create the app store. */
export function createAppStore(opts: { storage?: StorageLike | null; hash?: string; prefersDark?: boolean } = {}): StoreApi<AppState> {
  const storage = opts.storage === undefined ? browserStorage() : opts.storage;
  let nextToast = 1;
  return createStore<AppState>()((set) => ({
    route: parseRoute(opts.hash ?? (typeof location !== 'undefined' ? location.hash : '')),
    settings: loadSettings(storage, opts.prefersDark ?? systemPrefersDark()),
    toasts: [],
    paletteOpen: false,
    newProjectOpen: false,
    setRoute: (route) => set({ route }),
    updateSettings: (patch) =>
      set((s) => {
        const settings = { ...s.settings, ...patch };
        saveSettings(storage, settings);
        return { settings };
      }),
    mirrorSettings: (settings) => set({ settings }),
    toast: (text, kind = 'info', duration = 4, action) => {
      const id = nextToast++;
      const d = Number.isFinite(duration) ? Math.min(Math.max(duration, 1), 30) : 4;
      set((s) => {
        const toasts = [...s.toasts, { id, kind, text: text.slice(0, 240), duration: d, ...(action ? { action } : {}) }];
        return { toasts: toasts.length > MAX_TOASTS ? toasts.slice(toasts.length - MAX_TOASTS) : toasts };
      });
      return id;
    },
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
    setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
    setNewProjectOpen: (newProjectOpen) => set({ newProjectOpen }),
  }));
}
