/**
 * Play in a walkthrough world starts the human character at the world's spawn. Arch compiles used to put that spawn at
 * y = 0.1 with the ground-floor slab's top at the plinth (0.15 to 0.3 m): the capsule started sunk in the slab, and the
 * controller ground in place under forward input until a jump lifted it out. On the exact shipped world files and their real
 * colliders (generators in the node sandbox), every walkthrough template must:
 *
 * - keep its document spawn out of the geometry (the headless runs use it as is),
 * - settle (as the live game does) to a spot whose capsule is free and on a floor,
 * - walk away from it under forward input alone, without a jump.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateWorld, type WorldDoc } from '@aether/core';
import { CHARACTER_FEEL, CharacterController, initPhysics, PhysicsWorld, settledSpawn } from '@aether/physics';
import { PLAYER_CAPSULE } from '@aether/playtest';
import { worldColliderProvider } from '@aether/procgen';
import { createNodeSandbox } from '@aether/procgen/node';
import { beforeAll, describe, expect, it } from 'vitest';
import { TEMPLATE_PUBLISH } from '../src/showcase/publish';

const fileOf = (slug: string): string => fileURLToPath(new URL(`../public/templates/worlds/${slug}.json`, import.meta.url));
const SLUGS = Object.entries(TEMPLATE_PUBLISH)
  .filter(([, p]) => p.profile === 'walkthrough')
  .map(([slug]) => slug)
  .filter((slug) => existsSync(fileOf(slug)));

function savedWorld(slug: string): WorldDoc {
  const r = validateWorld((JSON.parse(readFileSync(fileOf(slug), 'utf8')) as { world: unknown }).world);
  if (!r.ok) throw new Error(`${slug}: invalid saved world`);
  return r.world;
}

beforeAll(async () => {
  await initPhysics();
});

const DT = 1 / 60;
/** Bottom band of the capsule allowed to touch the floor (m). */
const TOUCH = 0.005;

describe('walkthrough templates', () => {
  it('are listed', () => {
    expect(SLUGS.length).toBeGreaterThanOrEqual(10);
    expect(SLUGS).toContain('casa-patio');
  });
});

describe.each(SLUGS)('%s: Play from the spawn', (slug) => {
  it('starts out of the geometry and walks away on forward input alone', async () => {
    const world = savedWorld(slug);
    const sandbox = createNodeSandbox({ timeoutMs: 60_000 });
    let pw: PhysicsWorld | null = null;
    try {
      pw = await PhysicsWorld.create(world, { colliders: await worldColliderProvider(world, sandbox) });
      const { radius, height } = PLAYER_CAPSULE;
      const spawn = world.player.spawn;
      expect(pw.capsuleFree(spawn, radius, height, TOUCH), `${slug}: the document spawn ${spawn.join(', ')} is inside geometry`).toBe(true);
      // Where the live game stands the character (CharacterOptions.settleSpawn), tested before the capsule is in the world.
      const settled = settledSpawn(pw, spawn, radius, height);
      expect(pw.capsuleFree(settled, radius, height, TOUCH), `${slug}: the settled spawn ${settled.join(', ')} is inside geometry`).toBe(true);
      const speed = world.player.moveSpeed;
      const best: number[] = [];
      for (const yawDeg of [world.player.yaw ?? 0, 0, 45, 90, 135, 180, 225, 270, 315]) {
        const ch = new CharacterController(pw, { radius, height, spawn, feel: CHARACTER_FEEL, settleSpawn: true });
        try {
          const start = ch.position;
          expect(start).toEqual(settled);
          for (let i = 0; i < 90; i++) {
            ch.move({ forward: 1, right: 0, jump: false, yawDeg }, DT, speed, world.player.jumpSpeed);
            pw.stepFixed();
          }
          const end = ch.position;
          best.push(Math.hypot(end[0] - start[0], end[2] - start[2]));
        } finally {
          ch.dispose();
        }
      }
      // Facing the way the world opens, the first steps go somewhere (not grinding in place); some heading walks freely.
      expect(best[0], `${slug}: forward from the spawn moved ${best[0]?.toFixed(2)} m`).toBeGreaterThan(0.4);
      expect(Math.max(...best), `${slug}: best walk from the spawn ${Math.max(...best).toFixed(2)} m`).toBeGreaterThan(speed * 1.5 * 0.6);
    } finally {
      pw?.dispose();
      sandbox.dispose();
    }
  }, 180_000);
});
