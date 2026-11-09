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
import { isSettleable, settleBounds, settleOnTerrain, PLINTH_MATERIAL } from './settle-core';
import { supports } from './sunk';
import { worldGround } from './land';

export { SETTLE_CLEARANCE, SETTLE_FLAT, PLINTH_MARGIN, PLINTH_MATERIAL, settleBounds, settleOnTerrain, type Settled } from './settle-core';

const r2 = (n: number): number => Math.round(n * 100) / 100;

/** A finding of the settle fix: the piece, what was wrong, and the patches that set it down. */
export interface SettleFix {
  id: string;
  /** sunk: the floor was under the highest ground; overhang: it hovered over the ground; footing: it stood on a slope with a gap on the low side. */
  kind: 'sunk' | 'overhang' | 'footing';
  /** Metres the floor was under the highest ground (sunk) or above it (overhang); the ground rise across the footprint for a footing. */
  depth: number;
  patches: PatchInput[];
}

const NO_SETTLE_TAG = /^(sunk|buried|underground|in-ground|dug-in|floating|hover|flying|sky|backdrop)$/;
/** A building is buried by at most this much and hovers by at most this much when a tool placed it by its centre point (m). */
const MAX_BURIED = 8;
const MAX_HOVER = 2.5;

/**
 * The fixes for the buildings of `world` (or only `only`) that are not settled on the terrain: buried on the uphill side,
 * hovering a little above it, or standing on a slope with a gap on the downhill side. Each is set on the highest ground of
 * its footprint with a plinth down to the lowest. Left alone: anything on a built surface (a platform, a terrace), with
 * its own footing param, tagged sunk/floating, parented, an arch building (it has its own plinth option) or with no
 * terrain in the world.
 */
export function settleFindings(world: WorldDoc, only?: ReadonlySet<string>): SettleFix[] {
  const hasTerrain = Object.values(world.entities).some((e) => e.shape.kind === 'procedural' && e.shape.generator === 'terrain' && !e.parent);
  if (!hasTerrain) return [];
  const ground = worldGround(world);
  const decks = supports(world);
  const out: SettleFix[] = [];
  for (const e of Object.values(world.entities)) {
    if (only && !only.has(e.id)) continue;
    if (e.shape.kind !== 'procedural' || e.parent || e.arch || e.template || !e.visible) continue;
    if (e.tags.some((t) => NO_SETTLE_TAG.test(t)) || !isSettleable(e.shape.generator)) continue;
    const params = e.shape.params as Record<string, Json>;
    if (typeof params['footing'] === 'number' && params['footing'] > 0) continue;
    const bounds = settleBounds(e.shape.generator, params, e.shape.seed ?? 0);
    if (!bounds) continue;
    const [x, y, z] = e.transform.position;
    const sc = e.transform.scale;
    const s = settleOnTerrain(ground, [x, z], bounds, e.transform.rotation[1], sc);
    const foot = y + bounds.min[1] * sc[1];
    // On a built surface (not on the terrain): it stands where it was put.
    const held = decks.top(x, z, foot + Math.max(0.4, (bounds.max[1] - bounds.min[1]) * sc[1]), e.id);
    if (Number.isFinite(held) && held > s.hi + 0.2 && held >= foot - 0.5) continue;
    const buried = s.hi - foot;
    const hover = foot - s.hi;
    let newY = y;
    let kind: SettleFix['kind'] | null = null;
    let depth = 0;
    if (buried > 0.05 && buried <= MAX_BURIED) {
      kind = 'sunk';
      depth = buried;
    } else if (hover > 0.3 && hover <= MAX_HOVER) {
      kind = 'overhang';
      depth = hover;
    } else if (s.plinth && !world.entities[`${e.id}-plinth`] && Math.abs(hover) <= 0.3 && s.hi - s.lo > 0.3) {
      kind = 'footing';
      depth = s.hi - s.lo;
    }
    if (!kind) continue;
    if (kind !== 'footing') newY = r2(s.floorY - bounds.min[1] * sc[1]);
    const patches: PatchInput[] = [];
    if (newY !== y) patches.push({ op: 'update', id: e.id, set: { transform: { ...e.transform, position: [x, newY, z] } } } as PatchInput);
    if (s.plinth && !world.entities[`${e.id}-plinth`]) {
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
    if (patches.length > 0) out.push({ id: e.id, kind, depth, patches });
  }
  return out;
}
