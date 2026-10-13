/**
 * React bindings for app-level services: the app store, the projects
 * repository (opened asynchronously — IndexedDB, or an in-memory fallback
 * when the browser blocks it) and navigation.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { parseRoute, routeHash, type Route } from '../lib/router';
import { MemoryBackend } from '../projects/backend';
import { IdbBackend } from '../projects/idb';
import { ProjectRepo } from '../projects/repo';
import { migrateLegacyWorld } from '../projects/migrate';
import { browserStorage } from '../lib/storage';
import { createLogger } from '../lib/log';
import type { AppState } from './appStore';

const log = createLogger('app');

/** App services handed to the tree. */
export interface AppServices {
  store: StoreApi<AppState>;
  /** Null until the projects database is open. */
  repo: ProjectRepo | null;
  /** Go to a route (adds a browser history entry unless `replace`). */
  navigate(route: Route, opts?: { replace?: boolean }): void;
}

const AppContext = createContext<AppServices | null>(null);

/** Open the projects repository: IndexedDB, or memory when unavailable; migrates the legacy saved world once. */
export async function openRepo(): Promise<ProjectRepo> {
  let repo: ProjectRepo;
  try {
    repo = new ProjectRepo(await IdbBackend.open());
  } catch (err) {
    log.warn('IndexedDB unavailable; projects will not persist', err);
    repo = new ProjectRepo(new MemoryBackend());
  }
  try {
    await migrateLegacyWorld(browserStorage(), repo);
  } catch (err) {
    log.warn('legacy world migration failed', err);
  }
  return repo;
}

/** Navigate by hash. */
export function navigateTo(route: Route, opts: { replace?: boolean } = {}): void {
  const hash = routeHash(route);
  if (opts.replace) location.replace(hash);
  else if (location.hash !== hash) location.hash = hash;
}

/** Provide app services; keeps `route` in sync with `location.hash`. */
export function AppProvider({ store, repoPromise, children }: { store: StoreApi<AppState>; repoPromise: Promise<ProjectRepo>; children: ReactNode }): ReactNode {
  const [repo, setRepo] = useState<ProjectRepo | null>(null);
  useEffect(() => {
    let live = true;
    void repoPromise.then((r) => {
      if (live) setRepo(r);
    });
    return () => {
      live = false;
    };
  }, [repoPromise]);
  useEffect(() => {
    const onHash = (): void => store.getState().setRoute(parseRouteSafe());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [store]);
  const value = useMemo<AppServices>(() => ({ store, repo, navigate: navigateTo }), [store, repo]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

function parseRouteSafe(): Route {
  return parseRoute(typeof location !== 'undefined' ? location.hash : '');
}

/** App services. */
export function useApp(): AppServices {
  const s = useContext(AppContext);
  if (!s) throw new Error('useApp must be used inside <AppProvider>');
  return s;
}

/** Select a slice of app state. */
export function useAppState<T>(selector: (s: AppState) => T): T {
  return useStore(useApp().store, selector);
}
