/**
 * Artifacts a viewer spots at a glance in a finished world, measured from the document so the model sees them without
 * asking (they run in every review round, like the sunk and buried-falls checks):
 *
 * - `sky_piece`: a solid piece hanging high in the air with nothing under it (a rock, a house, a column in the sky).
 * - `mesh_cloud`: cloud meshes in front of a photographed sky that already draws clouds; lit as solids they read as grey
 *   rocks floating in the air.
 * - `land_ends`: a world whose own terrain is its only land: past the terrain's edge nothing is drawn, and the bright
 *   horizon shows through as a flat white plane in every wide view.
 * - `plain_plane`: a large, thin primitive with a plain colour and no surface (an untextured white or grey sheet).
 * - `in_rock`: a building whose roof or upper walls are inside the terrain, a cliff or a solid block (a roof poking out of a
 *   plateau).
 * - `plants_in_fall`: rocks, bushes or ivy inside the curtain of a waterfall (a row of shrubs hung across the falling water).
 *
 * Each check respects the tags that say a piece is meant to be where it is (floating, flying, cloud, sky, hanging, sunk ...).
 */
import type { Entity, Json, WorldDoc } from '@aether/core';
import { findingKey, scoreFindings, type Finding } from '@aether/arch';
import { getBuiltinGenerator } from '@aether/procgen';
import type { ReviewSnapshot } from './review';
import { worldGround } from './land';
import { isFall, solidsOf, inside } from './falls';
import { localBounds, paramBounds, supports } from './sunk';

type Box = { min: [number, number, number]; max: [number, number, number] };

/** Most pieces measured per check. */
export const ARTIFACT_LIMITS = Object.freeze({ MAX_PIECES: 500 });

/** Tags that say a piece belongs in the air. */
const AIR_OK = /float|fly|flying|hover|hanging|cloud|^sky$|backdrop|bird|balloon|airship|kite|lantern|moon|^sun$|star|planet|orbit|levitat|chandelier|ceiling|projectile|fx/;
/** Tags that say a piece is dug in on purpose. */
const BURIED_OK = /^(sunk|buried|underground|in-ground|dug-in|cave|cellar|crypt|tunnel)$/;
/** Buildings (built-in generators of the architecture category with a roof, or world generators named for one). */
const BUILDING = /house|home|cottage|villa|temple|shrine|tholos|chapel|church|hall|shop|inn|tavern|barn|hut|cabin|pavilion|kiosk|stoa|palace|mill|building|dwelling|apartment/;
/** Plants and loose stone that would be swept off a falling-water curtain. */
const LOOSE = /(^|-)(rocks?|boulders?|stones?|shrubs?|bush(es)?|scrub|ferns?|flowers?|wildflowers|grass)($|-)/;

const r1 = (n: number): number => Math.round(n * 10) / 10;

function live(e: Entity): boolean {
  return !e.template && e.visible && !e.parent;
}

/** Local bounds of a piece's shape (a scatter's single instance), or null. */
function boundsOf(e: Entity): Box | null {
  const s = e.shape.kind === 'scatter' ? e.shape.of : e.shape;
  if (s.kind === 'primitive') {
    const size = Array.isArray(s.size) ? (s.size as number[]) : [1, 1, 1];
    const [w = 1, h = 1, d = 1] = size;
    // A cylinder's size is [diameter, height, diameter]; a plane lies flat.
    if (s.primitive === 'plane') return { min: [-w / 2, 0, -h / 2], max: [w / 2, 0.01, h / 2] };
    return { min: [-w / 2, -h / 2, -d / 2], max: [w / 2, h / 2, d / 2] };
  }
  if (s.kind !== 'procedural') return null;
  const params = s.params as Record<string, Json>;
  return getBuiltinGenerator(s.generator) ? localBounds(s.generator, params, s.seed ?? 0) : paramBounds(params);
}

/** The piece's box in world space, axis-aligned after its yaw (a little generous for a turned piece). */
function worldBox(e: Entity, b: Box): Box {
  const [sx, sy, sz] = e.transform.scale;
  const [ox, oy, oz] = e.transform.position;
  const yaw = (e.transform.rotation[1] * Math.PI) / 180;
  const c = Math.abs(Math.cos(yaw));
  const s = Math.abs(Math.sin(yaw));
  const hx = ((b.max[0] - b.min[0]) * sx) / 2;
  const hz = ((b.max[2] - b.min[2]) * sz) / 2;
  const cxl = ((b.max[0] + b.min[0]) / 2) * sx;
  const czl = ((b.max[2] + b.min[2]) / 2) * sz;
  const ys = Math.cos(yaw);
  const yn = Math.sin(yaw);
  const cx = ox + cxl * ys + czl * yn;
  const cz = oz - cxl * yn + czl * ys;
  const ex = hx * c + hz * s;
  const ez = hx * s + hz * c;
  return { min: [cx - ex, oy + b.min[1] * sy, cz - ez], max: [cx + ex, oy + b.max[1] * sy, cz + ez] };
}

function terrains(world: WorldDoc): Entity[] {
  return Object.values(world.entities).filter((e) => live(e) && e.shape.kind === 'procedural' && e.shape.generator === 'terrain');
}

/** A piece the ground checks cannot read under (a custom land generator, a mesh tagged land): the sky check stays quiet there. */
function unreadLand(world: WorldDoc): boolean {
  return Object.values(world.entities).some((e) => {
    if (!live(e) || !e.tags.some((t) => /^(terrain|land|ground|massif)$/.test(t))) return false;
    if (e.tags.some((t) => /^(path|road|street|paving)$/.test(t))) return false;
    if (e.shape.kind === 'mesh') return true;
    return e.shape.kind === 'procedural' && e.shape.generator !== 'terrain' && !getBuiltinGenerator(e.shape.generator);
  });
}

export interface Artifact {
  code: 'sky_piece' | 'mesh_cloud' | 'land_ends' | 'plain_plane' | 'in_rock' | 'plants_in_fall';
  ids: string[];
  message: string;
  fix: string;
}

/** Solid pieces hanging in the sky: the foot is more than 8 m (and twice the piece's height) above whatever is under it. */
export function findSkyPieces(world: WorldDoc): Artifact[] {
  if (unreadLand(world)) return [];
  const ground = worldGround(world);
  const decks = supports(world);
  const solids = solidsOf(world, '');
  const out: Artifact[] = [];
  let n = 0;
  for (const e of Object.values(world.entities)) {
    if (n >= ARTIFACT_LIMITS.MAX_PIECES) break;
    if (!live(e) || e.shape.kind === 'scatter' || e.npc || e.character || e.light || e.behaviors.length > 0) continue;
    if (e.tags.some((t) => AIR_OK.test(t))) continue;
    const s = e.shape;
    if (s.kind === 'procedural') {
      const g = getBuiltinGenerator(s.generator);
      if (g && (g.category === 'fx' || g.category === 'terrain')) continue;
      if (/cloud|bird|sky|sun|moon|star|planet|balloon|zeppelin|airship|plane|drone|lamp|light|banner|flag/.test(s.generator)) continue;
    } else if (s.kind !== 'primitive') continue;
    const b = boundsOf(e);
    if (!b) continue;
    n++;
    const w = worldBox(e, b);
    const height = w.max[1] - w.min[1];
    if (!(height > 0.3)) continue;
    const foot = w.min[1];
    let under = -Infinity;
    let held = false;
    for (const [u, v] of [[0.5, 0.5], [0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]] as const) {
      const x = w.min[0] + (w.max[0] - w.min[0]) * u;
      const z = w.min[2] + (w.max[2] - w.min[2]) * v;
      under = Math.max(under, ground(x, z), decks.top(x, z, foot + 0.5, e.id));
      // Standing on (or in) a cliff, a crag or a solid block: the rock under the foot carries it.
      const hit = inside(solids, ground, x, foot - 1, z);
      if (hit && hit !== e.id) held = true;
    }
    if (held) continue;
    const gap = foot - under;
    if (gap > Math.max(8, height * 2)) {
      out.push({
        code: 'sky_piece',
        ids: [e.id],
        message: `${e.id} hangs in the sky: its foot is ${r1(gap)} m above the ground or anything under it, with nothing holding it up (${r1(height)} m tall).`,
        fix: `put it on the ground or on the piece meant to carry it (y about ${r1(under - (b.min[1] * e.transform.scale[1]))}), or delete it; tag it "floating" or "flying" if it hangs in the air on purpose`,
      });
    }
  }
  return out;
}

/** Cloud meshes in a world whose photographed sky (an HDRI shown as the background) already draws the clouds. */
export function findMeshClouds(world: WorldDoc): Artifact[] {
  const env = world.environment;
  if (!env.hdri || env.hdriBackground === false) return [];
  const ids = Object.values(world.entities)
    .filter((e) => live(e) && !e.tags.includes('mesh-cloud'))
    .filter((e) => {
      const s = e.shape.kind === 'scatter' ? e.shape.of : e.shape;
      return s.kind === 'procedural' && s.generator === 'cloud';
    })
    .map((e) => e.id);
  if (ids.length === 0) return [];
  return [
    {
      code: 'mesh_cloud',
      ids,
      message: `${ids.length} cloud mesh${ids.length > 1 ? 'es' : ''} (${ids.slice(0, 6).join(', ')}) hang in front of the photographed sky, which already draws its clouds: lit as solids against it they read as grey rocks floating in the air.`,
      fix: 'delete them and let the sky draw the clouds (pick a cloudier HDRI or environment.sky preset for more); tag one "mesh-cloud" only for a stylised scene that wants solid clouds',
    },
  ];
}

/**
 * A world whose own terrain is its only land: no built-in ground, no sea or second terrain around it. Past the terrain's
 * edge nothing is drawn, so wide views show the bright horizon through the gap as a flat white plane.
 */
export function findLandEnds(world: WorldDoc): Artifact[] {
  if (world.environment.ground) return [];
  const lands = terrains(world);
  if (lands.length === 0) return [];
  let half = 0;
  let main: Entity | null = null;
  for (const e of lands) {
    const size = Number((e.shape as { params: Record<string, Json> }).params['size'] ?? 60);
    const h = size / 2 + Math.max(Math.abs(e.transform.position[0]), Math.abs(e.transform.position[2]));
    if (h > half) {
      half = h;
      main = e;
    }
  }
  if (!main || half >= 450) return [];
  // A sea, a lake or a second land reaching well past the terrain closes the gap.
  for (const e of Object.values(world.entities)) {
    if (!live(e) || e.id === main.id) continue;
    const b = boundsOf(e);
    if (!b) continue;
    const w = worldBox(e, b);
    const reach = Math.min(-w.min[0], w.max[0], -w.min[2], w.max[2]);
    if (reach >= half * 1.6) return [];
  }
  // Content reaching near the terrain's edge, or tall enough to be seen from far: someone will look past the edge.
  const size = Number((main.shape as { params: Record<string, Json> }).params['size'] ?? 60);
  return [
    {
      code: 'land_ends',
      ids: [main.id],
      message: `the land ends at the edge of ${main.id} (${r1(size)} m across) and nothing lies beyond it: wide views see the bright horizon through the gap as a flat white plane.`,
      fix: `add an outer land around it: a second terrain (variant 5, size ${Math.min(1000, Math.round(size * 3.5))}, its cutX0..cutZ1 the square of ${main.id} so the two do not overlap, y about the height of ${main.id}'s edge), or set environment.ground, or a sea reaching past the edge`,
    },
  ];
}

/** Large thin primitives with a plain colour and no surface: an untextured sheet. */
export function findPlainPlanes(world: WorldDoc): Artifact[] {
  const out: Artifact[] = [];
  for (const e of Object.values(world.entities)) {
    if (!live(e) || e.shape.kind !== 'primitive') continue;
    if (e.tags.some((t) => /^(water|sea|lake|collider|trigger|invisible|marker|glass)$/.test(t))) continue;
    const m = e.material;
    if (m && (m.preset || m.finish || m.texture || m.shader || m.surface || m.waterKind || m.splat || (m.opacity ?? 1) < 0.6)) continue;
    const b = boundsOf(e);
    if (!b) continue;
    const w = worldBox(e, b);
    const span = Math.min(w.max[0] - w.min[0], w.max[2] - w.min[2]);
    const thick = w.max[1] - w.min[1];
    if (span >= 40 && thick <= Math.max(1, span * 0.03)) {
      out.push({
        code: 'plain_plane',
        ids: [e.id],
        message: `${e.id} is a ${r1(w.max[0] - w.min[0])} by ${r1(w.max[2] - w.min[2])} m flat sheet with a plain colour and no surface: it reads as an untextured plane.`,
        fix: 'give it a material preset or finish (stone, grass, sand, paving, water) with surface layers, replace it with terrain or a generator that draws the real thing, or delete it',
      });
    }
  }
  return out;
}

/** Buildings whose roof or upper walls are inside the terrain, a cliff or a solid block. */
export function findBuildingsInRock(world: WorldDoc): Artifact[] {
  const ground = worldGround(world);
  const out: Artifact[] = [];
  let n = 0;
  for (const e of Object.values(world.entities)) {
    if (n >= ARTIFACT_LIMITS.MAX_PIECES) break;
    if (!live(e) || e.shape.kind !== 'procedural' || e.tags.some((t) => BURIED_OK.test(t))) continue;
    const gen = e.shape.generator;
    const builtin = getBuiltinGenerator(gen);
    // Crafted houses (furn-dwelling) are filed with the interior pieces: the name decides.
    if (builtin ? (builtin.category !== 'architecture' && builtin.category !== 'interior') || !BUILDING.test(gen) : !(BUILDING.test(gen) && world.generators?.[gen])) continue;
    const b = boundsOf(e);
    if (!b) continue;
    n++;
    const solids = solidsOf(world, e.id);
    const [sx, sy, sz] = e.transform.scale;
    const [ox, oy, oz] = e.transform.position;
    const yaw = (e.transform.rotation[1] * Math.PI) / 180;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const height = (b.max[1] - b.min[1]) * sy;
    let hits = 0;
    let total = 0;
    const by = new Set<string>();
    // The walls above the floor and the roof (a footing or a cellar in the ground is fine): a corner or a side cut into the
    // rock shows as a wall or a roof running into it.
    for (const t of [0.35, 0.6, 0.85]) {
      for (const u of [0.15, 0.5, 0.85]) {
        for (const v of [0.15, 0.5, 0.85]) {
          const lx = (b.min[0] + (b.max[0] - b.min[0]) * u) * sx;
          const lz = (b.min[2] + (b.max[2] - b.min[2]) * v) * sz;
          const y = oy + (b.min[1] + (b.max[1] - b.min[1]) * t) * sy;
          const hit = inside(solids, ground, ox + lx * c + lz * s, y, oz - lx * s + lz * c);
          total++;
          if (hit) {
            hits++;
            by.add(hit);
          }
        }
      }
    }
    if (hits * 6 >= total) {
      const where = [...by].slice(0, 3).map((i) => (i === 'terrain' ? 'the terrain' : i)).join(', ');
      out.push({
        code: 'in_rock',
        ids: [e.id],
        message: `${e.id} (${gen}, ${r1(height)} m tall) runs into ${where}: ${Math.round((hits / total) * 100)} % of its walls and roof above the floor are inside the rock, so a roof or wall pokes out of the ground.`,
        fix: `move it onto the top of the rock or out in front of it (its y on the surface it stands on, with a footing on a slope), or delete it; tag it "sunk" only for a building dug in on purpose`,
      });
    }
  }
  return out;
}

/** Plants and loose stones inside the curtain of falling water (whatever their tags: nothing grows in a falling sheet). */
export function findPlantsInFalls(world: WorldDoc): Artifact[] {
  const falls: Box[] = [];
  for (const e of Object.values(world.entities)) {
    if (!live(e) || !isFall(e)) continue;
    let b = boundsOf(e);
    if (!b) continue;
    // A sheet leaves its lip at z = 0 and pours toward +z: the curtain runs from the rock a few metres behind the lip (seen
    // through the water) to a few metres in front of it; its pool
    // and spray at the foot spread wider and are left out).
    const sh = e.shape;
    if (sh.kind === 'procedural' && sh.generator === 'waterfall-sheet') {
      const wd = Number((sh.params as Record<string, Json>)['width'] ?? b.max[0] - b.min[0]);
      b = { min: [-wd / 2, b.min[1], -4], max: [wd / 2, b.max[1], 3] };
    }
    falls.push(worldBox(e, b));
  }
  if (falls.length === 0) return [];
  const out: Artifact[] = [];
  for (const e of Object.values(world.entities)) {
    if (!live(e) || isFall(e)) continue;
    const s = e.shape.kind === 'scatter' ? e.shape.of : e.shape;
    if (s.kind !== 'procedural' || !LOOSE.test(s.generator)) continue;
    const b = boundsOf(e);
    if (!b) continue;
    const pts = scatterPoints(e);
    let inFall = 0;
    for (const [x, y, z] of pts) {
      const foot = y + b.min[1] * e.transform.scale[1];
      // Hanging in the curtain: within its width, within 1.5 m of the sheet, and above its foot (a bush at the pool is fine).
      if (falls.some((f) => x > f.min[0] + 0.3 && x < f.max[0] - 0.3 && z > f.min[2] - 1.5 && z < f.max[2] + 1.5 && foot > f.min[1] + 2 && foot < f.max[1] - 1.5)) inFall++;
    }
    if (inFall > 0 && inFall * 8 >= pts.length) {
      out.push({
        code: 'plants_in_fall',
        ids: [e.id],
        message: `${pts.length > 1 ? `${inFall} of ${pts.length} ${s.generator} of ${e.id} hang` : `${e.id} (${s.generator}) hangs`} in the curtain of a waterfall: green clumps floating across the falling water.`,
        fix: 'take them out of the fall (move the points to the rock beside it, or onto ledges with ground under them), or delete the layer',
      });
    }
  }
  return out;
}

/** World positions of a piece or scatter (a layout-at-load scatter sampled on a grid over its area). */
function scatterPoints(e: Entity): Array<[number, number, number]> {
  const [ox, oy, oz] = e.transform.position;
  const s = e.shape;
  if (s.kind !== 'scatter') return [[ox, oy, oz]];
  const yaw = (e.transform.rotation[1] * Math.PI) / 180;
  const c = Math.cos(yaw);
  const sn = Math.sin(yaw);
  const at = (x: number, y: number, z: number): [number, number, number] => [ox + x * c + z * sn, oy + y, oz - x * sn + z * c];
  if (s.points && s.points.length > 0) return s.points.slice(0, 2000).map(([x, y, z]) => at(x, y, z));
  if (s.onSurface || !Array.isArray(s.area)) return [];
  const [w, d] = s.area as [number, number];
  const nx = Math.max(1, Math.min(12, Math.round(Math.sqrt(((s.count ?? 1) * w) / Math.max(0.1, d)))));
  const nz = Math.max(1, Math.min(12, Math.ceil((s.count ?? 1) / nx)));
  const out: Array<[number, number, number]> = [];
  for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) out.push(at(((i + 0.5) / nx - 0.5) * w, 0, ((k + 0.5) / nz - 0.5) * d));
  return out;
}

/** Every artifact of `world`. */
export function findArtifacts(world: WorldDoc): Artifact[] {
  const out: Artifact[] = [];
  for (const check of [findSkyPieces, findMeshClouds, findLandEnds, findPlainPlanes, findBuildingsInRock, findPlantsInFalls]) {
    try {
      out.push(...check(world));
    } catch {
      // A check that cannot read this world says nothing.
    }
  }
  return out;
}

const CODES = new Set<string>(['sky_piece', 'mesh_cloud', 'land_ends', 'plain_plane', 'in_rock', 'plants_in_fall']);

/** The artifacts as review findings (warnings). */
export function artifactFindings(world: WorldDoc): Finding[] {
  return findArtifacts(world)
    .slice(0, 30)
    .map((a) => ({ code: a.code, severity: 'warning', message: a.message, entities: a.ids.slice(0, 12), fix: a.fix }) as Finding);
}

/** `snap` with the artifacts of `world` added to its findings (score and keys follow), so every review round checks them. */
export function withArtifacts(snap: ReviewSnapshot, world: WorldDoc): ReviewSnapshot {
  const extra = artifactFindings(world);
  if (extra.length === 0) return snap;
  const findings = [...snap.findings.filter((f) => !CODES.has(f.code)), ...extra];
  return { ...snap, findings, score: scoreFindings(findings), keys: new Set(findings.map(findingKey)) };
}
