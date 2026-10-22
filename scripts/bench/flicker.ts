/**
 * Flicker scores of a camera orbit, from grey frames (0..255). A slow orbit moves every edge a little each frame, so a steady image
 * changes linearly from frame to frame; what flickers (shadow edges that crawl, specular sparkle on thin geometry, a texture that
 * swims under a missing mip) breaks the line. Two numbers, both mean absolute grey levels (lower is better):
 *  - `orbit`: the second temporal difference |F(t) - (F(t-1) + F(t+1)) / 2| over the orbit frames.
 *  - `still`: |A - B| of two frames drawn from the same pose (what a jittered or noisy pipeline does while the camera rests).
 */
export interface FlickerScore {
  orbit: number;
  still: number;
}

/** Mean absolute second temporal difference of frames of equal size. */
export function orbitFlicker(frames: ReadonlyArray<ArrayLike<number>>): number {
  if (frames.length < 3) return 0;
  let sum = 0;
  let count = 0;
  for (let t = 1; t < frames.length - 1; t++) {
    const a = frames[t - 1] as ArrayLike<number>;
    const b = frames[t] as ArrayLike<number>;
    const c = frames[t + 1] as ArrayLike<number>;
    for (let i = 0; i < b.length; i++) {
      sum += Math.abs((b[i] as number) - ((a[i] as number) + (c[i] as number)) / 2);
      count++;
    }
  }
  return count > 0 ? sum / count : 0;
}

/** Mean absolute difference of two frames from the same pose. */
export function stillFlicker(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let sum = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) sum += Math.abs((a[i] as number) - (b[i] as number));
  return n > 0 ? sum / n : 0;
}
