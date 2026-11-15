/**
 * Entry of the standalone player (`play.html`): published games and share
 * links. Only the runtime is bundled here — renderer, physics (lazy),
 * logic, the block game and the player UI; no editor and no agent code.
 */
// The page paints its own loading screen (play.html); the engine, renderer and player UI load after it.
// Evaluated first: zod is configured (jitless, no `new Function` under the CSP) before any schema is defined. Only the
// configuration, not the whole of core: core's schemas are shared with the player chunk, so a bare `import '@aether/core'`
// here put every one of them (about 43 kB gzip) in the shell's first download.
import '@aether/core/zod-config';
import { registerOfflineCache } from './offline';
import { installStaleDeployReload } from '../components/staleDeploy';

// A deploy that replaced the files under an open page: reload once into the new build.
installStaleDeployReload();

const root = document.getElementById('player');
if (root) {
  void Promise.all([import('react-dom/client'), import('react'), import('./PlayerApp'), import('./player.css'), import('../styles/npc.css'), import('../styles/combat.css')]).then(([dom, react, app]) => {
    root.replaceChildren();
    dom.createRoot(root).render(react.createElement(app.PlayerApp));
  });
}
registerOfflineCache();
