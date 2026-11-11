/**
 * Skip recomposing local matrices that did not change.
 *
 * three.js (r186) `Object3D.updateMatrixWorld` recomposes every auto-updated object's local matrix from position,
 * rotation and scale on every call, which marks its world matrix dirty, which forces every descendant to multiply its
 * world matrix again: the whole graph, every frame, though almost all of a world stands still. On a hillside town of
 * 7,000 objects that was 15-18 % of the frame's script time on a laptop CPU.
 *
 * Here an object recomposes only when its position, quaternion or scale differ from the values it last composed (or it
 * has a pivot, or was never composed). Unchanged objects keep their matrices, their world matrices are not marked dirty,
 * and their subtrees are only multiplied again when an ancestor moved. The result is identical by construction: the
 * comparison is on the very values `compose` reads. Code that writes `matrix` directly while `matrixAutoUpdate` is on
 * (which three would overwrite on the next frame anyway) keeps its matrix until the object's transform changes.
 */
import { Object3D } from 'three';

interface Composed {
  __trs?: Float64Array;
  matrixAutoUpdate: boolean;
  matrixWorldNeedsUpdate: boolean;
  matrixWorldAutoUpdate: boolean;
  pivot?: unknown;
  position: { x: number; y: number; z: number };
  quaternion: { x: number; y: number; z: number; w: number };
  scale: { x: number; y: number; z: number };
  parent: Composed | null;
  children: Composed[];
  matrix: unknown;
  matrixWorld: { copy(m: unknown): void; multiplyMatrices(a: unknown, b: unknown): void };
  updateMatrix(): void;
  updateMatrixWorld(force?: boolean): void;
  updateWorldMatrix(updateParents: boolean, updateChildren: boolean, force?: boolean): void;
}

/** Recompose `o`'s local matrix if its transform changed since the last compose; true when it did. */
export function composeIfChanged(o: Composed): boolean {
  const p = o.position, q = o.quaternion, s = o.scale;
  let c = o.__trs;
  if (c === undefined) {
    c = new Float64Array(10);
    c[0] = Number.NaN;
    o.__trs = c;
  }
  if (o.pivot != null || c[0] !== p.x || c[1] !== p.y || c[2] !== p.z || c[3] !== q.x || c[4] !== q.y || c[5] !== q.z || c[6] !== q.w || c[7] !== s.x || c[8] !== s.y || c[9] !== s.z) {
    c[0] = p.x; c[1] = p.y; c[2] = p.z; c[3] = q.x; c[4] = q.y; c[5] = q.z; c[6] = q.w; c[7] = s.x; c[8] = s.y; c[9] = s.z;
    o.updateMatrix();
    return true;
  }
  return false;
}

let installed = false;

/** Install once (the prototype is shared by every renderer). Opt out with `globalThis.__AETHER_MATRIX_CHECK = false`. */
export function installMatrixDirtyCheck(): void {
  if (installed || (globalThis as { __AETHER_MATRIX_CHECK?: boolean }).__AETHER_MATRIX_CHECK === false) return;
  installed = true;
  const proto = Object3D.prototype as unknown as Composed;
  // three composes the local matrix outside updateMatrixWorld too: `updateWorldMatrix` (called by `lookAt`,
  // `getWorldPosition`, `getWorldDirection`, ...) calls `updateMatrix` directly. The record of the composed values must
  // follow every compose, or a transform set back to the recorded values keeps a matrix composed from other ones: a camera
  // that orbit controls turned and the capture then put back drew from the controls' view (a whole other picture).
  const updateMatrix = proto.updateMatrix;
  proto.updateMatrix = function (this: Composed): void {
    updateMatrix.call(this);
    const c = this.__trs;
    if (c === undefined) return;
    const p = this.position, q = this.quaternion, s = this.scale;
    c[0] = p.x; c[1] = p.y; c[2] = p.z; c[3] = q.x; c[4] = q.y; c[5] = q.z; c[6] = q.w; c[7] = s.x; c[8] = s.y; c[9] = s.z;
  };
  // `updateWorldMatrix(parents, false)` (IK, look-at, `getWorldPosition`) refreshes an object's world matrix and clears its
  // dirty flag without touching its children. three's own traversal recomposes every frame, so the children catch up there;
  // with the check above the cleared object looks unchanged and its subtree is never multiplied again. A walking body whose
  // hand IK refreshed the root's chain kept every other bone at the world matrix of where it stood: limbs stretched back
  // to the spawn point. So the children of an object refreshed that way are marked stale.
  proto.updateWorldMatrix = function (this: Composed, updateParents: boolean, updateChildren: boolean, force = false): void {
    const parent = this.parent;
    if (updateParents === true && parent !== null) (parent as unknown as { updateWorldMatrix(a: boolean, b: boolean): void }).updateWorldMatrix(true, false);
    if (this.matrixAutoUpdate) this.updateMatrix();
    const children = this.children;
    if (this.matrixWorldNeedsUpdate || force) {
      if (this.matrixWorldAutoUpdate === true) {
        if (parent === null) this.matrixWorld.copy(this.matrix);
        else this.matrixWorld.multiplyMatrices(parent.matrixWorld, this.matrix);
      }
      this.matrixWorldNeedsUpdate = false;
      force = true;
      if (updateChildren !== true) for (let i = 0, l = children.length; i < l; i++) (children[i] as Composed).matrixWorldNeedsUpdate = true;
    }
    if (updateChildren === true) {
      for (let i = 0, l = children.length; i < l; i++) (children[i] as unknown as { updateWorldMatrix(a: boolean, b: boolean, f: boolean): void }).updateWorldMatrix(false, true, force);
    }
  };
  proto.updateMatrixWorld = function (this: Composed, force?: boolean): void {
    if (this.matrixAutoUpdate) composeIfChanged(this);
    if (this.matrixWorldNeedsUpdate || force) {
      if (this.matrixWorldAutoUpdate === true) {
        if (this.parent === null) this.matrixWorld.copy(this.matrix);
        else this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix);
      }
      this.matrixWorldNeedsUpdate = false;
      force = true;
    }
    const children = this.children;
    for (let i = 0, l = children.length; i < l; i++) (children[i] as Composed).updateMatrixWorld(force);
  };
}
