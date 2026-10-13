/**
 * Aether Studio entry point: creates the Studio controller, exposes a debug
 * handle for e2e tests (dev builds or `?debug=1`), and mounts React.
 */
// Evaluated first: core configures zod (jitless) before any module defines a schema,
// so the strict CSP never sees zod's `new Function` probe.
import '@aether/core';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/app.css';
import { App } from './App';
import { StudioProvider } from './app/context';
import { Studio } from './engine/Studio';

declare global {
  interface Window {
    /** Debug/e2e handle (dev builds or `?debug=1` only). */
    __aether?: { readonly history: Studio['history']; readonly simulation: Studio['simulation']; readonly store: Studio['store']; readonly studio: Studio };
  }
}

function debugEnabled(): boolean {
  try {
    return import.meta.env.DEV || new URLSearchParams(location.search).get('debug') === '1';
  } catch {
    return false;
  }
}

const studio = new Studio();
void studio.boot();

if (debugEnabled()) {
  window.__aether = {
    studio,
    get history() {
      return studio.history;
    },
    get simulation() {
      return studio.simulation;
    },
    get store() {
      return studio.store;
    },
  };
}

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <StudioProvider studio={studio}>
        <App />
      </StudioProvider>
    </StrictMode>,
  );
}
