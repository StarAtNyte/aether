/**
 * What makes a world heavy to draw, measured from the document so every review round (like the artifact checks) tells the
 * model before a laptop finds out. The renderer merges, instances, culls and prepares what it can, but these choices cost
 * on any GPU and only the world can avoid them:
 *
 * - `repeat_pieces`: many identical pieces placed one by one. Each is its own object (a draw, a render object and a node
 *   build per pass); a scatter of the same piece is one instanced draw.
 * - `material_variety`: many distinct materials. Each is a shader program of its own (about 10 MB of driver memory on an
 *   integrated GPU and a link of up to 3 s) and a build per object that wears it; a small palette reused is far lighter.
 * - `shadow_lamps`: lamps (point, spot, area) that cast shadows. Each renders the scene again into its own map (a point light
 *   six times); the sun's shadows are cached, the lamps' are not.
 * - `many_lamps`: more lamps than a frame can shade (integrated GPUs light with 8): the rest are dropped or cost every pixel.
 * - `heavy_scatter`: instance counts past what level-of-detail fields keep smooth on an integrated GPU.
 */
import type { Entity, WorldDoc } from '@aether/core';
import { findingKey, scoreFindings, type Finding } from '@aether/arch';
import type { ReviewSnapshot } from './review';

/** Thresholds of the weight checks. */
export const WEIGHT_LIMITS = Object.freeze({
  /** Identical pieces placed one by one before they should be one scatter. */
  REPEATS: 16,
  /** Distinct material kinds before the palette should shrink. */
  MATERIALS: 90,
  /** Shadow-casting lamps allowed (the sun is not counted). */
  SHADOW_LAMPS: 2,
  /** Lamps (point, spot, area) before they should be thinned or merged. */
  LAMPS: 48,
  /** Scatter instances in the whole world. */
  INSTANCES: 1_500_000,
});

const LAMP = new Set(['point', 'spot', 'area']);

function live(e: Entity): boolean {
  return !e.template && e.visible !== false;
}

/** A stable key of a JSON value (objects with sorted keys). */
function stable(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'undefined';
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`;
}

/** The shape a repeat is judged by: the generator and its parameters (a seed alone does not make a piece different). */
function shapeKey(e: Entity): string | null {
  const s = e.shape;
  if (s.kind === 'procedural') return `p:${s.generator}:${stable(s.params)}`;
  if (s.kind === 'primitive') return `q:${stable(s)}`;
  if (s.kind === 'model') return `m:${s.url}`;
  return null;
}

/** Every weight finding of `world` (warnings, at most four repeat groups and one of each other code). */
export function weightFindings(world: WorldDoc): Finding[] {
  const out: Finding[] = [];
  const entities = Object.values(world.entities).filter(live);

  // Repeats: building parts are merged per storey by the renderer, and characters, moving or scripted pieces cannot be instanced.
  const groups = new Map<string, Entity[]>();
  for (const e of entities) {
    if (e.arch || e.npc || e.physics?.body === 'dynamic' || e.behaviors.length > 0 || e.light) continue;
    const k = shapeKey(e);
    if (!k) continue;
    // Same turn and size too: a scatter places copies at points (with one turn for all, or random yaw), so only pieces that
    // differ in position alone convert without moving anything.
    const key = `${k}|${stable(e.material ?? null)}|${stable(e.transform.rotation)}|${stable(e.transform.scale)}`;
    const g = groups.get(key);
    if (g) g.push(e);
    else groups.set(key, [e]);
  }
  const repeats = [...groups.values()].filter((g) => g.length >= WEIGHT_LIMITS.REPEATS).sort((a, b) => b.length - a.length);
  for (const g of repeats.slice(0, 4)) {
    const s = g[0]!.shape;
    const what = s.kind === 'procedural' ? s.generator : s.kind === 'primitive' ? s.primitive : 'model';
    out.push({
      code: 'repeat_pieces',
      severity: 'warning',
      message: `${g.length} identical ${what} pieces are placed one by one (${g.slice(0, 3).map((e) => e.id).join(', ')} …): each is a separate object to draw and prepare.`,
      entities: g.slice(0, 12).map((e) => e.id),
      subject: what,
      fix: `replace them with one scatter entity of that ${what} (shape kind "scatter" with "points" at their positions, or an area and a count): one instanced draw for all of them`,
    });
  }

  // Materials: the key is what changes a shader (preset, finish, texture, foliage, flags), not a colour or a roughness.
  const materials = new Set<string>();
  for (const e of entities) {
    const m = e.material;
    if (!m) continue;
    materials.add(stable({ preset: m.preset, finish: m.finish, texture: m.texture, foliage: m.foliage, splat: m.splat, vertexColors: m.vertexColors, doubleSided: m.doubleSided, flat: m.flatShading, emissive: m.emissive !== undefined, transparent: (m.opacity ?? 1) < 1 }));
  }
  if (materials.size > WEIGHT_LIMITS.MATERIALS) {
    out.push({
      code: 'material_variety',
      severity: 'warning',
      message: `The world uses ${materials.size} distinct material kinds (finishes, textures, presets): each is a shader of its own to compile and hold in memory.`,
      entities: [],
      subject: 'materials',
      fix: `reuse a palette of at most ${WEIGHT_LIMITS.MATERIALS} finishes across the world (vary colour and roughness instead, which do not make new shaders)`,
    });
  }

  // Lamps.
  const lamps = entities.filter((e) => e.light && LAMP.has(e.light.type));
  const shadowLamps = lamps.filter((e) => e.light!.castShadow);
  if (shadowLamps.length > WEIGHT_LIMITS.SHADOW_LAMPS) {
    out.push({
      code: 'shadow_lamps',
      severity: 'warning',
      message: `${shadowLamps.length} lamps cast shadows: each draws the scene again every frame it changes (a point light six times).`,
      entities: shadowLamps.slice(0, 12).map((e) => e.id),
      subject: 'shadow lamps',
      fix: `set castShadow false on all but the ${WEIGHT_LIMITS.SHADOW_LAMPS} lamps that matter most; the sun keeps its shadows`,
    });
  }
  if (lamps.length > WEIGHT_LIMITS.LAMPS) {
    out.push({
      code: 'many_lamps',
      severity: 'warning',
      message: `${lamps.length} lamps: a frame shades with the nearest few (8 on an integrated GPU), the rest only cost.`,
      entities: lamps.slice(0, 12).map((e) => e.id),
      subject: 'lamps',
      fix: `keep at most ${WEIGHT_LIMITS.LAMPS} lamps: one per room or streetlight cluster, and emissive materials for small decorative lights`,
    });
  }

  // Instances.
  let instances = 0;
  const scatters: Entity[] = [];
  for (const e of entities) {
    if (e.shape.kind !== 'scatter') continue;
    instances += e.shape.points?.length ?? e.shape.count;
    scatters.push(e);
  }
  if (instances > WEIGHT_LIMITS.INSTANCES) {
    const count = (e: Entity): number => (e.shape.kind === 'scatter' ? e.shape.points?.length ?? e.shape.count : 0);
    scatters.sort((a, b) => count(b) - count(a));
    out.push({
      code: 'heavy_scatter',
      severity: 'warning',
      message: `${instances.toLocaleString('en-US')} scattered instances in total.`,
      entities: scatters.slice(0, 6).map((e) => e.id),
      subject: 'instances',
      fix: `bring the total under ${WEIGHT_LIMITS.INSTANCES.toLocaleString('en-US')}: lower the counts of the largest layers, or widen their spacing`,
    });
  }
  return out;
}

const CODES = new Set<string>(['repeat_pieces', 'material_variety', 'shadow_lamps', 'many_lamps', 'heavy_scatter']);

/** `snap` with the weight findings of `world` added (score and keys follow), so every review round checks them. */
export function withWeight(snap: ReviewSnapshot, world: WorldDoc): ReviewSnapshot {
  let extra: Finding[];
  try {
    extra = weightFindings(world);
  } catch {
    return snap;
  }
  if (extra.length === 0) return snap;
  const findings = [...snap.findings.filter((f) => !CODES.has(f.code)), ...extra];
  return { ...snap, findings, score: scoreFindings(findings), keys: new Set(findings.map(findingKey)) };
}
