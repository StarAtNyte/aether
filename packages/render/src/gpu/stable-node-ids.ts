/**
 * Node ids of their own for uniform arrays.
 *
 * The GLSL backend names a uniform array's block `buffer<node id>`, and three numbers nodes in the order they are made,
 * counting every node of the page. A load that builds its materials in another order (the cook's recording against the
 * player, a streamed world, one more material on the way) then gives the same program other sources, and a cooked or
 * stored program set no longer matches it. An array that takes an id here is named by its owner's kind and the order of
 * that kind alone, in a range three's running count never reaches.
 */

/** First id of each kind, far apart and far above three's running node count. */
const BASES = { lamp: 1_000_000_000, water: 1_100_000_000 } as const;
/** Ids each owner reserves (an owner's arrays take consecutive ids). */
const STRIDE = 16;
const owners: Record<keyof typeof BASES, number> = { lamp: 0, water: 0 };

/** Give `nodes` (the uniform arrays of one owner of `kind`, at most 16) the next block of ids of that kind. */
export function takeStableIds(kind: keyof typeof BASES, nodes: readonly unknown[]): void {
  if (nodes.length > STRIDE) throw new Error(`at most ${STRIDE} arrays per owner`);
  const base = BASES[kind] + owners[kind]++ * STRIDE;
  nodes.forEach((node, j) => {
    (node as { id: number }).id = base + j;
  });
}
