/**
 * Instancing of static library models: every copy of a street lamp, a potted plant, a parked car or a bench draws as one
 * instanced mesh per part instead of one draw per part per copy (transparent parts per region of {@link INSTANCE_REGION}
 * metres, since they are sorted by the instanced mesh's position).
 *
 * Each instanced mesh packs, for the camera drawing it, the copies that camera sees: shown, at the level of detail three's
 * `LOD` would pick for that camera ({@link levelFor}; one instanced mesh per part of each level), and inside its frustum.
 * It packs twice per draw: when three tests it against the frustum during projection (nothing to draw: no draw call), and
 * right before the draw, for the camera of the draw (three draws shadow maps while it draws the view, so the projection's
 * packing may have been replaced by a shadow camera's). The view, the sun's depth pass and a capture's pose camera each draw
 * what three would have drawn for them, and each copy is still culled on its own.
 *
 * Materials join by what they draw, not by instance ({@link materialSignature}): two loads of one model, or two models that
 * share a finish, give equal but distinct materials, and those instance together. The body paint of a model, which
 * `SceneSync.paintAsset` tints per entity, instances with the colour as a per-instance attribute (three multiplies the
 * material colour by `instanceColor`, so a white copy of the paint times the copy's colour is the same diffuse colour).
 * Materials with node graphs or hooks stay out (a graph may read the object's own matrix, which an instance replaces).
 *
 * Like {@link StaticBatches} it is a render-only layer: members move to {@link BATCHED_LAYER} (raycast, never drawn), so
 * picking, selection, bounds and physics work unchanged. A member that is removed, re-materialised or rebuilt marks the
 * layer for a regroup; one that moves is drawn where it is.
 *
 * Model meshes that `StaticMerges` merges per cell (three or more parts of one material in a cell: the four wheels of a
 * parked car) stay merged; this layer takes the rest (levels of detail, which merges leave out, and parts repeated across
 * copies further apart).
 *
 * Switches (set on `globalThis` before the studio starts): `__AETHER_ASSET_INSTANCES = false` turns the layer off;
 * `__AETHER_MATERIAL_DEDUPE = false` groups by material instance only.
 */
import { Color, DynamicDrawUsage, Frustum, InstancedBufferAttribute, InstancedMesh, Material, Matrix4, Mesh, Sphere, Vector3, type BufferGeometry, type Camera, type LOD, type Object3D, type Scene, type Texture } from 'three';
import type { EntityNode } from './entity-node';
import { BATCHED_LAYER } from './static-batches';

/** Edge (m) of the regions transparent parts are instanced in (three sorts them by the instanced mesh's position). */
export const INSTANCE_REGION = 256;
/** Fewest copies worth an instanced mesh. */
export const MIN_INSTANCES = 2;

export function assetInstancesEnabled(): boolean {
  return (globalThis as { __AETHER_ASSET_INSTANCES?: boolean }).__AETHER_ASSET_INSTANCES !== false;
}

export function materialDedupeEnabled(): boolean {
  return (globalThis as { __AETHER_MATERIAL_DEDUPE?: boolean }).__AETHER_MATERIAL_DEDUPE !== false;
}

/** Whether `m` is a model's body paint (tinted per entity by `SceneSync.paintAsset`). */
export function paintMaterial(m: Material): boolean {
  return (m as { isMeshStandardMaterial?: boolean }).isMeshStandardMaterial === true && (m.name === 'paint' || m.userData['aetherPaint'] === true);
}

/** See {@link materialSignature}. */
export interface MaterialSignature {
  /** Equal for materials that draw the same. */
  key: string;
  /** The same without the diffuse colour. */
  tintless: string;
  /** False when the material has node graphs or hooks (it is then never instanced). */
  plain: boolean;
}

const signatures = new WeakMap<Material, MaterialSignature & { version: number }>();
const textureKey = (t: Texture): string =>
  `${t.source?.uuid ?? t.uuid}/${t.mapping},${t.wrapS},${t.wrapT},${t.magFilter},${t.minFilter},${t.anisotropy},${t.flipY},${t.colorSpace},${t.channel},${t.repeat.x},${t.repeat.y},${t.offset.x},${t.offset.y},${t.center.x},${t.center.y},${t.rotation}`;

/**
 * A key equal for two materials that draw the same: class, every own value (colours, scalars, flags), the identity of every
 * texture's image and its sampling, `defines`. A value the key cannot compare (a node graph, a hook, clipping planes) makes it
 * the material's identity.
 */
export function materialSignature(m: Material): MaterialSignature {
  const cached = signatures.get(m);
  if (cached && cached.version === m.version) return cached;
  const fields = m as unknown as Record<string, unknown>;
  let plain = m.onBeforeCompile === Material.prototype.onBeforeCompile && m.onBeforeRender === Material.prototype.onBeforeRender && m.customProgramCacheKey === Material.prototype.customProgramCacheKey;
  let comparable = plain;
  const parts: string[] = [m.type];
  let colour = '';
  for (const k of Object.keys(fields).sort()) {
    if (k === 'uuid' || k === 'id' || k === 'version' || k === 'name' || k === 'userData' || k.startsWith('_')) continue;
    const v = fields[k];
    if (k.endsWith('Node') && v != null) {
      plain = comparable = false;
      break;
    }
    if (v === null || v === undefined) parts.push(`${k}:-`);
    else if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') parts.push(`${k}:${v}`);
    else if (typeof v === 'function') continue;
    else if ((v as Color).isColor) {
      const c = `${k}:${(v as Color).r},${(v as Color).g},${(v as Color).b}`;
      if (k === 'color') colour = c;
      else parts.push(c);
    } else if ((v as { isVector2?: boolean }).isVector2 || (v as { isVector3?: boolean }).isVector3 || (v as { isEuler?: boolean }).isEuler) parts.push(`${k}:${(v as unknown as { toArray(): unknown[] }).toArray().join(',')}`);
    else if ((v as Texture).isTexture) parts.push(`${k}:${textureKey(v as Texture)}`);
    else if (k === 'defines') parts.push(`${k}:${JSON.stringify(v)}`);
    else if (Array.isArray(v) && v.every((x) => typeof x === 'number')) parts.push(`${k}:[${v.join(',')}]`);
    else comparable = false;
  }
  const base = parts.join('|');
  const out = comparable ? { version: m.version, key: `${base}|${colour}`, tintless: base, plain } : { version: m.version, key: `#${m.uuid}`, tintless: `#${m.uuid}`, plain };
  signatures.set(m, out);
  return out;
}

/** A model node whose meshes may be instanced: a static, untouched library model without skinning or animation. */
export function instanceableAsset(node: Readonly<EntityNode>): boolean {
  if (node.transient || node.placeholder || node.pending || node.failed || node.overridden || node.characterBody !== null) return false;
  const e = node.entity;
  if (e.shape.kind !== 'asset' || e.template || e.visible === false || e.behaviors.length > 0) return false;
  return !e.physics || e.physics.body === 'static';
}

/** The meshes of `node` that may be instanced (all levels of detail), or null when the model is animated or skinned. */
export function instanceableMeshes(node: Readonly<EntityNode>): Mesh[] | null {
  const out: Mesh[] = [];
  let still = true;
  node.content.traverse((o) => {
    if (!still) return;
    const x = o as { isSkinnedMesh?: boolean; isBone?: boolean; animations?: unknown[] };
    if (x.isSkinnedMesh === true || x.isBone === true || (x.animations?.length ?? 0) > 0) {
      still = false;
      return;
    }
    const mesh = o as Mesh;
    if (mesh.isMesh !== true || mesh.type !== 'Mesh' || (mesh as Partial<InstancedMesh>).isInstancedMesh === true) return;
    const m = mesh.material as Material | Material[];
    const g = mesh.geometry;
    if (Array.isArray(m) || !g || g.groups.length > 1 || Object.keys(g.morphAttributes).length > 0 || !g.getAttribute('position')) return;
    if (mesh.renderOrder !== 0 || mesh.frustumCulled !== true || mesh.onBeforeRender !== Mesh.prototype.onBeforeRender || mesh.onBeforeShadow !== Mesh.prototype.onBeforeShadow) return;
    if (mesh.customDepthMaterial || mesh.customDistanceMaterial || (g as { isInstancedBufferGeometry?: boolean }).isInstancedBufferGeometry) return;
    if (!materialSignature(m).plain) return;
    out.push(mesh);
  });
  return still && out.length > 0 ? out : null;
}

interface Member {
  mesh: Mesh;
  /** Its material when the group formed (identity, so a re-materialised member is noticed). */
  material: Material;
  /** The level of detail the mesh belongs to and the index of its level, or null and -1. */
  lod: LOD | null;
  level: number;
}

interface Group {
  key: string;
  mesh: InstancedMesh;
  members: Member[];
  geometry: BufferGeometry;
  /** The group's own white copy of a paint (disposed with the group), else null. */
  ownMaterial: Material | null;
  tinted: boolean;
  /** Member index drawn in each slot at the last pack (-1: none). */
  slots: Int32Array;
}

const ATTACHED = 0;
const HIDDEN = 1;
const DETACHED = 2;

/** Whether `obj` is under `root` and shown along the way (an LOD's levels count as shown: see {@link levelFor}). */
function placement(obj: Object3D, root: Object3D): number {
  let state = ATTACHED;
  for (let o: Object3D | null = obj; o; o = o.parent) {
    if (o === root) return state;
    if (!o.visible && (o.parent as Partial<LOD> | null)?.isLOD !== true) state = HIDDEN;
  }
  return DETACHED;
}

/** The nearest LOD `mesh` is in, with the index of its level. */
function lodOf(mesh: Mesh): { lod: LOD | null; level: number } {
  for (let o: Object3D = mesh; o.parent; o = o.parent) {
    const p = o.parent as LOD;
    if (p.isLOD === true) return { lod: p, level: p.levels.findIndex((l) => l.object === o) };
  }
  return { lod: null, level: -1 };
}

const _eye = new Vector3();
const _at = new Vector3();

/**
 * The level three's `LOD.update` picks for an eye at `eye` (`zoom`: the camera's). Hysteresis is not modelled: the levels of
 * library models have none (`SceneSync.mountModelAsset`).
 */
export function levelFor(lod: LOD, eye: Vector3, zoom: number): number {
  const levels = lod.levels;
  if (levels.length <= 1) return 0;
  const d = eye.distanceTo(_at.setFromMatrixPosition(lod.matrixWorld)) / zoom;
  let i = 1;
  for (; i < levels.length; i++) if (d < (levels[i] as { distance: number }).distance) break;
  return i - 1;
}

const _m = new Matrix4();
const _origin = new Matrix4();
const _sphere = new Sphere();
const _colour = new Color();
const _frustum = new Frustum();
const _projection = new Matrix4();

/**
 * The camera of the scene being rendered: set by the scene's `onBeforeRender`, which three calls at the start of every render
 * call (the view, each shadow map, a capture), so it is the projecting camera during the frustum tests.
 */
let renderCamera: Camera | null = null;
const hookedScenes = new WeakSet<Object3D>();

function hookScene(root: Object3D): void {
  let top = root;
  while (top.parent) top = top.parent;
  if ((top as Partial<Scene>).isScene !== true || hookedScenes.has(top)) return;
  hookedScenes.add(top);
  const before = top.onBeforeRender;
  top.onBeforeRender = function (this: Object3D, renderer, scene, camera, geometry, material, group) {
    renderCamera = camera;
    before.call(this, renderer, scene, camera, geometry, material, group);
  };
}

/** Instanced copies of static library models under one root (the sync root, identity transform). */
export class AssetInstances {
  private groups: Group[] = [];
  private readonly owned = new Set<Mesh>();
  private dirty = false;
  private saved = 0;

  /**
   * @param root the sync root (identity transform): instanced meshes are added here
   * @param taken meshes another layer draws (merged library models): never instanced, never given back to the default layer
   */
  constructor(private readonly root: Object3D, private readonly taken: (mesh: Mesh) => boolean = () => false, private readonly minInstances = MIN_INSTANCES) {}

  /** Number of instanced meshes. */
  get count(): number {
    return this.groups.length;
  }

  /** Draws saved per pass when every copy is drawn. */
  get drawCallsSaved(): number {
    return this.saved;
  }

  /** True when a member left its group since the last rebuild. */
  get needsRebuild(): boolean {
    return this.dirty;
  }

  /** Whether `mesh` is drawn by one of the instanced meshes. */
  owns(mesh: Mesh): boolean {
    return this.owned.has(mesh);
  }

  /** The instanced meshes (tests, diagnostics). */
  meshes(): InstancedMesh[] {
    return this.groups.map((g) => g.mesh);
  }

  /**
   * Regroup the models of `nodes` (call after content changed). Groups whose members are unchanged are kept.
   * @returns true when instanced meshes were created or removed
   */
  rebuild(nodes: Iterable<Readonly<EntityNode>>): boolean {
    const dedupe = materialDedupeEnabled();
    const wanted = new Map<string, Mesh[]>();
    for (const node of nodes) {
      if (!instanceableAsset(node) || !node.content.visible || !node.object.visible) continue;
      const meshes = instanceableMeshes(node);
      if (!meshes) continue;
      for (const mesh of meshes) {
        if (this.taken(mesh)) continue;
        const m = mesh.material as Material;
        const s = materialSignature(m);
        const tinted = dedupe && paintMaterial(m) && !m.transparent && !s.key.startsWith('#');
        const mk = dedupe ? (tinted ? `paint:${s.tintless}` : s.key) : m.uuid;
        const e = mesh.matrixWorld.elements;
        const region = m.transparent ? `${Math.floor((e[12] as number) / INSTANCE_REGION)},${Math.floor((e[14] as number) / INSTANCE_REGION)}` : '';
        const key = `${mesh.geometry.uuid}|${mk}|${+mesh.castShadow}${+mesh.receiveShadow}|${region}`;
        let list = wanted.get(key);
        if (!list) wanted.set(key, (list = []));
        list.push(mesh);
      }
    }
    const byKey = new Map<string, Group>();
    for (const g of this.groups) byKey.set(g.key, g);
    const keep: Group[] = [];
    const create: Array<[string, Mesh[]]> = [];
    const still = new Set<Mesh>();
    for (const [key, list] of wanted) {
      if (list.length < this.minInstances) continue;
      for (const m of list) still.add(m);
      const same = byKey.get(key);
      if (same && sameMembers(same, list)) {
        keep.push(same);
        byKey.delete(key);
      } else create.push([key, list]);
    }
    const removed = this.groups.length - keep.length;
    for (const g of this.groups) if (!keep.includes(g)) this.release(g, still);
    this.groups = keep;
    for (const [key, list] of create) this.create(key, list);
    this.owned.clear();
    this.saved = 0;
    for (const g of this.groups) {
      for (const m of g.members) this.owned.add(m.mesh);
      this.saved += g.members.length - 1;
    }
    if (create.length > 0) hookScene(this.root);
    this.dirty = false;
    return removed > 0 || create.length > 0;
  }

  private release(g: Group, still: ReadonlySet<Mesh>): void {
    for (const m of g.members) if (!still.has(m.mesh) && m.mesh.layers.mask === 1 << BATCHED_LAYER && !this.taken(m.mesh)) m.mesh.layers.set(0);
    g.mesh.removeFromParent();
    g.mesh.dispose();
    g.ownMaterial?.dispose();
  }

  private create(key: string, meshes: Mesh[]): void {
    const first = meshes[0] as Mesh;
    const source = first.material as Material;
    const tinted = key.includes('|paint:');
    let material = source;
    let own: Material | null = null;
    if (tinted) {
      own = source.clone();
      own.name = `${source.name}:instanced`;
      (own as unknown as { color: Color }).color.setRGB(1, 1, 1);
      material = own;
    }
    const mesh = new InstancedMesh(first.geometry, material, meshes.length);
    mesh.name = 'aether:asset-instances';
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    if (tinted) {
      mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(meshes.length * 3), 3);
      mesh.instanceColor.setUsage(DynamicDrawUsage);
    }
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.raycast = () => undefined;
    // The group sits at the centre of its copies: instance matrices stay small numbers, and transparent parts sort by it.
    if (!first.geometry.boundingSphere) first.geometry.computeBoundingSphere();
    const bounds = new Sphere().makeEmpty();
    for (const m of meshes) {
      _sphere.copy(first.geometry.boundingSphere as Sphere).applyMatrix4(m.matrixWorld);
      bounds.union(_sphere);
    }
    mesh.position.copy(bounds.center);
    mesh.updateMatrixWorld(true);
    mesh.matrixAutoUpdate = false;
    mesh.boundingSphere = new Sphere(new Vector3(), bounds.radius * 1.05 + 0.01);
    mesh.count = 0;
    for (const m of meshes) m.layers.set(BATCHED_LAYER);
    const members: Member[] = meshes.map((m) => ({ mesh: m, material: m.material as Material, ...lodOf(m) }));
    const group: Group = { key, mesh, members, geometry: first.geometry, ownMaterial: own, tinted, slots: new Int32Array(meshes.length).fill(-1) };
    // Culling: is a copy this camera draws with this mesh inside the frustum? (None: no draw call at all.)
    mesh.intersectsFrustum = (frustum: Frustum) => this.pack(group, renderCamera, frustum) > 0;
    // The draw: pack for the camera actually drawing.
    mesh.onBeforeRender = (_renderer, _scene, camera) => {
      let f: Frustum | null = null;
      if ((camera as { isArrayCamera?: boolean }).isArrayCamera !== true) {
        _projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        f = _frustum.setFromProjectionMatrix(_projection, camera.coordinateSystem, (camera as { reversedDepth?: boolean }).reversedDepth === true);
      }
      this.pack(group, camera, f);
    };
    this.root.add(mesh);
    this.groups.push(group);
  }

  /**
   * Write the members of `g` that `camera` sees (shown, at the level of detail it picks, inside `frustum`; null camera: the
   * levels three picked last, null frustum: no culling) into its first slots; uploads only when the packing changed.
   * Returns the number packed.
   */
  private pack(g: Group, camera: Camera | null, frustum: Frustum | null): number {
    if (!g.geometry.boundingSphere) g.geometry.computeBoundingSphere();
    const bs = g.geometry.boundingSphere as Sphere;
    const arr = g.mesh.instanceMatrix.array as Float32Array;
    const cols = g.tinted ? (g.mesh.instanceColor!.array as Float32Array) : null;
    _origin.copy(g.mesh.matrixWorld).invert();
    if (camera) _eye.setFromMatrixPosition(camera.matrixWorld);
    const zoom = (camera as { zoom?: number } | null)?.zoom ?? 1;
    let n = 0;
    let changed = false;
    let coloured = false;
    for (let i = 0; i < g.members.length; i++) {
      const member = g.members[i] as Member;
      const m = member.mesh;
      const where = placement(m, this.root);
      if (where === DETACHED || m.material !== member.material || m.geometry !== g.geometry || m.layers.mask !== 1 << BATCHED_LAYER || this.taken(m)) {
        this.dirty = true;
        continue;
      }
      if (where === HIDDEN) continue;
      if (member.lod && (camera ? levelFor(member.lod, _eye, zoom) !== member.level : member.lod.levels[member.level]?.object.visible !== true)) continue;
      if (frustum && !frustum.intersectsSphere(_sphere.copy(bs).applyMatrix4(m.matrixWorld))) continue;
      const o = n * 16;
      _m.multiplyMatrices(_origin, m.matrixWorld);
      const e = _m.elements;
      if (g.slots[n] !== i) {
        g.slots[n] = i;
        changed = true;
      }
      for (let k = 0; k < 16; k++) {
        const v = Math.fround(e[k] as number);
        if (arr[o + k] !== v) {
          arr[o + k] = v;
          changed = true;
        }
      }
      if (cols) {
        _colour.copy((m.material as unknown as { color: Color }).color);
        const c = n * 3;
        if (cols[c] !== Math.fround(_colour.r) || cols[c + 1] !== Math.fround(_colour.g) || cols[c + 2] !== Math.fround(_colour.b)) {
          cols[c] = _colour.r;
          cols[c + 1] = _colour.g;
          cols[c + 2] = _colour.b;
          coloured = true;
        }
      }
      n++;
    }
    if (n !== g.mesh.count) {
      for (let s = n; s < g.slots.length; s++) g.slots[s] = -1;
      g.mesh.count = n;
    }
    if (changed) g.mesh.instanceMatrix.needsUpdate = true;
    if (coloured) g.mesh.instanceColor!.needsUpdate = true;
    return n;
  }

  /** Pack every group for `camera` (tests; the renderer packs while it culls and draws). Returns the copies packed per group. */
  packAll(camera: Camera | null = null, frustum: Frustum | null = null): number[] {
    return this.groups.map((g) => this.pack(g, camera, frustum));
  }

  /** Remove every instanced mesh and give the members back to the default layer. */
  clear(): void {
    const none = new Set<Mesh>();
    for (const g of this.groups) this.release(g, none);
    this.groups = [];
    this.owned.clear();
    this.saved = 0;
    this.dirty = false;
  }
}

function sameMembers(g: Group, list: readonly Mesh[]): boolean {
  if (g.members.length !== list.length) return false;
  for (let i = 0; i < list.length; i++) {
    const m = list[i] as Mesh;
    const x = g.members[i] as Member;
    if (x.mesh !== m || m.material !== x.material || m.geometry !== g.geometry) return false;
  }
  return true;
}
