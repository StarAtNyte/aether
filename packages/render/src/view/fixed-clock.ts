/**
 * A fixed film clock for offline renders (a story film exported frame by frame): while it is set, everything that
 * animates from the wall clock reads this time instead (the compositing layer's drifting dust and sparkles, the node
 * frame's `time` that sways the foliage), so a frame depends only on its film time, never on how long it took to draw.
 * Null (the default): the wall clock, as live.
 */
let fixed: number | null = null;

/** Set the film time in seconds (null: back to the wall clock). */
export function setFixedClock(seconds: number | null): void {
  fixed = seconds !== null && Number.isFinite(seconds) ? seconds : null;
}

/** The film time in seconds, or null while the wall clock runs. */
export function fixedClock(): number | null {
  return fixed;
}
