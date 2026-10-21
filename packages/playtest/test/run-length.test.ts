/**
 * Runs that used to end "not verified yet: ran too long" on generated worlds: the bot burnt the whole
 * simulated budget in a loop instead of finishing or failing with a reason.
 *
 * - A pack that hunts the player but cannot get at it (in the stream below a bank) pinned a bot that always stepped aside.
 * - A path under a footbridge: the bot stepped onto the ramp, walked the deck above its path, stood over a
 *   waypoint it could not reach and hopped on the spot (a hop read as progress) until the clock ran out.
 * - A shrine zone that only counts while the player stands in it was crossed on the way to the last lantern.
 * - The first run in a process measured library pickups before the asset catalog had loaded.
 *
 * And a house whose walkthrough failed headless for a real reason: the balustrade of its L stair's well closed the
 * top of the stair (and narrowed the flight), so the upper floor could not be reached on foot.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applyArchOps } from '@aether/arch';
import { createWorld, validateWorld, type WorldDoc } from '@aether/core';
import { ensureAssetCatalog } from '@aether/physics';
import { describe, expect, it } from 'vitest';
import { playtest, walkthrough } from '../src';
import { coin, gameWorld, slab, winAt } from './helpers';

function fixture(name: string): WorldDoc {
  const raw = JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8')) as unknown;
  const v = validateWorld(raw);
  if (!v.ok) throw new Error(`invalid fixture ${name}`);
  return v.world;
}

/** The night forest Codex built on a carved stream with a footbridge, a mound for the shrine, woods and wolves. */
const codexForest = (): WorldDoc => fixture('forest-bridge.world.json');
/** An offline-planner forest (landscape, stream, footbridge, woods): four wolves by the stream below the lantern on its bank (ground cover removed). */
const packForest = (): WorldDoc => fixture('forest-pack.world.json');

describe('the playtest bot finishes generated worlds instead of running out the clock', () => {
  it('takes the lantern on a bank above a hunting pack that cannot climb it, after a while of keeping clear', async () => {
    // The studio's worker has the catalog loaded (the wolves' and lanterns' real sizes): so does this run.
    const world = packForest();
    await ensureAssetCatalog(world);
    const r = await playtest(world, { trace: false });
    expect(r.status, r.summary).toBe('passed');
    expect(r.objectives.every((o) => o.status === 'done')).toBe(true);
    expect(r.stats?.evasions ?? 0).toBeGreaterThan(0);
    expect(r.seconds).toBeLessThan(90);
    expect(r.wallMs).toBeLessThan(20_000);
  }, 120_000);

  it('climbs to the shrine on the hill with a wolf trailing it round the hill, instead of dodging in circles until the clock runs out', async () => {
    // Codex's moonlit forest: after the last lantern a wolf that hunts the player follows it a few metres behind (the player
    // runs faster), and every re-route round the wolf led the bot round the foot of the hill, never up it.
    const world = fixture('forest-hill-chase.world.json');
    await ensureAssetCatalog(world);
    const r = await playtest(world, { trace: false });
    expect(r.status, r.summary).toBe('passed');
    expect(r.objectives.filter((o) => o.required).every((o) => o.status === 'done')).toBe(true);
    expect(r.seconds).toBeLessThan(80);
  }, 120_000);

  it('wins the Codex night forest (stream, footbridge, mound, woods, wolves) within the studio budget', async () => {
    const world = codexForest();
    const r = await playtest(world, { trace: true });
    expect(r.status, r.summary).toBe('passed');
    expect(r.objectives.filter((o) => o.required).every((o) => o.status === 'done')).toBe(true);
    // Well inside the default caps (240 s simulated, 20 s of compute).
    expect(r.seconds).toBeLessThan(80);
    expect(r.wallMs).toBeLessThan(20_000);
    // It got off the bridge deck and on with the route instead of hopping in place.
    expect(r.trace?.events.filter((e) => e.kind === 'pickup')).toHaveLength(5);
  }, 180_000);

  it('plays a world with library pickups the same way on the first run in a process as on the next', async () => {
    const world = codexForest();
    const a = await playtest(world, { trace: false });
    const b = await playtest(world, { trace: false });
    expect(b.status).toBe(a.status);
    expect(b.steps).toBe(a.steps);
    expect(b.objectives.map((o) => o.status)).toEqual(a.objectives.map((o) => o.status));
  }, 240_000);

  it('gives up an objective it cannot get to with a reason, long before the clock runs out', async () => {
    // A coin on a pillar a step too high to climb or jump, beside one on the ground: the run ends failed and says which.
    const world = gameWorld([coin('ground-coin', [4, 0.6, -4]), slab('pillar', [-4, 1.6, -6], [1.2, 3.2, 1.2]), coin('pillar-coin', [-4, 3.8, -6])], { rules: [winAt(2)], state: { score: 0 } });
    const r = await playtest(world, { trace: false });
    expect(r.status).toBe('failed');
    expect(r.objectives.find((o) => o.label.includes('ground-coin'))?.status).toBe('done');
    expect(r.seconds).toBeLessThan(120);
  }, 120_000);

  it('walks every room of the Codex two-storey house with an L stair, within the studio budget', async () => {
    const plan = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/house-l-stair.plan.json', import.meta.url)), 'utf8')) as unknown;
    const built = applyArchOps(createWorld(), [{ op: 'create_building', plan }]);
    expect(built.errors).toEqual([]);
    const r = await walkthrough(built.target, { trace: false });
    expect(r.status, r.summary).toBe('passed');
    expect(r.objectives.every((o) => o.status === 'done')).toBe(true);
    expect(r.wallMs).toBeLessThan(20_000);
  }, 120_000);
});
