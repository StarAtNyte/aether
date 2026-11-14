/**
 * Sanctuary Falls is walked on foot from Play: from the quay up the grand stair, through the opened stair head onto
 * the rim promenade, up the terrace steps to the temple, and down the shelf stairs to every villa door. This builds the
 * walking map from the shipped world's real colliders (the custom generators run in the node sandbox) with walk edges
 * only (no jumps, no drops) and asserts each place is reached from the spawn.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateWorld, type Vec3 } from '@aether/core';
import { initPhysics, PhysicsWorld } from '@aether/physics';
import { NavGraph } from '@aether/playtest';
import { worldColliderProvider } from '@aether/procgen';
import { createNodeSandbox } from '@aether/procgen/node';
import { beforeAll, describe, expect, it } from 'vitest';

const text = readFileSync(fileURLToPath(new URL('../public/templates/worlds/sanctuary-falls.json', import.meta.url)), 'utf8');
const checked = validateWorld((JSON.parse(text) as { world: unknown }).world);
if (!checked.ok) throw new Error('sanctuary-falls: invalid saved world');
const world = checked.world;

beforeAll(async () => {
  await initPhysics();
});

/** The spot in front of a villa's door: the cliff-villa facade (and its door) faces local +Z. */
function doorFront(id: string): Vec3 {
  const e = world.entities[id];
  if (!e || e.shape.kind !== 'procedural') throw new Error(id);
  const depth = Number((e.shape.params as Record<string, unknown>)['depth'] ?? 5.5);
  const yaw = (e.transform.rotation[1] * Math.PI) / 180;
  const [x, y, z] = e.transform.position;
  const d = depth / 2 + 1.2;
  return [x + Math.sin(yaw) * d, y, z + Math.cos(yaw) * d];
}

describe('Sanctuary Falls on foot', () => {
  it('walks (no jumping) from the spawn to the top of the grand stair, the temple and every villa door', async () => {
    const sandbox = createNodeSandbox({ timeoutMs: 60_000 });
    let pw: PhysicsWorld | null = null;
    try {
      pw = await PhysicsWorld.create(world, { colliders: await worldColliderProvider(world, sandbox) });
      const params = { radius: 0.35, height: 1.7, stepHeight: 0.35, maxSlopeDeg: 50, speed: world.player.moveSpeed, jumpSpeed: 0.01, gravity: 9.81 };
      const g = await NavGraph.build({ pw, minX: -75, maxX: 75, minZ: -100, maxZ: 45, topY: 90, bottomY: -3, params, hazards: [], noDrops: true });
      const sp = world.player.spawn;
      const start = g.nearest([sp[0], sp[1] - 0.6, sp[2]], 2.5, 3);
      expect(start).toBeGreaterThanOrEqual(0);
      const reach = new Uint8Array(g.count);
      reach[start] = 1;
      const queue = [start];
      while (queue.length > 0) {
        const u = queue.pop() as number;
        // Walk edges only: a jump or a drop is not a way for this check.
        g.forEachEdge(u, (v) => {
          if (reach[v] === 0 && g.edgeKind(u, v) === 0) {
            reach[v] = 1;
            queue.push(v);
          }
        });
      }
      const reached = (p: Vec3): boolean => {
        for (let k = 0; k < g.count; k++) if (reach[k] === 1 && Math.hypot((g.px[k] as number) - p[0], (g.pz[k] as number) - p[2]) < 1.5 && Math.abs((g.py[k] as number) - p[1]) < 1.2) return true;
        return false;
      };
      const places: Array<[string, Vec3]> = [
        ['grand stair top landing', [-18, 45.5, -25]],
        ['stair head step', [-18, 45.78, -29.2]],
        ['rim promenade', [-10, 46.05, -33]],
        ['temple stylobate', [0, 47.9, -43]],
        ...Object.values(world.entities).filter((e) => e.tags.includes('stair')).map((e): [string, Vec3] => [`${e.id} bottom`, [e.transform.position[0], e.transform.position[1], e.transform.position[2] + Number((e.shape as { params?: Record<string, unknown> }).params?.['run'] ?? 0) / 2 + 0.6]]),
        ...Object.values(world.entities).filter((e) => e.tags.includes('house')).map((e): [string, Vec3] => [`${e.id} door`, doorFront(e.id)]),
      ];
      expect(places.filter(([n]) => n.endsWith(' door'))).toHaveLength(6);
      expect(places.filter(([, p]) => !reached(p)).map(([n]) => n)).toEqual([]);
    } finally {
      pw?.dispose();
      sandbox.dispose();
    }
  }, 120_000);
});
