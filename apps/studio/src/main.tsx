/**
 * Aether Studio entry point: app store (route, settings), the projects
 * repository (IndexedDB, opened in the background) and the React tree.
 * The theme was already applied before first paint by `/theme-boot.js`.
 */
// Evaluated first: core configures zod (jitless) before any module defines a schema,
// so the strict CSP never sees zod's `new Function` probe.
import '@aether/core';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/base.css';
import './styles/controls.css';
import './styles/editor.css';
import './styles/panels.css';
import './styles/home.css';
import './styles/editing.css';
import { App } from './App';
import { AppProvider, openRepo } from './app/appContext';
import { createAppStore } from './app/appStore';
import { applyTheme, themeFromSetting } from './lib/theme';
import { installTooltips } from './components/ui/tooltips';
import { extractBridgeLink } from './ai/deepLink';

// A bridge pairing deep link is removed from the address bar before anything else reads it.
const bridgeLink = extractBridgeLink(location.href);
if (bridgeLink.link) history.replaceState(history.state, '', bridgeLink.clean);

const store = createAppStore();
if (bridgeLink.link) {
  const link = bridgeLink.link;
  void Promise.all([import('./ai/session'), import('./ai/connection')]).then(([session, connection]) => {
    const pairing = session.validateBridgeLink(link);
    if (!pairing) {
      store.getState().toast('That bridge link is not valid. Pair with the code instead (Settings → AI connection).', 'error', 8);
      return;
    }
    const ai = connection.aiConnection();
    ai.adoptPairing(pairing);
    void ai.refreshBridge().then(() => {
      const st = ai.store.getState().bridge;
      store.getState().toast(st.state === 'ready' ? 'Paired with the local bridge.' : `Bridge paired: ${st.detail || st.state}`, st.state === 'ready' ? 'success' : 'info', 6);
    });
  });
}
installTooltips(document);
applyTheme(document, themeFromSetting(store.getState().settings.darkTheme));
const repoPromise = openRepo();

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <AppProvider store={store} repoPromise={repoPromise}>
        <App />
      </AppProvider>
    </StrictMode>,
  );
}
