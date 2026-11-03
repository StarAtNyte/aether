/**
 * Entry of the standalone player (`play.html`): published games and share
 * links. Only the runtime is bundled here — renderer, physics (lazy),
 * logic, the block game and the player UI; no editor and no agent code.
 */
// The page paints its own loading screen (play.html); the engine, renderer and player UI load after it.
// Evaluated first: core configures zod (jitless) before any schema is defined.
import '@aether/core';
import { registerOfflineCache } from './offline';

const root = document.getElementById('player');
if (root) {
  void Promise.all([import('react-dom/client'), import('react'), import('./PlayerApp'), import('./player.css'), import('../styles/npc.css'), import('../styles/combat.css')]).then(([dom, react, app]) => {
    root.replaceChildren();
    dom.createRoot(root).render(react.createElement(app.PlayerApp));
  });
}
registerOfflineCache();
