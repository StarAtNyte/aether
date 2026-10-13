/**
 * Editable meshes: topology, editing operations, sculpt/paint brushes,
 * baking and colliders. Pure typed-array code (no three.js, no DOM), shared
 * by the studio, the compute worker and tests.
 */
export { buildTopology, boundaryVertices, edgeKey, edgeEnds, faceNormal, meshHealth, signedVolume, syncCopies, weldMap, WELD_EPSILON, type MeshHealth, type Topology } from './topology';
export { MeshBuilder, MeshLimitError } from './builder';
export {
  averageNormal,
  coplanarFaces,
  copiesOf,
  deleteFaces,
  extrudeFaces,
  faceEdges,
  faceVertices,
  flipFaces,
  insetFaces,
  mergeByDistance,
  nearestComponent,
  orientOutward,
  smoothMesh,
  softWeights,
  subdivide,
  transformVertices,
  transformVerticesInto,
  unwrapUVs,
} from './ops';
export { falloffWeight, SculptSession, type BrushDab, type BrushFalloff, type SculptMode } from './sculpt';
export { bakeOutput, meshColliders, MAX_HULL_POINTS, MAX_MATERIAL_SLOTS, type BakedMesh } from './bake';
export { MeshOp, runMeshOp, meshTransferables, parseMeshMessage, type MeshOpInput, type MeshOpResult } from './run';
