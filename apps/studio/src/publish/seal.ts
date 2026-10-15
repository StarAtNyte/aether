/**
 * Sealing a world for publishing and re-checking a seal in the viewer. The
 * replay engine (`@aether/verifier`: physics + logic) is imported lazily, so
 * nothing here costs a page that never seals or checks.
 *
 * The author's signing key is a non-extractable Ed25519 `CryptoKey` kept in
 * this browser's IndexedDB: it proves "published by the same browser key",
 * never an identity (docs/PROOFS.md).
 */
import type { WorldDoc } from '@aether/core';
import type { ColliderProvider } from '@aether/physics';
import type { Proof } from '@aether/verifier';
import { workerColliders } from '../engine/verify/colliders';
import { createLogger, errorMessage } from '../lib/log';

const log = createLogger('seal');

const DB_NAME = 'aether-signing';
const STORE = 'keys';
const KEY_ID = 'ed25519-v1';

interface StoredKey {
  publicKey: string;
  privateKey: CryptoKey;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB unavailable'));
  });
}

function idb<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = run(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB error'));
  });
}

/**
 * This browser's signing key (created on first use). Null when IndexedDB or
 * Ed25519 is unavailable (private windows, old browsers): sealing then
 * produces an unsigned proof.
 */
export async function browserSigningKey(): Promise<StoredKey | null> {
  try {
    if (typeof indexedDB === 'undefined') return null;
    const { generateNonExtractableKey } = await import('@aether/verifier');
    const db = await openDb();
    try {
      const existing = (await idb<StoredKey | undefined>(db, 'readonly', (s) => s.get(KEY_ID))) ?? null;
      if (existing && typeof existing.publicKey === 'string' && existing.privateKey instanceof CryptoKey) return existing;
      const fresh = await generateNonExtractableKey();
      await idb(db, 'readwrite', (s) => s.put(fresh, KEY_ID));
      return fresh;
    } finally {
      db.close();
    }
  } catch (e) {
    log.warn('signing key unavailable', errorMessage(e));
    return null;
  }
}

/** Options of {@link sealWorld}. */
export interface SealOptions {
  /** Renderer colliders of exactly `world` (undefined when not synced). */
  colliders?: ColliderProvider | undefined;
  /** Sign with this browser's key (default true). */
  sign?: boolean;
  signal?: AbortSignal;
}

/** Outcome of {@link sealWorld}. */
export type SealOutcome = { ok: true; proof: Proof; signed: boolean } | { ok: false; error: string };

/** Replay `world` and seal the outcome. Never throws. */
export async function sealWorld(world: WorldDoc, opts: SealOptions = {}): Promise<SealOutcome> {
  try {
    const { createProof } = await import('@aether/verifier');
    const key = opts.sign === false ? null : await browserSigningKey();
    const colliders = workerColliders(world, opts.colliders);
    const proof = await createProof(world, {
      ...(colliders.length > 0 ? { colliders } : {}),
      ...(key ? { key } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    return { ok: true, proof, signed: proof.signature !== undefined };
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') return { ok: false, error: 'cancelled' };
    return { ok: false, error: errorMessage(e).slice(0, 300) };
  }
}
