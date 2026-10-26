/** Prepare our multi-draw camera lists after nested shadow rendering, before node/binding updates in Three r186. */
import { BatchedMesh, Matrix4, REVISION, type Mesh } from 'three';

import { velocity } from 'three/tsl';

const batches = new WeakMap<BatchedMesh, { prepared(): void; revision: number; callbacks: unknown[] }>();
const renderers = new WeakSet<object>();
const prepare = BatchedMesh.prototype.onBeforeRender as unknown as (this: BatchedMesh, ...args: unknown[]) => void;
interface RenderObject {
  object: BatchedMesh;
  scene: unknown;
  camera: unknown;
  geometry: unknown;
  material: unknown;
  group: unknown;
}
interface Port { _nodes?: { updateForRender?: (object: RenderObject) => unknown; updateAfter?: (object: RenderObject) => unknown } }

export function registerDrawBatch(mesh: BatchedMesh, prepared: () => void): void { batches.set(mesh, { prepared, revision: 0, callbacks: [mesh.onBeforeRender, mesh.onAfterRender, mesh.onBeforeShadow, mesh.onAfterShadow] }); }
export function invalidateDrawBatch(mesh: BatchedMesh): void { const state = batches.get(mesh); if (state) state.revision++; }
export function drawBatchRevision(object: object): number | undefined {
  const mesh = object as BatchedMesh, state = batches.get(mesh);
  if (!state || mesh.onBeforeRender !== state.callbacks[0] || mesh.onAfterRender !== state.callbacks[1] || mesh.onBeforeShadow !== state.callbacks[2] || mesh.onAfterShadow !== state.callbacks[3]) return undefined;
  return state.revision;
}
export function unregisterDrawBatch(mesh: BatchedMesh): void { batches.delete(mesh); }
export function hasBatchDrawPreparation(renderer: object): boolean { return renderers.has(renderer); }

/** Only our registered batches use this path. Unknown renderer internals retain native meshes. */
export function prepareBatchDraws(renderer: object): boolean {
  if (renderers.has(renderer)) return true;
  const nodes = (renderer as Port)._nodes, original = nodes?.updateForRender, after = nodes?.updateAfter;
  if (REVISION !== '186' || !nodes || typeof original !== 'function' || typeof after !== 'function' || typeof prepare !== 'function') return false;
  nodes.updateForRender = function (object: RenderObject): unknown {
    if (batches.has(object.object)) prepare.call(object.object, renderer, object.scene, object.camera, object.geometry, object.material, object.group);
    return original.call(this, object);
  };
  nodes.updateAfter = function (object: RenderObject): unknown {
    const result = after.call(this, object);
    if (!(object.material as { isShadowPassMaterial?: boolean }).isShadowPassMaterial) batches.get(object.object)?.prepared();
    return result;
  };
  renderers.add(renderer);
  return true;
}

const currentWorld = new Matrix4();
/** Native originals resume with the last batched world pose, rather than history from before they joined the batch. */
export function seedMeshVelocity(mesh: Mesh, previous: Matrix4): void {
  currentWorld.copy(mesh.matrixWorld);
  mesh.matrixWorld.copy(previous);
  try { (velocity.updateAfter as unknown as (frame: { object: Mesh }) => void).call(velocity, { object: mesh }); }
  finally { mesh.matrixWorld.copy(currentWorld); }
}
