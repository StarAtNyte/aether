/**
 * Storage backends for projects: IndexedDB in the browser, an in-memory map
 * for tests and for browsers where IndexedDB is unavailable (some private
 * modes). The repository (`repo.ts`) validates everything a backend returns.
 */
import type { ProjectData, ProjectMeta } from './model';

/** Minimal async key-value surface the repository needs. */
export interface ProjectBackend {
  /** True when data survives a reload. */
  readonly persistent: boolean;
  listMeta(): Promise<unknown[]>;
  getMeta(id: string): Promise<unknown>;
  getData(id: string): Promise<unknown>;
  /** Write metadata and (optionally) the body in one transaction. */
  put(meta: ProjectMeta, data?: ProjectData): Promise<void>;
  getThumb(id: string): Promise<Blob | null>;
  putThumb(id: string, blob: Blob): Promise<void>;
  /** Delete metadata, body and thumbnail. */
  remove(id: string): Promise<void>;
  close(): void;
}

/** Non-persistent backend (tests; fallback when IndexedDB is blocked). Values are deep-copied like structured clone. */
export class MemoryBackend implements ProjectBackend {
  readonly persistent = false;
  private readonly meta = new Map<string, string>();
  private readonly data = new Map<string, string>();
  private readonly thumbs = new Map<string, Blob>();
  /** Test hook: throw this from the next `put` (e.g. a quota error). */
  failNextPut: Error | null = null;

  async listMeta(): Promise<unknown[]> {
    return [...this.meta.values()].map((s) => JSON.parse(s) as unknown);
  }
  async getMeta(id: string): Promise<unknown> {
    const s = this.meta.get(id);
    return s === undefined ? null : (JSON.parse(s) as unknown);
  }
  async getData(id: string): Promise<unknown> {
    const s = this.data.get(id);
    return s === undefined ? null : (JSON.parse(s) as unknown);
  }
  async put(meta: ProjectMeta, data?: ProjectData): Promise<void> {
    if (this.failNextPut) {
      const e = this.failNextPut;
      this.failNextPut = null;
      throw e;
    }
    this.meta.set(meta.id, JSON.stringify(meta));
    if (data) this.data.set(meta.id, JSON.stringify(data));
  }
  async getThumb(id: string): Promise<Blob | null> {
    return this.thumbs.get(id) ?? null;
  }
  async putThumb(id: string, blob: Blob): Promise<void> {
    this.thumbs.set(id, blob);
  }
  async remove(id: string): Promise<void> {
    this.meta.delete(id);
    this.data.delete(id);
    this.thumbs.delete(id);
  }
  close(): void {
    /* nothing to release */
  }
}
