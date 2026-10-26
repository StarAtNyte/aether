/** Research-only transform-updatable multi-draw batches. Not installed by the runtime. */
import { BatchedMesh, Material, Matrix4, Mesh, StaticDrawUsage, type BufferAttribute, type BufferGeometry, type Object3D } from 'three';
import { BATCHED_LAYER } from '../../packages/render/src/sync/static-batches';

const ownedBatches = new WeakSet<BatchedMesh>();

type BatchMaterial = Material & { positionNode?: unknown; displacementMap?: unknown; wireframe?: boolean; transmission?: number; isNodeMaterial?: boolean };

/** Native batching normal transforms require orthogonal, positive-scale instance bases. */
export function batchTransformSupported(matrix: Matrix4): boolean {
  const e=matrix.elements;
  if (!e.every(Number.isFinite) || matrix.determinant() <= 0) return false;
  const lengths=[Math.hypot(e[0]!,e[1]!,e[2]!),Math.hypot(e[4]!,e[5]!,e[6]!),Math.hypot(e[8]!,e[9]!,e[10]!)];
  for (const [a,b] of [[0,1],[0,2],[1,2]]) {
    const dot=e[a!*4]!*e[b!*4]!+e[a!*4+1]!*e[b!*4+1]!+e[a!*4+2]!*e[b!*4+2]!;
    if (Math.abs(dot)>1e-10*lengths[a!]!*lengths[b!]!) return false;
  }
  return true;
}
interface GeometryState {
  geometry: BufferGeometry;
  index: BufferAttribute | null;
  indexVersion: number;
  sphere: BufferGeometry['boundingSphere'];
  attributes: Array<{ name: string; attribute: BufferAttribute; version: number; array: BufferAttribute['array']; count: number; itemSize: number; normalized: boolean }>;
  valid: boolean;
}

function snapshotGeometry(geometry: BufferGeometry): GeometryState {
  return { geometry, index: geometry.index, indexVersion: geometry.index?.version ?? 0, sphere: geometry.boundingSphere?.clone() ?? null,
    attributes: Object.keys(geometry.attributes).map(name => { const attribute = geometry.attributes[name] as BufferAttribute; return { name, attribute, version: attribute.version, array: attribute.array, count: attribute.count, itemSize: attribute.itemSize, normalized: attribute.normalized }; }), valid: true };
}

function geometryIntact(state: GeometryState): boolean {
  const g = state.geometry;
  if (!state.valid || g.index !== state.index || (g.index?.version ?? 0) !== state.indexVersion || g.drawRange.start !== 0 || Number.isFinite(g.drawRange.count)) return false;
  if (!!g.boundingSphere !== !!state.sphere || (g.boundingSphere && state.sphere && !g.boundingSphere.equals(state.sphere))) return false;
  let count = 0; for (const key in g.attributes) count++;
  if (count !== state.attributes.length) return false;
  for (const a of state.attributes) if (g.attributes[a.name] !== a.attribute || a.attribute.version !== a.version || a.attribute.array !== a.array || a.attribute.count !== a.count || a.attribute.itemSize !== a.itemSize || a.attribute.normalized !== a.normalized) return false;
  for (const key in g.morphAttributes) return false;
  return true;
}

interface Member { source: Mesh; geometry: BufferGeometry; geometryState: GeometryState; world: Matrix4; visible: boolean; index: number; frustumCulled: boolean }
interface Batch { mesh: BatchedMesh; members: Member[]; material: Material }

/** Geometry copies must remain valid and per-object shader inputs must be native. */
export function dynamicBatchKey(mesh: Mesh): string | null {
  const m = mesh.material as BatchMaterial, g = mesh.geometry;
  if (('isInstancedMesh' in mesh && mesh.isInstancedMesh) || ('isBatchedMesh' in mesh && mesh.isBatchedMesh) || ('isSkinnedMesh' in mesh && mesh.isSkinnedMesh) || ('isInstancedBufferGeometry' in g && g.isInstancedBufferGeometry)) return null;
  if (mesh.type !== 'Mesh' || Array.isArray(m) || m.transparent || m.opacity !== 1 || m.positionNode || m.displacementMap || m.wireframe || m.isNodeMaterial || (m.transmission ?? 0) > 0 || m.onBeforeCompile !== Material.prototype.onBeforeCompile) return null;
  if (mesh.onBeforeRender !== Mesh.prototype.onBeforeRender || mesh.onAfterRender !== Mesh.prototype.onAfterRender || mesh.onBeforeShadow !== Mesh.prototype.onBeforeShadow || mesh.onAfterShadow !== Mesh.prototype.onAfterShadow) return null;
  if (mesh.customDepthMaterial || mesh.customDistanceMaterial) return null;
  for (let parent = mesh.parent; parent; parent = parent.parent) if (parent.renderOrder !== 0) return null;
  if (mesh.layers.mask !== 1 || !batchTransformSupported(mesh.matrixWorld) || g.drawRange.start !== 0 || Number.isFinite(g.drawRange.count)) return null;
  if (Object.keys(g.morphAttributes).length || !g.attributes.position || !g.attributes.normal) return null;
  const attrs = Object.keys(g.attributes).sort();
  if (attrs.some(k => !['position','normal','uv','color','tangent'].includes(k))) return null;
  const signature: string[] = [];
  for (const name of attrs) {
    const a = g.attributes[name]!;
    if (!('usage' in a) || a.usage !== StaticDrawUsage || ('isInstancedBufferAttribute' in a && a.isInstancedBufferAttribute) || 'isInterleavedBufferAttribute' in a) return null;
    signature.push(`${name}:${a.itemSize}:${a.normalized}:${a.array.constructor.name}`);
  }
  return `${m.uuid}|${+mesh.castShadow}${+mesh.receiveShadow}|${mesh.renderOrder}|${mesh.frustumCulled}|${!!g.index}|${signature.join(',')}`;
}

/** Recompute our batches after nested shadow draws, before node uniforms/textures update (Three r186). */
export function prepareDynamicBatchDraws(renderer: any): () => void {
  const nodes = renderer._nodes, original = nodes.updateForRender;
  nodes.updateForRender = function (ro: any) {
    if (ownedBatches.has(ro.object)) {
      BatchedMesh.prototype.onBeforeRender.call(ro.object, renderer, ro.scene, ro.camera, ro.geometry, ro.material, ro.group);
    }
    return original.call(this, ro);
  };
  return () => { nodes.updateForRender = original; };
}

/** Snapshot grouping for experiments; changing source transforms/visibility are synchronized without geometry rebuilds. */
export class DynamicBatchesExperiment {
  readonly batches: Batch[] = [];
  private readonly inverse = new Matrix4();
  private readonly relative = new Matrix4();
  private readonly geometries = new Map<BufferGeometry, GeometryState>();
  constructor(readonly root: Object3D, sources: readonly Mesh[], readonly culling = true) {
    root.updateWorldMatrix(true, true);
    const groups = new Map<string, Mesh[]>();
    for (const mesh of sources) {
      const key = dynamicBatchKey(mesh);
      if (key === null) continue;
      const group = groups.get(key) ?? []; group.push(mesh); groups.set(key, group);
    }
    for (const meshes of groups.values()) {
      if (meshes.length < 4) continue;
      const unique = new Set(meshes.map(m => m.geometry));
      let vertices = 0, indices = 0;
      for (const g of unique) { vertices += g.attributes.position!.count; indices += g.index?.count ?? 0; }
      if (vertices > 400_000 || meshes.length > 4096) continue;
      const first = meshes[0]!, material = first.material as Material;
      const batch = new BatchedMesh(meshes.length, vertices, indices, material);
      batch.name = 'aether:dynamic-experiment'; batch.castShadow = first.castShadow; batch.receiveShadow = first.receiveShadow;
      batch.renderOrder = first.renderOrder; batch.matrixAutoUpdate = false; batch.frustumCulled = false;
      batch.perObjectFrustumCulled = culling && first.frustumCulled; batch.sortObjects = false;
      batch.userData.aetherDynamicBatch = true; ownedBatches.add(batch);
      // updateForRender computes camera-specific lists after any nested shadow passes.
      batch.onBeforeRender = () => {};
      batch.onBeforeShadow = () => {};
      batch.raycast = () => {};
      const ids = new Map<BufferGeometry, number>();
      for (const g of unique) { ids.set(g, batch.addGeometry(g)); if (!this.geometries.has(g)) this.geometries.set(g, snapshotGeometry(g)); }
      const members = meshes.map(source => ({ source, geometry: source.geometry, geometryState: this.geometries.get(source.geometry)!, world: Object.assign(new Matrix4(), { elements: Array(16).fill(NaN) }), visible: false, frustumCulled: source.frustumCulled, index: batch.addInstance(ids.get(source.geometry)!) }));
      for (const m of meshes) m.layers.set(BATCHED_LAYER);
      root.add(batch); batch.updateMatrixWorld(true); this.batches.push({ mesh: batch, members, material });
    }
    this.update();
  }
  get saved(): number { return this.batches.reduce((n,b)=>n+b.members.length-1,0); }
  update(): boolean {
    this.inverse.copy(this.root.matrixWorld).invert(); let changed = false;
    for (const state of this.geometries.values()) state.valid = geometryIntact(state);
    for (const b of this.batches) for (const m of b.members) {
      let attached = false, visible = true, ordered = false;
      for (let o: Object3D | null = m.source; o; o=o.parent) {
        if (o === this.root) { attached = true; break; }
        if (!o.visible) visible = false;
        if (o !== m.source && o.renderOrder !== 0) ordered = true;
      }
      this.relative.multiplyMatrices(this.inverse, m.source.matrixWorld);
      const material=b.material as BatchMaterial;
      const intact=!ordered&&m.source.onBeforeRender===Mesh.prototype.onBeforeRender&&m.source.onAfterRender===Mesh.prototype.onAfterRender&&m.source.onBeforeShadow===Mesh.prototype.onBeforeShadow&&m.source.onAfterShadow===Mesh.prototype.onAfterShadow&&!m.source.customDepthMaterial&&!m.source.customDistanceMaterial&&m.geometryState.valid&&!material.isNodeMaterial&&!material.transparent&&material.opacity===1&&!material.positionNode&&!material.displacementMap&&!material.wireframe&&!(material.transmission??0)&&material.onBeforeCompile===Material.prototype.onBeforeCompile&&m.source.frustumCulled===m.frustumCulled&&m.source.geometry===m.geometry&&m.source.material===b.material&&m.source.castShadow===b.mesh.castShadow&&m.source.receiveShadow===b.mesh.receiveShadow&&m.source.renderOrder===b.mesh.renderOrder&&batchTransformSupported(this.relative);
      if(!intact&&m.source.layers.isEnabled(BATCHED_LAYER))m.source.layers.set(0);
      visible &&= attached && intact && m.source.layers.isEnabled(BATCHED_LAYER);
      if (visible !== m.visible) { b.mesh.setVisibleAt(m.index, visible); m.visible = visible; changed = true; }
      if (visible && !m.world.equals(m.source.matrixWorld)) {
        b.mesh.setMatrixAt(m.index, this.relative); m.world.copy(m.source.matrixWorld); changed = true;
      }
    }
    return changed;
  }
  dispose(): void {
    for (const b of this.batches) {
      for (const m of b.members) if (m.source.layers.isEnabled(BATCHED_LAYER)) m.source.layers.set(0);
      ownedBatches.delete(b.mesh); b.mesh.removeFromParent(); b.mesh.dispose();
    }
    this.batches.length = 0; this.geometries.clear();
  }
}
