/**
 * Hard limits enforced by `applyPatches` and `validateWorld`.
 *
 * They bound memory, CPU and token cost of a world regardless of what an LLM
 * (or a malicious client) asks for. The first six are part of the public
 * contract; the rest are additional safety rails.
 */
export const LIMITS = Object.freeze({
  /** Maximum number of entities (templates included). */
  MAX_ENTITIES: 5000,
  /** Maximum number of world rules. */
  MAX_RULES: 500,
  /** Maximum sum of `scatter.count` over all scatter entities. */
  MAX_SCATTER_TOTAL: 500_000,
  /** Maximum number of custom generators in `world.generators`. */
  MAX_GENERATORS: 64,
  /** Maximum number of custom scripts in `world.scripts`. */
  MAX_SCRIPTS: 64,
  /** Maximum number of verification tests. */
  MAX_TESTS: 100,
  /** Maximum number of patches accepted by a single `applyPatches` call. */
  MAX_PATCHES_PER_CALL: 10_000,
  /** Maximum parent-chain depth (root entities have depth 0). */
  MAX_HIERARCHY_DEPTH: 64,
  /** Maximum number of global state variables. */
  MAX_STATE_KEYS: 1000,
  /** Maximum number of HUD bindings. */
  MAX_HUD: 32,
  /** Maximum nesting depth of any untrusted JSON input. */
  MAX_INPUT_DEPTH: 64,
  /** Maximum number of JSON nodes (values) in one untrusted input. */
  MAX_INPUT_NODES: 2_000_000,
  /** Maximum length of any single string in untrusted input. */
  MAX_STRING_LENGTH: 100_000,
  /** Maximum number of editable mesh assets in `world.meshes`. */
  MAX_MESHES: 128,
  /** Maximum vertices of one mesh asset (indices are stored as uint16). */
  MAX_MESH_VERTICES: 65_536,
  /** Maximum triangles of one mesh asset. */
  MAX_MESH_TRIANGLES: 131_072,
  /** Maximum decoded bytes of all mesh assets of a world together. */
  MAX_MESH_BYTES: 24 * 1024 * 1024,
  /** Maximum hand-placed points of one scatter entity. */
  MAX_SCATTER_POINTS: 20_000,
});

/** Type of {@link LIMITS}. */
export type Limits = typeof LIMITS;
