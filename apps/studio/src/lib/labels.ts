/**
 * Floating viewport labels: which entities get one and what it says
 * ("Crate · 12 kg"). Top-level, named, visible things only; backdrop
 * scenery and scatters are skipped; gameplay pieces and dynamic bodies
 * first. Pure.
 */
import type { Entity, WorldDoc } from '@aether/core';
import { MAX_LABELS, type LabelSpec } from '../engine/viewOverlay';

const BACKDROP_GENERATORS = new Set(['terrain', 'mountain', 'island', 'cloud', 'grass-tuft']);

function importance(e: Entity): number {
  let score = 0;
  if (e.tags.includes('focus')) score += 8;
  if (e.behaviors.length > 0) score += 4;
  if (e.physics?.body === 'dynamic') score += 3;
  if (e.light) score += 1;
  if (e.name) score += 1;
  return score;
}

function metricOf(e: Entity): string {
  if (e.light) return `${e.light.type} light`;
  const b = e.behaviors.find((x) => x.enabled);
  if (b) return b.type === 'collectible' ? 'pickup' : b.type;
  if (e.physics?.body === 'dynamic') return e.physics.mass !== undefined ? `${Math.round(e.physics.mass * 10) / 10} kg` : 'dynamic';
  if (e.shape.kind === 'procedural') return e.shape.generator.replace(/-/g, ' ');
  if (e.shape.kind === 'primitive') return e.shape.primitive;
  return e.shape.kind;
}

function labelHeight(e: Entity): number {
  const sy = Math.abs(e.transform.scale[1]) || 1;
  if (e.shape.kind === 'primitive') return (e.shape.size[1] / 2) * sy + 0.25;
  if (e.light) return 0.3;
  return 1.2 * sy;
}

/** Labels for a world, most important first (at most {@link MAX_LABELS}). */
export function worldLabels(world: Pick<WorldDoc, 'entities'>): LabelSpec[] {
  const out: Array<{ spec: LabelSpec; score: number }> = [];
  for (const id of Object.keys(world.entities)) {
    const e = world.entities[id];
    if (!e || e.parent !== null || e.template || !e.visible) continue;
    if (e.shape.kind === 'scatter') continue;
    if (e.shape.kind === 'procedural' && BACKDROP_GENERATORS.has(e.shape.generator)) continue;
    if (e.shape.kind === 'none' && !e.light) continue;
    const p = e.transform.position;
    out.push({ spec: { id, name: e.name || id, metric: metricOf(e), position: [p[0], p[1] + labelHeight(e), p[2]] }, score: importance(e) });
  }
  out.sort((a, b) => b.score - a.score || (a.spec.id < b.spec.id ? -1 : 1));
  return out.slice(0, MAX_LABELS).map((x) => x.spec);
}
