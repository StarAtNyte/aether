/**
 * Flagship showcase plans of the offline planner: each one is found by its
 * name, builds a valid world with no rejected patch, compiles its building
 * (architecture flagships) without refused ops, and ships a title card,
 * verification tests and — for games — an objective the player can reach.
 */
import { applyArchOps } from '@aether/arch';
import { applyPatches, createWorld, summarizeWorld, validateWorld, type WorldDoc } from '@aether/core';
import { describe, expect, it } from 'vitest';
import { planMock } from '../src/providers/mock/planner';
import { FLAGSHIPS, findFlagship, planShowcase } from '../src/providers/mock/showcase/index';
import { kartTrack } from '../src/providers/mock/showcase/kart-canyon';

/** Apply a flagship plan (patches, then architecture ops) to a world. */
function build(id: string, start: WorldDoc = createWorld()): { world: WorldDoc; patchErrors: string[]; archErrors: string[] } {
  const f = FLAGSHIPS.find((x) => x.id === id);
  if (!f) throw new Error(`no flagship ${id}`);
  const plan = f.plan();
  const r = applyPatches(start, plan.patches);
  let world = r.world;
  const archErrors: string[] = [];
  if (plan.arch) {
    const a = applyArchOps(world, plan.arch.ops);
    archErrors.push(...a.errors.map((e) => `${e.code}: ${e.message}`));
    const r2 = applyPatches(world, a.patches);
    archErrors.push(...r2.errors.map((e) => e.message));
    world = r2.world;
  }
  return { world, patchErrors: r.errors.map((e) => e.message), archErrors };
}

describe('flagship showcase plans', () => {
  it('have unique ids and titles', () => {
    expect(new Set(FLAGSHIPS.map((f) => f.id)).size).toBe(FLAGSHIPS.length);
    expect(new Set(FLAGSHIPS.map((f) => f.title)).size).toBe(FLAGSHIPS.length);
  });

  it.each(FLAGSHIPS.map((f) => [f.id] as const))('%s builds a valid, complete world', (id) => {
    const { world, patchErrors, archErrors } = build(id);
    expect(patchErrors).toEqual([]);
    expect(archErrors).toEqual([]);
    expect(validateWorld(world).ok).toBe(true);
    // Rich content: many entities, or a block world with many builds.
    expect(Object.keys(world.entities).length + (world.voxel?.edits.length ?? 0)).toBeGreaterThan(20);
    expect(world.intro?.title).toBe(FLAGSHIPS.find((f) => f.id === id)?.title);
    expect(world.intro?.controls.length).toBeGreaterThan(0);
    expect(world.description.length).toBeGreaterThan(10);
  });

  it.each(FLAGSHIPS.map((f) => [f.id] as const))('%s is deterministic', (id) => {
    const f = FLAGSHIPS.find((x) => x.id === id);
    expect(JSON.stringify(f?.plan())).toBe(JSON.stringify(f?.plan()));
  });

  it('answers to its name and its manifest prompt, and replaces a world only when asked to build', () => {
    expect(findFlagship('Sakura River Journey: a canoe ride')?.id).toBe('sakura-river');
    expect(findFlagship('build the skyline penthouse')?.id).toBe('skyline-penthouse');
    expect(findFlagship('a river with a canoe')).toBeNull();
    const world = build('sakura-river').world;
    const summary = summarizeWorld(world);
    // An edit that mentions the name is not a rebuild…
    expect(planShowcase('the sakura river journey looks nice', summary)).toBeNull();
    // …but an explicit request is.
    expect(planShowcase('open the sakura river journey again', summary)).not.toBeNull();
    // planMock routes flagship names before every other planner.
    const plan = planMock('Skyline Penthouse', '');
    expect(plan.arch?.message).toBe('Skyline Penthouse');
  });

  it('starts from a clear, so a flagship replaces whatever was there', () => {
    const before = applyPatches(createWorld(), [{ op: 'add', entity: { id: 'old-thing' } }, { op: 'setMeta', intro: { title: 'Old' } }]).world;
    const { world } = build('sakura-river', before);
    expect(world.entities['old-thing']).toBeUndefined();
    expect(world.intro?.title).toBe('Sakura River Journey');
  });
});

describe('architecture flagships start the walkthrough inside, facing the house', () => {
  it.each(['casa-patio', 'skyline-penthouse', 'dusk-lake-house'])('%s', (id) => {
    const { world } = build(id);
    const building = Object.values(world.entities).find((e) => e.arch?.role === 'building');
    expect(building).toBeDefined();
    const walls = Object.values(world.entities).filter((e) => e.arch?.role === 'wall' && e.arch.kind !== undefined);
    expect(walls.length).toBeGreaterThan(0);
    const yaw = world.player.yaw;
    expect(yaw).toBeDefined();
    // The spawn is inside the footprint of the exterior walls (their bounding box), not on the doorstep outside.
    const xs: number[] = [];
    const zs: number[] = [];
    for (const e of Object.values(world.entities)) {
      if (e.arch?.role !== 'wall' || !e.tags.includes('exterior')) continue;
      xs.push(e.transform.position[0] + (building?.transform.position[0] ?? 0));
      zs.push(e.transform.position[2] + (building?.transform.position[2] ?? 0));
    }
    expect(world.player.spawn[0]).toBeGreaterThan(Math.min(...xs) - 0.5);
    expect(world.player.spawn[0]).toBeLessThan(Math.max(...xs) + 0.5);
    expect(world.player.spawn[2]).toBeGreaterThan(Math.min(...zs) - 0.5);
    expect(world.player.spawn[2]).toBeLessThan(Math.max(...zs) + 0.5);
  });

  it('the Skyline Penthouse has a skyline: towers that rise above the roof deck', () => {
    const { world } = build('skyline-penthouse');
    const towers = Object.values(world.entities).filter((e) => e.tags.includes('city'));
    expect(towers.length).toBeGreaterThanOrEqual(40);
    // Towers are `skyline-tower` volumes (window-grid facades) whose `height` param is their total height; they stand on
    // streets 40 m below the deck, so a crown above the deck is taller than 40 m.
    const tall = towers.filter((t) => {
      const s = t.shape;
      return s.kind === 'procedural' && s.generator === 'skyline-tower' && Number(s.params['height'] ?? 0) > 60;
    });
    expect(tall.length).toBeGreaterThanOrEqual(30);
    // The ground skirt that would extend the roof to the horizon (over the street level) is off.
    expect(world.environment.ground?.skirt).toBe(false);
  });

  it('the Dusk House has its lake in a basin of real terrain, wooded hills and people inside', () => {
    const { world } = build('dusk-lake-house');
    expect(world.entities['lake-1']).toBeDefined();
    // The ground is a terrain entity (estate variant with a lake basin), not the flat plane, and the horizon is hills.
    expect(world.environment.ground).toBeNull();
    const land = Object.values(world.entities).find((e) => e.tags.includes('terrain'));
    expect(land?.shape.kind === 'procedural' && land.shape.params['variant']).toBe(5);
    expect(land?.shape.kind === 'procedural' && Number(land.shape.params['lakeRadius'])).toBeGreaterThan(0);
    const woods = Object.values(world.entities).filter((e) => e.tags.includes('grove') && e.shape.kind === 'scatter');
    expect(woods.length).toBeGreaterThanOrEqual(4);
    expect(Object.values(world.entities).filter((e) => e.arch?.role === 'resident').length).toBe(2);
  });

  it('the Dusk House meadow does not grow through the living-room floor', () => {
    const { world } = build('dusk-lake-house');
    const building = Object.values(world.entities).find((e) => e.arch?.role === 'building');
    const [bx, , bz] = building?.transform.position ?? [0, 0, 0];
    // Footprint (plan 0..14 by 0..7) of the ground floor: no ground-cover point inside it.
    for (const e of Object.values(world.entities)) {
      if (e.shape.kind !== 'scatter' || !e.shape.points || e.tags.includes('grove')) continue;
      for (const [px, , pz] of e.shape.points) {
        const x = e.transform.position[0] + px - bx;
        const z = e.transform.position[2] + pz - bz;
        expect(x > -1 && x < 15 && z > -1 && z < 8).toBe(false);
      }
    }
  });
});

describe('landscapes of the architecture flagships', () => {
  it('Casa del Patio stands on a level plot of a hillside with woods, not on a flat plane', () => {
    const { world } = build('casa-patio');
    expect(world.environment.ground).toBeNull();
    const land = Object.values(world.entities).find((e) => e.tags.includes('terrain'));
    expect(land).toBeDefined();
    if (land?.shape.kind !== 'procedural') throw new Error('terrain is procedural');
    expect(land.shape.params['variant']).toBe(5);
    expect(Number(land.shape.params['padRadius'])).toBeGreaterThanOrEqual(20);
    expect(Object.values(world.entities).filter((e) => e.tags.includes('grove')).length).toBeGreaterThanOrEqual(3);
    expect(Object.values(world.entities).filter((e) => e.arch?.role === 'resident').length).toBe(3);
  });
});

describe('flagship first-minute framing', () => {
  it('orbital-lab keeps every pod clear of the chase camera behind the spawn', () => {
    const { world } = build('orbital-lab');
    const spawn = world.player.spawn;
    // The chase camera sits up to ~7 m behind the spawn (+z): no pod footprint may reach that corridor.
    const pods = Object.values(world.entities).filter((e) => e.tags?.includes('pod'));
    expect(pods.length).toBe(4);
    for (const p of pods) {
      const [x, , z] = p.transform.position;
      const dx = Math.abs(x - spawn[0]);
      const behind = z - spawn[2];
      expect(dx > 4.2 || behind < 0 || behind > 7).toBe(true);
    }
  });

  it('chain-reaction starts the player on the stage with a visible body', () => {
    const { world } = build('chain-reaction');
    expect(world.player.mode).toBe('thirdPerson');
    expect(Math.abs(world.player.spawn[0])).toBeLessThan(40);
    expect(world.player.spawn[1]).toBeLessThan(2);
  });
  it('chain-reaction windows are individual panes with their own strength, not one lit card', () => {
    const { world } = build('chain-reaction');
    const panes = Object.values(world.entities).filter((e) => e.name?.startsWith('window-glow') || e.id.startsWith('window-glow'));
    expect(panes.length).toBeGreaterThanOrEqual(36);
    const strengths = new Set(panes.map((p) => (p.material as { emissiveIntensity?: number } | undefined)?.emissiveIntensity));
    expect(strengths.size).toBeGreaterThanOrEqual(4);
  });

  it('neon-rain-city shopfronts have several panes of different strength and a dim transom', () => {
    const { world } = build('neon-rain-city');
    const glass = Object.values(world.entities).filter((e) => e.id.startsWith('shop-glass'));
    const transom = Object.values(world.entities).filter((e) => e.id.startsWith('shop-transom'));
    expect(glass.length).toBeGreaterThanOrEqual(24);
    expect(transom.length).toBe(glass.length);
    const strengths = new Set(glass.map((g) => (g.material as { emissiveIntensity?: number } | undefined)?.emissiveIntensity));
    expect(strengths.size).toBeGreaterThanOrEqual(3);
  });
  it('kart-canyon scrub and grass strips never cover the asphalt', () => {
    const { world } = build('kart-canyon');
    expect(world.entities['road']).toBeDefined();
    const loop = kartTrack();
    const strips = Object.values(world.entities).filter((e) => e.shape.kind === 'scatter');
    expect(strips.length).toBeGreaterThan(20);
    // Points along the centre line every metre or so.
    const along: Array<[number, number]> = [];
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i] as [number, number, number];
      const c = loop[(i + 1) % loop.length] as [number, number, number];
      const n = Math.max(1, Math.ceil(Math.hypot(c[0] - a[0], c[2] - a[2])));
      for (let k = 0; k < n; k++) along.push([a[0] + ((c[0] - a[0]) * k) / n, a[2] + ((c[2] - a[2]) * k) / n]);
    }
    for (const s of strips) {
      if (s.shape.kind !== 'scatter') continue;
      const [cx, , cz] = s.transform.position;
      const [w, d] = s.shape.area;
      for (const [px, pz] of along) {
        const nx = Math.max(cx - w / 2, Math.min(px, cx + w / 2));
        const nz = Math.max(cz - d / 2, Math.min(pz, cz + d / 2));
        // Nearest point of the strip's box to the centre line must clear the road (5 m) and its curb (0.7 m).
        expect(Math.hypot(nx - px, nz - pz), `${s.id} at ${px},${pz}`).toBeGreaterThan(5.7);
      }
    }
  });

  it('kart-canyon road is one continuous ribbon with stripes that close around the loop', () => {
    const { world } = build('kart-canyon');
    const road = world.entities['road'];
    const curbs = world.entities['road-curbs'];
    expect(road?.shape.kind).toBe('mesh');
    expect(curbs?.shape.kind).toBe('mesh');
    // The old build was one box per segment: none of those remain.
    expect(Object.values(world.entities).filter((e) => e.id.startsWith('asphalt') || e.id.startsWith('curb-')).length).toBe(0);
  });

  it('every action and story flagship has real people in it, and none is a bare capsule', () => {
    for (const slug of ['hollow-gate', 'kart-canyon', 'neon-rain-city', 'kyoto-temple', 'orbital-lab', 'chain-reaction']) {
      const { world } = build(slug);
      const people = Object.values(world.entities).filter((e) => e.character !== undefined);
      expect(people.length, `${slug} has people`).toBeGreaterThanOrEqual(1);
      // A capsule primitive without a character is the placeholder the player would see as a blob.
      const blobs = Object.values(world.entities).filter((e) => e.shape.kind === 'primitive' && e.shape.primitive === 'capsule' && e.character === undefined && e.tags.includes('npc'));
      expect(blobs.map((b) => b.id), `${slug} blob NPCs`).toEqual([]);
    }
  });
  it('kyoto-temple shrines are gabled with lattice doors, and the halls have lattice over their screens', () => {
    const { world } = build('kyoto-temple');
    const count = (re: RegExp): number => Object.values(world.entities).filter((e) => re.test(e.id)).length;
    expect(count(/^shrine-roof-/)).toBe(8); // two slabs per shrine, four shrines
    expect(count(/^shrine-door-/)).toBe(4);
    expect(count(/^shrine-offering-box-/)).toBe(4);
    expect(count(/^hall-muntin-/)).toBeGreaterThanOrEqual(30);
    expect(count(/^hall-rail-/)).toBe(12); // three rails on each of the two long faces of both halls
  });

  it('neon-rain-city lamps on cars come in pairs, not one lit bar', () => {
    const { world } = build('neon-rain-city');
    const heads = Object.values(world.entities).filter((e) => e.id.startsWith('headlight-'));
    expect(heads.length).toBeGreaterThanOrEqual(8);
    expect(heads.length % 2).toBe(0);
    expect(Object.values(world.entities).filter((e) => e.id.startsWith('headlights-')).length).toBe(0);
  });
  it('orbital-lab planet is a painted mesh (continents, ice, clouds), not a flat sphere, and is deterministic', () => {
    const a = build('orbital-lab').world;
    const b = build('orbital-lab').world;
    const planet = a.entities['planet'];
    expect(planet?.shape.kind).toBe('mesh');
    const asset = Object.values(a.meshes ?? {}).find((m) => m.id.startsWith('planet'));
    expect(asset).toBeDefined();
    expect(asset!.vertexCount).toBeGreaterThan(5000);
    expect(asset!.colors).toBeDefined();
    expect(JSON.stringify(a.meshes?.['planet-mesh']?.colors)).toBe(JSON.stringify(b.meshes?.['planet-mesh']?.colors));
    // The colour channel varies (a flat ball would encode one colour).
    const distinct = new Set<string>();
    const raw = Buffer.from((asset!.colors as string[]).join(''), 'base64');
    for (let i = 0; i + 2 < raw.length; i += 3 * 97) distinct.add(`${raw[i]},${raw[i + 1]},${raw[i + 2]}`);
    expect(distinct.size).toBeGreaterThan(20);
  });
});
