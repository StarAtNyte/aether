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
import { App } from './App';
import { AppProvider, openRepo } from './app/appContext';
import { createAppStore } from './app/appStore';
import { applyTheme, themeFromSetting } from './lib/theme';
import { installTooltips } from './components/ui/tooltips';

const store = createAppStore();
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
