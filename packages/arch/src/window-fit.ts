/**
 * Window fitting: where one more window can go on a room's exterior walls.
 * Works on the compiled building's exterior wall record (`CompiledBuilding.exterior`): each stretch of a room's
 * outline that faces outdoors, with the doors and windows already on it. A new window needs clear wall away from
 * the corners and the other openings; the widest clear stretch wins, so a window goes to an empty wall before it
 * crowds one that already has openings. When no stretch is clear but a wall carries an even row of windows that
 * one more would still fit, the row is re-spread with one more. Used by `add_window` when the side is left open
 * (the offline planner, agents that only name the room) and to keep auto-placed windows when a room gets its
 * first explicit one.
 */
import type { Compass, PlanWindow } from './plan';
import type { ExteriorWall } from './compile';

/** Clear wall kept at the ends of an exterior stretch (corners, wall joins). */
export const WINDOW_END_MARGIN = 0.4;
/** Clear wall kept between a new window and another opening. */
export const WINDOW_GAP = 0.4;

/** A spot for a new window: the side, its centre in edge metres (the `PlanWindow.centres` frame) and the clear stretch it sits in. */
export interface WindowSpot {
  side: Compass;
  centre: number;
  /** Clear stretch the window was centred in (edge metres). */
  free: [number, number];
}

const r3 = (n: number): number => Math.round(n * 1000) / 1000;

/** Clear stretches of one exterior wall for a new window (edge metres): the wall minus corner margins and the openings with a gap. */
export function clearStretches(wall: Pick<ExteriorWall, 't0' | 't1' | 'openings'>, extra: ReadonlyArray<[number, number]> = []): Array<[number, number]> {
  let free: Array<[number, number]> = [[wall.t0 + WINDOW_END_MARGIN, wall.t1 - WINDOW_END_MARGIN]];
  const blocks: Array<[number, number]> = [...wall.openings.map((o): [number, number] => [o.t0, o.t1]), ...extra];
  for (const [b0, b1] of blocks) {
    const lo = b0 - WINDOW_GAP;
    const hi = b1 + WINDOW_GAP;
    const next: Array<[number, number]> = [];
    for (const [s, u] of free) {
      if (hi <= s || lo >= u) next.push([s, u]);
      else {
        if (lo > s) next.push([s, lo]);
        if (hi < u) next.push([hi, u]);
      }
    }
    free = next;
  }
  return free.filter(([s, u]) => u - s > 0);
}

/**
 * The best spot for one more window of `width` in `room` on `level` (optionally on one `side`): the centre of the
 * widest clear stretch that fits it, or null when no exterior wall has room. `taken` holds spots already chosen in
 * this batch (per wall, keyed `side:edge`). Deterministic: ties keep the record order.
 */
export function fitWindow(exterior: readonly ExteriorWall[], level: number, room: string, width: number, side?: Compass, taken: ReadonlyMap<string, ReadonlyArray<[number, number]>> = new Map()): WindowSpot | null {
  let best: WindowSpot | null = null;
  let bestLen = 0;
  for (const wall of exterior) {
    if (wall.level !== level || wall.room !== room || (side !== undefined && wall.side !== side)) continue;
    for (const [s, u] of clearStretches(wall, taken.get(`${wall.side}:${wall.edge}`) ?? [])) {
      const len = u - s;
      if (len + 1e-9 < width || len <= bestLen) continue;
      bestLen = len;
      best = { side: wall.side, centre: r3((s + u) / 2), free: [s, u] };
    }
  }
  return best;
}

/** The longest exterior stretch of a room on one side (the stretch an evenly spread window spec uses). */
function longestStretch(exterior: readonly ExteriorWall[], level: number, room: string, side: Compass): ExteriorWall | undefined {
  let best: ExteriorWall | undefined;
  for (const w of exterior) if (w.level === level && w.room === room && w.side === side && (!best || w.t1 - w.t0 > best.t1 - best.t0)) best = w;
  return best;
}

/** Centres of `n` windows spread evenly over a stretch (the compiler's even spread). */
function spread(wall: Pick<ExteriorWall, 't0' | 't1'>, n: number): number[] {
  const len = wall.t1 - wall.t0;
  return Array.from({ length: n }, (_, k) => wall.t0 + (len * (k + 0.5)) / n);
}

/** How many windows of `width` the compiler spreads over a stretch of `len` metres. */
function spreadCapacity(len: number, width: number): number {
  return Math.floor((len - 0.4) / (width + 0.4));
}

const STYLES: ReadonlySet<string> = new Set(['casement', 'fixed', 'sliding', 'grid', 'picture']);

/**
 * The windows a room shows now, as explicit specs: what the compiler placed on its own (auto windows) becomes part
 * of the plan, so adding a first explicit window keeps them instead of replacing them. An even row on a side's
 * longest stretch stays an even spread (so one more can re-spread it); anything else gets exact centres.
 */
export function windowsAsSpecs(exterior: readonly ExteriorWall[], level: number, room: string): PlanWindow[] {
  const out: PlanWindow[] = [];
  const sides = [...new Set(exterior.filter((w) => w.level === level && w.room === room).map((w) => w.side))];
  for (const side of sides) {
    const walls = exterior.filter((w) => w.level === level && w.room === room && w.side === side);
    const wins = walls.flatMap((w) => w.openings.filter((o) => o.kind === 'window').map((o) => ({ wall: w, o })));
    if (wins.length === 0) continue;
    const first = wins[0]?.o;
    const main = longestStretch(exterior, level, room, side);
    const uniform = first !== undefined && wins.every(({ o }) => Math.abs(o.t1 - o.t0 - (first.t1 - first.t0)) < 0.005 && Math.abs(o.sill - first.sill) < 0.005 && Math.abs(o.height - first.height) < 0.005 && o.style === first.style);
    const even = uniform && main !== undefined && wins.every(({ wall }) => wall === main) && spread(main, wins.length).every((c, k) => {
      const o = wins[k]?.o;
      return o !== undefined && Math.abs((o.t0 + o.t1) / 2 - c) < 0.02;
    });
    if (even && first) {
      const style = first.style && STYLES.has(first.style) ? (first.style as PlanWindow['style']) : undefined;
      out.push({ room, side, count: wins.length, width: r3(first.t1 - first.t0), height: first.height, sill: first.sill, ...(style ? { style } : {}) });
      continue;
    }
    for (const { o } of wins) {
      const style = o.style && STYLES.has(o.style) ? (o.style as PlanWindow['style']) : undefined;
      out.push({ room, side, count: 1, width: r3(o.t1 - o.t0), height: o.height, sill: o.sill, centres: [r3((o.t0 + o.t1) / 2)], ...(style ? { style } : {}) });
    }
  }
  return out;
}

/** A request for more windows in a room: the plan window with the side optional. */
export type WindowRequest = Omit<PlanWindow, 'side'> & { side?: Compass | undefined };

/** Outcome of {@link planWindowAddition}. */
export type WindowAddition =
  | { ok: true; windows: PlanWindow[]; placed: number; line: string }
  | { ok: false; message: string; hint: string };

/**
 * Add `req.count` windows to a room on `level`, given the level's window specs and the compiled exterior walls.
 * The room's current windows are kept (auto windows become explicit specs first). Each new window goes to the
 * centre of the widest clear stretch; when no stretch is clear, an even row that has room for one more is
 * re-spread. Pure: returns the level's new window list.
 */
export function planWindowAddition(exterior: readonly ExteriorWall[], current: readonly PlanWindow[], level: number, room: string, req: WindowRequest): WindowAddition {
  const windows: PlanWindow[] = current.map((w) => ({ ...w, ...(w.centres ? { centres: [...w.centres] } : {}) }));
  if (!windows.some((w) => w.room === room)) windows.push(...windowsAsSpecs(exterior, level, room));
  const taken = new Map<string, Array<[number, number]>>();
  const sides: Compass[] = [];
  let respread = 0;
  for (let k = 0; k < req.count; k++) {
    const spot = fitWindow(exterior, level, room, req.width, req.side, taken);
    if (spot) {
      const wall = exterior.find((w) => w.level === level && w.room === room && w.side === spot.side && spot.centre >= w.t0 && spot.centre <= w.t1);
      const key = `${spot.side}:${wall?.edge ?? -1}`;
      taken.set(key, [...(taken.get(key) ?? []), [spot.centre - req.width / 2, spot.centre + req.width / 2]]);
      const { side: _side, ...rest } = req;
      windows.push({ ...rest, room, side: spot.side, count: 1, centres: [spot.centre] });
      sides.push(spot.side);
      continue;
    }
    // No clear stretch: one more window in an even row that still has room for it (no doors on that stretch).
    const row = windows.find((w) => {
      // Only a row of windows about the size asked for (a 6 m picture window is not "one more of these").
      if (w.room !== room || w.centres || (req.side !== undefined && w.side !== req.side) || Math.abs(w.width - req.width) > 0.4) return false;
      const main = longestStretch(exterior, level, room, w.side);
      if (!main || main.openings.some((o) => o.kind !== 'window')) return false;
      const extra = (taken.get(`${w.side}:${main.edge}`) ?? []).length;
      return extra === 0 && spreadCapacity(main.t1 - main.t0, w.width) >= w.count + 1;
    });
    if (!row) break;
    row.count += 1;
    respread++;
    sides.push(row.side);
  }
  const placed = sides.length;
  if (placed === 0) {
    const walls = exterior.filter((w) => w.level === level && w.room === room);
    const free = walls.map((w) => `${w.side} ${Math.max(0, ...clearStretches(w).map(([a, b]) => b - a)).toFixed(2)} m`).join(', ');
    return {
      ok: false,
      message: `no exterior wall of ${room}${req.side ? ` facing ${req.side}` : ''} has ${req.width} m of clear wall for a window`,
      hint: walls.length === 0 ? `${room} has no exterior wall; pick a room on the outside of the building.` : `Widest clear stretch per exterior wall (corners and openings kept ${WINDOW_GAP} m clear): ${free}. Use a narrower window${req.side ? ' or another side' : ''}.`,
    };
  }
  const where = [...new Set(sides)].join(' and ');
  const how = respread > 0 ? (respread === placed ? ' (the row there re-spread evenly)' : ' (partly by re-spreading the row there)') : ' (centred in its widest clear stretch)';
  return { ok: true, windows, placed, line: `${placed} window(s)${respread === 0 ? ` ${req.width} m wide` : ''} on the ${where} wall of ${room}${how}${placed < req.count ? `; only ${placed} of ${req.count} fit` : ''}` };
}
