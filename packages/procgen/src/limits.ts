/**
 * Hard limits for generator outputs and the sandbox. They bound GPU memory,
 * physics cost and CPU time regardless of what generator code asks for.
 */
export const PROCGEN_LIMITS = Object.freeze({
  /** Max vertices over all parts of one output. */
  MAX_OUTPUT_VERTICES: 2_000_000,
  /** Max vertices a single generator run may allocate (intermediate meshes included). */
  MAX_ALLOCATED_VERTICES: 4_000_000,
  /** Max indices over all parts of one output. */
  MAX_OUTPUT_INDICES: 12_000_000,
  /** Max `api.library` pieces one generator run may start from. */
  MAX_LIBRARY_CALLS: 32,
  /** Max mesh parts (≈ draw calls) per output. */
  MAX_PARTS: 64,
  /** Max colliders per output. */
  MAX_COLLIDERS: 256,
  /** Max points of one convex-hull collider. */
  MAX_HULL_POINTS: 4096,
  /** Max vertices of one trimesh collider. */
  MAX_TRIMESH_VERTICES: 200_000,
  /** Max cells per side of a heightfield collider. */
  MAX_HEIGHTFIELD_CELLS: 512,
  /** Max absolute coordinate value. */
  MAX_COORDINATE: 10_000,
  /** Max generator source length (characters); matches the World IR schema. */
  MAX_SOURCE_LENGTH: 60_000,
  /** Default sandbox wall-clock budget per run. */
  DEFAULT_TIMEOUT_MS: 3000,
  /** Upper bound for a caller-provided timeout. */
  MAX_TIMEOUT_MS: 30_000,
});
