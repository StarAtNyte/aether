/**
 * Settling a building on terrain. A piece placed by its centre point alone ends up sunk on the high side of a slope and
 * hanging on the low side (the Sakura River's riverside houses, pagoda and torii stood at a fixed height on a bank that
 * rises across their footprint). The rule is one for the whole harness: the base stands on the highest ground of the real
 * footprint (a small clearance above it), and a plinth fills the gap down to the lowest ground, so there is neither a
 * buried floor nor a gap under it.
 *
 * - {@link settleOnTerrain}: the measurement and the plinth, a pure function (used by the offline builder for every
 *   building a generator, template or tool places, `Builder.gen`).
 * - {@link settleFindings}: the world-quality pass's data fix, for a finished world: every piece the sunk check finds
 *   buried or hanging over a drop is raised or footed through patches.
 */
import type { Entity, Json, PatchInput, WorldDoc } from '@aether/core';
import { settleBounds, settleOnTerrain, PLINTH_MATERIAL } from './settle-core';
import { findSunk } from './sunk';
import { worldGround } from './land';

export { SETTLE_CLEARANCE, SETTLE_FLAT, PLINTH_MARGIN, PLINTH_MATERIAL, settleBounds, settleOnTerrain, type Settled } from './settle-core';

const r2 = (n: number): number => Math.round(n * 100) / 100;

/** A finding of the settle fix: the piece, what was wrong, and the patches that set it down. */
export interface SettleFix {
  id: string;
  kind: 'sunk' | 'overhang';
  /** Metres the floor was under the highest ground (sunk) or above the ground it hangs over (overhang). */
  depth: number;
  patches: PatchInput[];
}

/**
 * The fixes for every building of `world` that is sunk into the terrain or hangs over a drop: the piece is raised to the
 * highest ground of its footprint and a plinth fills the slope under it. A piece with a footing param, an arch building (it
 * has its own plinth option), a scatter layer or a parented piece is left to its own rules (the sunk check never reports
 * them for settling).
 */
export function settleFindings(world: WorldDoc): SettleFix[] {
  const ground = worldGround(world);
  const out: SettleFix[] = [];
  for (const p of findSunk(world)) {
    const e: Entity | undefined = world.entities[p.id];
    if (!e || e.shape.kind !== 'procedural' || e.parent || e.arch) continue;
    const params = e.shape.params as Record<string, Json>;
    const bounds = settleBounds(e.shape.generator, params, e.shape.seed ?? 0);
    if (!bounds) continue;
    const [x, y, z] = e.transform.position;
    // The bounds' own floor is at min y; the entity origin sits that far above the floor.
    const s = settleOnTerrain(ground, [x, z], bounds, e.transform.rotation[1], e.transform.scale);
    const newY = r2(s.floorY - bounds.min[1] * e.transform.scale[1]);
    if (Math.abs(newY - y) < 0.02 && !s.plinth) continue;
    const patches: PatchInput[] = [{ op: 'update', id: e.id, set: { transform: { ...e.transform, position: [x, newY, z] } } } as PatchInput];
    if (s.plinth) {
      patches.push({
        op: 'add',
        entity: {
          id: `${e.id}-plinth`,
          name: `${e.name || e.id} plinth`,
          transform: { position: s.plinth.position, rotation: [0, s.plinth.yaw, 0] },
          shape: { kind: 'primitive', primitive: 'box', size: s.plinth.size },
          material: { ...PLINTH_MATERIAL },
          physics: { body: 'static' },
          tags: ['foundation'],
        },
      } as PatchInput);
    }
    out.push({ id: e.id, kind: p.kind === 'overhang' ? 'overhang' : 'sunk', depth: p.depth, patches });
  }
  return out;
}
