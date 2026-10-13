/**
 * ProjectRepo — the projects API used by the home page and the editor.
 * Wraps a {@link ProjectBackend} with validation, size and count caps,
 * quota-aware error messages, change notifications (this tab and, through
 * BroadcastChannel where available, other tabs) and undoable deletes.
 */
import type { WorldDoc } from '@aether/core';
import { reviveChat, type ChatEntry } from '../lib/chat';
import { exportWorld, parseWorldImport, validateImportedValue } from '../lib/worldIO';
import type { ProjectBackend } from './backend';
import {
  MAX_PROJECT_CHARS,
  MAX_PROJECTS,
  MAX_THUMBNAIL_BYTES,
  PROJECTS_SCHEMA_VERSION,
  cleanProjectName,
  newProjectId,
  parseProjectMeta,
  type ProjectData,
  type ProjectMeta,
} from './model';

/** Result of a repository write. */
export type RepoResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** A project opened in the editor. */
export interface OpenedProject {
  meta: ProjectMeta;
  world: WorldDoc;
  chat: ChatEntry[];
}

/** Everything needed to undo a delete. */
export interface DeletedProject {
  meta: ProjectMeta;
  data: ProjectData | null;
  thumb: Blob | null;
}

/** Input for {@link ProjectRepo.create}. */
export interface NewProject {
  world: WorldDoc;
  chat?: readonly ChatEntry[];
  /** Defaults to the world's name. */
  name?: string;
  template?: string | null;
}

const CHANNEL = 'aether-projects';
/** Image types accepted as thumbnails (never SVG). */
const THUMB_TYPE = /^image\/(webp|jpeg|png)$/;

function ok<T>(value: T): RepoResult<T> {
  return { ok: true, value };
}

function fail<T>(error: string): RepoResult<T> {
  return { ok: false, error };
}

/** User-facing text for a storage failure (quota errors get actionable advice). */
export function storageErrorMessage(err: unknown): string {
  const name = typeof err === 'object' && err !== null && 'name' in err ? String((err as { name: unknown }).name) : '';
  if (name === 'QuotaExceededError' || /quota/i.test(String(err))) return 'Browser storage is full. Export or delete some projects, then try again.';
  const msg = err instanceof Error ? err.message : String(err);
  return `Could not save to browser storage (${msg.slice(0, 120)}).`;
}

function entityCount(world: WorldDoc): number {
  return Object.keys(world.entities).length;
}

/** Projects repository. See module docs. */
export class ProjectRepo {
  private readonly listeners = new Set<() => void>();
  private readonly channel: BroadcastChannel | null;

  /**
   * @param backend storage backend
   * @param now clock (injectable for tests)
   * @param newId id generator (injectable for tests)
   */
  constructor(
    readonly backend: ProjectBackend,
    private readonly now: () => number = Date.now,
    private readonly newId: () => string = () => newProjectId(),
  ) {
    let channel: BroadcastChannel | null = null;
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        channel = new BroadcastChannel(CHANNEL);
        // Only the fact that something changed crosses tabs; the data is re-read and re-validated.
        channel.onmessage = () => this.emit(false);
      }
    } catch {
      channel = null;
    }
    this.channel = channel;
  }

  /** True when projects survive a reload (IndexedDB available). */
  get persistent(): boolean {
    return this.backend.persistent;
  }

  /** Listen for changes (this tab or another). Returns an unsubscribe function. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(broadcast = true): void {
    for (const fn of [...this.listeners]) fn();
    if (broadcast) {
      try {
        this.channel?.postMessage('changed');
      } catch {
        /* channel closed */
      }
    }
  }

  /** All valid projects, most recently updated first. Invalid records are skipped. */
  async list(): Promise<ProjectMeta[]> {
    let raw: unknown[] = [];
    try {
      raw = await this.backend.listMeta();
    } catch {
      return [];
    }
    const out: ProjectMeta[] = [];
    for (const r of raw.slice(0, MAX_PROJECTS * 2)) {
      const m = parseProjectMeta(r);
      if (m) out.push(m);
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** One project's metadata (null when missing or invalid). */
  async meta(id: string): Promise<ProjectMeta | null> {
    try {
      return parseProjectMeta(await this.backend.getMeta(id));
    } catch {
      return null;
    }
  }

  private serialize(id: string, world: WorldDoc, chat: readonly ChatEntry[]): RepoResult<ProjectData> {
    const data: ProjectData = { id, world, chat: [...chat] };
    let size = 0;
    try {
      size = JSON.stringify(data).length;
    } catch {
      return fail('The project could not be serialized.');
    }
    if (size > MAX_PROJECT_CHARS) return fail(`The project is too large to save (${Math.round(size / 1024 / 1024)} MB, limit ${Math.round(MAX_PROJECT_CHARS / 1024 / 1024)} MB).`);
    return ok(data);
  }

  /** Create a project. */
  async create(input: NewProject): Promise<RepoResult<ProjectMeta>> {
    const existing = await this.list();
    if (existing.length >= MAX_PROJECTS) return fail(`You have ${MAX_PROJECTS} projects, the most this browser keeps. Delete some first.`);
    const name = cleanProjectName(input.name ?? input.world.name) || 'Untitled world';
    const world: WorldDoc = input.world.name === name ? input.world : { ...input.world, name };
    const id = this.newId();
    const data = this.serialize(id, world, input.chat ?? []);
    if (!data.ok) return data;
    const t = this.now();
    const meta: ProjectMeta = {
      v: PROJECTS_SCHEMA_VERSION,
      id,
      name,
      createdAt: t,
      updatedAt: t,
      openedAt: t,
      template: input.template ?? null,
      entityCount: entityCount(world),
      hasThumbnail: false,
    };
    try {
      await this.backend.put(meta, data.value);
    } catch (err) {
      return fail(storageErrorMessage(err));
    }
    this.emit();
    return ok(meta);
  }

  /** Load and validate a project for the editor; bumps its "opened" time. */
  async open(id: string): Promise<RepoResult<OpenedProject>> {
    const meta = await this.meta(id);
    if (!meta) return fail('This project does not exist (it may have been deleted).');
    let raw: unknown;
    try {
      raw = await this.backend.getData(id);
    } catch (err) {
      return fail(storageErrorMessage(err));
    }
    const body = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : null;
    if (!body) return fail('This project is damaged: its world is missing.');
    const r = validateImportedValue(body['world']);
    if (!r.ok) return fail(`This project is damaged: ${r.error}`);
    const chat = reviveChat(body['chat']);
    const opened: ProjectMeta = { ...meta, openedAt: this.now() };
    try {
      await this.backend.put(opened);
    } catch {
      /* the opened-at bump is cosmetic */
    }
    return ok({ meta: opened, world: r.world, chat });
  }

  /** Save the editor state (world + chat). The project name follows the world name. */
  async save(id: string, world: WorldDoc, chat: readonly ChatEntry[]): Promise<RepoResult<ProjectMeta>> {
    const meta = await this.meta(id);
    if (!meta) return fail('This project no longer exists.');
    const data = this.serialize(id, world, chat);
    if (!data.ok) return data;
    const next: ProjectMeta = { ...meta, name: cleanProjectName(world.name) || meta.name, updatedAt: this.now(), entityCount: entityCount(world) };
    try {
      await this.backend.put(next, data.value);
    } catch (err) {
      return fail(storageErrorMessage(err));
    }
    this.emit();
    return ok(next);
  }

  /** Rename a project (and its world). */
  async rename(id: string, name: string): Promise<RepoResult<ProjectMeta>> {
    const clean = cleanProjectName(name);
    if (!clean) return fail('Enter a name.');
    const opened = await this.open(id);
    if (!opened.ok) return opened;
    return this.save(id, { ...opened.value.world, name: clean }, opened.value.chat);
  }

  /** Copy a project (world, chat and thumbnail) as "<name> copy". */
  async duplicate(id: string): Promise<RepoResult<ProjectMeta>> {
    const opened = await this.open(id);
    if (!opened.ok) return opened;
    const name = cleanProjectName(`${opened.value.meta.name} copy`);
    const created = await this.create({ world: { ...opened.value.world, name }, chat: opened.value.chat, name, template: opened.value.meta.template });
    if (!created.ok) return created;
    const thumb = await this.thumbnail(id);
    if (thumb) await this.setThumbnail(created.value.id, thumb);
    return ok((await this.meta(created.value.id)) ?? created.value);
  }

  /** Delete a project. Returns what {@link restore} needs to undo it. */
  async remove(id: string): Promise<RepoResult<DeletedProject>> {
    const meta = await this.meta(id);
    if (!meta) return fail('This project no longer exists.');
    let data: ProjectData | null = null;
    let thumb: Blob | null = null;
    try {
      const raw = await this.backend.getData(id);
      if (typeof raw === 'object' && raw !== null) data = raw as ProjectData;
      thumb = await this.backend.getThumb(id);
      await this.backend.remove(id);
    } catch (err) {
      return fail(storageErrorMessage(err));
    }
    this.emit();
    return ok({ meta, data, thumb });
  }

  /** Undo a {@link remove}. */
  async restore(deleted: DeletedProject): Promise<RepoResult<ProjectMeta>> {
    const meta = parseProjectMeta(deleted.meta);
    if (!meta) return fail('Nothing to restore.');
    try {
      await this.backend.put(meta, deleted.data ?? undefined);
      if (deleted.thumb) await this.backend.putThumb(meta.id, deleted.thumb);
    } catch (err) {
      return fail(storageErrorMessage(err));
    }
    this.emit();
    return ok(meta);
  }

  /** Store a thumbnail (≤ {@link MAX_THUMBNAIL_BYTES}, image/* only). */
  async setThumbnail(id: string, blob: Blob): Promise<RepoResult<true>> {
    if (blob.size === 0 || blob.size > MAX_THUMBNAIL_BYTES) return fail('Thumbnail too large.');
    if (!THUMB_TYPE.test(blob.type)) return fail('Unsupported thumbnail type.');
    const meta = await this.meta(id);
    if (!meta) return fail('This project no longer exists.');
    try {
      await this.backend.putThumb(id, blob);
      if (!meta.hasThumbnail) await this.backend.put({ ...meta, hasThumbnail: true });
    } catch (err) {
      return fail(storageErrorMessage(err));
    }
    this.emit();
    return ok(true);
  }

  /** The stored thumbnail, or null. */
  async thumbnail(id: string): Promise<Blob | null> {
    try {
      const b = await this.backend.getThumb(id);
      return b && b.size > 0 && b.size <= MAX_THUMBNAIL_BYTES && THUMB_TYPE.test(b.type) ? b : null;
    } catch {
      return null;
    }
  }

  /** Serialized `.aether.json` export of a project. */
  async exportText(id: string): Promise<RepoResult<{ name: string; text: string; world: WorldDoc }>> {
    const opened = await this.open(id);
    if (!opened.ok) return opened;
    return ok({ name: opened.value.meta.name, text: exportWorld(opened.value.world), world: opened.value.world });
  }

  /** Import a `.aether.json` (or bare world JSON) file as a new project. */
  async importText(text: string): Promise<RepoResult<ProjectMeta>> {
    const r = parseWorldImport(text);
    if (!r.ok) return fail(r.error);
    return this.create({ world: r.world });
  }

  /** Release the backend and the cross-tab channel. */
  dispose(): void {
    this.listeners.clear();
    try {
      this.channel?.close();
    } catch {
      /* already closed */
    }
    this.backend.close();
  }
}
