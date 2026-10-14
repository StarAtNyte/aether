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
import { PRESET_HOURS, type VoxelLayer, type WorldRenderer } from '@aether/render';
import type { Environment, VoxelEdit, VoxelTerrain, WorldDoc } from '@aether/core';
import { deepEqual } from '@aether/core';
import {
  BlockRegistry, buildAtlas, ChunkStreamer, compileEdits, createHit, decodeChunk, decodeSave, encodeChunk, encodeSave, identityKey, raycastVoxels, saveIdentity,
  SavedPlayer, TerrainGenerator, terrainIdentity, VoxelJobPool, VoxelWorld, CHUNK, chunkKey, type BlockAtlas, type ChunkData, type ChunkSlot, type TerrainIdentity, type VoxelSave,
} from '@aether/voxel';
import { createInput, daylightAt, EYE_HEIGHT, skyForHour, skyTintAt, VoxelGame, type GameEvent, type GameInput, type ItemDef } from '@aether/voxel/game';
import { createLogger, errorMessage } from '../lib/log';
import { hudEqual, type HudRecipe, type HudSlot, type ItemIcon, type VoxelHudState } from './hudState';
import { VoxelInput } from './input';
import { paintItemIcons, pixelsToDataUrl, ICON } from './itemIcons';
import { parseChunkKey, voxelSaveStore, type VoxelSaveStore } from './saveStore';

const log = createLogger('voxel');

/** Seconds between autosaves while playing (only when something changed). */
const AUTOSAVE_S = 8;
/** HUD refresh interval (ms). */
const HUD_MS = 100;
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

  /** Streaming status (tests, e2e, stats overlay). */
  status(): { chunks: number; meshed: number; pending: number; settled: boolean; inline: boolean; changed: number } {
    return {
      chunks: this.world?.chunks.size ?? 0,
      meshed: this.streamer?.meshedCount ?? 0,
      pending: this.pool?.pending ?? 0,
      settled: this.streamer?.settled ?? true,
      inline: this.pool?.inlineMode ?? false,
      changed: [...(this.world?.chunks.values() ?? [])].filter((s) => s.modified).length,
    };
  }

  /**
   * Diagnostics: change one block and resolve with the milliseconds until
   * its chunk's new mesh is on screen (−1 when the chunk is not loaded or it
   * took over 5 s). Used by the end-to-end performance checks.
   */
  async measureEdit(x: number, y: number, z: number, block: string): Promise<number> {
    const world = this.world;
    const streamer = this.streamer;
    const id = this.reg?.id(block);
    if (!world || !streamer || id === undefined) return -1;
    const slot = world.slot(Math.floor(x / CHUNK), Math.floor(z / CHUNK));
    if (!slot) return -1;
    const t0 = performance.now();
    if (world.set(x, y, z, id) < 0) return -1;
    const want = slot.version;
    return new Promise((resolve) => {
      const check = (): void => {
        if (streamer.shownVersion(slot.key) >= want) resolve(performance.now() - t0);
        else if (performance.now() - t0 > 5000) resolve(-1);
        else requestAnimationFrame(check);
      };
      check();
    });
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
      this.streamer?.setViewDistance(t.viewDistance);
      this.renderer.setFogDistance(t.viewDistance * CHUNK);
      return;
    }
    const epoch = ++this.epoch;
    const layer = await this.renderer.voxel();
    if (this.disposed || epoch !== this.epoch) return;
    this.layer = layer;
    const regKey = JSON.stringify(t.blocks);
    if (!this.reg || regKey !== this.registryKey) {
      this.reg = new BlockRegistry(t.blocks);
      this.registryKey = regKey;
      this.atlas = buildAtlas(this.reg);
      layer.setAtlas(this.atlas.pixels, this.atlas.size, this.reg.faceTiles);
      this.atlasUrl = pixelsToDataUrl(this.atlas.pixels, this.atlas.size, this.atlas.size);
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
    this.streamer?.setViewDistance(t.viewDistance);
    this.renderer.setFogDistance(t.viewDistance * CHUNK);
    this.applyEditLighting(doc.environment);
    const saveKey = `${this.host.saveBase}::${saveIdentity(identity)}`;
    if (saveKey !== this.saveKey) await this.loadSaveIndex(saveKey, epoch);
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
      this.world = new VoxelWorld(reg);
      this.streamer = new ChunkStreamer(this.world, this.pool, {
        onMesh: (key, cx, cz, mesh) => this.layer?.setChunk(key, cx, cz, mesh),
        onUnload: (key) => this.layer?.removeChunk(key),
        onEvict: (slot) => void this.saveSlots([slot]),
      }, { viewDistance: t.viewDistance, border: identity.border, saved: (cx, cz) => this.savedChunk(cx, cz) });
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
    this.itemsUrl = pixelsToDataUrl(paintItemIcons(items), ICON * Math.max(1, items.length), ICON);
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
    return { atlasUrl: this.atlasUrl, itemsUrl: this.itemsUrl, itemCount: this.itemIndex.size };
  }

  private async loadSaveIndex(saveKey: string, epoch: number): Promise<void> {
    this.saveKey = saveKey;
    this.savedKeys = new Set();
    try {
      this.store ??= await voxelSaveStore();
      const keys = await this.store.listChunks(saveKey);
      if (epoch !== this.epoch || this.disposed) return;
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
    this.layer?.setLighting(space ? 0.55 : env.sky === 'studio' ? 1 : daylightAt(hour), skyTintAt(hour, [0, 0, 0]));
  }

  /** Per animation frame: stream around the camera (edit) or the player (play). */
  frame(dt: number): void {
    if (!this.terrain || !this.streamer) return;
    if (this.play) this.play.frame(dt);
    else {
      this.renderer.orbitTarget(this.center);
      this.streamer.setCenter(this.center[0], this.center[2]);
    }
    this.streamer.update();
  }

  /** Ground height (feet y) near (x, z) from the generator (frames the camera before chunks exist). */
  groundAt(x: number, z: number): number {
    return this.gen ? this.gen.groundLevel(Math.floor(x), Math.floor(z)) : 64;
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
    this.play?.dispose();
    this.play = null;
    this.streamer?.dispose();
    this.streamer = null;
    this.pool?.dispose();
    this.pool = null;
    this.world = null;
    this.reg = null;
    this.registryKey = '';
    this.gen = null;
    this.identity = null;
    this.terrain = null;
    this.layer = null;
    this.saveKey = '';
    this.itemsUrl = '';
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
    // Start looking the way the editor camera looked.
    const e = renderer.camera.matrixWorld.elements;
    this.input.setLook(Math.atan2(e[8] as number, e[10] as number), 0);
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

  private tryStart(): void {
    const [x, z] = this.spawnXZ;
    const cx = Math.floor(x / CHUNK);
    const cz = Math.floor(z / CHUNK);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!this.world.slot(cx + dx, cz + dz)) return;
    const b = this.game.player.body;
    if (this.saved) this.game.loadPlayer(this.saved);
    else {
      const top = this.world.surfaceY(Math.floor(x), Math.floor(z));
      b.x = Math.floor(x) + 0.5;
      b.z = Math.floor(z) + 0.5;
      b.y = top + 0.01;
      this.game.player.spawn = [b.x, b.y, b.z];
      this.game.player.fallFrom = b.y;
    }
    this.input.setLook(this.saved ? this.saved.yaw : this.input.yawRad, this.saved ? this.saved.pitch : -0.15);
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
    const g = this.game;
    const b = g.player.body;
    this.streamer.setCenter(this.ready ? b.x : this.spawnXZ[0], this.ready ? b.z : this.spawnXZ[1]);
    if (this.ready) {
      g.eye(this.eye);
      const yaw = this.gameInput.yaw;
      const pitch = this.gameInput.pitch;
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
    this.layer.setLighting(clock.daylight, skyTintAt(hour, this.tint));
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
      locked: this.input.locked,
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
