/**
 * VoxelLayer — the three.js side of block terrain.
 *
 * It owns the block atlas texture, the three terrain materials and one
 * mesh per (chunk, pass). Chunk geometry arrives as typed arrays from the
 * meshing workers and is wrapped in GPU buffers as-is (no copy, no
 * per-frame work): replacing a chunk disposes its old buffers first. Each
 * chunk mesh carries a tight bounding box, so three's per-object frustum
 * culling skips chunks outside the view.
 *
 * It also draws the game-kit overlays: the targeted-block outline, the
 * break-progress cracks, dropped items (textured mini blocks) and mobs.
 * All per-frame updates (`setTarget`, `setCrack`, `setDrop`, `setMob`)
 * mutate existing objects in place.
 */
import {
  Box3,
  BoxGeometry,
  type Color,
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  NearestMipmapLinearFilter,
  RGBAFormat,
  RepeatWrapping,
  SRGBColorSpace,
  Sphere,
  UnsignedByteType,
  Vector3,
  type Material,
  type Object3D,
} from 'three';
import { MobKit, MobModel, type MobModelKind } from './mob-models';
import { createTerrainMaterials, type TerrainMaterials } from './terrain-material';

/** One render pass of a chunk mesh (the voxel mesher's output). */
export interface VoxelMeshPass {
  positions: Float32Array;
  uvs: Float32Array;
  /** uint8 × 4 per vertex: atlas tile, AO × 85, sky light × 17, block light × 17. */
  data: Uint8Array;
  indices: Uint16Array | Uint32Array;
  quads: number;
}

/** The meshes of one chunk (chunk-local coordinates). */
export interface VoxelChunkMesh {
  opaque: VoxelMeshPass | null;
  cutout: VoxelMeshPass | null;
  liquid: VoxelMeshPass | null;
  minY: number;
  maxY: number;
}

/** Chunk edge in blocks. */
const CHUNK = 16;
/** Most chunk meshes kept (a 16-chunk view distance needs 33² = 1089). */
export const MAX_VOXEL_CHUNKS = 1600;
/** Most dropped items drawn. */
export const MAX_VOXEL_DROPS = 256;
/** Most mobs drawn. */
export const MAX_VOXEL_MOBS = 96;
/** Crack stages of the break-progress overlay. */
export const CRACK_STAGES = 10;

interface ChunkEntry {
  meshes: [Mesh | null, Mesh | null, Mesh | null];
  triangles: number;
}

const _box = new Box3();
const _v = new Vector3();

function passGeometry(p: VoxelMeshPass, minY: number, maxY: number): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(p.positions, 3));
  g.setAttribute('uv', new BufferAttribute(p.uvs, 2));
  g.setAttribute('data', new BufferAttribute(p.data, 4, true));
  g.setIndex(new BufferAttribute(p.indices, 1));
  _box.min.set(0, Math.max(0, minY), 0);
  _box.max.set(CHUNK, Math.max(minY + 1, maxY), CHUNK);
  g.boundingBox = _box.clone();
  g.boundingSphere = _box.getBoundingSphere(new Sphere());
  return g;
}

const NO_F32 = new Float32Array(0);
const NO_U8 = new Uint8Array(0);
const NO_U16 = new Uint16Array(0);
const NO_U32 = new Uint32Array(0);

/**
 * Release a chunk geometry's CPU vertex copies once its GPU buffers exist
 * (20–60 MiB at view distance 8). Counts, bounds and versions stay, so
 * nothing is uploaded again. Chunk meshes are never ray cast (picking only
 * tests document entities), and a lost GPU context rebuilds the terrain.
 */
function releaseVertexArrays(geometry: BufferGeometry): void {
  for (const name of ['position', 'uv'] as const) {
    const a = geometry.getAttribute(name) as BufferAttribute | undefined;
    if (a) a.array = NO_F32;
  }
  const data = geometry.getAttribute('data') as BufferAttribute | undefined;
  if (data) data.array = NO_U8;
  const index = geometry.getIndex();
  if (index) index.array = index.array instanceof Uint32Array ? NO_U32 : NO_U16;
}

/** Cutout crack pattern for each stage, stacked vertically (16 × 16·stages RGBA). */
function crackPixels(): Uint8Array {
  const px = new Uint8Array(16 * 16 * CRACK_STAGES * 4);
  // Fixed jagged crack paths from the centre; stage n reveals more of them.
  const order: number[] = [];
  let s = 0x2545f491;
  const rand = (): number => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
  const walk = new Set<number>();
  for (let arm = 0; arm < 7; arm++) {
    let x = 7 + Math.floor(rand() * 2);
    let y = 7 + Math.floor(rand() * 2);
    const ang = (arm / 7) * Math.PI * 2 + rand() * 0.6;
    for (let k = 0; k < 11; k++) {
      const c = x + y * 16;
      if (!walk.has(c)) {
        walk.add(c);
        order.push(c);
      }
      x = Math.max(0, Math.min(15, Math.round(x + Math.cos(ang) + (rand() - 0.5) * 1.2)));
      y = Math.max(0, Math.min(15, Math.round(y + Math.sin(ang) + (rand() - 0.5) * 1.2)));
    }
  }
  // Sort by distance from the centre so cracks grow outward.
  order.sort((a, b) => Math.hypot((a % 16) - 7.5, Math.floor(a / 16) - 7.5) - Math.hypot((b % 16) - 7.5, Math.floor(b / 16) - 7.5));
  for (let stage = 0; stage < CRACK_STAGES; stage++) {
    const shown = Math.round(((stage + 1) / CRACK_STAGES) * order.length);
    for (let i = 0; i < shown; i++) {
      const c = order[i] as number;
      const o = ((stage * 16 + Math.floor(c / 16)) * 16 + (c % 16)) * 4;
      px[o] = 20;
      px[o + 1] = 16;
      px[o + 2] = 14;
      px[o + 3] = 210;
    }
  }
  return px;
}

/** Per-drop render record. */
interface DropEntry {
  mesh: Mesh;
  key: string;
}

/** The block-terrain layer of a WorldRenderer. */
export class VoxelLayer {
  readonly group = new Group();
  private readonly chunkGroup = new Group();
  private readonly chunks = new Map<number, ChunkEntry>();
  private atlas: DataTexture | null = null;
  private mats: TerrainMaterials | null = null;
  private readonly outline: LineSegments;
  private readonly crack: Mesh;
  private readonly crackTexture: DataTexture;
  private readonly dropGroup = new Group();
  private readonly drops = new Map<number, DropEntry>();
  private readonly dropGeometries = new Map<string, BufferGeometry>();
  private readonly itemMaterials = new Map<string, MeshBasicMaterial>();
  private readonly mobGroup = new Group();
  private readonly mobs = new Map<number, MobModel>();
  private readonly mobKit = new MobKit();
  private triangles = 0;
  private faceTiles: Uint16Array | null = null;
  private compiler: ((object: Object3D) => Promise<unknown>) | null = null;
  /** Chunk meshes whose GPU state is being pre-built (see {@link flushPrebuild}). */
  private readonly prebuilding = new Map<Mesh, Promise<unknown>>();
  /** New chunk meshes waiting for {@link flushPrebuild}. */
  private readonly toBuild: Mesh[] = [];
  /** Detached container handed to the compiler (never in the scene; children listed, not parented). */
  private readonly buildBatch = new Group();
  /** Materials whose shaders are compiling: chunk meshes stay hidden until they are ready. */
  private warming: TerrainMaterials | null = null;
  /** Bumped whenever something visible changed (the renderer redraws on demand). */
  version = 0;

  constructor() {
    this.buildBatch.name = 'aether:voxel-prebuild';
    this.buildBatch.matrixAutoUpdate = false;
    this.buildBatch.matrixWorldAutoUpdate = false;
    this.group.name = 'aether:voxel';
    this.chunkGroup.name = 'aether:voxel-chunks';
    this.dropGroup.name = 'aether:voxel-drops';
    this.mobGroup.name = 'aether:voxel-mobs';
    const edges = new EdgesGeometry(new BoxGeometry(1.004, 1.004, 1.004));
    this.outline = new LineSegments(edges, new LineBasicMaterial({ color: '#0b0d12', transparent: true, opacity: 0.55, depthWrite: false, fog: false }));
    this.outline.visible = false;
    this.outline.renderOrder = 5;
    this.crackTexture = new DataTexture(crackPixels(), 16, 16 * CRACK_STAGES, RGBAFormat, UnsignedByteType);
    this.crackTexture.magFilter = NearestFilter;
    this.crackTexture.minFilter = NearestFilter;
    this.crackTexture.generateMipmaps = false;
    this.crackTexture.wrapS = RepeatWrapping;
    this.crackTexture.wrapT = RepeatWrapping;
    this.crackTexture.repeat.set(1, 1 / CRACK_STAGES);
    this.crackTexture.needsUpdate = true;
    this.crack = new Mesh(
      new BoxGeometry(1.008, 1.008, 1.008),
      new MeshBasicMaterial({ map: this.crackTexture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, fog: true }),
    );
    this.crack.visible = false;
    this.crack.renderOrder = 4;
    this.group.add(this.chunkGroup, this.dropGroup, this.mobGroup, this.outline, this.crack);
  }

  /**
   * Install the renderer's asynchronous shader compiler (three's
   * `compileAsync`). New terrain materials are then compiled off the frame
   * (parallel pipeline creation on WebGPU, `KHR_parallel_shader_compile` on
   * WebGL2) on three one-quad stand-in meshes while the chunk meshes stay
   * hidden, instead of compiling synchronously inside the first frame that
   * draws a chunk (hundreds of milliseconds on software rasterisers).
   */
  setCompiler(compile: ((object: Object3D) => Promise<unknown>) | null): void {
    this.compiler = compile;
  }

  /** Terrain shaders are still compiling (chunks hidden). */
  get compiling(): boolean {
    return this.warming !== null;
  }

  private warmUp(mats: TerrainMaterials): void {
    const compile = this.compiler;
    if (!compile) return;
    const quad: VoxelMeshPass = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1]),
      uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      data: new Uint8Array(16).fill(255),
      indices: new Uint16Array([0, 2, 1, 0, 3, 2]),
      quads: 1,
    };
    const warm = new Group();
    warm.name = 'aether:voxel-warmup';
    const geo = passGeometry(quad, 0, 1);
    for (const m of [mats.opaque, mats.cutout, mats.liquid]) warm.add(new Mesh(geo, m));
    this.warming = mats;
    this.chunkGroup.visible = false;
    const done = (): void => {
      geo.dispose();
      if (this.warming !== mats) return;
      this.warming = null;
      this.chunkGroup.visible = true;
      this.version++;
    };
    let pending: Promise<unknown>;
    try {
      pending = compile(warm);
    } catch {
      pending = Promise.resolve();
    }
    // A failed pre-compile is harmless: the first frame then compiles synchronously.
    pending.then(done, done);
  }

  /**
   * Set (or replace) the block atlas: RGBA pixels, row 0 at the top, and
   * the per-block face tiles (`[top, bottom, side]` per numeric block id)
   * used to texture dropped blocks.
   */
  setAtlas(pixels: Uint8Array, size: number, faceTiles: Uint16Array): void {
    if (pixels.length !== size * size * 4) throw new Error('atlas size mismatch');
    this.faceTiles = faceTiles;
    for (const g of this.dropGeometries.values()) g.dispose();
    this.dropGeometries.clear();
    if (this.atlas && this.atlas.image.width === size) {
      (this.atlas.image.data as Uint8Array).set(pixels);
      this.atlas.needsUpdate = true;
    } else {
      const tex = new DataTexture(pixels.slice(), size, size, RGBAFormat, UnsignedByteType);
      tex.colorSpace = SRGBColorSpace;
      tex.flipY = false;
      tex.magFilter = NearestFilter;
      tex.minFilter = NearestMipmapLinearFilter;
      tex.generateMipmaps = true;
      tex.anisotropy = 1;
      tex.needsUpdate = true;
      const old = this.atlas;
      const oldMats = this.mats;
      this.atlas = tex;
      this.mats = createTerrainMaterials(tex);
      this.warmUp(this.mats);
      for (const e of this.chunks.values()) this.rebind(e);
      oldMats?.dispose();
      old?.dispose();
    }
    this.version++;
  }

  private rebind(e: ChunkEntry): void {
    const m = this.mats;
    if (!m) return;
    if (e.meshes[0]) e.meshes[0].material = m.opaque;
    if (e.meshes[1]) e.meshes[1].material = m.cutout;
    if (e.meshes[2]) e.meshes[2].material = m.liquid;
  }

  /** Lighting: daylight 0…1 scales sky light; `tint` is the sky light colour (linear RGB 0…1). */
  setLighting(daylight: number, tint: readonly [number, number, number]): void {
    const m = this.mats;
    if (!m) return;
    const d = Number.isFinite(daylight) ? Math.max(0, Math.min(1, daylight)) : 1;
    if (m.uniforms.daylight.value !== d) {
      m.uniforms.daylight.value = d;
      this.version++;
    }
    const c = m.uniforms.skyTint.value;
    if (c.r !== tint[0] || c.g !== tint[1] || c.b !== tint[2]) {
      c.setRGB(tint[0], tint[1], tint[2]);
      this.version++;
    }
  }

  /**
   * Terrain fog (see `terrain-material.ts`): `color` in linear RGB, the
   * linear fade from `near` to `far` metres of horizontal distance, and the
   * environment's own exponential haze `density`. Called every frame; only
   * changes bump {@link version}.
   */
  setFog(color: Color, near: number, far: number, density: number): void {
    const m = this.mats;
    if (!m) return;
    const u = m.uniforms;
    const n = Number.isFinite(near) ? Math.max(0, near) : 1e5;
    const f = Number.isFinite(far) ? Math.max(n + 1, far) : n + 1;
    const d = Number.isFinite(density) ? Math.max(0, density) : 0;
    if (u.fogNear.value !== n || u.fogFar.value !== f || u.fogDensity.value !== d || !u.fogColor.value.equals(color)) {
      u.fogNear.value = n;
      u.fogFar.value = f;
      u.fogDensity.value = d;
      u.fogColor.value.copy(color);
      this.version++;
    }
  }

  /** Centre of the terrain's distance fog (world x, z): the streaming centre. */
  setFogOrigin(x: number, z: number): void {
    const m = this.mats;
    if (!m || !Number.isFinite(x) || !Number.isFinite(z)) return;
    const o = m.uniforms.fogOrigin.value;
    if (o.x === x && o.y === z) return;
    o.set(x, z);
    this.version++;
  }

  /** Install (or with null remove) the meshes of chunk (cx, cz). */
  setChunk(key: number, cx: number, cz: number, mesh: VoxelChunkMesh | null): void {
    this.removeChunk(key);
    if (!mesh || !this.mats) return;
    if (!mesh.opaque && !mesh.cutout && !mesh.liquid) return;
    if (this.chunks.size >= MAX_VOXEL_CHUNKS) return;
    const entry: ChunkEntry = { meshes: [null, null, null], triangles: 0 };
    const passes = [mesh.opaque, mesh.cutout, mesh.liquid] as const;
    const mats: Material[] = [this.mats.opaque, this.mats.cutout, this.mats.liquid];
    for (let i = 0; i < 3; i++) {
      const p = passes[i];
      if (!p || p.quads <= 0) continue;
      const m = new Mesh(passGeometry(p, mesh.minY, mesh.maxY), mats[i]);
      m.position.set(cx * CHUNK, 0, cz * CHUNK);
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      m.castShadow = false;
      m.receiveShadow = false;
      m.renderOrder = i === 2 ? 2 : 0;
      m.name = `voxel:${cx},${cz}:${i}`;
      this.chunkGroup.add(m);
      entry.meshes[i] = m;
      entry.triangles += p.quads * 2;
      this.prebuild(m);
    }
    this.triangles += entry.triangles;
    this.chunks.set(key, entry);
    this.version++;
  }

  /** Queue a new chunk mesh for {@link flushPrebuild}. */
  private prebuild(m: Mesh): void {
    if (this.compiler) this.toBuild.push(m);
  }

  /**
   * Create the queued chunk meshes' GPU state (vertex buffers, bindings,
   * render objects) now, spread over later tasks by the renderer's
   * asynchronous compiler, instead of at their first draw: otherwise every
   * chunk that enters the view in the same frame (camera flights, the reveal
   * after the shader warm-up) is built inside that one frame, a 100+ ms
   * stall with a few dozen chunks. One compiler call per frame for all of
   * them (each call has a fixed cost); projection happens synchronously in
   * the call, so meshes outside the view are built too. The renderer calls
   * this once per frame.
   */
  flushPrebuild(): void {
    const compile = this.compiler;
    const list = this.toBuild;
    if (list.length === 0) return;
    if (!compile) {
      list.length = 0;
      return;
    }
    // A detached container lists the meshes without re-parenting them (their matrices stay valid).
    const batch = this.buildBatch;
    for (const m of list) {
      if (m.parent === null) continue; // removed again before this frame
      m.updateWorldMatrix(true, false);
      m.frustumCulled = false;
      batch.children.push(m);
    }
    list.length = 0;
    if (batch.children.length === 0) return;
    let pending: Promise<unknown>;
    try {
      pending = compile(batch);
    } catch {
      pending = Promise.resolve();
    }
    const built = batch.children.slice() as Mesh[];
    for (const m of built) m.frustumCulled = true;
    batch.children.length = 0;
    const done = (): void => {
      for (const m of built) if (this.prebuilding.get(m) === pending) this.prebuilding.delete(m);
    };
    // Built (buffers uploaded from the full arrays): the CPU copies of meshes still shown can go.
    // The compiler's projection pass already calls onAfterRender before anything is uploaded,
    // so the release waits for the compiler instead. A failed build keeps them (first draw uploads).
    const built0 = (): void => {
      for (const m of built) if (m.parent !== null && this.prebuilding.get(m) === pending) releaseVertexArrays(m.geometry);
      done();
    };
    for (const m of built) this.prebuilding.set(m, pending);
    pending.then(built0, done);
  }

  /** Free a chunk mesh's geometry, after its pending pre-build (which would upload a disposed geometry again). */
  private disposeChunkMesh(m: Mesh): void {
    m.removeFromParent();
    const pending = this.prebuilding.get(m);
    if (!pending) {
      m.geometry.dispose();
      return;
    }
    this.prebuilding.delete(m);
    const free = (): void => {
      m.geometry.dispose();
    };
    pending.then(free, free);
  }

  /** A mesh is installed for chunk `key`. */
  hasChunk(key: number): boolean {
    return this.chunks.has(key);
  }

  /** Drop a chunk's meshes and free their GPU buffers. */
  removeChunk(key: number): void {
    const e = this.chunks.get(key);
    if (!e) return;
    for (const m of e.meshes) if (m) this.disposeChunkMesh(m);
    this.triangles -= e.triangles;
    this.chunks.delete(key);
    this.version++;
  }

  /** Remove every chunk mesh. */
  clearChunks(): void {
    for (const key of [...this.chunks.keys()]) this.removeChunk(key);
  }

  /** Highlight a block (null hides the outline). */
  setTarget(x: number, y: number, z: number, visible: boolean): void {
    if (!visible) {
      if (this.outline.visible) {
        this.outline.visible = false;
        this.crack.visible = false;
        this.version++;
      }
      return;
    }
    if (!this.outline.visible || this.outline.position.x !== x + 0.5 || this.outline.position.y !== y + 0.5 || this.outline.position.z !== z + 0.5) {
      this.outline.position.set(x + 0.5, y + 0.5, z + 0.5);
      this.crack.position.set(x + 0.5, y + 0.5, z + 0.5);
      this.outline.visible = true;
      this.version++;
    }
  }

  /** Break progress of the targeted block (0 hides the cracks). */
  setCrack(progress: number): void {
    const stage = progress > 0 ? Math.min(CRACK_STAGES - 1, Math.floor(progress * CRACK_STAGES)) : -1;
    const visible = stage >= 0 && this.outline.visible;
    if (visible !== this.crack.visible) {
      this.crack.visible = visible;
      this.version++;
    }
    if (visible) {
      const y = stage / CRACK_STAGES;
      if (this.crackTexture.offset.y !== y) {
        this.crackTexture.offset.y = y;
        this.version++;
      }
    }
  }

  private dropGeometry(block: number): BufferGeometry | null {
    const tiles = this.faceTiles;
    if (!tiles || block * 3 + 2 >= tiles.length) return null;
    const key = `b${block}`;
    let g = this.dropGeometries.get(key);
    if (g) return g;
    g = new BoxGeometry(0.28, 0.28, 0.28);
    const count = g.getAttribute('position').count;
    const data = new Uint8Array(count * 4);
    // BoxGeometry face order: +x, −x, +y, −y, +z, −z; 4 vertices each.
    const faceTile = [2, 2, 0, 1, 2, 2];
    for (let f = 0; f < 6; f++) {
      const tile = tiles[block * 3 + (faceTile[f] as number)] as number;
      for (let v = 0; v < 4; v++) {
        const o = (f * 4 + v) * 4;
        data[o] = tile;
        data[o + 1] = 255;
        data[o + 2] = 255;
        data[o + 3] = 0;
      }
    }
    g.setAttribute('data', new BufferAttribute(data, 4, true));
    this.dropGeometries.set(key, g);
    return g;
  }

  private itemMaterial(color: string): MeshBasicMaterial {
    let m = this.itemMaterials.get(color);
    if (!m) {
      m = new MeshBasicMaterial({ color });
      this.itemMaterials.set(color, m);
    }
    return m;
  }

  /**
   * Draw a dropped item: `block` ≥ 0 renders a textured mini block, otherwise
   * a small coloured token in `color`. Bobbing and spinning are the caller's
   * (`y`, `spin`).
   */
  setDrop(id: number, block: number, color: string, x: number, y: number, z: number, spin: number): void {
    let e = this.drops.get(id);
    const key = block >= 0 ? `b${block}` : `c${color}`;
    if (e && e.key !== key) {
      this.removeDrop(id);
      e = undefined;
    }
    if (!e) {
      if (this.drops.size >= MAX_VOXEL_DROPS || !this.mats) return;
      const geo = block >= 0 ? this.dropGeometry(block) : null;
      const mesh = geo
        ? new Mesh(geo, this.mats.opaque)
        : new Mesh(this.itemGeometry(), this.itemMaterial(/^#[0-9a-fA-F]{6}$/.test(color) ? color : '#cccccc'));
      mesh.castShadow = false;
      this.dropGroup.add(mesh);
      e = { mesh, key };
      this.drops.set(id, e);
    }
    e.mesh.position.set(x, y, z);
    e.mesh.rotation.y = spin;
    this.version++;
  }

  private itemGeometry(): BufferGeometry {
    let g = this.dropGeometries.get('item');
    if (!g) {
      g = new BoxGeometry(0.26, 0.26, 0.06);
      this.dropGeometries.set('item', g);
    }
    return g;
  }

  /** Remove a dropped item. */
  removeDrop(id: number): void {
    const e = this.drops.get(id);
    if (!e) return;
    e.mesh.removeFromParent();
    this.drops.delete(id);
    this.version++;
  }

  /** Pose (creating on first use) a mob. */
  setMob(id: number, kind: MobModelKind, x: number, y: number, z: number, yaw: number, phase: number, walk: number, hurt: boolean): void {
    let m = this.mobs.get(id);
    if (m && m.kind !== kind) {
      this.removeMob(id);
      m = undefined;
    }
    if (!m) {
      if (this.mobs.size >= MAX_VOXEL_MOBS) return;
      m = new MobModel(kind, this.mobKit);
      this.mobGroup.add(m.group);
      this.mobs.set(id, m);
    }
    m.pose(x, y, z, yaw, phase, walk, hurt);
    this.version++;
  }

  /** Remove a mob model. */
  removeMob(id: number): void {
    const m = this.mobs.get(id);
    if (!m) return;
    m.dispose();
    this.mobs.delete(id);
    this.version++;
  }

  /** Mobs currently drawn. */
  get mobCount(): number {
    return this.mobs.size;
  }

  /** Drops currently drawn. */
  get dropCount(): number {
    return this.drops.size;
  }

  /** Ids of mobs currently drawn (for pruning). */
  mobIds(): IterableIterator<number> {
    return this.mobs.keys();
  }

  /** Ids of drops currently drawn (for pruning). */
  dropIds(): IterableIterator<number> {
    return this.drops.keys();
  }

  /** Remove all mobs and drops (play stopped). */
  clearActors(): void {
    for (const id of [...this.mobs.keys()]) this.removeMob(id);
    for (const id of [...this.drops.keys()]) this.removeDrop(id);
    this.setTarget(0, 0, 0, false);
  }

  /** Counters for the stats overlay. */
  stats(): { chunks: number; triangles: number; mobs: number; drops: number } {
    return { chunks: this.chunks.size, triangles: this.triangles, mobs: this.mobs.size, drops: this.drops.size };
  }

  /** Centre of the loaded chunk meshes' bounds (framing), or null. */
  bounds(out: Box3): Box3 | null {
    out.makeEmpty();
    for (const e of this.chunks.values()) {
      for (const m of e.meshes) {
        if (!m || !m.geometry.boundingBox) continue;
        _box.copy(m.geometry.boundingBox);
        _v.set(m.position.x, 0, m.position.z);
        _box.min.add(_v);
        _box.max.add(_v);
        out.union(_box);
      }
    }
    return out.isEmpty() ? null : out;
  }

  /** Release every GPU resource. */
  dispose(): void {
    this.toBuild.length = 0;
    this.clearChunks();
    this.clearActors();
    this.mobKit.dispose();
    for (const g of this.dropGeometries.values()) g.dispose();
    this.dropGeometries.clear();
    for (const m of this.itemMaterials.values()) m.dispose();
    this.itemMaterials.clear();
    this.outline.geometry.dispose();
    (this.outline.material as Material).dispose();
    this.crack.geometry.dispose();
    (this.crack.material as Material).dispose();
    this.crackTexture.dispose();
    this.warming = null;
    this.compiler = null;
    this.mats?.dispose();
    this.mats = null;
    this.atlas?.dispose();
    this.atlas = null;
    this.group.removeFromParent();
  }
}
