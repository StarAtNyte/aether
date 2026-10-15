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
    case 'tree-pine':
      return { generator: 'tree-spruce', params: { ...copy(params, ['color', 'trunkColor']), height: Math.max(8, num(params['height'], 7) * 1.6), snow: params['snow'] === true ? 0.8 : 0 } };
    case 'bush':
      return { generator: 'shrub', params: { ...copy(params, ['color']), size: num(params['size'], 1.2) } };
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
