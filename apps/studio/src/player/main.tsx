/**
 * Entry of the standalone player (`play.html`): published games and share
 * links. Only the runtime is bundled here — renderer, physics (lazy),
 * logic, the block game and the player UI; no editor and no agent code.
 */
// Evaluated first: core configures zod (jitless) before any schema is defined.
import '@aether/core';
import { createRoot } from 'react-dom/client';
import './player.css';
import { PlayerApp } from './PlayerApp';
import { registerOfflineCache } from './offline';

const root = document.getElementById('player');
if (root) createRoot(root).render(<PlayerApp />);
registerOfflineCache();
