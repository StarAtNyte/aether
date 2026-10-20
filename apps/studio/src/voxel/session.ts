/**
 * VoxelSession — the studio side of block terrain, owned by the Simulation.
 *
 * Edit mode: mirrors `world.voxel` into the renderer's voxel layer. A new
 * terrain configuration rebuilds the block registry and atlas, configures
 * the worker pool and re-streams; appending or removing document edits
 * (the common agent step) regenerates only the chunks those edits touch,
 * so the rest of the terrain never flickers. Chunks stream around the
 * orbit target with the world's view distance and fog that ends there.
 *
 * Play mode ({@link VoxelPlay}): the game kit runs on the same block world
 * (fixed 60 Hz steps), the camera is posed directly (first or third
 * person), mobs / drops / the block outline and cracks are drawn by the
 * layer, the day/night clock drives the sky, and player changes are saved
 * to IndexedDB (modified chunks + player state) every few seconds, when a
 * modified chunk unloads and when play stops. Saves load again on the next
 * play (or after a page reload) for the same project and terrain seed.
 */
import { loadBlockSheets, PRESET_HOURS, type BlockSheets, type VoxelLayer, type WorldRenderer } from '@aether/render';
import type { Environment, VoxelEdit, VoxelTerrain, WorldDoc } from '@aether/core';
import { deepEqual } from '@aether/core';
import {
  BlockRegistry, buildAtlas, buildTileTable, ChunkStreamer, compileEdits, createHit, decodeChunk, decodeSave, encodeChunk, encodeSave, identityKey, openestYaw, raycastVoxels, saveIdentity,
  SavedPlayer, TerrainGenerator, terrainIdentity, VoxelJobPool, VoxelWorld, CHUNK, LIQUID_SURFACE, SEA_LEVEL, chunkKey, type BlockAtlas, type ChunkData, type ChunkMesh, type ChunkSlot, type TerrainIdentity, type VoxelSave,
} from '@aether/voxel';
import { createInput, daylightAt, EYE_HEIGHT, skyForHour, skyTintAt, VoxelGame, type GameEvent, type GameInput, type ItemDef } from '@aether/voxel/game';
import { createLogger, errorMessage } from '../lib/log';
import { hudEqual, type HudRecipe, type HudSlot, type ItemIcon, type VoxelHudState } from './hudState';
import { clearViewOffset } from './framing';
import { VoxelInput } from './input';
import { paintItemIcons, pixelsToObjectUrl, ICON } from './itemIcons';
import { parseChunkKey, voxelSaveStore, type VoxelSaveStore } from './saveStore';

const log = createLogger('voxel');

/** Photographic block materials, decoded once per page (null: unavailable, the pixel atlas stays). */
let blockSheets: Promise<BlockSheets | null> | null = null;
function photographicSheets(): Promise<BlockSheets | null> {
  blockSheets ??= loadBlockSheets('/blocks/', 8);
  return blockSheets;
}

/** Seconds between autosaves while playing (only when something changed). */
const AUTOSAVE_S = 8;
/** HUD refresh interval (ms). */
const HUD_MS = 100;
/** Most newly streamed chunk meshes handed to the GPU per frame. */
const UPLOADS_PER_FRAME = 4;
/** Quad budget of those uploads per frame (one big chunk may exceed it alone). */
const UPLOAD_QUADS_PER_FRAME = 12_000;
/** Most recent document edits {@link VoxelSession.editFocus} frames. */
const FOCUS_EDITS = 64;
/** Seconds of game time between sky updates. */
const SKY_STEP_HOURS = 0.08;

/** What the session needs from its owner. */
export interface VoxelSessionHost {
  /** HUD snapshot (null: no voxel game running). */
  onHud(state: VoxelHudState | null): void;
  sound(name: string): void;
  error(message: string): void;
  /** Save namespace (project id; 'scratch' outside projects). */
  saveBase: string;
}

/** Edits common prefix length. */
function commonPrefix(a: readonly VoxelEdit[], b: readonly VoxelEdit[]): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && (a[i] === b[i] || deepEqual(a[i], b[i]))) i++;
  return i;
}

/** Chunk keys whose area intersects any of `edits` (bounds via the compiler). */
function touchedChunks(edits: readonly VoxelEdit[], reg: BlockRegistry, gen: TerrainGenerator, seed: number): Set<number> {
  const out = new Set<number>();
  const compiled = compileEdits(edits, reg, gen, seed);
  for (const e of compiled) {
    // Lighting/AO reach one chunk further than the blocks themselves.
    const x0 = Math.floor((e.minX - 1) / CHUNK);
    const x1 = Math.floor((e.maxX + 1) / CHUNK);
    const z0 = Math.floor((e.minZ - 1) / CHUNK);
    const z1 = Math.floor((e.maxZ + 1) / CHUNK);
    if ((x1 - x0 + 1) * (z1 - z0 + 1) > 4096) return new Set([-1]);
    for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) out.add(chunkKey(cx, cz));
  }
  return out;
}

/** The voxel part of a Simulation. */
export class VoxelSession {
  private layer: VoxelLayer | null = null;
  private reg: BlockRegistry | null = null;
  private atlas: BlockAtlas | null = null;
  private atlasUrl = '';
  private itemsUrl = '';
  /** Generation of the item-icon image (an encode that finishes after a release is discarded). */
  private itemsGen = 0;
  private itemIndex = new Map<string, number>();
  private gen: TerrainGenerator | null = null;
  private pool: VoxelJobPool | null = null;
  private world: VoxelWorld | null = null;
  private streamer: ChunkStreamer | null = null;
  private terrain: VoxelTerrain | null = null;
  private identity: TerrainIdentity | null = null;
  private registryKey = '';
  private saveKey = '';
  private savedKeys = new Set<string>();
  private store: VoxelSaveStore | null = null;
  private play: VoxelPlay | null = null;
  private doc: WorldDoc | null = null;
  private disposed = false;
  private epoch = 0;
  /** View distance currently applied to streaming and fog (0: none yet). */
  private appliedDistance = 0;
  /** The save index of a new terrain is loading (streaming holds until it is known). */
  private indexLoading: Promise<void> | null = null;
  /** Longest upload batch (ms) since {@link resetWorkStats}. */
  private maxUploadMs = 0;
  /** Streamed chunk meshes waiting for their GPU upload (insertion order = nearest first). */
  private readonly uploads = new Map<number, { cx: number; cz: number; mesh: ChunkMesh }>();
  private readonly center: [number, number, number] = [0, 0, 0];
  /** Chunk slot versions already written to the save. */
  private readonly savedVersions = new Map<number, number>();

  constructor(
    private readonly renderer: WorldRenderer,
    private readonly host: VoxelSessionHost,
  ) {}

  /** A voxel terrain is active. */
  get active(): boolean {
    return this.terrain !== null;
  }

  /** The play session (null in edit mode). */
  get game(): VoxelPlay | null {
    return this.play;
  }

  /** The play session is still waiting for the terrain around the spawn (the "Generating terrain" card is up). */
  get loadingPlay(): boolean {
    return this.play?.loading ?? false;
  }

  /** Every chunk within the view distance is meshed and on screen (shaders compiled). */
  get settled(): boolean {
    return (this.streamer?.settled ?? true) && this.uploads.size === 0 && !(this.layer?.compiling ?? false);
  }

  /**
   * Longest main-thread costs of block terrain since the last
   * {@link resetWorkStats} (ms): a streamer update (scheduling + unload sweep),
   * one worker reply (validation + install), one frame's GPU upload batch.
   * Environment-independent evidence that streaming never blocks the page.
   */
  workStats(): { update: number; reply: number; upload: number } {
    return { update: this.streamer?.maxUpdateMs ?? 0, reply: this.pool?.stats.maxReplyMs ?? 0, upload: this.maxUploadMs };
  }

  /** Restart {@link workStats}. */
  resetWorkStats(): void {
    if (this.streamer) this.streamer.maxUpdateMs = 0;
    if (this.pool) this.pool.stats.maxReplyMs = 0;
    this.maxUploadMs = 0;
  }

  /** Streaming status (tests, e2e, stats overlay). */
  status(): { chunks: number; meshed: number; pending: number; settled: boolean; inline: boolean; changed: number; view: number; compiling: boolean } {
    return {
      view: this.appliedDistance,
      compiling: this.layer?.compiling ?? false,
      chunks: this.world?.chunks.size ?? 0,
      meshed: this.streamer?.meshedCount ?? 0,
      pending: this.pool?.pending ?? 0,
      settled: this.settled,
      inline: this.pool?.inlineMode ?? false,
      changed: [...(this.world?.chunks.values() ?? [])].filter((s) => s.modified).length,
    };
  }

  /**
   * Diagnostics: change one block the way a game edit does (the streamer
   * is told at once, as in the play loop) and resolve with
   * `mesh` — milliseconds until the chunk's new mesh is installed in the
   * render layer — and `frame` — until the first animation frame after
   * that, i.e. when it is on screen. Both are −1 when the chunk is not
   * loaded or nothing arrived within 5 s. Used by the end-to-end checks.
   */
  async measureEdit(x: number, y: number, z: number, block: string): Promise<{ mesh: number; frame: number }> {
    const world = this.world;
    const streamer = this.streamer;
    const id = this.reg?.id(block);
    const none = { mesh: -1, frame: -1 };
    if (!world || !streamer || id === undefined) return none;
    const slot = world.slot(Math.floor(x / CHUNK), Math.floor(z / CHUNK));
    if (!slot) return none;
    const t0 = performance.now();
    if (world.set(x, y, z, id) < 0) return none;
    const want = slot.version;
    streamer.update();
    const mesh = await new Promise<number>((resolve) => {
      const check = (): void => {
        if (streamer.shownVersion(slot.key) >= want) resolve(performance.now() - t0);
        else if (performance.now() - t0 > 5000) resolve(-1);
        else setTimeout(check, 1);
      };
      check();
    });
    if (mesh < 0) return none;
    const frame = await new Promise<number>((resolve) => requestAnimationFrame(() => resolve(performance.now() - t0)));
    return { mesh, frame };
  }

  /** Solid-block source for Rapier terrain colliders (dynamic entities in block worlds). */
  solidSource(): { isSolid(x: number, y: number, z: number): boolean; chunkVersion(cx: number, cz: number): number; readonly height: number } | null {
    const world = this.world;
    if (!world) return null;
    return {
      height: 128,
      isSolid: (x, y, z) => world.isLoaded(x, z) && world.isSolid(x, y, z),
      chunkVersion: (cx, cz) => world.slot(cx, cz)?.version ?? -1,
    };
  }

  /** Block at a world cell (diagnostics; −1 when not loaded). */
  blockAt(x: number, y: number, z: number): string | null {
    if (!this.world || !this.reg || !this.world.isLoaded(x, z)) return null;
    return this.reg.type(this.world.get(x, y, z)).id;
  }

  /** Loaded chunks and drawn chunk meshes (memory checks). */
  get counts(): { loaded: number; drawn: number } {
    return { loaded: this.world?.chunks.size ?? 0, drawn: this.layer?.stats().chunks ?? 0 };
  }

  /** Mirror `doc.voxel` (call after the renderer synced the document). */
  async sync(doc: WorldDoc): Promise<void> {
    if (this.disposed) return;
    this.doc = doc;
    const t = doc.voxel;
    if (!t) {
      if (this.terrain) this.teardown();
      return;
    }
    const identity = terrainIdentity(t, doc.seed);
    const prev = this.identity;
    this.terrain = t;
    if (prev && identityKey(prev) === identityKey(identity)) {
      this.applyViewDistance();
      return;
    }
    const epoch = ++this.epoch;
    this.applyViewDistance();
    const layer = await this.renderer.voxel();
    if (this.disposed || epoch !== this.epoch) return;
    this.layer = layer;
    layer.setWaterLevel(SEA_LEVEL - 1 + LIQUID_SURFACE);
    const regKey = JSON.stringify(t.blocks);
    if (!this.reg || regKey !== this.registryKey) {
      this.reg = new BlockRegistry(t.blocks);
      this.registryKey = regKey;
      this.atlas = buildAtlas(this.reg);
      layer.setAtlas(this.atlas.pixels, this.atlas.size, this.reg.faceTiles);
      const reg = this.reg;
      void photographicSheets().then((sheets) => {
        if (sheets && !this.disposed && this.layer === layer && this.reg === reg) layer.setBlockMaterials(sheets, buildTileTable(reg.tiles, sheets.materials));
      });
      this.setAtlasUrl('');
      const atlas = this.atlas;
      void pixelsToObjectUrl(atlas.pixels, atlas.size, atlas.size).then((url) => {
        if (this.atlas === atlas && !this.disposed) this.setAtlasUrl(url);
        else if (url) URL.revokeObjectURL(url);
      });
      this.buildItemIcons();
      // A new registry renumbers blocks: everything regenerates.
      this.resetStreaming(identity, t);
    } else if (prev && prev.preset === identity.preset && prev.seed === identity.seed && prev.border === identity.border) {
      // Only document edits changed: regenerate the chunks they touch.
      this.gen = new TerrainGenerator(identity.seed, identity.preset, this.reg);
      const p = commonPrefix(prev.edits, identity.edits);
      const changed = [...prev.edits.slice(p), ...identity.edits.slice(p)];
      const keys = touchedChunks(changed, this.reg, this.gen, identity.seed);
      this.identity = identity;
      this.pool?.configure(identity, this.reg.size - 1);
      if (keys.has(-1)) this.streamer?.reset(identity.border);
      else this.streamer?.regenerate(keys);
    } else {
      this.resetStreaming(identity, t);
    }
    this.applyViewDistance();
    this.applyEditLighting(doc.environment);
    const saveKey = `${this.host.saveBase}::${saveIdentity(identity)}`;
    if (saveKey !== this.saveKey) {
      // Streaming waits for the save index: a chunk generated from the seed while the
      // index loads would otherwise hide the player's saved copy of it.
      const loading = this.loadSaveIndex(saveKey);
      this.indexLoading = loading;
      try {
        await loading;
      } finally {
        if (this.indexLoading === loading) this.indexLoading = null;
      }
    }
  }

  /** The world's view distance, capped by the device's render budget (low-memory mode lowers it). */
  private viewDistance(t: VoxelTerrain): number {
    return Math.max(2, Math.min(t.viewDistance, this.renderer.voxelViewDistanceCap));
  }

  /**
   * A chunk mesh arrived from the workers. Replacements (edits,
   * regenerated chunks) and removals apply at once, so an edit shows in the
   * next frame; newly streamed chunks wait in {@link uploads} and
   * {@link flushUploads} hands a few per frame to the GPU, so a burst of
   * worker replies never turns into one long frame of buffer uploads.
   */
  private queueMesh(key: number, cx: number, cz: number, mesh: ChunkMesh | null): void {
    const layer = this.layer;
    if (!layer) return;
    if (!mesh || layer.hasChunk(key)) {
      this.uploads.delete(key);
      layer.setChunk(key, cx, cz, mesh);
      return;
    }
    this.uploads.set(key, { cx, cz, mesh });
  }

  /** Install queued chunk meshes: at most {@link UPLOADS_PER_FRAME} chunks / {@link UPLOAD_QUADS_PER_FRAME} quads. */
  private flushUploads(): void {
    const layer = this.layer;
    if (!layer || this.uploads.size === 0) return;
    const t0 = performance.now();
    let n = 0;
    let quads = 0;
    for (const [key, u] of this.uploads) {
      if (n >= UPLOADS_PER_FRAME || (n > 0 && quads >= UPLOAD_QUADS_PER_FRAME)) break;
      this.uploads.delete(key);
      layer.setChunk(key, u.cx, u.cz, u.mesh);
      quads += (u.mesh.opaque?.quads ?? 0) + (u.mesh.cutout?.quads ?? 0) + (u.mesh.liquid?.quads ?? 0);
      n++;
    }
    const ms = performance.now() - t0;
    if (ms > this.maxUploadMs) this.maxUploadMs = ms;
  }

  /**
   * Apply the (capped) view distance to streaming and fog; cheap when
   * unchanged. Fog is part of every material's shader, so it is set before
   * the terrain materials are created and pre-compiled (a later change would
   * recompile them all inside one frame).
   */
  private applyViewDistance(): void {
    const t = this.terrain;
    if (!t) return;
    const vd = this.viewDistance(t);
    this.streamer?.setViewDistance(vd);
    if (vd === this.appliedDistance) return;
    this.appliedDistance = vd;
    this.renderer.setFogDistance(vd * CHUNK);
  }

  private resetStreaming(identity: TerrainIdentity, t: VoxelTerrain): void {
    const reg = this.reg as BlockRegistry;
    this.identity = identity;
    this.gen = new TerrainGenerator(identity.seed, identity.preset, reg);
    this.pool ??= new VoxelJobPool();
    this.pool.configure(identity, reg.size - 1);
    if (!this.world || this.world.reg !== reg) {
      this.streamer?.dispose();
      this.layer?.clearChunks();
      this.uploads.clear();
      this.world = new VoxelWorld(reg);
      this.streamer = new ChunkStreamer(this.world, this.pool, {
        onMesh: (key, cx, cz, mesh) => this.queueMesh(key, cx, cz, mesh),
        onUnload: (key) => {
          this.uploads.delete(key);
          this.layer?.removeChunk(key);
        },
        onEvict: (slot) => void this.saveSlots([slot]),
      }, { viewDistance: this.viewDistance(t), border: identity.border, saved: (cx, cz) => this.savedChunk(cx, cz), isSaved: (cx, cz) => this.savedKeys.has(`${cx},${cz}`) });
    } else {
      this.streamer?.reset(identity.border);
    }
    this.savedVersions.clear();
  }

  private buildItemIcons(): void {
    if (this.itemsUrl) return;
    const reg = this.reg as BlockRegistry;
    const game = new VoxelGame({ world: new VoxelWorld(reg), reg, settings: (this.terrain as VoxelTerrain).game, seed: 0, spawn: [0, 0, 0] });
    const items = game.items.list.filter((i) => i.block < 0);
    this.itemIndex = new Map(items.map((i, k) => [i.id, k] as const));
    // Placeholder until the asynchronous encode lands (also blocks a second build meanwhile).
    this.itemsUrl = 'pending';
    const gen = ++this.itemsGen;
    void pixelsToObjectUrl(paintItemIcons(items), ICON * Math.max(1, items.length), ICON).then((url) => {
      if (this.itemsUrl === 'pending' && gen === this.itemsGen && !this.disposed) this.itemsUrl = url;
      else if (url) URL.revokeObjectURL(url);
    });
  }

  /** Replace the atlas image URL, releasing the previous object URL. */
  private setAtlasUrl(url: string): void {
    if (this.atlasUrl.startsWith('blob:')) URL.revokeObjectURL(this.atlasUrl);
    this.atlasUrl = url;
  }

  private releaseItemsUrl(): void {
    this.itemsGen++;
    if (this.itemsUrl.startsWith('blob:')) URL.revokeObjectURL(this.itemsUrl);
    this.itemsUrl = '';
  }

  /** Icon of an item. */
  iconOf(item: ItemDef): ItemIcon {
    if (item.block >= 0 && this.reg) {
      const t = this.reg.faceTiles;
      return { kind: 'block', top: t[item.block * 3] as number, side: t[item.block * 3 + 2] as number, flat: this.reg.render[item.block] === 3 };
    }
    return { kind: 'item', index: this.itemIndex.get(item.id) ?? 0 };
  }

  get hudAssets(): { atlasUrl: string; itemsUrl: string; itemCount: number } {
    return { atlasUrl: this.atlasUrl, itemsUrl: this.itemsUrl === 'pending' ? '' : this.itemsUrl, itemCount: this.itemIndex.size };
  }

  /** Load which chunks the save of `saveKey` holds (the index belongs to the key, whatever syncs happen meanwhile). */
  private async loadSaveIndex(saveKey: string): Promise<void> {
    this.saveKey = saveKey;
    this.savedKeys = new Set();
    try {
      this.store ??= await voxelSaveStore();
      const keys = await this.store.listChunks(saveKey);
      if (saveKey !== this.saveKey || this.disposed) return;
      this.savedKeys = new Set(keys.filter((k) => parseChunkKey(k) !== null));
      if (this.savedKeys.size > 0) {
        // Chunks generated before the index arrived: reload the saved ones.
        const reload = new Set<number>();
        for (const k of this.savedKeys) {
          const c = parseChunkKey(k) as [number, number];
          if (this.world?.slot(c[0], c[1])) reload.add(chunkKey(c[0], c[1]));
        }
        if (reload.size > 0) this.streamer?.regenerate(reload);
      }
    } catch (err) {
      log.warn('voxel save index unavailable', err);
    }
  }

  private savedChunk(cx: number, cz: number): Promise<{ chunk: ChunkData; top: number } | null> | null {
    if (!this.savedKeys.has(`${cx},${cz}`) || !this.store || !this.reg) return null;
    const reg = this.reg;
    const store = this.store;
    const saveKey = this.saveKey;
    return (async () => {
      try {
        const bytes = await store.getChunk(saveKey, cx, cz);
        if (!bytes) return null;
        const c = await decodeChunk(bytes, reg.size - 1);
        if (c.cx !== cx || c.cz !== cz) return null;
        return { chunk: c.data, top: c.top };
      } catch (err) {
        log.warn(`saved chunk ${cx},${cz} unreadable; regenerating`, err);
        return null;
      }
    })();
  }

  /** Write modified chunks (all loaded ones, or the given slots) to the save. */
  async saveSlots(slots?: readonly ChunkSlot[]): Promise<number> {
    const world = this.world;
    const store = this.store;
    if (!world || !store || !this.saveKey) return 0;
    const list = slots ?? [...world.chunks.values()];
    const rows: Array<{ cx: number; cz: number; bytes: Uint8Array }> = [];
    for (const s of list) {
      if (!s.modified || this.savedVersions.get(s.key) === s.version) continue;
      rows.push({ cx: s.cx, cz: s.cz, bytes: await encodeChunk({ cx: s.cx, cz: s.cz, top: s.top, data: s.data }) });
      this.savedVersions.set(s.key, s.version);
      this.savedKeys.add(`${s.cx},${s.cz}`);
    }
    try {
      await store.putChunks(this.saveKey, rows);
    } catch (err) {
      for (const s of list) this.savedVersions.delete(s.key);
      this.host.error(`Could not save the world: ${errorMessage(err)}`);
    }
    return rows.length;
  }

  /** Save the player's state. */
  async savePlayer(p: SavedPlayer): Promise<void> {
    if (!this.store || !this.saveKey) return;
    try {
      const bytes = await encodeSave({ meta: { terrain: this.saveKey, savedAt: Date.now(), player: p }, chunks: [] });
      await this.store.putPlayer(this.saveKey, bytes);
    } catch (err) {
      log.warn('player save failed', err);
    }
  }

  /** The saved player (null when none / unreadable). */
  async loadPlayer(): Promise<SavedPlayer | null> {
    if (!this.store || !this.saveKey || !this.reg) return null;
    try {
      const bytes = await this.store.getPlayer(this.saveKey);
      if (!bytes) return null;
      return (await decodeSave(bytes, this.reg.size - 1)).meta.player;
    } catch (err) {
      log.warn('saved player unreadable', err);
      return null;
    }
  }

  /** Forget the save (fresh world from the seed): every chunk regenerates. */
  async resetSave(): Promise<void> {
    if (!this.store || !this.saveKey) return;
    await this.store.clear(this.saveKey);
    this.savedKeys.clear();
    this.savedVersions.clear();
    this.restream();
  }

  /** Drop all loaded chunks (the same block world object) and stream again. */
  private restream(): void {
    if (!this.world || !this.identity) return;
    for (const slot of this.world.chunks.values()) slot.modified = false;
    this.streamer?.reset(this.identity.border);
  }

  /** Export the whole save (loaded and stored chunks + player) as bytes. */
  async exportSave(player: SavedPlayer | null): Promise<Uint8Array | null> {
    const store = this.store;
    const reg = this.reg;
    if (!store || !reg || !this.saveKey) return null;
    await this.saveSlots();
    const chunks: VoxelSave['chunks'] = [];
    for (const k of this.savedKeys) {
      const c = parseChunkKey(k);
      if (!c) continue;
      const bytes = await store.getChunk(this.saveKey, c[0], c[1]);
      if (!bytes) continue;
      try {
        chunks.push(await decodeChunk(bytes, reg.size - 1));
      } catch {
        /* skip unreadable rows */
      }
    }
    return encodeSave({ meta: { terrain: this.saveKey, savedAt: Date.now(), player: player ?? (await this.loadPlayer()) }, chunks });
  }

  /** Import a save file (replaces the current save); returns its player. Throws on invalid files. */
  async importSave(bytes: Uint8Array): Promise<SavedPlayer | null> {
    const store = this.store;
    const reg = this.reg;
    if (!store || !reg || !this.saveKey) throw new Error('no voxel world is open');
    const save = await decodeSave(bytes, reg.size - 1);
    await store.clear(this.saveKey);
    const rows: Array<{ cx: number; cz: number; bytes: Uint8Array }> = [];
    for (const c of save.chunks) rows.push({ cx: c.cx, cz: c.cz, bytes: await encodeChunk(c) });
    await store.putChunks(this.saveKey, rows);
    if (save.meta.player) await this.savePlayer(save.meta.player);
    this.savedKeys = new Set(save.chunks.map((c) => `${c.cx},${c.cz}`));
    this.savedVersions.clear();
    this.restream();
    return save.meta.player;
  }

  private applyEditLighting(env: Environment): void {
    const hour = env.timeOfDay ?? PRESET_HOURS[env.sky] ?? 12;
    const space = env.sky === 'space';
    this.layer?.setLighting(space ? 0.55 : env.sky === 'studio' ? 1 : daylightAt(hour), skyTintAt(hour, [0, 0, 0]), hour);
  }

  /** Per animation frame: stream around the camera (edit) or the player (play). */
  frame(dt: number): void {
    if (!this.terrain || !this.streamer || this.indexLoading !== null) return;
    this.applyViewDistance();
    if (this.play) this.play.frame(dt);
    else {
      this.renderer.orbitTarget(this.center);
      this.streamer.setCenter(this.center[0], this.center[2]);
      this.layer?.setFogOrigin(this.center[0], this.center[2]);
    }
    this.streamer.update();
    this.flushUploads();
  }

  /** Ground height (feet y) near (x, z) from the generator (frames the camera before chunks exist). */
  groundAt(x: number, z: number): number {
    return this.gen ? this.gen.groundLevel(Math.floor(x), Math.floor(z)) : 64;
  }

  /**
   * A sphere around the document's block edits (structures, pixel art,
   * shapes) from index `from` on, for camera framing; null when there are
   * none. Bounds come from the edit compiler (surface anchors resolved);
   * at most the last {@link FOCUS_EDITS} edits are considered.
   */
  editFocus(from = 0): { center: [number, number, number]; radius: number } | null {
    const t = this.terrain;
    const reg = this.reg;
    const gen = this.gen;
    if (!t || !reg || !gen || !this.identity) return null;
    const start = Math.max(0, Math.min(t.edits.length, from), t.edits.length - FOCUS_EDITS);
    const edits = t.edits.slice(start).filter((e) => e.shape !== 'clear');
    if (edits.length === 0) return null;
    let x0 = Infinity;
    let y0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let z1 = -Infinity;
    for (const e of compileEdits(edits, reg, gen, this.identity.seed)) {
      x0 = Math.min(x0, e.minX);
      y0 = Math.min(y0, e.content?.minY ?? e.minY);
      z0 = Math.min(z0, e.minZ);
      x1 = Math.max(x1, e.maxX + 1);
      y1 = Math.max(y1, (e.content?.maxY ?? e.maxY) + 1);
      z1 = Math.max(z1, e.maxZ + 1);
    }
    if (!Number.isFinite(x0) || !Number.isFinite(x1)) return null;
    const radius = 0.5 * Math.hypot(x1 - x0, y1 - y0, z1 - z0);
    return { center: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], radius };
  }

  /**
   * Camera offset direction for framing a subject of `radius` blocks around
   * `center` from about `distance` blocks: `preferred` turned to the side
   * where the terrain does not hide it (see `framing.ts`).
   */
  viewOffset(center: [number, number, number], radius: number, distance: number, preferred: [number, number, number]): [number, number, number] {
    const gen = this.gen;
    if (!gen) return preferred;
    return clearViewOffset((x, z) => gen.groundLevel(x, z), center, radius, distance, preferred);
  }

  /** Begin the game (play mode). */
  async startPlay(doc: WorldDoc, canvas: HTMLElement): Promise<VoxelPlay | null> {
    if (!this.terrain || !this.world || !this.reg || !this.streamer || !this.layer) return null;
    const saved = await this.loadPlayer();
    const play = new VoxelPlay(this, this.renderer, this.layer, this.world, this.reg, this.streamer, doc, this.terrain, canvas, saved, this.host);
    this.play = play;
    return play;
  }

  /** End the game (saves first). */
  async stopPlay(): Promise<void> {
    const p = this.play;
    if (!p) return;
    this.play = null;
    p.dispose();
    await this.saveSlots();
    await this.savePlayer(p.snapshot());
    this.renderer.restoreEnvironment();
    if (this.doc) this.applyEditLighting(this.doc.environment);
    this.layer?.clearActors();
    this.renderer.setAvatarVisible(false);
    this.host.onHud(null);
  }

  private teardown(): void {
    this.epoch++;
    this.indexLoading = null;
    this.play?.dispose();
    this.play = null;
    this.streamer?.dispose();
    this.streamer = null;
    this.uploads.clear();
    this.pool?.dispose();
    this.pool = null;
    this.world = null;
    this.reg = null;
    this.registryKey = '';
    this.gen = null;
    this.identity = null;
    this.terrain = null;
    this.layer = null;
    this.appliedDistance = 0;
    this.saveKey = '';
    this.releaseItemsUrl();
    this.setAtlasUrl('');
    this.atlas = null;
    this.renderer.releaseVoxel();
  }

  dispose(): void {
    if (this.disposed) return;
    const p = this.play;
    if (p) {
      void this.saveSlots();
      void this.savePlayer(p.snapshot());
    }
    this.teardown();
    this.disposed = true;
  }
}

/** One play session of the voxel game. */
export class VoxelPlay {
  readonly game: VoxelGame;
  readonly input = new VoxelInput();
  private readonly gameInput: GameInput = createInput();
  private ready = false;
  private view: 'first' | 'third' = 'first';
  private readonly spawnXZ: [number, number];
  private hudTimer = 0;
  private lastHud: VoxelHudState | null = null;
  private saveTimer = 0;
  private dirty = false;
  private skyHour = -100;
  private skyPreset = '';
  private frameNo = 0;
  private toast = '';
  private toastUntil = 0;
  private deathCause = '';
  private readonly eye: [number, number, number] = [0, 0, 0];
  private readonly mobStamp = new Map<number, number>();
  private readonly dropStamp = new Map<number, number>();
  private readonly hit = createHit();
  private readonly tint: [number, number, number] = [1, 1, 1];
  private inventoryOpen = false;
  private saved: SavedPlayer | null;

  constructor(
    private readonly session: VoxelSession,
    private readonly renderer: WorldRenderer,
    private readonly layer: VoxelLayer,
    private readonly world: VoxelWorld,
    private readonly reg: BlockRegistry,
    private readonly streamer: ChunkStreamer,
    private readonly doc: WorldDoc,
    terrain: VoxelTerrain,
    canvas: HTMLElement,
    saved: SavedPlayer | null,
    private readonly host: VoxelSessionHost,
  ) {
    const spawn = doc.player.spawn;
    this.spawnXZ = saved ? [saved.position[0], saved.position[2]] : [spawn[0], spawn[2]];
    this.saved = saved;
    this.game = new VoxelGame({ world, reg, settings: terrain.game, seed: doc.seed, spawn: [spawn[0], session.groundAt(spawn[0], spawn[2]), spawn[2]] });
    this.input.attach(canvas);
    // Start looking the way the document says (a village game faces its square), else the way the editor camera looked.
    const e = renderer.camera.matrixWorld.elements;
    const authored = doc.player.yaw;
    this.input.setLook(authored !== undefined && Number.isFinite(authored) ? (authored * Math.PI) / 180 : Math.atan2(e[8] as number, e[10] as number), 0);
    world.unloaded = 'solid';
  }

  /** Fixed 60 Hz step. */
  step(dt: number): void {
    if (!this.ready) {
      this.tryStart();
      return;
    }
    this.handleCommands();
    this.input.uiOpen = this.inventoryOpen || this.game.player.dead;
    this.game.tick(dt, this.input.sample(this.gameInput));
    this.game.drainEvents(this.onEvent);
    this.saveTimer += dt;
    if (this.saveTimer >= AUTOSAVE_S) {
      this.saveTimer = 0;
      if (this.dirty) {
        this.dirty = false;
        void this.session.saveSlots();
        void this.session.savePlayer(this.game.snapshotPlayer());
      }
    }
  }

  /** Waiting for the terrain around the spawn. */
  get loading(): boolean {
    return !this.ready;
  }

  private tryStart(): void {
    const [x, z] = this.spawnXZ;
    const cx = Math.floor(x / CHUNK);
    const cz = Math.floor(z / CHUNK);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!this.world.slot(cx + dx, cz + dz)) return;
    const b = this.game.player.body;
    if (this.saved) this.game.loadPlayer(this.saved);
    else {
      // Solid open ground near the spawn: never a tree top, a plant or the sea.
      const spot = this.world.findSpawn(x, z, CHUNK);
      b.x = spot ? spot[0] : Math.floor(x) + 0.5;
      b.z = spot ? spot[2] : Math.floor(z) + 0.5;
      b.y = (spot ? spot[1] : this.world.surfaceY(Math.floor(x), Math.floor(z))) + 0.01;
      this.game.player.spawn = [b.x, b.y, b.z];
      this.game.player.fallFrom = b.y;
    }
    // A fresh start never opens on a wall, a roof edge or a trunk in the face: turn towards the open view when the
    // authored or editor heading is blocked within ten blocks.
    const yaw = this.saved ? this.saved.yaw : openestYaw((qx, qy, qz) => this.world.get(qx, qy, qz), (id) => id !== 0 && this.reg.opaque[id] === 1, b.x, b.y, b.z, this.input.yawRad);
    this.input.setLook(yaw, this.saved ? this.saved.pitch : -0.15);
    this.ready = true;
  }

  private readonly onEvent = (e: GameEvent): void => {
    switch (e.type) {
      case 'sound':
        this.host.sound(e.name);
        break;
      case 'block':
        this.dirty = true;
        break;
      case 'pickup': {
        const def = this.game.items.get(e.item);
        this.toast = `+${e.count} ${def?.label ?? e.item}`;
        this.toastUntil = performance.now() + 1800;
        break;
      }
      case 'death':
        this.deathCause = e.cause;
        this.dirty = true;
        this.input.unlock();
        break;
      default:
        break;
    }
  };

  private handleCommands(): void {
    const c = this.input.commands;
    const inv = this.game.inventory;
    if (c.inventory) this.setInventoryOpen(!this.inventoryOpen);
    if (c.slot >= 0) inv.select(c.slot);
    if (c.scroll !== 0) inv.select(inv.selected + c.scroll);
    if (c.view) this.view = this.view === 'first' ? 'third' : 'first';
    if (c.drop && !this.game.player.dead) {
      const held = inv.held;
      if (held) {
        const item = held.item;
        if (inv.takeOne(inv.selected)) {
          const b = this.game.player.body;
          const yaw = this.game.player.yaw;
          this.game.spawnDrop(item, 1, b.x - Math.sin(yaw) * 0.8, b.y + 1.3, b.z - Math.cos(yaw) * 0.8, true);
        }
      }
    }
    this.input.clearCommands();
  }

  /** Open or close the inventory / crafting screen (releases the mouse). */
  setInventoryOpen(open: boolean): void {
    if (open === this.inventoryOpen) return;
    this.inventoryOpen = open;
    this.input.uiOpen = open;
    if (open) this.input.unlock();
    this.hudTimer = HUD_MS;
  }

  /** Per animation frame: camera, actors, sky, HUD. */
  frame(dt: number): void {
    this.frameNo++;
    // Ready as soon as the terrain around the spawn exists, also while the game is held back by a start card
    // (the fixed step that normally does this does not run then, and the loading card would stay up at 100 %).
    if (!this.ready) this.tryStart();
    const g = this.game;
    const b = g.player.body;
    const fx = this.ready ? b.x : this.spawnXZ[0];
    const fz = this.ready ? b.z : this.spawnXZ[1];
    this.streamer.setCenter(fx, fz);
    this.layer.setFogOrigin(fx, fz);
    if (this.ready) {
      g.eye(this.eye);
      // The live look, not the last fixed-step sample: while a start card holds the game no step runs, and the first
      // frames would show the sample's initial heading (north) instead of the one chosen at the spawn.
      const yaw = this.input.yawRad;
      const pitch = this.input.pitchRad;
      if (this.view === 'first') {
        this.renderer.setAvatarVisible(false);
        this.renderer.setCameraPose(this.eye[0], this.eye[1], this.eye[2], yaw, pitch);
      } else {
        // Behind the player, pulled in front of walls.
        const cp = Math.cos(pitch);
        const dx = Math.sin(yaw) * cp;
        const dy = -Math.sin(pitch);
        const dz = Math.cos(yaw) * cp;
        let dist = 4.5;
        if (raycastVoxels((x, y, z) => this.world.get(x, y, z), this.eye[0], this.eye[1], this.eye[2], dx, dy, dz, dist, (id) => id !== 0 && this.reg.opaque[id] === 1, this.hit)) dist = Math.max(0.6, this.hit.distance - 0.25);
        this.renderer.setPlayerAvatar([b.x, b.y, b.z], (yaw * 180) / Math.PI);
        this.renderer.setAvatarVisible(true);
        this.renderer.setCameraPose(this.eye[0] + dx * dist, this.eye[1] + dy * dist, this.eye[2] + dz * dist, yaw, pitch);
      }
      const t = g.target;
      this.layer.setTarget(t.hit.x, t.hit.y, t.hit.z, t.valid && !g.player.dead);
      this.layer.setCrack(t.valid ? t.progress : 0);
      this.drawActors();
      this.updateSky();
    } else {
      const top = this.session.groundAt(this.spawnXZ[0], this.spawnXZ[1]);
      this.renderer.setCameraPose(this.spawnXZ[0], top + EYE_HEIGHT + 2, this.spawnXZ[1], this.input.yawRad, -0.2);
    }
    this.hudTimer += dt * 1000;
    if (this.hudTimer >= HUD_MS) {
      this.hudTimer = 0;
      this.pushHud();
    }
  }

  private drawActors(): void {
    const g = this.game;
    const n = this.frameNo;
    for (let i = 0; i < g.mobs.length; i++) {
      const m = g.mobs[i] as (typeof g.mobs)[number];
      this.layer.setMob(m.id, m.spec.kind, m.body.x, m.body.y, m.body.z, m.yaw, m.phase, m.walk, m.hurt > 0);
      this.mobStamp.set(m.id, n);
    }
    // Prune only when something disappeared (no iteration in the common case).
    if (this.layer.mobCount > g.mobs.length) {
      for (const id of this.layer.mobIds()) {
        if (this.mobStamp.get(id) !== n) {
          this.layer.removeMob(id);
          this.mobStamp.delete(id);
        }
      }
    }
    const time = g.time;
    for (let i = 0; i < g.drops.length; i++) {
      const d = g.drops[i] as (typeof g.drops)[number];
      const def = g.items.get(d.item);
      const bob = Math.sin(time * 2.4 + d.id) * 0.06 + 0.16;
      this.layer.setDrop(d.id, def && def.block >= 0 ? def.block : -1, def?.color ?? '#cccccc', d.body.x, d.body.y + bob, d.body.z, time * 1.6 + d.id);
      this.dropStamp.set(d.id, n);
    }
    if (this.layer.dropCount > g.drops.length) {
      for (const id of this.layer.dropIds()) {
        if (this.dropStamp.get(id) !== n) {
          this.layer.removeDrop(id);
          this.dropStamp.delete(id);
        }
      }
    }
  }

  private updateSky(): void {
    const clock = this.game.clock;
    const hour = clock.hour;
    const preset = skyForHour(hour);
    const d = Math.abs(hour - this.skyHour);
    if (preset !== this.skyPreset || Math.min(d, 24 - d) >= SKY_STEP_HOURS) {
      this.skyHour = hour;
      this.skyPreset = preset;
      const env = this.doc.environment;
      this.renderer.setEnvironmentOverride({ ...env, sky: preset, timeOfDay: hour, ground: null });
    }
    this.layer.setLighting(clock.daylight, skyTintAt(hour, this.tint), hour);
  }

  private pushHud(): void {
    const g = this.game;
    const p = g.player;
    const reg = this.reg;
    const assets = this.session.hudAssets;
    const slots: Array<HudSlot | null> = g.inventory.slots.map((s) => {
      if (!s) return null;
      const def = g.items.get(s.item);
      if (!def) return null;
      return { item: s.item, label: def.label, count: s.count, icon: this.session.iconOf(def) };
    });
    let recipes: HudRecipe[] = [];
    let nearTable = false;
    if (this.inventoryOpen) {
      nearTable = g.creative || g.nearCraftingTable();
      recipes = g.recipes.recipes.map((r) => {
        const out = g.items.get(r.output.item) as ItemDef;
        return {
          id: r.id,
          label: out.label,
          count: r.output.count,
          icon: this.session.iconOf(out),
          craftable: g.recipes.canCraft(r, g.inventory, nearTable),
          needsTable: r.table,
          inputs: r.inputs.map((i) => {
            const d = g.items.get(i.item) as ItemDef;
            return { label: d.label, count: i.count, have: g.inventory.count(i.item), icon: this.session.iconOf(d) };
          }),
        };
      });
      // Craftable first, then the rest; stable otherwise.
      recipes.sort((a, b) => Number(b.craftable) - Number(a.craftable));
    }
    const t = g.target;
    const now = performance.now();
    if (now > this.toastUntil) this.toast = '';
    const state: VoxelHudState = {
      mode: g.settings.mode,
      loading: this.ready ? null : this.loadProgress(),
      health: p.health,
      hunger: p.hunger,
      air: Math.ceil(p.air),
      dead: p.dead,
      deathCause: this.deathCause,
      slots,
      selected: g.inventory.selected,
      inventoryOpen: this.inventoryOpen,
      recipes,
      nearTable,
      hour: Math.round(g.clock.hour * 4) / 4,
      day: g.clock.day,
      capture: this.input.needsCapture,
      touch: this.input.touch,
      view: this.view,
      flying: p.flying,
      target: t.valid ? reg.type(t.hit.block).label : '',
      position: [Math.floor(p.body.x), Math.floor(p.body.y), Math.floor(p.body.z)],
      atlasUrl: assets.atlasUrl,
      itemsUrl: assets.itemsUrl,
      itemCount: assets.itemCount,
      toast: this.toast,
    };
    if (hudEqual(state, this.lastHud)) return;
    this.lastHud = state;
    this.host.onHud(state);
  }

  private loadProgress(): number {
    const [x, z] = this.spawnXZ;
    const cx = Math.floor(x / CHUNK);
    const cz = Math.floor(z / CHUNK);
    let n = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (this.world.slot(cx + dx, cz + dz)) n++;
    return n / 9;
  }

  /** HUD actions. */
  select(slot: number): void {
    this.game.inventory.select(slot);
    this.hudTimer = HUD_MS;
  }

  craft(id: string): boolean {
    const ok = this.game.craft(id);
    this.game.drainEvents(this.onEvent);
    this.hudTimer = HUD_MS;
    return ok;
  }

  moveSlot(from: number, to: number, half: boolean): void {
    this.game.inventory.move(from, to, half);
    this.hudTimer = HUD_MS;
  }

  respawn(): void {
    this.game.respawn();
    this.game.drainEvents(this.onEvent);
    this.deathCause = '';
    this.hudTimer = HUD_MS;
  }

  /** The whole save as a file (bytes). */
  exportSave(): Promise<Uint8Array | null> {
    return this.session.exportSave(this.game.snapshotPlayer());
  }

  /** Replace the world with a save file. */
  async importSave(bytes: Uint8Array): Promise<void> {
    const player = await this.session.importSave(bytes);
    this.ready = false;
    if (player) {
      this.saved = player;
      this.spawnXZ[0] = player.position[0];
      this.spawnXZ[1] = player.position[2];
    }
  }

  /** Start over: forget the save and respawn on fresh terrain. */
  async resetWorld(): Promise<void> {
    await this.session.resetSave();
    this.saved = null;
    this.game.inventory.clear();
    for (const st of this.game.settings.startItems) this.game.inventory.add(st.item, st.count);
    this.spawnXZ[0] = this.doc.player.spawn[0];
    this.spawnXZ[1] = this.doc.player.spawn[2];
    this.game.respawn();
    this.ready = false;
  }

  /** Capture the mouse (from a user gesture). */
  lockPointer(): void {
    this.input.lock();
  }

  /** Player state for saving. */
  snapshot(): SavedPlayer {
    return this.game.snapshotPlayer();
  }

  dispose(): void {
    this.input.detach();
  }
}
