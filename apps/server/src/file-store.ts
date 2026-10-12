/**
 * Small JSON document store on the local filesystem.
 *
 * - Keys are validated against a caller-provided regex (no path separators can
 *   ever reach `path.join`), and the resolved path is re-checked to stay inside
 *   the store directory.
 * - Writes are atomic: data goes to a unique temp file which is then renamed
 *   over the destination, so readers never see partial documents.
 * - The number of documents and the size of each document are capped.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

/** Thrown for store-level failures that map to HTTP errors. */
export class StoreError extends Error {
  constructor(
    readonly code: 'invalid-key' | 'too-large' | 'store-full',
    message: string,
  ) {
    super(message);
    this.name = 'StoreError';
  }
}

/** Options for {@link JsonFileStore}. */
export interface JsonFileStoreOptions {
  dir: string;
  keyPattern: RegExp;
  maxEntries: number;
  maxBytes: number;
}

const SUFFIX = '.json';

/** A directory of `<key>.json` files. */
export class JsonFileStore {
  private readonly dir: string;
  private count: number | null = null;
  private ready: Promise<void> | null = null;

  constructor(private readonly opts: JsonFileStoreOptions) {
    this.dir = resolve(opts.dir);
  }

  /** True when `key` is acceptable for this store. */
  isValidKey(key: string): boolean {
    return this.opts.keyPattern.test(key);
  }

  /** Read and JSON-parse a document; `undefined` when missing. */
  async get(key: string): Promise<unknown> {
    const file = this.pathFor(key);
    let text: string;
    try {
      const st = await stat(file);
      if (!st.isFile() || st.size > this.opts.maxBytes) return undefined;
      text = await readFile(file, 'utf8');
    } catch (err) {
      if (isNotFound(err)) return undefined;
      throw err;
    }
    return JSON.parse(text) as unknown;
  }

  /** True when a document exists for `key`. */
  async has(key: string): Promise<boolean> {
    try {
      return (await stat(this.pathFor(key))).isFile();
    } catch (err) {
      if (isNotFound(err)) return false;
      throw err;
    }
  }

  /**
   * Atomically write `value` as JSON. `create` = true fails with `store-full`
   * when the entry cap is reached (updates of existing keys never count).
   */
  async put(key: string, value: unknown, create: boolean): Promise<void> {
    const file = this.pathFor(key);
    const text = JSON.stringify(value);
    if (Buffer.byteLength(text, 'utf8') > this.opts.maxBytes) throw new StoreError('too-large', 'document is too large');
    await this.init();
    // Reserve the slot synchronously (no await between check and increment) so
    // concurrent creates cannot all pass the cap check.
    let reserved = false;
    if (create) {
      const count = this.count ?? 0;
      if (count >= this.opts.maxEntries) throw new StoreError('store-full', 'storage limit reached');
      if (this.count !== null) {
        this.count++;
        reserved = true;
      }
    }
    const tmp = join(this.dir, `.${key}.${randomBytes(6).toString('hex')}.tmp`);
    try {
      await writeFile(tmp, text, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      const existed = await this.has(key);
      await rename(tmp, file);
      if (reserved && existed) this.release();
      else if (!reserved && !existed && this.count !== null) this.count++;
    } catch (err) {
      if (reserved) this.release();
      await unlink(tmp).catch(() => undefined);
      throw err;
    }
  }

  private release(): void {
    if (this.count !== null && this.count > 0) this.count--;
  }

  /** Number of stored documents. */
  async size(): Promise<number> {
    await this.init();
    return this.count ?? 0;
  }

  private init(): Promise<void> {
    this.ready ??= (async () => {
      await mkdir(this.dir, { recursive: true, mode: 0o700 });
      const names = await readdir(this.dir);
      this.count = names.filter((n) => n.endsWith(SUFFIX) && !n.startsWith('.')).length;
    })();
    return this.ready;
  }

  private pathFor(key: string): string {
    if (!this.isValidKey(key)) throw new StoreError('invalid-key', 'invalid key');
    const file = resolve(this.dir, `${key}${SUFFIX}`);
    if (!file.startsWith(this.dir + sep)) throw new StoreError('invalid-key', 'invalid key');
    return file;
  }
}

function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'ENOENT';
}
