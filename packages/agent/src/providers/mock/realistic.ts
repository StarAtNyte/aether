/**
 * "Make it realistic": when a request asks for a realistic, photoreal or lifelike look, the offline
 * planner's stylised nature parts (low-poly pines, oaks, bushes, grass tufts, rocks) are exchanged for
 * the realistic vegetation generators (leaf-card broadleaf trees, spruce, shrubs, meadow grass, boulders
 * with the photographed rock surface). The plan's layout, counts and positions stay: only the generator
 * and its parameters change, so everything that was verified about the placement still holds.
 */
import type { Json, PatchInput } from '@aether/core';
import type { MockPlan } from './planner';

/** Wording that asks for a realistic look. */
export const REALISTIC_RE = /\b(?:realistic(?:ally)?|photo-?realistic|photoreal|life-?like|true[- ]to[- ]life|naturalistic)\b/i;

/**
 * Wording that asks for a stylised look on purpose. Without it, worlds are built realistic by default (the leaf-card
 * vegetation, a landscape instead of a flat plane); with it the low-poly stylised parts stay.
 */
export const STYLISED_RE = /\b(?:low[- ]?poly|cartoon(?:y|ish)?|stylis(?:ed|ized)|styliz(?:ed)?|toon|cel[- ]?shaded|painterly|cute|kawaii|chibi|toy(?:like|[- ]town)?|pixel(?:ated)?|voxel|blocky|minecraft|lego|flat[- ]shaded|simple shapes|claymation|paper ?craft|diorama)\b/i;

/** True when a request should be built with the realistic parts (everything that does not ask for a stylised look). */
export function wantsRealistic(request: string): boolean {
  return REALISTIC_RE.test(request) || !STYLISED_RE.test(request);
}

const STYLISED_NATURE: ReadonlySet<string> = new Set(['tree-pine', 'tree-oak', 'bush', 'grass-tuft', 'rock', 'flowers']);
const REALISTIC_NATURE: ReadonlySet<string> = new Set(['tree-broadleaf', 'tree-spruce', 'tree-birch', 'shrub', 'meadow-grass', 'boulder', 'wildflowers', 'fern', 'cactus']);

/**
 * Whether parts added for `request` to `world` should be realistic: never when the request asks for a stylised look;
 * otherwise unless the world is already built mostly from the stylised nature parts (a painterly world stays painterly).
 */
export function realisticWorld(request: string, world: { entities: Readonly<Record<string, { shape: { kind: string; generator?: string; of?: { kind: string; generator?: string } } }>> }): boolean {
  if (!wantsRealistic(request)) return false;
  let stylised = 0;
  let realistic = 0;
  for (const e of Object.values(world.entities)) {
    const g = e.shape.kind === 'procedural' ? e.shape.generator : e.shape.kind === 'scatter' && e.shape.of?.kind === 'procedural' ? e.shape.of.generator : undefined;
    if (!g) continue;
    if (STYLISED_NATURE.has(g)) stylised++;
    else if (REALISTIC_NATURE.has(g)) realistic++;
  }
  return realistic >= stylised;
}

type Params = Record<string, Json>;

function num(v: Json | undefined, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function copy(p: Params, keys: readonly string[]): Params {
  const out: Params = {};
  for (const k of keys) if (p[k] !== undefined) out[k] = p[k] as Json;
  return out;
}

/** The realistic stand-in for a stylised generator, or null when there is none. */
export function realisticStandIn(generator: string, params: Params): { generator: string; params: Params } | null {
  switch (generator) {
    case 'tree-oak':
      return { generator: 'tree-broadleaf', params: { ...copy(params, ['color', 'trunkColor']), height: Math.max(6, num(params['height'], 6) * 1.5), variant: Math.min(2, Math.max(0, Math.round(num(params['variant'], 2)))) } };
    case 'hero-cherry-tree':
      // Cherry blossom: a wide broadleaf crown in blossom pink on a dark, twisting trunk.
      return { generator: 'tree-broadleaf', params: { color: typeof params['blossomColor'] === 'string' ? params['blossomColor'] : '#f1a9c0', trunkColor: typeof params['barkColor'] === 'string' ? params['barkColor'] : '#3b2a24', height: Math.max(5, num(params['height'], 5.5) * 1.35), variant: 2, blossom: 1 } };
    case 'tree-pine':
      return { generator: 'tree-spruce', params: { ...copy(params, ['color', 'trunkColor']), height: Math.max(8, num(params['height'], 7) * 1.6), snow: params['snow'] === true ? 0.8 : typeof params['snow'] === 'number' ? params['snow'] : 0 } };
    case 'bush':
      return { generator: 'shrub', params: { ...copy(params, ['color']), size: num(params['size'], 1.2) } };
    case 'flowers':
      return { generator: 'wildflowers', params: { ...copy(params, ['color']), size: num(params['size'], 0.6) * 0.8 } };
    case 'grass-tuft':
      return { generator: 'meadow-grass', params: { ...copy(params, ['color']), size: num(params['size'], 0.5) } };
    case 'rock':
      return { generator: 'boulder', params: { ...copy(params, ['color']), size: num(params['size'], 1.5), lichen: params['mossy'] === true ? 0.6 : 0.15, variant: Math.min(2, Math.max(0, Math.round(num(params['variant'], 0)))) } };
    default:
      return null;
  }
}

interface ShapeLike {
  kind?: unknown;
  generator?: unknown;
  params?: unknown;
  of?: unknown;
}

function swapShape(shape: ShapeLike): number {
  let n = 0;
  if (shape.kind === 'scatter' && typeof shape.of === 'object' && shape.of !== null) n += swapShape(shape.of as ShapeLike);
  if (shape.kind === 'procedural' && typeof shape.generator === 'string') {
    const params = typeof shape.params === 'object' && shape.params !== null && !Array.isArray(shape.params) ? (shape.params as Params) : {};
    const stand = realisticStandIn(shape.generator, params);
    if (stand) {
      shape.generator = stand.generator;
      shape.params = stand.params;
      n++;
    }
  }
  return n;
}

/** Exchange the stylised nature parts of a plan for realistic ones (in place); returns how many shapes changed. */
export function makeRealistic(patches: readonly PatchInput[]): number {
  let n = 0;
  for (const p of patches) {
    if (p.op === 'add' && p.entity && typeof p.entity === 'object') {
      const shape = (p.entity as { shape?: ShapeLike }).shape;
      if (shape) n += swapShape(shape);
    }
  }
  return n;
}

/** Apply the realistic exchange to a plan when the request asks for it. */
export function realisticPlan(request: string, plan: MockPlan): MockPlan {
  if (!REALISTIC_RE.test(request) || plan.patches.length === 0) return plan;
  const patches = structuredClone(plan.patches) as PatchInput[];
  const changed = makeRealistic(patches);
  if (changed === 0) return plan;
  return { ...plan, patches, plan: `${plan.plan} Realistic look: ${changed} stylised nature parts exchanged for realistic vegetation.`.trim() };
}
