/**
 * Tiny numeric helpers for the allocation-free NPC hot path. `Math.hypot` is a
 * non-inlined builtin that boxes its result, so distance code uses `hyp`.
 */
/** sqrt(dx² + dz²) without boxing. */
export function hyp(dx, dz) {
    return Math.sqrt(dx * dx + dz * dz);
}
