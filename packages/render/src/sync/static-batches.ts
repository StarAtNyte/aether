/**
 * Static-prop instancing: identical static props (same primitive geometry,
 * same shared material, same shadow flags) are drawn as ONE `InstancedMesh`
 * instead of one draw call each (fence posts, bowling-alley boards, coins on
 * pedestals, rows of pillars…).
 *
 * It is a render-only optimisation layered over the normal scene graph:
 * every entity keeps its own nodes and meshes, so picking, selection
 * outlines, gizmos, bounds, physics colliders and runtime overrides work
 * unchanged. A batched member mesh is moved to {@link BATCHED_LAYER}, which
 * cameras and shadow cameras do not render but the renderer's raycasters
 * test, and the instanced copy is drawn in its place.
 *
 * - {@link StaticBatches.rebuild} groups candidates; groups smaller than
 *   {@link MIN_BATCH} stay as they are. Transparent materials, runtime
 *   material overrides, dynamic/kinematic bodies, runtime spawns and
 *   multi-part shapes are never batched.
 * - {@link StaticBatches.update} runs before each drawn frame (after world
 *   matrices were updated): it copies member world matrices into the
 *   instance buffer only when they changed (gizmo drags, grow-in, logic
 *   teleports), hides instances of invisible members, and reports when a
 *   member left its group (removed, re-materialised, overridden), so the
 *   owner rebuilds. Allocation-free.
 * - Instance buffers are owned here and released on rebuild/dispose;
 *   geometry and material belong to the shared caches and are never disposed.
 */
import { DynamicDrawUsage, InstancedMesh, Sphere, type BufferGeometry, type Material, type Mesh, type Object3D } from 'three';
import type { EntityNode } from './entity-node';

/** Layer of batched member meshes: raycast, but never rendered directly. */
export const BATCHED_LAYER = 7;
/** Smallest group worth an instanced draw. */
export const MIN_BATCH = 6;
/** Largest instanced mesh (bigger groups split into several). */
export const MAX_BATCH = 4096;

interface Batch {
  mesh: InstancedMesh;
  members: Mesh[];
  material: Material;
  geometry: BufferGeometry;
}

/** A node can be batched when it is a static, single-part, opaque primitive using a shared material. */
export function batchable(node: Readonly<EntityNode>): boolean {
  if (node.transient || node.placeholder || node.pending || node.failed || node.instances > 0) return false;
  const e = node.entity;
  if (e.template || e.shape.kind !== 'primitive') return false;
  if (e.physics && e.physics.body !== 'static') return false;
  if (node.bindings.length !== 1 || node.geometryKeys.length !== 1) return false;
  const b = node.bindings[0];
  if (!b || b.ownedMaterial || b.seeThrough) return false;
  const m = b.mesh.material as Material | Material[];
  if (Array.isArray(m) || m.transparent) return false;
  return true;
}

const _sphere = new Sphere();

const ATTACHED = 0;
const HIDDEN = 1;
const DETACHED = 2;

/** Whether `obj` is under `root` and visible along the way. */
function placement(obj: Object3D, root: Object3D): number {
  let state = ATTACHED;
  for (let o: Object3D | null = obj; o; o = o.parent) {
    if (o === root) return state;
    if (!o.visible) state = HIDDEN;
  }
  return DETACHED;
}

/** Instanced batches of identical static props under one root. */
export class StaticBatches {
  private batches: Batch[] = [];
  private saved = 0;
  private dirty = false;

  /**
   * @param root the sync root (identity transform): instanced meshes are added here
   * @param minBatch smallest group to instance
   */
  constructor(
    private readonly root: Object3D,
    private readonly minBatch: number = MIN_BATCH,
  ) {}

  /** Draw calls saved per pass by the current batches. */
  get drawCallsSaved(): number {
    return this.saved;
  }

  /** Number of instanced batches. */
  get count(): number {
    return this.batches.length;
  }

  /** True when a member left its group since the last rebuild (the owner should rebuild). */
  get needsRebuild(): boolean {
    return this.dirty;
  }

  /**
   * Re-group `nodes` (call after content changed). Batches whose members are
   * unchanged are kept as they are (no new instance buffer); only groups that
   * changed are recreated.
   * @returns true when batches were created or removed
   */
  rebuild(nodes: Iterable<Readonly<EntityNode>>): boolean {
    const groups = new Map<string, Mesh[]>();
    for (const node of nodes) {
      if (!batchable(node)) continue;
      const b = node.bindings[0] as EntityNode['bindings'][number];
      const mesh = b.mesh;
      const key = `${node.geometryKeys[0]}|${b.materialKey}|${mesh.castShadow ? 1 : 0}${mesh.receiveShadow ? 1 : 0}`;
      let list = groups.get(key);
      if (!list) {
        list = [];
        groups.set(key, list);
      }
      list.push(mesh);
    }
    const wanted: Mesh[][] = [];
    for (const list of groups.values()) {
      for (let start = 0; start < list.length; start += MAX_BATCH) {
        const members = list.slice(start, start + MAX_BATCH);
        if (members.length >= this.minBatch) wanted.push(members);
      }
    }
    // Keep batches whose member list is identical; release the rest.
    const kept: Batch[] = [];
    const reuse = new Set<Batch>();
    const toCreate: Mesh[][] = [];
    for (const members of wanted) {
      const same = this.batches.find((b) => !reuse.has(b) && sameMembers(b, members));
      if (same) {
        reuse.add(same);
        kept.push(same);
      } else {
        toCreate.push(members);
      }
    }
    const released = this.batches.length - kept.length;
    for (const b of this.batches) if (!reuse.has(b)) this.release(b, wanted);
    this.batches = kept;
    this.saved = kept.reduce((n, b) => n + b.members.length - 1, 0);
    for (const members of toCreate) this.create(members);
    this.dirty = false;
    return released > 0 || toCreate.length > 0;
  }

  /** Remove a batch; members that are not in a wanted group go back to the default layer. */
  private release(b: Batch, wanted: readonly Mesh[][]): void {
    const still = new Set<Mesh>();
    for (const list of wanted) for (const m of list) still.add(m);
    for (const m of b.members) if (!still.has(m)) m.layers.set(0);
    b.mesh.removeFromParent();
    // Releases the instance buffer only; geometry/material belong to the caches.
    b.mesh.dispose();
  }

  private create(members: Mesh[]): void {
    const first = members[0] as Mesh;
    const geometry = first.geometry;
    const material = first.material as Material;
    const mesh = new InstancedMesh(geometry, material, members.length);
    mesh.name = 'aether:batch';
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.matrixAutoUpdate = false;
    // Picking goes through the member meshes (BATCHED_LAYER); the copy is never hit.
    mesh.raycast = () => undefined;
    for (const m of members) m.layers.set(BATCHED_LAYER);
    this.root.add(mesh);
    const batch: Batch = { mesh, members, material, geometry };
    this.batches.push(batch);
    this.saved += members.length - 1;
    this.sync(batch, true);
  }

  /**
   * Copy member transforms and visibility into the instance buffers.
   * Call after world matrices are current and before drawing.
   * @returns true when any instance changed (the frame must be drawn)
   */
  update(): boolean {
    let changed = false;
    for (let i = 0; i < this.batches.length; i++) {
      if (this.sync(this.batches[i] as Batch, false)) changed = true;
    }
    return changed;
  }

  private sync(batch: Batch, force: boolean): boolean {
    const arr = batch.mesh.instanceMatrix.array as Float32Array;
    let changed = force;
    const members = batch.members;
    for (let i = 0; i < members.length; i++) {
      const m = members[i] as Mesh;
      const where = placement(m, this.root);
      if (where === DETACHED || m.material !== batch.material || m.geometry !== batch.geometry || !m.layers.isEnabled(BATCHED_LAYER)) {
        // The member was removed, re-materialised or overridden: regroup soon; meanwhile hide its instance.
        this.dirty = true;
        if (writeZero(arr, i * 16)) changed = true;
        continue;
      }
      const o = i * 16;
      if (where === HIDDEN) {
        if (writeZero(arr, o)) changed = true;
        continue;
      }
      const e = m.matrixWorld.elements;
      let moved = false;
      for (let k = 0; k < 16; k++) {
        const v = e[k] as number;
        if (arr[o + k] !== v) {
          arr[o + k] = v;
          moved = true;
        }
      }
      if (moved) {
        changed = true;
        // Grow the culling sphere to cover the new pose (never shrinks until the next regroup).
        const bs = batch.geometry.boundingSphere;
        if (bs && batch.mesh.boundingSphere && !force) batch.mesh.boundingSphere.union(_sphere.copy(bs).applyMatrix4(m.matrixWorld));
      }
    }
    if (changed) batch.mesh.instanceMatrix.needsUpdate = true;
    if (force) batch.mesh.computeBoundingSphere();
    return changed;
  }

  /** Remove every batch and give members back to the default layer. */
  clear(): void {
    for (const b of this.batches) this.release(b, []);
    this.batches = [];
    this.saved = 0;
    this.dirty = false;
  }
}

/** True when `b` draws exactly `members` (same meshes, order, geometry and material). */
function sameMembers(b: Batch, members: readonly Mesh[]): boolean {
  if (b.members.length !== members.length) return false;
  for (let i = 0; i < members.length; i++) {
    const m = members[i] as Mesh;
    if (b.members[i] !== m || m.material !== b.material || m.geometry !== b.geometry) return false;
  }
  return true;
}

/** Zero an instance matrix (scale 0 = not drawn); true when it changed. */
function writeZero(arr: Float32Array, o: number): boolean {
  let changed = false;
  for (let k = 0; k < 16; k++) {
    if (arr[o + k] !== 0) {
      arr[o + k] = 0;
      changed = true;
    }
  }
  return changed;
}
