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
import { Box3, BoxGeometry, BufferAttribute, BufferGeometry, DataTexture, EdgesGeometry, FloatType, LinearFilter, LinearMipmapLinearFilter, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, NearestFilter, NearestMipmapLinearFilter, RGBAFormat, RepeatWrapping, SRGBColorSpace, Sphere, UnsignedByteType, Vector3, } from 'three';
import { sunPosition } from '../environment/sky-state';
import { MobKit, MobModel } from './mob-models';
import { SunShadowField } from './shadow-field';
import { createTerrainMaterials, TILE_TABLE_WIDTH } from './terrain-material';
/** Anisotropic filtering per tier. */
const ANISOTROPY = Object.freeze({ low: 1, medium: 4, high: 8, ultra: 16 });
/** Sun updates per hour of day (the sun direction is recomputed at this rate). */
const SUN_STEPS_PER_HOUR = 240;
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
const _box = new Box3();
const _v = new Vector3();
function passGeometry(p, minY, maxY) {
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
function releaseVertexArrays(geometry) {
    for (const name of ['position', 'uv']) {
        const a = geometry.getAttribute(name);
        if (a)
            a.array = NO_F32;
    }
    const data = geometry.getAttribute('data');
    if (data)
        data.array = NO_U8;
    const index = geometry.getIndex();
    if (index)
        index.array = index.array instanceof Uint32Array ? NO_U32 : NO_U16;
}
/** Cutout crack pattern for each stage, stacked vertically (16 × 16·stages RGBA). */
function crackPixels() {
    const px = new Uint8Array(16 * 16 * CRACK_STAGES * 4);
    // Fixed jagged crack paths from the centre; stage n reveals more of them.
    const order = [];
    let s = 0x2545f491;
    const rand = () => {
        s ^= s << 13;
        s ^= s >>> 17;
        s ^= s << 5;
        return (s >>> 0) / 4294967296;
    };
    const walk = new Set();
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
            const c = order[i];
            const o = ((stage * 16 + Math.floor(c / 16)) * 16 + (c % 16)) * 4;
            px[o] = 20;
            px[o + 1] = 16;
            px[o + 2] = 14;
            px[o + 3] = 210;
        }
    }
    return px;
}
/** The block-terrain layer of a WorldRenderer. */
export class VoxelLayer {
    group = new Group();
    chunkGroup = new Group();
    chunks = new Map();
    atlas = null;
    atlasSmooth = null;
    mats = null;
    /** Column heights for the sun shadows and the water depth. */
    field = new SunShadowField();
    /** Chunks that wrote the height texture (so removing them clears their columns). */
    shadowed = new Map();
    /** Photographic block materials (owned by the caller) and the tile table that binds the atlas tiles to them. */
    sheets = null;
    tileTable = null;
    tier = 'medium';
    sunHourKey = Number.NaN;
    sunDaylightKey = Number.NaN;
    outline;
    crack;
    crackTexture;
    dropGroup = new Group();
    drops = new Map();
    dropGeometries = new Map();
    itemMaterials = new Map();
    mobGroup = new Group();
    mobs = new Map();
    mobKit = new MobKit();
    characters = null;
    triangles = 0;
    faceTiles = null;
    compiler = null;
    /** Chunk meshes whose GPU state is being pre-built (see {@link flushPrebuild}). */
    prebuilding = new Map();
    /** New chunk meshes waiting for {@link flushPrebuild}. */
    toBuild = [];
    /** Detached container handed to the compiler (never in the scene; children listed, not parented). */
    buildBatch = new Group();
    /** Materials whose shaders are compiling: chunk meshes stay hidden until they are ready. */
    warming = null;
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
        this.crack = new Mesh(new BoxGeometry(1.008, 1.008, 1.008), new MeshBasicMaterial({ map: this.crackTexture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, fog: true }));
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
    setCompiler(compile) {
        this.compiler = compile;
    }
    /** Give zombies the renderer's character system (they are then rigged people instead of a rounded stand-in). */
    setCharacters(system) {
        this.characters = system;
    }
    /** Terrain shaders are still compiling (chunks hidden). */
    get compiling() {
        return this.warming !== null;
    }
    warmUp(mats) {
        const compile = this.compiler;
        if (!compile)
            return;
        const quad = {
            positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1]),
            uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
            data: new Uint8Array(16).fill(255),
            indices: new Uint16Array([0, 2, 1, 0, 3, 2]),
            quads: 1,
        };
        const warm = new Group();
        warm.name = 'aether:voxel-warmup';
        const geo = passGeometry(quad, 0, 1);
        for (const m of [mats.opaque, mats.cutout, mats.liquid])
            warm.add(new Mesh(geo, m));
        this.warming = mats;
        this.chunkGroup.visible = false;
        const done = () => {
            geo.dispose();
            if (this.warming !== mats)
                return;
            this.warming = null;
            this.chunkGroup.visible = true;
            this.version++;
        };
        let pending;
        try {
            pending = compile(warm);
        }
        catch {
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
    setAtlas(pixels, size, faceTiles) {
        if (pixels.length !== size * size * 4)
            throw new Error('atlas size mismatch');
        this.faceTiles = faceTiles;
        for (const g of this.dropGeometries.values())
            g.dispose();
        this.dropGeometries.clear();
        if (this.atlas && this.atlas.image.width === size) {
            this.atlas.image.data.set(pixels);
            this.atlas.needsUpdate = true;
            if (this.atlasSmooth)
                this.atlasSmooth.needsUpdate = true;
        }
        else {
            const tex = new DataTexture(pixels.slice(), size, size, RGBAFormat, UnsignedByteType);
            tex.colorSpace = SRGBColorSpace;
            tex.flipY = false;
            tex.magFilter = NearestFilter;
            tex.minFilter = NearestMipmapLinearFilter;
            tex.generateMipmaps = true;
            tex.anisotropy = 1;
            tex.needsUpdate = true;
            const smooth = new DataTexture(tex.image.data, size, size, RGBAFormat, UnsignedByteType);
            smooth.colorSpace = SRGBColorSpace;
            smooth.flipY = false;
            smooth.magFilter = LinearFilter;
            smooth.minFilter = LinearMipmapLinearFilter;
            smooth.generateMipmaps = true;
            smooth.anisotropy = 4;
            smooth.needsUpdate = true;
            const old = this.atlas;
            const oldSmooth = this.atlasSmooth;
            this.atlas = tex;
            this.atlasSmooth = smooth;
            this.rebuildMaterials();
            old?.dispose();
            oldSmooth?.dispose();
        }
        this.version++;
    }
    /**
     * Install the photographic block materials (decoded sheets plus the per-tile table from
     * `buildTileTable`); null returns to the pixel atlas. The sheets stay owned by the caller (they are
     * shared and survive this layer). Terrain shaders are rebuilt.
     */
    setBlockMaterials(sheets, table) {
        const prevTable = this.tileTable;
        this.sheets = sheets && table && table.length === TILE_TABLE_WIDTH * 4 * 4 ? sheets : null;
        if (this.sheets && table) {
            const t = new DataTexture(table.slice(), TILE_TABLE_WIDTH, 4, RGBAFormat, FloatType);
            t.magFilter = NearestFilter;
            t.minFilter = NearestFilter;
            t.generateMipmaps = false;
            t.flipY = false;
            t.needsUpdate = true;
            this.tileTable = t;
        }
        else {
            this.tileTable = null;
        }
        this.applyAnisotropy();
        this.rebuildMaterials();
        prevTable?.dispose();
    }
    /** Quality tier of the terrain shaders (the render tier); a different tier rebuilds them. */
    setQuality(tier) {
        if (tier === this.tier)
            return;
        this.tier = tier;
        this.applyAnisotropy();
        this.rebuildMaterials();
    }
    /** Anisotropic filtering follows the tier (software rasterisers pay per tap): 1, 4, 8, 16 (the backend clamps to what it supports). */
    applyAnisotropy() {
        const sheets = this.sheets;
        if (!sheets)
            return;
        const level = ANISOTROPY[this.tier];
        for (const t of [sheets.albedo, sheets.normal, sheets.orm]) {
            if (t.anisotropy !== level) {
                t.anisotropy = level;
                t.needsUpdate = true;
            }
        }
    }
    /** The tier the terrain shaders were built for. */
    get quality() {
        return this.tier;
    }
    /** True while the photographic materials (not the pixel atlas) are in use. */
    get photographic() {
        return this.sheets !== null && this.tileTable !== null;
    }
    rebuildMaterials() {
        const atlas = this.atlas;
        const atlasSmooth = this.atlasSmooth;
        if (!atlas || !atlasSmooth)
            return;
        const sheets = this.sheets;
        const table = this.tileTable;
        const old = this.mats;
        const mats = createTerrainMaterials({ atlas, atlasSmooth, pbr: sheets && table ? { albedo: sheets.albedo, normal: sheets.normal, orm: sheets.orm, table } : null, field: this.field.texture }, this.tier);
        if (old) {
            const a = old.uniforms;
            const b = mats.uniforms;
            b.daylight.value = a.daylight.value;
            b.skyTint.value.copy(a.skyTint.value);
            b.liquidOpacity.value = a.liquidOpacity.value;
            b.fogColor.value.copy(a.fogColor.value);
            b.fogOrigin.value.copy(a.fogOrigin.value);
            b.fogNear.value = a.fogNear.value;
            b.fogFar.value = a.fogFar.value;
            b.fogDensity.value = a.fogDensity.value;
            b.sunDirection.value.copy(a.sunDirection.value);
            b.sunColor.value.copy(a.sunColor.value);
            b.skyZenith.value.copy(a.skyZenith.value);
            b.waterLevel.value = a.waterLevel.value;
        }
        this.mats = mats;
        this.warmUp(mats);
        for (const e of this.chunks.values())
            this.rebind(e);
        old?.dispose();
        this.version++;
    }
    /** The sky overhead (linear RGB) that terrain reflections and water mirror. */
    setSkyZenith(color) {
        const m = this.mats;
        if (!m || !Number.isFinite(color.r + color.g + color.b))
            return;
        if (!m.uniforms.skyZenith.value.equals(color)) {
            m.uniforms.skyZenith.value.copy(color);
            this.version++;
        }
    }
    /** World y of the water surface (wet shores, caustics). */
    setWaterLevel(y) {
        const m = this.mats;
        if (!m || !Number.isFinite(y))
            return;
        if (m.uniforms.waterLevel.value !== y) {
            m.uniforms.waterLevel.value = y;
            this.version++;
        }
    }
    rebind(e) {
        const m = this.mats;
        if (!m)
            return;
        if (e.meshes[0])
            e.meshes[0].material = m.opaque;
        if (e.meshes[1])
            e.meshes[1].material = m.cutout;
        if (e.meshes[2])
            e.meshes[2].material = m.liquid;
    }
    /**
     * Lighting: daylight 0…1 scales sky light; `tint` is the sky light colour (linear RGB 0…1); `hour` (0…24) puts the
     * sun in the sky and warms its light as it sinks (without it the sun keeps its default high position).
     */
    setLighting(daylight, tint, hour) {
        const m = this.mats;
        if (!m)
            return;
        // The sun moves a hair per frame: recompute its direction only when the hour moved by a visible amount (no garbage per frame).
        if (hour !== undefined && Number.isFinite(hour)) {
            const q = Math.round(hour * SUN_STEPS_PER_HOUR);
            const dq = Math.round((Number.isFinite(daylight) ? daylight : 1) * 255);
            if (q !== this.sunHourKey || dq !== this.sunDaylightKey) {
                this.sunHourKey = q;
                this.sunDaylightKey = dq;
                this.setSun(hour, daylight);
            }
        }
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
    /** The sun's direction and colour for an hour: warm and low at dusk and dawn, white and high at noon, cool moonlight at night. */
    setSun(hour, daylight) {
        const m = this.mats;
        if (!m)
            return;
        const { elevation, direction } = sunPosition(hour);
        const d = Number.isFinite(daylight) ? Math.max(0, Math.min(1, daylight)) : 1;
        const high = Math.max(0, Math.min(1, elevation / 45));
        // Below the horizon the light is the moon: from the opposite side, dim and blue.
        const night = elevation <= 1;
        const dir = night ? [-direction[0], Math.max(0.35, -direction[1]), -direction[2]] : direction;
        const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
        const u = m.uniforms;
        const dx = dir[0] / len;
        const dy = dir[1] / len;
        const dz = dir[2] / len;
        // Warm toward the horizon: (1, 0.55, 0.28) at the horizon to (1, 0.97, 0.9) high up.
        const r = night ? 0.28 : 1;
        const g = night ? 0.34 : 0.55 + 0.42 * high;
        const b = night ? 0.5 : 0.28 + 0.62 * high;
        const k = night ? 0.5 * (1 - d) : d * (0.35 + 0.65 * Math.min(1, elevation / 14));
        const cur = u.sunDirection.value;
        const col = u.sunColor.value;
        if (cur.x !== dx || cur.y !== dy || cur.z !== dz || col.r !== r * k || col.g !== g * k || col.b !== b * k) {
            cur.set(dx, dy, dz);
            col.setRGB(r * k, g * k, b * k);
            this.version++;
        }
    }
    /**
     * Terrain fog (see `terrain-material.ts`): `color` in linear RGB, the
     * linear fade from `near` to `far` metres of horizontal distance, and the
     * environment's own exponential haze `density`. Called every frame; only
     * changes bump {@link version}.
     */
    setFog(color, near, far, density) {
        const m = this.mats;
        if (!m)
            return;
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
    setFogOrigin(x, z) {
        const m = this.mats;
        if (!m || !Number.isFinite(x) || !Number.isFinite(z))
            return;
        const o = m.uniforms.fogOrigin.value;
        if (o.x === x && o.y === z)
            return;
        o.set(x, z);
        this.version++;
    }
    /** Install (or with null remove) the meshes of chunk (cx, cz). */
    setChunk(key, cx, cz, mesh) {
        this.removeChunk(key);
        this.field.setChunk(cx, cz, mesh?.heights);
        if (mesh?.heights)
            this.shadowed.set(key, { cx, cz });
        if (!mesh || !this.mats)
            return;
        if (!mesh.opaque && !mesh.cutout && !mesh.liquid)
            return;
        if (this.chunks.size >= MAX_VOXEL_CHUNKS)
            return;
        const entry = { meshes: [null, null, null], triangles: 0, cx, cz };
        const passes = [mesh.opaque, mesh.cutout, mesh.liquid];
        const mats = [this.mats.opaque, this.mats.cutout, this.mats.liquid];
        for (let i = 0; i < 3; i++) {
            const p = passes[i];
            if (!p || p.quads <= 0)
                continue;
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
    prebuild(m) {
        if (this.compiler)
            this.toBuild.push(m);
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
    flushPrebuild() {
        if (this.field.flush())
            this.version++;
        // Nothing queued (the usual frame): return before the closures below, whose captured context V8 allocates on entry.
        if (this.toBuild.length === 0)
            return;
        this.buildQueued();
    }
    buildQueued() {
        const compile = this.compiler;
        const list = this.toBuild;
        if (list.length === 0)
            return;
        if (!compile) {
            list.length = 0;
            return;
        }
        // A detached container lists the meshes without re-parenting them (their matrices stay valid).
        const batch = this.buildBatch;
        for (const m of list) {
            if (m.parent === null)
                continue; // removed again before this frame
            m.updateWorldMatrix(true, false);
            m.frustumCulled = false;
            batch.children.push(m);
        }
        list.length = 0;
        if (batch.children.length === 0)
            return;
        let pending;
        try {
            pending = compile(batch);
        }
        catch {
            pending = Promise.resolve();
        }
        const built = batch.children.slice();
        for (const m of built)
            m.frustumCulled = true;
        batch.children.length = 0;
        const done = () => {
            for (const m of built)
                if (this.prebuilding.get(m) === pending)
                    this.prebuilding.delete(m);
        };
        // Built (buffers uploaded from the full arrays): the CPU copies of meshes still shown can go.
        // The compiler's projection pass already calls onAfterRender before anything is uploaded,
        // so the release waits for the compiler instead. A failed build keeps them (first draw uploads).
        const built0 = () => {
            for (const m of built)
                if (m.parent !== null && this.prebuilding.get(m) === pending)
                    releaseVertexArrays(m.geometry);
            done();
        };
        for (const m of built)
            this.prebuilding.set(m, pending);
        pending.then(built0, done);
    }
    /** Free a chunk mesh's geometry, after its pending pre-build (which would upload a disposed geometry again). */
    disposeChunkMesh(m) {
        m.removeFromParent();
        const pending = this.prebuilding.get(m);
        if (!pending) {
            m.geometry.dispose();
            return;
        }
        this.prebuilding.delete(m);
        const free = () => {
            m.geometry.dispose();
        };
        pending.then(free, free);
    }
    /** A mesh is installed for chunk `key`. */
    hasChunk(key) {
        return this.chunks.has(key);
    }
    /** Drop a chunk's meshes and free their GPU buffers. */
    removeChunk(key) {
        const sh = this.shadowed.get(key);
        if (sh) {
            this.field.setChunk(sh.cx, sh.cz, null);
            this.shadowed.delete(key);
        }
        const e = this.chunks.get(key);
        if (!e)
            return;
        for (const m of e.meshes)
            if (m)
                this.disposeChunkMesh(m);
        this.triangles -= e.triangles;
        this.chunks.delete(key);
        this.version++;
    }
    /** Remove every chunk mesh. */
    clearChunks() {
        for (const key of [...new Set([...this.chunks.keys(), ...this.shadowed.keys()])])
            this.removeChunk(key);
    }
    /** Highlight a block (null hides the outline). */
    setTarget(x, y, z, visible) {
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
    setCrack(progress) {
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
    dropGeometry(block) {
        const tiles = this.faceTiles;
        if (!tiles || block * 3 + 2 >= tiles.length)
            return null;
        const key = `b${block}`;
        let g = this.dropGeometries.get(key);
        if (g)
            return g;
        g = new BoxGeometry(0.28, 0.28, 0.28);
        const count = g.getAttribute('position').count;
        const data = new Uint8Array(count * 4);
        // BoxGeometry face order: +x, −x, +y, −y, +z, −z; 4 vertices each.
        const faceTile = [2, 2, 0, 1, 2, 2];
        for (let f = 0; f < 6; f++) {
            const tile = tiles[block * 3 + faceTile[f]];
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
    itemMaterial(color) {
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
    setDrop(id, block, color, x, y, z, spin) {
        let e = this.drops.get(id);
        const key = block >= 0 ? `b${block}` : `c${color}`;
        if (e && e.key !== key) {
            this.removeDrop(id);
            e = undefined;
        }
        if (!e) {
            if (this.drops.size >= MAX_VOXEL_DROPS || !this.mats)
                return;
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
    itemGeometry() {
        let g = this.dropGeometries.get('item');
        if (!g) {
            g = new BoxGeometry(0.26, 0.26, 0.06);
            this.dropGeometries.set('item', g);
        }
        return g;
    }
    /** Remove a dropped item. */
    removeDrop(id) {
        const e = this.drops.get(id);
        if (!e)
            return;
        e.mesh.removeFromParent();
        this.drops.delete(id);
        this.version++;
    }
    /** Pose (creating on first use) a mob. */
    setMob(id, kind, x, y, z, yaw, phase, walk, hurt) {
        let m = this.mobs.get(id);
        if (m && m.kind !== kind) {
            this.removeMob(id);
            m = undefined;
        }
        if (!m) {
            if (this.mobs.size >= MAX_VOXEL_MOBS)
                return;
            m = new MobModel(kind, this.mobKit, this.characters ? { system: this.characters, id: String(id) } : undefined);
            this.mobGroup.add(m.group);
            this.mobs.set(id, m);
        }
        m.pose(x, y, z, yaw, phase, walk, hurt);
        this.version++;
    }
    /** Remove a mob model. */
    removeMob(id) {
        const m = this.mobs.get(id);
        if (!m)
            return;
        m.dispose();
        this.mobs.delete(id);
        this.version++;
    }
    /** Mobs currently drawn. */
    get mobCount() {
        return this.mobs.size;
    }
    /** Drops currently drawn. */
    get dropCount() {
        return this.drops.size;
    }
    /** Ids of mobs currently drawn (for pruning). */
    mobIds() {
        return this.mobs.keys();
    }
    /** Ids of drops currently drawn (for pruning). */
    dropIds() {
        return this.drops.keys();
    }
    /** Remove all mobs and drops (play stopped). */
    clearActors() {
        for (const id of [...this.mobs.keys()])
            this.removeMob(id);
        for (const id of [...this.drops.keys()])
            this.removeDrop(id);
        this.setTarget(0, 0, 0, false);
    }
    /** Counters for the stats overlay. */
    stats() {
        return { chunks: this.chunks.size, triangles: this.triangles, mobs: this.mobs.size, drops: this.drops.size };
    }
    /** Centre of the loaded chunk meshes' bounds (framing), or null. */
    bounds(out) {
        out.makeEmpty();
        for (const e of this.chunks.values()) {
            for (const m of e.meshes) {
                if (!m || !m.geometry.boundingBox)
                    continue;
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
    dispose() {
        this.toBuild.length = 0;
        this.clearChunks();
        this.shadowed.clear();
        this.clearActors();
        this.mobKit.dispose();
        for (const g of this.dropGeometries.values())
            g.dispose();
        this.dropGeometries.clear();
        for (const m of this.itemMaterials.values())
            m.dispose();
        this.itemMaterials.clear();
        this.outline.geometry.dispose();
        this.outline.material.dispose();
        this.crack.geometry.dispose();
        this.crack.material.dispose();
        this.crackTexture.dispose();
        this.warming = null;
        this.compiler = null;
        this.mats?.dispose();
        this.mats = null;
        this.atlas?.dispose();
        this.atlas = null;
        this.atlasSmooth?.dispose();
        this.atlasSmooth = null;
        this.tileTable?.dispose();
        this.tileTable = null;
        this.sheets = null;
        this.field.dispose();
        this.group.removeFromParent();
    }
}
