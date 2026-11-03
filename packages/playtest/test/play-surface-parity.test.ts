/**
 * Play-surface parity, checked in the code: whatever game UI the studio's play mode shows (the weapon HUD, the score and
 * the best score, the win and lose screens, the title card, touch fire controls, the held start) the published player
 * (apps/studio/src/player/PlayerApp.tsx) must show too. A static read of the sources: each surface is found on the studio
 * side first (so a surface the studio drops is not demanded of the player), then looked for in the player.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../../../apps/studio/src/', import.meta.url));
const read = (path: string): string => readFileSync(SRC + path, 'utf8');

const studio = {
  viewport: read('components/viewport/Viewport.tsx'),
  hud: read('components/viewport/PlayHud.tsx'),
  engine: read('engine/Studio.ts'),
};
const sim = read('engine/Simulation.ts');
const player = read('player/PlayerApp.tsx');
const manifest = read('publish/manifest.ts');

/** The source of the callback `name` in `src` (`const name = useCallback(...)`), to the end of its dependency list. */
function body(src: string, name: string): string {
  const at = src.indexOf(`const ${name} = `);
  if (at < 0) return '';
  const end = src.indexOf('\n  }, [', at);
  return src.slice(at, end < 0 ? undefined : end);
}

describe('published player shows the game UI of studio play mode', () => {
  it('the weapon HUD (ammunition, reload, crosshair) of an armed player', () => {
    expect(studio.viewport).toMatch(/<CombatHud\b/);
    expect(player).toMatch(/<CombatHudView\b/);
    // Fed by the simulation's combat snapshots.
    expect(player).toMatch(/onCombat\s*:/);
  });

  it('the score with the best score on this device', () => {
    expect(studio.hud).toMatch(/<ScoreLine\b/);
    expect(studio.engine).toMatch(/recordScore\(/);
    expect(player).toMatch(/<ScoreLine\b/);
    expect(player).toMatch(/recordScore\(/);
  });

  it('the win and the lose screens, with a way to play again', () => {
    expect(studio.hud).toMatch(/You win!/);
    expect(studio.hud).toMatch(/Game over/);
    expect(player).toMatch(/onGameOver\s*:/);
    expect(player).toMatch(/You win!/);
    expect(player).toMatch(/Game over/);
    expect(player).toMatch(/Play again|Try again/);
  });

  it('the title card: the world intro\'s title, tagline, objective and controls', () => {
    expect(studio.hud).toMatch(/intro\.title/);
    for (const field of ['title', 'tagline', 'objective', 'controls']) {
      expect(studio.hud, `studio title card shows intro.${field}`).toMatch(new RegExp(`intro\\.${field}`));
      expect(manifest, `the player's title screen takes intro.${field}`).toMatch(new RegExp(`intro(\\?)?\\.${field}`));
    }
    expect(player).toMatch(/phase === 'title'/);
    expect(player).toMatch(/game\.title/);
    expect(player).toMatch(/game\.description/);
    expect(player).toMatch(/game\.controls/);
  });

  it('touch controls with a fire button for an armed player', () => {
    expect(read('components/viewport/TouchControls.tsx')).toMatch(/armed/);
    expect(player).toMatch(/<TouchControlsView\b[^>]*armed=/);
  });

  it('a held start: no welcome message or start rule runs while the title card is up', () => {
    // Shared by both surfaces: the session's logic starts when the hold is released, not when the session is built.
    const setHeld = sim.slice(sim.indexOf('setHeld(on: boolean)'), sim.indexOf('setHeld(on: boolean)') + 600);
    expect(setHeld).toMatch(/if \(!on\)[^\n]*logic\.start\(\)/);
    expect(sim).toMatch(/if \(!this\.held\)\s*session\.logic\.start\(\)/);
    // The player builds the session only when the player presses Play, so nothing runs under its title screen.
    expect(body(player, 'start')).toMatch(/sim\.(play|restart)\(\)/);
  });

  it('restart goes back to the title card when the world has one, as in the studio', () => {
    const studioRestart = studio.engine.slice(studio.engine.indexOf('async restart()'), studio.engine.indexOf('async restart()') + 600);
    expect(studioRestart).toMatch(/intro/);
    expect(studioRestart).toMatch(/setHeld\(intro\)/);
    // The player's restart (pause menu and the end screen's button) must also return to its title when there is an intro.
    const restart = body(player, 'restart');
    expect(restart, 'PlayerApp restart() should go back to the title (or a short intro) when world.intro is set').toMatch(/intro[\s\S]*go\('title'\)|go\('title'\)[\s\S]*intro/);
  });
});
