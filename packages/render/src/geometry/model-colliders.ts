/**
 * Triangle-mesh colliders from a loaded model (a `model` entity whose physics asks for `trimesh`).
 *
 * The physics package cannot read glTF: without a provider a model collides as a box of its fit size. A baked scene
 * (Cloudwatch Harbour's terrain, stair and houses) needs its real surfaces to stand on, so the simulation asks the
 * renderer, which holds the model, for its triangles in the entity's own frame. Outline shells (back-face materials),
 * transparent cards and skinned meshes are left out: they are not surfaces anyone walks on.
 */
import { BackSide, Matrix4, Vector3, type BufferGeometry, type Material, type Mesh, type Object3D } from 'three';
import type { ColliderDesc } from '@aether/procgen';

/** Most vertices in one trimesh collider (under physics' SHAPE_LIMITS.MAX_TRIMESH_VERTICES). */
export const MODEL_COLLIDER_MAX_VERTICES = 180_000;
/** Most triangles taken from one model (a hostile file cannot ask for millions). */
export const MODEL_COLLIDER_MAX_TRIANGLES = 600_000;

const _m = new Matrix4();
const _inv = new Matrix4();
const _v = new Vector3();

function solid(material: Material | Material[]): boolean {
  const list = Array.isArray(material) ? material : [material];
  return list.some((m) => m.side !== BackSide && !m.transparent && m.visible !== false);
}

/** A mesh's triangles (in `toLocal` space) appended to the running collider lists. */
interface Acc {
  out: ColliderDesc[];
  pos: number[];
  idx: number[];
  triangles: number;
}

function flush(acc: Acc): void {
  if (acc.idx.length === 0) return;
  acc.out.push({ kind: 'trimesh', positions: new Float32Array(acc.pos), indices: new Uint32Array(acc.idx) });
  acc.pos = [];
  acc.idx = [];
}

function addMesh(mesh: Mesh, toLocal: Matrix4, acc: Acc): void {
  const geom = mesh.geometry as BufferGeometry;
  const p = geom.getAttribute('position');
  if (!p || p.count === 0 || (p as { array?: ArrayLike<number> }).array?.length === 0) return;
  const index = geom.getIndex();
  if (index && index.array.length === 0) return;
  _m.multiplyMatrices(toLocal, mesh.matrixWorld);
  const triCount = Math.floor((index ? index.count : p.count) / 3);
  if (p.count > MODEL_COLLIDER_MAX_VERTICES) return;
  if (acc.pos.length / 3 + p.count > MODEL_COLLIDER_MAX_VERTICES) flush(acc);
  const base = acc.pos.length / 3;
  for (let i = 0; i < p.count; i++) {
    _v.fromBufferAttribute(p, i).applyMatrix4(_m);
    acc.pos.push(_v.x, _v.y, _v.z);
  }
  for (let t = 0; t < triCount && acc.triangles < MODEL_COLLIDER_MAX_TRIANGLES; t++, acc.triangles++) {
    for (let k = 0; k < 3; k++) acc.idx.push(base + (index ? index.getX(t * 3 + k) : t * 3 + k));
  }
}

/**
 * Trimesh collider descriptions of every solid mesh under `root`, in the frame of `entityObject` (the entity's own
 * object: physics places the colliders at the entity's pose). Empty when the model has not loaded.
 */
export function modelColliderDescs(root: Object3D, entityObject: Object3D = root): ColliderDesc[] {
  entityObject.updateWorldMatrix(true, true);
  _inv.copy(entityObject.matrixWorld).invert();
  const acc: Acc = { out: [], pos: [], idx: [], triangles: 0 };
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (mesh.isMesh !== true || (o as { isSkinnedMesh?: boolean }).isSkinnedMesh || (o as { isInstancedMesh?: boolean }).isInstancedMesh) return;
    if (!mesh.material || !solid(mesh.material)) return;
    if (acc.triangles >= MODEL_COLLIDER_MAX_TRIANGLES) return;
    addMesh(mesh, _inv, acc);
  });
  flush(acc);
  return acc.out;
}
