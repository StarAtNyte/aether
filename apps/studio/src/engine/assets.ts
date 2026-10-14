/**
 * Asset controller: the curated library (lazy catalog), favourites, user
 * imports (validated, stored in IndexedDB, registered as `blob:` URLs for
 * the renderer and physics), placement of assets by click or drag-and-drop
 * (raycast onto surfaces, snapped to floors / walls / ceilings), credits,
 * and world packages (`.zip` with the world, every asset file it uses and
 * a CREDITS.txt). Owns its own small store so the library UI never
 * re-renders the editor.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { EntityInput, History, Patch, Vec3, WorldDoc } from '@aether/core';
import { uniqueId } from '@aether/core';
import {
  assetInfo,
  catalogEntry,
  creditsFor,
  creditsText,
  importUserAsset,
  isUserAssetId,
  loadCatalog,
  libraryUrl,
  registerUserAsset,
  unregisterUserAsset,
  worldAssetIds,
  type Catalog,
  type Credit,
  type UserAssetMeta,
} from '@aether/assets';
import type { StudioState } from '../state/store';
import type { Simulation } from './Simulation';
import { placeAsset, type Placement } from '../assets/placement';
import { readFavorites, toggleFavorite } from '../assets/favorites';
import { openUserAssetStore, type UserAssetStore } from '../assets/userStore';
import { readZip, writeZip, type ZipEntry } from '../assets/zip';
import { browserStorage, type StorageLike } from '../lib/storage';
import { exportFileName, exportWorld, validateImportedValue } from '../lib/worldIO';
import { createLogger } from '../lib/log';

const log = createLogger('assets');

/** What the controller needs from the studio. */
export interface AssetHost {
  readonly store: StoreApi<StudioState>;
  readonly history: History;
  readonly simulation: Simulation | null;
  onSimulation(fn: (sim: Simulation | null) => void): () => void;
  commitUser(patches: Patch[] | unknown[], message: string): string | null;
  replaceWorld(world: WorldDoc, message: string): void;
}

/** Library UI state. */
export interface LibraryState {
  catalog: Catalog | null;
  /** Imports stored in this browser (newest first). */
  imports: UserAssetMeta[];
  /** Imports survive reloads (false: IndexedDB unavailable, session only). */
  persistent: boolean;
  favorites: string[];
  /** Credits dialog open. */
  creditsOpen: boolean;
  /** A long operation in progress ("Importing chair.glb…"), or null. */
  busy: string | null;
}

/** Package format marker (`package.json` inside exported zips). */
export const PACKAGE_FORMAT = 'aether-package';
const MAX_IMPORT_FILES = 16;
/** Largest package accepted for import. */
export const MAX_PACKAGE_BYTES = 200 * 1024 * 1024;

/** Extension used for a stored user asset inside packages. */
function extFor(meta: UserAssetMeta): string {
  switch (meta.mime) {
    case 'model/gltf-binary':
      return 'glb';
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    default:
      return 'hdr';
  }
}

/** The asset controller (one per studio). */
export class AssetController {
  readonly state: StoreApi<LibraryState>;
  private store: Promise<UserAssetStore> | null = null;
  private readonly urls = new Map<string, string>();
  private readonly cleanups: Array<() => void> = [];
  private readonly storage: StorageLike | null;
  private disposed = false;

  constructor(private readonly host: AssetHost, opts: { storage?: StorageLike | null } = {}) {
    this.storage = opts.storage === undefined ? browserStorage() : opts.storage;
    this.state = createStore<LibraryState>()(() => ({ catalog: null, imports: [], persistent: true, favorites: readFavorites(this.storage), creditsOpen: false, busy: null }));
    // User imports referenced by the world are registered as soon as a world loads or changes.
    this.cleanups.push(host.history.subscribe((world) => void this.syncWorld(world)));
    void this.syncWorld(host.history.current);
  }

  /** Load the catalog (idempotent). Called when the library is first shown or the editor is idle. */
  async ready(): Promise<Catalog> {
    const c = await loadCatalog();
    if (this.state.getState().catalog !== c) {
      this.state.setState({ catalog: c });
      // Entities placed before the catalog arrived (shared worlds, agent turns) re-mount with real models.
      this.host.simulation?.renderer.refreshAssets();
    }
    return c;
  }

  private userStore(): Promise<UserAssetStore> {
    this.store ??= openUserAssetStore().then((s) => {
      this.state.setState({ persistent: s.persistent });
      return s;
    });
    return this.store;
  }

  /** Refresh the list of imports. */
  async refreshImports(): Promise<void> {
    try {
      const list = await (await this.userStore()).list();
      if (!this.disposed) this.state.setState({ imports: list });
    } catch (err) {
      log.warn('listing imports failed', err);
    }
  }

  /** Register (blob URL) every user asset the world uses that is not registered yet. */
  private async syncWorld(world: WorldDoc): Promise<void> {
    const wanted = worldAssetIds(world).filter((id) => isUserAssetId(id) && !this.urls.has(id));
    if (wanted.length === 0) return;
    const store = await this.userStore();
    const added = new Set<string>();
    for (const id of wanted) {
      if (this.urls.has(id)) continue;
      const rec = await store.get(id).catch(() => null);
      if (!rec || this.disposed) continue;
      this.register(rec.meta, rec.blob);
      added.add(id);
    }
    if (added.size > 0) this.host.simulation?.renderer.refreshAssets(added);
  }

  private register(meta: UserAssetMeta, blob: Blob): string {
    const old = this.urls.get(meta.id);
    if (old) return old;
    const url = URL.createObjectURL(blob);
    this.urls.set(meta.id, url);
    registerUserAsset({ meta, url });
    return url;
  }

  /** Toggle a favourite. */
  toggleFavorite(id: string): void {
    this.state.setState({ favorites: toggleFavorite(this.storage, this.state.getState().favorites, id) });
  }

  /** Open / close the credits dialog. */
  setCreditsOpen(open: boolean): void {
    this.state.setState({ creditsOpen: open });
  }

  /** Credits of the current world. */
  credits(): Credit[] {
    return creditsFor(this.host.history.current, this.state.getState().catalog);
  }

  /**
   * Where an asset would land for a cursor position (normalized device
   * coordinates), or at the camera's focus when no cursor is given.
   */
  placement(id: string, ndc: { x: number; y: number } | null): Placement | null {
    const info = assetInfo(id);
    const sim = this.host.simulation;
    if (!info || !sim) return null;
    const asset = { size: info.size, placement: info.entry?.placement ?? (info.kind === 'image' ? 'wall' : 'floor'), facing: info.entry?.facing ?? '+z' } as const;
    const cam = sim.renderer.camera.position;
    const camera: Vec3 = [cam.x, cam.y, cam.z];
    if (!ndc) {
      const p = sim.placementPoint();
      return placeAsset({ hit: { point: p, normal: [0, 1, 0] }, ray: { origin: camera, direction: [0, -1, 0] }, camera, asset });
    }
    const hit = sim.renderer.raycastEntity(ndc.x, ndc.y);
    const ray = sim.renderer.cursorRay(ndc.x, ndc.y);
    const floorAt = (x: number, z: number): number => {
      const down = sim.renderer.raycastWorld([x, (hit?.point[1] ?? 0) + 0.5, z], [0, -1, 0], 50);
      return down && down.normal[1] > 0.6 ? down.point[1] : 0;
    };
    return placeAsset({ hit: hit ? { point: hit.point, normal: hit.normal } : null, ray, camera, asset, floorAt });
  }

  /**
   * Place an asset (click: at the view's focus; drop: under the cursor) as
   * one undoable edit and select it. Skies set the environment instead.
   * Returns the new entity id (null for skies or on failure).
   */
  async place(id: string, ndc: { x: number; y: number } | null = null): Promise<string | null> {
    const st = this.host.store.getState();
    if (st.mode === 'play') {
      st.toast('Stop the simulation before adding objects.', 'info');
      return null;
    }
    await this.ready();
    const info = assetInfo(id);
    if (!info) {
      st.toast('That asset is not available.', 'error');
      return null;
    }
    const name = info.entry?.name ?? info.user?.name ?? id;
    if (info.kind === 'hdri') {
      this.host.commitUser([{ op: 'setEnvironment', set: { hdri: id } }], `Sky: ${name}`);
      st.toast(`Sky set to ${name}`, 'success', 2.5);
      return null;
    }
    const at = this.placement(id, ndc);
    if (!at) return null;
    const world = this.host.history.current;
    const entityId = uniqueId(world, id.replace(/^user-/, 'import-').slice(0, 48));
    const entity: EntityInput = {
      id: entityId,
      name,
      transform: { position: at.position, rotation: [0, at.yaw, 0] },
      shape: { kind: 'asset', id },
      physics: { body: 'static' },
      tags: info.entry ? [info.entry.category] : ['imported'],
    };
    // Characters and animals stay free of static colliders so they can be given behaviors.
    if (info.entry?.category === 'characters' || info.entry?.category === 'animals') delete entity.physics;
    if (this.host.commitUser([{ op: 'add', entity }], `Add ${name.toLowerCase()}`) !== null) return null;
    this.host.store.getState().select([entityId]);
    void this.host.simulation?.revealEntities([entityId]);
    return entityId;
  }

  /**
   * Import dropped / picked files (models, images, HDRIs, or an exported
   * world package). Each file is validated; accepted ones are stored and,
   * when `ndc` is given, the first is placed where it was dropped.
   */
  async importFiles(files: readonly File[], ndc: { x: number; y: number } | null = null): Promise<string[]> {
    const st = this.host.store.getState();
    const list = files.slice(0, MAX_IMPORT_FILES);
    if (files.length > MAX_IMPORT_FILES) st.toast(`Only the first ${MAX_IMPORT_FILES} files are imported.`, 'info', 4);
    const placed: string[] = [];
    for (const file of list) {
      if (/\.zip$/i.test(file.name)) {
        const err = await this.importPackage(file);
        if (err) st.toast(err, 'error', 6);
        continue;
      }
      this.state.setState({ busy: `Importing ${file.name.slice(0, 40)}…` });
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const r = await importUserAsset(bytes, file.name);
        if (!r.ok) {
          st.toast(`${file.name.slice(0, 40)}: ${r.error}`, 'error', 6);
          continue;
        }
        const store = await this.userStore();
        await store.put(r.asset.meta, r.asset.data);
        this.register(r.asset.meta, new Blob([r.asset.data as Uint8Array<ArrayBuffer>], { type: r.asset.meta.mime }));
        st.toast(`Imported ${r.asset.meta.name}${store.persistent ? '' : ' (kept for this session only)'}`, 'success', 3);
        if (r.asset.meta.kind === 'hdri') {
          this.host.commitUser([{ op: 'setEnvironment', set: { hdri: r.asset.meta.id } }], `Sky: ${r.asset.meta.name}`);
        } else if (placed.length === 0 || ndc === null) {
          const id = await this.place(r.asset.meta.id, ndc);
          if (id) placed.push(id);
        }
      } catch (err) {
        st.toast(`${file.name.slice(0, 40)}: ${err instanceof Error ? err.message.slice(0, 160) : 'import failed'}`, 'error', 6);
      } finally {
        this.state.setState({ busy: null });
      }
    }
    await this.refreshImports();
    return placed;
  }

  /** Delete an import from this browser (worlds using it show stand-ins). */
  async removeImport(id: string): Promise<void> {
    if (!isUserAssetId(id)) return;
    await (await this.userStore()).remove(id);
    const url = this.urls.get(id);
    if (url) URL.revokeObjectURL(url);
    this.urls.delete(id);
    unregisterUserAsset(id);
    this.host.simulation?.renderer.refreshAssets(new Set([id]));
    await this.refreshImports();
  }

  /** Bytes of every file a package needs: library files fetched, imports read from storage. */
  private async packageFiles(world: WorldDoc): Promise<ZipEntry[]> {
    const out: ZipEntry[] = [];
    const store = await this.userStore();
    for (const id of worldAssetIds(world)) {
      if (isUserAssetId(id)) {
        const rec = await store.get(id);
        if (rec) out.push({ name: `assets/${id}.${extFor(rec.meta)}`, data: new Uint8Array(await rec.blob.arrayBuffer()) });
        continue;
      }
      const e = catalogEntry(id);
      if (!e) continue;
      for (const path of [e.file, ...e.lods.map((l) => l.file)]) {
        if (!path) continue;
        const res = await fetch(libraryUrl(path));
        if (res.ok) out.push({ name: `assets/lib/${path}`, data: new Uint8Array(await res.arrayBuffer()) });
      }
    }
    return out;
  }

  /** Build the package bytes for the current world. */
  async buildPackage(): Promise<{ name: string; bytes: Uint8Array }> {
    await this.ready();
    const world = this.host.history.current;
    const credits = creditsFor(world, this.state.getState().catalog);
    const store = await this.userStore();
    const imports: UserAssetMeta[] = [];
    for (const id of worldAssetIds(world)) {
      if (!isUserAssetId(id)) continue;
      const rec = await store.get(id);
      if (rec) imports.push(rec.meta);
    }
    const entries: ZipEntry[] = [
      { name: 'world.aether.json', data: new TextEncoder().encode(exportWorld(world)) },
      { name: 'package.json', data: new TextEncoder().encode(JSON.stringify({ format: PACKAGE_FORMAT, version: 1, world: 'world.aether.json', imports }, null, 2)) },
      { name: 'CREDITS.txt', data: new TextEncoder().encode(creditsText(world.name, credits)) },
      ...(await this.packageFiles(world)),
    ];
    const base = exportFileName(world).replace(/\.aether\.json$/, '');
    return { name: `${base}.aether.zip`, bytes: await writeZip(entries) };
  }

  /** Download the current world as a package. */
  async exportPackage(): Promise<void> {
    const st = this.host.store.getState();
    this.state.setState({ busy: 'Packing world…' });
    try {
      const { name, bytes } = await this.buildPackage();
      const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/zip' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      st.toast(`Exported ${name} (${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB)`, 'success', 3);
    } catch (err) {
      st.toast(`Export failed: ${err instanceof Error ? err.message.slice(0, 160) : 'error'}`, 'error', 6);
    } finally {
      this.state.setState({ busy: null });
    }
  }

  /** Import a world package: validated world, re-validated imports. Returns an error message or null. */
  async importPackage(file: File): Promise<string | null> {
    if (file.size > MAX_PACKAGE_BYTES) return `The package is too large (limit ${Math.round(MAX_PACKAGE_BYTES / 1024 / 1024)} MB).`;
    this.state.setState({ busy: `Opening ${file.name.slice(0, 40)}…` });
    try {
      const zip = await readZip(new Uint8Array(await file.arrayBuffer()));
      if (!zip.ok) return `Package rejected: ${zip.error}`;
      const worldEntry = zip.entries.find((e) => e.name === 'world.aether.json');
      if (!worldEntry || worldEntry.data.byteLength > 16 * 1024 * 1024) return 'Package rejected: no world inside.';
      let value: unknown;
      try {
        value = JSON.parse(new TextDecoder().decode(worldEntry.data));
      } catch {
        return 'Package rejected: the world file is not valid JSON.';
      }
      const r = validateImportedValue(value);
      if (!r.ok) return r.error;
      const store = await this.userStore();
      for (const e of zip.entries) {
        const m = /^assets\/(user-[0-9a-f]{12})\.(glb|png|jpg|webp|hdr)$/.exec(e.name);
        if (!m) continue;
        const imported = await importUserAsset(e.data, e.name.slice(7));
        // Content-addressed: the id must match what the world references, else the file was altered.
        if (!imported.ok || imported.asset.meta.id !== m[1]) continue;
        await store.put(imported.asset.meta, imported.asset.data);
        this.register(imported.asset.meta, new Blob([imported.asset.data as Uint8Array<ArrayBuffer>], { type: imported.asset.meta.mime }));
      }
      this.host.replaceWorld(r.world, `Import "${r.world.name}"`);
      this.host.store.getState().toast(`Opened "${r.world.name}"`, 'success');
      await this.refreshImports();
      return null;
    } finally {
      this.state.setState({ busy: null });
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const c of this.cleanups.splice(0)) c();
    for (const [id, url] of this.urls) {
      URL.revokeObjectURL(url);
      unregisterUserAsset(id);
    }
    this.urls.clear();
  }
}
