/**
 * Deterministic pseudo-random numbers and hashing.
 * Never use `Math.random()` for generation or simulation — use these.
 */

/** splitmix32 step used to expand a single seed into sfc32 state. */
function splitmix32(state: { s: number }): number {
  state.s = (state.s + 0x9e3779b9) | 0;
  let z = state.s;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
  return (z ^ (z >>> 16)) >>> 0;
}

/** Fold any number (negative, fractional, > 2^32, non-finite) into a uint32 seed. */
function normalizeSeed(seed: number): number {
  if (!Number.isFinite(seed)) return 0;
  const int = Math.trunc(seed);
  const lo = int >>> 0;
  const hi = Math.trunc(int / 4294967296) >>> 0;
  const frac = Math.round((seed - int) * 4294967296) >>> 0;
  return (lo ^ Math.imul(hi, 0x27d4eb2d) ^ Math.imul(frac, 0x165667b1)) >>> 0;
}

/**
 * Seeded PRNG (sfc32, seeded through splitmix32). Returns a function yielding
 * floats uniformly distributed in [0, 1). Same seed → same sequence on every
 * platform (pure 32-bit integer math).
 */
export function rng(seed: number): () => number {
  const st = { s: normalizeSeed(seed) };
  let a = splitmix32(st);
  let b = splitmix32(st);
  let c = splitmix32(st);
  let d = splitmix32(st);
  const next = (): number => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 12; i++) next();
  return next;
}

/**
 * 32-bit FNV-1a hash of the UTF-8 encoding of `s` (unsigned integer result).
 * Matches reference test vectors, e.g. hashString('a') === 0xe40c292c.
 */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  const mix = (byte: number): void => {
    h ^= byte;
    h = Math.imul(h, 0x01000193);
  };
  for (let i = 0; i < s.length; i++) {
    let cp = s.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < s.length) {
      const lo = s.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        cp = 0x10000 + ((cp - 0xd800) << 10) + (lo - 0xdc00);
        i++;
      }
    }
    if (cp < 0x80) mix(cp);
    else if (cp < 0x800) {
      mix(0xc0 | (cp >> 6));
      mix(0x80 | (cp & 63));
    } else if (cp < 0x10000) {
      mix(0xe0 | (cp >> 12));
      mix(0x80 | ((cp >> 6) & 63));
      mix(0x80 | (cp & 63));
    } else {
      mix(0xf0 | (cp >> 18));
      mix(0x80 | ((cp >> 12) & 63));
      mix(0x80 | ((cp >> 6) & 63));
      mix(0x80 | (cp & 63));
    }
  }
  return h >>> 0;
}
