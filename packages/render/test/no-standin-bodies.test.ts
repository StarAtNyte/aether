import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Group, Mesh } from 'three';
import { createWorld } from '@aether/core';
import { GhostRun } from '../src/view/ghost-run';
import { replayWorld } from '../src/view/proof-replay';

/**
 * People are rigged, animated humans. A capsule or box drawn as a body must not
 * reach the screen, so the render sources may only build capsule geometry in
 * the places listed here, each with the reason it is not a character.
 */
const CAPSULE_ALLOWED: Record<string, string> = {
  // The offline fallback of the player's own avatar when the character files cannot load (never an NPC or a ghost).
  'view/avatar.ts': 'player fallback body, hidden as soon as the rigged person mounts',
};

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('no capsule stand-in bodies', () => {
  const root = join(__dirname, '../src');
  it('builds CapsuleGeometry only where it is a documented non-character', () => {
    const found = walk(root)
      .filter((f) => /\bnew CapsuleGeometry\b/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(root.length + 1).replace(/\\/g, '/'));
    expect(found.filter((f) => !(f in CAPSULE_ALLOWED))).toEqual([]);
  });

  it('draws the replay ghost with no capsule, only the marker ring and heading cone', () => {
    const ghost = new GhostRun();
    const g: Group = ghost.group;
    const geos: string[] = [];
    g.traverse((o) => {
      if ((o as Mesh).isMesh) geos.push(((o as Mesh).geometry as { type: string }).type);
    });
    expect(geos.sort()).toEqual(['ConeGeometry', 'RingGeometry']);
    ghost.dispose();
  });

  it('leaves people out of the proof replay ghosts (their capsule collider is never drawn)', () => {
    const world = createWorld({
      entities: {
        mira: { id: 'mira', name: 'Mira', shape: { kind: 'primitive', primitive: 'capsule', size: [0.7, 1.7, 0.7] }, physics: { body: 'kinematic' }, character: { wardrobe: 'merchant' }, npc: { role: 'shopkeeper' } },
        guard: { id: 'guard', name: 'town guard', tags: ['guard'], shape: { kind: 'primitive', primitive: 'capsule', size: [0.7, 1.7, 0.7] }, physics: { body: 'kinematic' } },
        ball: { id: 'ball', shape: { kind: 'primitive', primitive: 'sphere', size: [1, 1, 1] }, physics: { body: 'dynamic' } },
      },
    });
    expect(Object.keys(replayWorld(world, ['mira', 'guard', 'ball']).entities)).toEqual(['ball']);
  });
});
