/**
 * Client of the local server's on-demand model import (`/api/assets/import`, see docs/ASSETS.md). Pure transport: it asks the
 * server to import a model, follows the job, downloads the finished GLB and checks its SHA-256. Storing the model with the
 * project (as a user asset, so exports and published games carry it) is the caller's job.
 *
 * On a page without the local server (the hosted static site, a server with imports off) every call answers
 * `unavailable` and nothing is thrown.
 */
import { ImportJobView, ImportedAsset, sha256Hex, type ImportedAsset as ImportedAssetT } from '@aether/assets';
import { z } from 'zod';

export type ServerImportOutcome = { ok: true; asset: ImportedAssetT; bytes: Uint8Array } | { ok: false; reason: 'unavailable' | 'failed'; message: string };

export interface ServerImportOptions {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  onProgress?: (text: string, fraction: number) => void;
  pollMs?: number;
  /** Stop waiting after this long (the server has its own budget). */
  maxMs?: number;
}

export const NEEDS_SERVER = 'Importing needs the local Aether server (npx aether start). This page cannot import models.';
const MAX_GLB = 8 * 1024 * 1024;

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });

/** True when `/api/health` says this server imports models. */
export async function serverCanImport(f: typeof fetch = fetch, signal?: AbortSignal): Promise<boolean> {
  try {
    const r = await f('/api/health', { credentials: 'same-origin', cache: 'no-store', ...(signal ? { signal } : {}) });
    if (!r.ok) return false;
    const j = z.object({ assetImport: z.boolean().optional() }).passthrough().safeParse(await r.json());
    return j.success && j.data.assetImport === true;
  } catch {
    return false;
  }
}

export async function importFromServer(query: string, maxSize: number | undefined, opts: ServerImportOptions = {}): Promise<ServerImportOutcome> {
  const f = opts.fetchImpl ?? fetch;
  const say = opts.onProgress ?? ((): void => undefined);
  const unavailable = { ok: false, reason: 'unavailable', message: NEEDS_SERVER } as const;
  if (!(await serverCanImport(f, opts.signal))) return unavailable;
  let started: Response;
  try {
    started = await f('/api/assets/import', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, ...(maxSize !== undefined ? { maxSize } : {}) }),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
  } catch {
    return unavailable;
  }
  if (started.status === 404 || started.status === 401 || started.status === 403) return unavailable;
  const body: unknown = await started.json().catch(() => null);
  if (!started.ok) {
    const msg = z.object({ message: z.string().optional() }).safeParse((body as { error?: unknown } | null)?.error);
    return { ok: false, reason: 'failed', message: msg.success && msg.data.message ? msg.data.message.slice(0, 300) : `The server refused the import (HTTP ${started.status}).` };
  }
  const first = ImportJobView.safeParse((body as { job?: unknown } | null)?.job);
  if (!first.success) return { ok: false, reason: 'failed', message: 'The server answered in an unexpected shape.' };
  const id = first.data.id;
  const deadline = Date.now() + (opts.maxMs ?? 15 * 60_000);
  let view = first.data;
  for (;;) {
    say(view.message, view.progress);
    if (view.stage === 'ready' || view.stage === 'failed') break;
    if (opts.signal?.aborted) return { ok: false, reason: 'failed', message: 'The import was stopped.' };
    if (Date.now() > deadline) return { ok: false, reason: 'failed', message: 'The import took too long.' };
    await sleep(opts.pollMs ?? 700, opts.signal);
    const r = await f(`/api/assets/import/${id}`, { credentials: 'same-origin', cache: 'no-store', ...(opts.signal ? { signal: opts.signal } : {}) }).catch(() => null);
    if (!r?.ok) return { ok: false, reason: 'failed', message: 'Lost contact with the local server during the import.' };
    const next = ImportJobView.safeParse(((await r.json().catch(() => null)) as { job?: unknown } | null)?.job);
    if (!next.success) return { ok: false, reason: 'failed', message: 'The server answered in an unexpected shape.' };
    view = next.data;
  }
  if (view.stage === 'failed' || !view.asset) return { ok: false, reason: 'failed', message: view.error ?? 'The import failed.' };
  const asset = ImportedAsset.safeParse(view.asset);
  if (!asset.success || !asset.data.entry.file) return { ok: false, reason: 'failed', message: 'The imported record is not valid.' };
  const rel = asset.data.entry.file;
  const url = `${asset.data.base}${rel}`;
  if (!url.startsWith('/api/assets/imported/files/')) return { ok: false, reason: 'failed', message: 'The imported record points somewhere unexpected.' };
  const res = await f(url, { credentials: 'same-origin', ...(opts.signal ? { signal: opts.signal } : {}) }).catch(() => null);
  if (!res?.ok) return { ok: false, reason: 'failed', message: 'The imported model could not be read from the server.' };
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_GLB) return { ok: false, reason: 'failed', message: 'The imported model has an unexpected size.' };
  if ((await sha256Hex(bytes)) !== asset.data.provenance.files[rel]) return { ok: false, reason: 'failed', message: 'The imported model does not match its recorded hash.' };
  return { ok: true, asset: asset.data, bytes };
}
