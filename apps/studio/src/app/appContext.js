import { jsx as _jsx } from "react/jsx-runtime";
/**
 * React bindings for app-level services: the app store, the projects
 * repository (opened asynchronously — IndexedDB, or an in-memory fallback
 * when the browser blocks it) and navigation.
 */
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';
import { parseRoute, routeHash } from '../lib/router';
import { MemoryBackend } from '../projects/backend';
import { IdbBackend } from '../projects/idb';
import { ProjectRepo } from '../projects/repo';
import { migrateLegacyWorld } from '../projects/migrate';
import { browserStorage } from '../lib/storage';
import { createLogger } from '../lib/log';
const log = createLogger('app');
const AppContext = createContext(null);
/** Open the projects repository: IndexedDB, or memory when unavailable; migrates the legacy saved world once. */
export async function openRepo() {
    let repo;
    try {
        repo = new ProjectRepo(await IdbBackend.open());
    }
    catch (err) {
        log.warn('IndexedDB unavailable; projects will not persist', err);
        repo = new ProjectRepo(new MemoryBackend());
    }
    try {
        await migrateLegacyWorld(browserStorage(), repo);
    }
    catch (err) {
        log.warn('legacy world migration failed', err);
    }
    return repo;
}
/** Navigate by hash. */
export function navigateTo(route, opts = {}) {
    const hash = routeHash(route);
    if (opts.replace)
        location.replace(hash);
    else if (location.hash !== hash)
        location.hash = hash;
}
/** Provide app services; keeps `route` in sync with `location.hash`. */
export function AppProvider({ store, repoPromise, children }) {
    const [repo, setRepo] = useState(null);
    useEffect(() => {
        let live = true;
        void repoPromise.then((r) => {
            if (live)
                setRepo(r);
        });
        return () => {
            live = false;
        };
    }, [repoPromise]);
    useEffect(() => {
        const onHash = () => store.getState().setRoute(parseRouteSafe());
        window.addEventListener('hashchange', onHash);
        return () => window.removeEventListener('hashchange', onHash);
    }, [store]);
    const value = useMemo(() => ({ store, repo, navigate: navigateTo }), [store, repo]);
    return _jsx(AppContext.Provider, { value: value, children: children });
}
function parseRouteSafe() {
    return parseRoute(typeof location !== 'undefined' ? location.hash : '');
}
/** App services. */
export function useApp() {
    const s = useContext(AppContext);
    if (!s)
        throw new Error('useApp must be used inside <AppProvider>');
    return s;
}
/** Select a slice of app state. */
export function useAppState(selector) {
    return useStore(useApp().store, selector);
}
