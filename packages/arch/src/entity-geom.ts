/** Geometry of arch entities read from a World IR document. */
import type { Entity, Json } from '@aether/core';
import { rotateYaw, type P2 } from './math2';

function params(e: Entity): Record<string, Json> {
  return e.shape.kind === 'procedural' ? e.shape.params : {};
}

/** World-space outline of a room or slab entity (`polygon` param), or null. */
export function placedPolygon(e: Entity, key = 'polygon'): P2[] | null {
  const raw = params(e)[key];
  if (!Array.isArray(raw)) return null;
  const pos = e.transform.position;
  const yaw = e.transform.rotation[1];
  const out: P2[] = [];
  for (const p of raw.slice(0, 256)) {
    if (!Array.isArray(p) || typeof p[0] !== 'number' || typeof p[1] !== 'number') return null;
    const r = rotateYaw(p[0], p[1], yaw);
    out.push([pos[0] + r[0], pos[2] + r[1]]);
  }
  return out.length >= 3 ? out : null;
}

