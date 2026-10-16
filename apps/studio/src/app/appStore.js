/**
 * App-level state shared by the home dashboard and the editor: the current
 * route, the persisted settings (theme first of all), home-page toasts and
 * the command palette. The editor keeps its own per-project store
 * (`state/store.ts`); settings changed there are mirrored here.
 */
import { createStore } from 'zustand/vanilla';
import { MAX_TOASTS } from '../config';
import { parseRoute } from '../lib/router';
import { browserStorage, loadSettings, saveSettings, systemPrefersDark } from '../lib/storage';
/** Create the app store. */
export function createAppStore(opts = {}) {
    const storage = opts.storage === undefined ? browserStorage() : opts.storage;
    let nextToast = 1;
    return createStore()((set) => ({
        route: parseRoute(opts.hash ?? (typeof location !== 'undefined' ? location.hash : '')),
        settings: loadSettings(storage, opts.prefersDark ?? systemPrefersDark()),
        toasts: [],
        paletteOpen: false,
        newProjectOpen: false,
        setRoute: (route) => set({ route }),
        updateSettings: (patch) => set((s) => {
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
