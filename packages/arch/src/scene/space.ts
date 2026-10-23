/**
 * Space evidence for a placement that was refused for lack of room: the numbers the model needs to decide whether
 * to widen the shell (measured width and depth, free floor, the width the placed pieces want) and the call that does
 * it. Advisory text only; nothing here decides.
 */
import { cmr } from './geom';
import type { Finding } from './checks';
import type { Scene, SceneItem, SceneRoom } from './types';

/** Findings that say "there is no room" rather than "this is in the wrong place". */
export const SPACE_CODES: ReadonlySet<string> = new Set(['item_overlap', 'blocked_path', 'unreachable_item', 'doorway_blocked', 'no_front_clearance']);

/** Walkway left between the rows of floor pieces across the short axis. */
export const WALKWAY = 0.8;

function extent(it: SceneItem, axis: 0 | 1): [number, number] {
  const v = it.footprint.map((p) => p[axis]);
  return [Math.min(...v), Math.max(...v)];
}

/** Measured numbers of a room: size, free floor area and the width its floor pieces want across the short side. */
export function roomSpace(scene: Scene, room: SceneRoom) {
  const [x0, z0, x1, z1] = room.bbox;
  // The clear floor: the outline is wall centrelines, the pieces stand between the wall faces.
  const inset = room.walls.reduce((m, wl) => Math.max(m, wl.inset), 0);
  const w = x1 - x0 - 2 * inset;
  const d = z1 - z0 - 2 * inset;
  const shortAxis: 0 | 1 = w <= d ? 0 : 1;
  const longAxis: 0 | 1 = shortAxis === 0 ? 1 : 0;
  const floor = scene.items.filter((i) => i.room === room.id && i.mount === 'floor');
  const used = floor.reduce((s, i) => { const a = extent(i, 0); const b = extent(i, 1); return s + (a[1] - a[0]) * (b[1] - b[0]); }, 0);
  // A row is the pieces whose spans along the long side overlap: they stand side by side across the short side.
  let rowSum = 0;
  for (const p of floor) {
    const [l0, l1] = extent(p, longAxis);
    const row = floor.filter((q) => { const [m0, m1] = extent(q, longAxis); return m0 < l1 - 0.05 && m1 > l0 + 0.05; });
    rowSum = Math.max(rowSum, row.reduce((s, q) => { const [a, b] = extent(q, shortAxis); return s + (b - a); }, 0));
  }
  const short = shortAxis === 0 ? w : d;
  return { w, d, shortAxis, short, free: Math.max(0, room.area - used), needed: rowSum > 0 ? rowSum + WALKWAY : 0, rect: [x0, z0, x1, z1] as [number, number, number, number] };
}

/** The evidence paragraph for the refusals in `errors` (empty when none is a space refusal). */
export function spaceEvidence(scene: Scene, errors: readonly Finding[], ids: ReadonlySet<string>): string {
  if (!errors.some((e) => SPACE_CODES.has(e.code))) return '';
  const item = scene.items.find((i) => ids.has(i.id));
  const room = scene.rooms.find((r) => r.id === item?.room) ?? scene.rooms.find((r) => errors.some((e) => e.room === r.key));
  if (!room) return '';
  const s = roomSpace(scene, room);
  const f = (n: number) => cmr(n).toFixed(2);
  const lines = [`Space evidence for ${room.key} (advisory; you choose): clear floor ${f(s.w)} x ${f(s.d)} m between the wall faces, ${f(room.area)} m2 inside the wall centrelines, free floor ${f(s.free)} m2.`];
  if (s.needed > 0) {
    const gap = s.needed - s.short;
    lines.push(`The floor pieces side by side across the ${s.shortAxis === 0 ? 'x' : 'z'} (short) side take ${f(s.needed - WALKWAY)} m; with a ${WALKWAY} m walkway that wants ${f(s.needed)} m, the room has ${f(s.short)} m${gap > 0.05 ? ` (${f(gap)} m short)` : ''}.`);
    if (gap > 0.05) {
      const r = s.rect;
      const wider: number[] = s.shortAxis === 0 ? [r[0], r[1], r[2] + gap, r[3]] : [r[0], r[1], r[2], r[3] + gap];
      lines.push(`To widen, resend design_plan with room "${room.key}" rect [${r.map(f).join(', ')}] changed to [${wider.map(f).join(', ')}] (placed pieces stay; check the openings on the moved wall), then place the piece again instead of dropping it.`);
    }
  }
  return lines.join('\n');
}
