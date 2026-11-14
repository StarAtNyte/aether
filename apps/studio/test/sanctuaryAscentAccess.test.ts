/**
 * Sanctuary Ascent is walked on foot from Play: from the quay up the processional flight and the zigzag cliff stair to
 * the temple forecourt, along the rim walks, down the village stairs to the side terraces and to every house door. This
 * builds the walking map from the shipped world's real colliders (the custom generators run in the node sandbox) with
 * walk edges only (no jumps, no drops) and asserts each place is reached from the spawn.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateWorld, type Vec3 } from '@aether/core';
import { initPhysics, PhysicsWorld } from '@aether/physics';
import { NavGraph } from '@aether/playtest';
import { worldColliderProvider } from '@aether/procgen';
import { createNodeSandbox } from '@aether/procgen/node';
import { beforeAll, describe, expect, it } from 'vitest';

const text = readFileSync(fileURLToPath(new URL('../public/templates/worlds/sanctuary-ascent.json', import.meta.url)), 'utf8');
const checked = validateWorld((JSON.parse(text) as { world: unknown }).world);
if (!checked.ok) throw new Error('sanctuary-ascent: invalid saved world');
const world = checked.world;

beforeAll(async () => {
  await initPhysics();
});

function params(id: string): Record<string, unknown> {
  const e = world.entities[id];
  if (!e || e.shape.kind !== 'procedural') throw new Error(id);
  return e.shape.params as Record<string, unknown>;
}

/** The spot in front of a town house's door, on its ground: the med-house facade (and its door) faces local +Z and stands on its footing. */
function doorFront(id: string): Vec3 {
  const e = world.entities[id];
  if (!e) throw new Error(id);
  const p = params(id);
  const depth = Number(p['depth'] ?? 6);
  const yaw = (e.transform.rotation[1] * Math.PI) / 180;
  const [x, y, z] = e.transform.position;
  const d = depth / 2 + 1.2;
  return [x + Math.sin(yaw) * d, y + Number(p['footing'] ?? 1), z + Math.cos(yaw) * d];
}

/** Both ends of a straight flight (local -X bottom at its base, +X top at base + rise), a little past each end. */
function stairEnds(id: string): Array<[string, Vec3]> {
  const e = world.entities[id];
  if (!e) throw new Error(id);
  const p = params(id);
  const run = Number(p['run']);
  const rise = Number(p['rise']);
  const yaw = (e.transform.rotation[1] * Math.PI) / 180;
  const [x, y, z] = e.transform.position;
  const ux = Math.cos(yaw);
  const uz = -Math.sin(yaw);
  const h = run / 2 + 0.8;
  return [
    [`${id} bottom`, [x - ux * h, y, z - uz * h]],
    [`${id} top`, [x + ux * h, y + rise, z + uz * h]],
  ];
}

describe('Sanctuary Ascent on foot', () => {
  it('walks (no jumping) from the spawn up the grand stair to the temple and down the village stairs to every house door', async () => {
    const sandbox = createNodeSandbox({ timeoutMs: 60_000 });
    let pw: PhysicsWorld | null = null;
    try {
      pw = await PhysicsWorld.create(world, { colliders: await worldColliderProvider(world, sandbox) });
      const walker = { radius: 0.35, height: 1.7, stepHeight: 0.35, maxSlopeDeg: 50, speed: world.player.moveSpeed, jumpSpeed: 0.01, gravity: 9.81 };
      const g = await NavGraph.build({ pw, minX: -75, maxX: 75, minZ: -100, maxZ: 50, topY: 90, bottomY: -3, params: walker, hazards: [], noDrops: true });
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
      const ids = (tag: string): string[] => Object.values(world.entities).filter((e) => e.tags.includes(tag)).map((e) => e.id);
      const places: Array<[string, Vec3]> = [
        ['top of the processional flight', [0, 8.07, -1.8]],
        ['first terrace of the cliff stair', [-11, 8.07, -4.5]],
        ['top terrace of the cliff stair', [11, 45.9, -25.5]],
        ['temple forecourt', [0, 45.9, -40]],
        ['west rim walk', [-30, 45.95, -33.5]],
        ['east rim walk', [30, 45.95, -33.5]],
        ['harbour lane', [1.5, 0.05, 30]],
        ...ids('village-stair').flatMap(stairEnds),
        ...ids('house').map((id): [string, Vec3] => [`${id} door`, doorFront(id)]),
      ];
      expect(places.filter(([n]) => n.endsWith(' door')).length).toBeGreaterThanOrEqual(10);
      expect(places.filter(([n]) => n.endsWith(' top')).length).toBeGreaterThanOrEqual(3);
      expect(places.filter(([, p]) => !reached(p)).map(([n]) => n)).toEqual([]);
    } finally {
      pw?.dispose();
      sandbox.dispose();
    }
  }, 180_000);
});
