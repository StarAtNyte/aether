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
import { DynamicDrawUsage, InstancedMesh, Matrix4, Sphere, type BufferGeometry, type Material, type Mesh, type Object3D } from 'three';
import type { EntityNode } from './entity-node';

/** Layer of batched member meshes: raycast, but never rendered directly. */
export const BATCHED_LAYER = 7;
/** Smallest group worth an instanced draw. */
export const MIN_BATCH = 6;
/** Largest instanced mesh (bigger groups split into several). */
export const MAX_BATCH = 4096;
/** Target population of spatial leaves; compact groups can stay larger to save draw calls. */
export const SPATIAL_BATCH_TARGET = 256;
/** Groups within this many metres stay together unless they exceed MAX_BATCH. */
export const SPATIAL_BATCH_SPAN = 64;

interface Batch {
  mesh: InstancedMesh;
  members: Mesh[];
  material: Material;
  geometry: BufferGeometry;
  /** Reused upload span, retained until the renderer consumes it. */
  upload: { start: number; count: number };
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
const _instance = new Matrix4();

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
      partitionMembers(list, wanted, this.minBatch);
    }
    // Keep batches whose member list is identical; release the rest.
    const kept: Batch[] = [];
    const reuse = new Set<Batch>();
    const toCreate: Mesh[][] = [];
    const byFirstMember = new Map<Mesh, Batch>();
    for (const b of this.batches) byFirstMember.set(b.members[0]!, b);
    for (const members of wanted) {
      const same = byFirstMember.get(members[0]!);
      if (same && sameMembers(same, members)) {
        reuse.add(same);
        kept.push(same);
      } else {
        toCreate.push(members);
      }
    }
    const released = this.batches.length - kept.length;
    const still = new Set<Mesh>();
    if (released > 0) for (const list of wanted) for (const m of list) still.add(m);
    for (const b of this.batches) if (!reuse.has(b)) this.release(b, still);
    this.batches = kept;
    this.saved = kept.reduce((n, b) => n + b.members.length - 1, 0);
    for (const members of toCreate) this.create(members);
    this.dirty = false;
    return released > 0 || toCreate.length > 0;
  }

  /** Remove a batch; members that are not in a wanted group go back to the default layer. */
  private release(b: Batch, still: ReadonlySet<Mesh>): void {
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
    // Capture draws can change matrices twice within one three.js node frame.
    // Dynamic usage keeps the interleaved GPU buffer current in that case.
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.matrixAutoUpdate = false;
    // Picking goes through the member meshes (BATCHED_LAYER); the copy is never hit.
    mesh.raycast = () => undefined;
    for (const m of members) m.layers.set(BATCHED_LAYER);
    this.root.add(mesh);
    const batch: Batch = { mesh, members, material, geometry, upload: { start: 0, count: 0 } };
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
    let first = force ? 0 : batch.members.length;
    let last = force ? batch.members.length - 1 : -1;
    const members = batch.members;
    let visible = 0;
    for (let i = 0; i < members.length; i++) {
      const m = members[i] as Mesh;
      const where = placement(m, this.root);
      if (where === DETACHED || m.material !== batch.material || m.geometry !== batch.geometry || !m.layers.isEnabled(BATCHED_LAYER)) {
        // The member was removed, re-materialised or overridden: regroup soon; meanwhile hide its instance.
        this.dirty = true;
        if (writeZero(arr, i * 16)) {
          changed = true;
          first = Math.min(first, i);
          last = Math.max(last, i);
        }
        continue;
      }
      const o = i * 16;
      if (where === HIDDEN) {
        if (writeZero(arr, o)) {
          changed = true;
          first = Math.min(first, i);
          last = Math.max(last, i);
        }
        continue;
      }
      visible++;
      const e = m.matrixWorld.elements;
      let moved = false;
      for (let k = 0; k < 16; k++) {
        // Compare at GPU precision: a double such as 0.1 never equals its stored Float32 value.
        const v = Math.fround(e[k] as number);
        if (arr[o + k] !== v) {
          arr[o + k] = v;
          moved = true;
        }
      }
      if (moved) {
        changed = true;
        first = Math.min(first, i);
        last = Math.max(last, i);
        // Grow the culling sphere to cover the new pose (never shrinks until the next regroup).
        if (!force) expandBatchBounds(batch, m);
      }
    }
    if (changed) {
      const attribute = batch.mesh.instanceMatrix;
      const upload = batch.upload;
      const start = first * 16;
      const end = (last + 1) * 16;
      if (attribute.updateRanges.length === 0) {
        upload.start = start;
        upload.count = end - start;
        // addUpdateRange allocates an object; reuse one span for this batch instead.
        attribute.updateRanges.push(upload);
      } else {
        // A culled batch may not have uploaded its previous edits yet.
        const pendingEnd = upload.start + upload.count;
        upload.start = Math.min(upload.start, start);
        upload.count = Math.max(pendingEnd, end) - upload.start;
      }
      attribute.needsUpdate = true;
    }
    const visibilityChanged = batch.mesh.visible !== (visible > 0);
    batch.mesh.visible = visible > 0;
    if (force) {
      // Hidden slots have a zero matrix (including w): native computeBoundingSphere would divide by zero.
      // Build the same GPU-precision union from the visible slots only.
      if (!batch.geometry.boundingSphere) batch.geometry.computeBoundingSphere();
      const bounds = batch.mesh.boundingSphere = new Sphere().makeEmpty();
      for (let i = 0; i < members.length; i++) {
        if (arr[i * 16 + 15] === 0) continue;
        _instance.fromArray(arr, i * 16);
        _sphere.copy(batch.geometry.boundingSphere!).applyMatrix4(_instance);
        bounds.union(_sphere);
      }
    }
    return changed || visibilityChanged;
  }

  /** Remove every batch and give members back to the default layer. */
  clear(): void {
    const still = new Set<Mesh>();
    for (const b of this.batches) this.release(b, still);
    this.batches = [];
    this.saved = 0;
    this.dirty = false;
  }
}

/** True when `b` draws exactly `members` (same meshes, order, geometry and material). */
function sameMembers(b: Batch, members: readonly Mesh[]): boolean {
  if (b.members.length !== members.length) return false;
  const first = members[0];
  if (!first || b.mesh.castShadow !== first.castShadow || b.mesh.receiveShadow !== first.receiveShadow) return false;
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

/** Balanced spatial leaves: imported/entity order must not decide culling locality. Rebuild-only work. */
function partitionMembers(members: Mesh[], out: Mesh[][], minimum: number): void {
  if (members.length < minimum) return;
  if (members.length <= SPATIAL_BATCH_TARGET) {
    out.push(members);
    return;
  }
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const m of members) {
    const e = m.matrixWorld.elements;
    minX = Math.min(minX, e[12]!); maxX = Math.max(maxX, e[12]!);
    minY = Math.min(minY, e[13]!); maxY = Math.max(maxY, e[13]!);
    minZ = Math.min(minZ, e[14]!); maxZ = Math.max(maxZ, e[14]!);
  }
  const x = maxX - minX, y = maxY - minY, z = maxZ - minZ;
  if ((members.length <= MAX_BATCH && Math.max(x, y, z) <= SPATIAL_BATCH_SPAN) || members.length < minimum * 2) {
    out.push(members);
    return;
  }
  const axis = x >= y && x >= z ? 12 : y >= z ? 13 : 14;
  members.sort((a, b) => a.matrixWorld.elements[axis]! - b.matrixWorld.elements[axis]!);
  const mid = Math.floor(members.length / 2);
  partitionMembers(members.slice(0, mid), out, minimum);
  partitionMembers(members.slice(mid), out, minimum);
}

/** Most edits stay inside the leaf. Skip the sphere-union work unless the new member escapes it. */
function expandBatchBounds(batch: Batch, member: Mesh): void {
  const bounds = batch.mesh.boundingSphere;
  const source = batch.geometry.boundingSphere;
  if (!bounds || !source) return;
  const e = member.matrixWorld.elements;
  const scale2 = Math.max(
    e[0]! * e[0]! + e[1]! * e[1]! + e[2]! * e[2]!,
    e[4]! * e[4]! + e[5]! * e[5]! + e[6]! * e[6]!,
    e[8]! * e[8]! + e[9]! * e[9]! + e[10]! * e[10]!,
  );
  _sphere.center.copy(source.center).applyMatrix4(member.matrixWorld);
  _sphere.radius = source.radius * Math.sqrt(scale2);
  const room = bounds.radius - _sphere.radius;
  const dx = _sphere.center.x - bounds.center.x;
  const dy = _sphere.center.y - bounds.center.y;
  const dz = _sphere.center.z - bounds.center.z;
  if (room >= 0 && dx * dx + dy * dy + dz * dz <= room * room) return;
  bounds.union(_sphere);
}
