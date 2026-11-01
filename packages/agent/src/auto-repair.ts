/**
 * Automatic repair of buildings, run by the review loop before the model sees a round: the mechanical faults the checker
 * measures (furniture overlapping, poking through a wall, floating, standing on a stair) are fixed with the product's own
 * tools, so the model's turns go to what needs judgement.
 *
 * 1. Every room with an error is furnished again by the layout solver (`furnish_room`), which places pieces by their
 *    relations; the new layout is kept only when that room has fewer errors and the building no more in all.
 * 2. Small decor that still clashes (a book, a plant, a rug, a lamp) is taken out: losing a book is better than a book
 *    inside a lamp. Furniture that matters (beds, sofas, tables) is never removed here.
 *
 * Pure: it returns the patches and the repaired world; the caller applies the patches through its host.
 */
import { applyArchOps } from '@aether/arch';
import { applyPatches, type Patch, type WorldDoc } from '@aether/core';
import { snapshotForReview } from './review';

/** Pieces the repair may remove when they clash (generator `furn-<kind>`). */
const DECOR_KINDS: ReadonlySet<string> = new Set(['book', 'mug', 'plant', 'vase', 'rug', 'candle', 'table-lamp', 'frame', 'cushion', 'bowl', 'bottle']);
/** Findings a decor piece can be removed for. */
const DECOR_CODES: ReadonlySet<string> = new Set(['item_overlap', 'item_through_wall', 'floating', 'item_on_stairs', 'wall_item_overlap']);

export interface AutoRepair {
  patches: Patch[];
  world: WorldDoc;
  /** One line per repair, for the run's log. */
  lines: string[];
  before: number;
  after: number;
}

interface Finding {
  code?: string;
  severity: string;
  entities?: string[];
  message: string;
}

const errorsOf = (world: WorldDoc): Finding[] => (snapshotForReview(world, null, { maxViews: 0, withViews: false }).findings as Finding[]).filter((f) => f.severity === 'error');

/** Building and room of a furniture id (`<building>-l<level>-<room>-f<n>`). */
function roomOf(id: string): [string, string] | null {
  const m = /^(.+?)-l\d+-(.+)-f\d+$/.exec(id);
  return m ? [m[1] as string, m[2] as string] : null;
}

function inRoom(f: Finding, b: string, r: string): boolean {
  return (f.entities ?? []).some((e) => {
    const x = roomOf(e);
    return x !== null && x[0] === b && x[1] === r;
  });
}

function decorKind(world: WorldDoc, id: string): string | null {
  const e = world.entities[id];
  if (!e || e.shape.kind !== 'procedural') return null;
  const kind = e.shape.generator.replace(/^furn-/, '');
  return DECOR_KINDS.has(kind) ? kind : null;
}

/** Repair the buildings of `world`; `maxRooms` bounds the re-furnishing work of one call. */
export function autoRepairBuildings(world: WorldDoc, maxRooms = 40): AutoRepair {
  let current = world;
  let errors = errorsOf(current);
  const before = errors.length;
  const patches: Patch[] = [];
  const lines: string[] = [];
  if (before === 0) return { patches, world, lines, before, after: 0 };

  // 1. Re-furnish rooms with errors, keeping only layouts that help.
  const rooms = new Map<string, [string, string]>();
  for (const f of errors) for (const e of f.entities ?? []) {
    const x = roomOf(e);
    if (x) rooms.set(x.join('/'), x);
  }
  for (const [key, [b, r]] of [...rooms].slice(0, maxRooms)) {
    const was = errors.filter((f) => inRoom(f, b, r)).length;
    if (was === 0) continue;
    let res;
    try {
      res = applyArchOps(current, [{ op: 'furnish_room', building: b, room: r, furnish: true }]);
    } catch {
      continue;
    }
    if (res.errors.length > 0 || res.patches.length === 0) continue;
    const next = errorsOf(res.target);
    const now = next.filter((f) => inRoom(f, b, r)).length;
    if (now < was && next.length <= errors.length) {
      patches.push(...res.patches);
      current = res.target;
      errors = next;
      lines.push(`furnished ${key} again (${was} → ${now} errors)`);
    }
  }

  // 2. Small decor that still clashes comes out.
  const remove = new Set<string>();
  for (const f of errors) {
    if (!f.code || !DECOR_CODES.has(f.code)) continue;
    const decor = (f.entities ?? []).filter((id) => decorKind(current, id) !== null);
    // An overlap of two decor pieces loses one; otherwise the decor piece in the finding goes.
    const pick = decor[0];
    if (pick) remove.add(pick);
  }
  if (remove.size > 0) {
    const removals: Patch[] = [...remove].map((id) => ({ op: 'remove', id, recursive: true }) as Patch);
    const res = applyPatches(current, removals);
    if (res.applied.length > 0) {
      const next = errorsOf(res.world);
      if (next.length < errors.length) {
        patches.push(...res.applied);
        current = res.world;
        errors = next;
        lines.push(`removed ${res.applied.length} clashing decor piece${res.applied.length === 1 ? '' : 's'}`);
      }
    }
  }
  return { patches, world: current, lines, before, after: errors.length };
}
