/**
 * Sealing: run the deterministic replay once and wrap its outcome in a
 * content-hashed (and optionally Ed25519-signed) proof. Signing uses Web
 * Crypto (`crypto.subtle`, present in Node 22+ and every supported browser);
 * hashing is the dependency-free SHA-256 of `./hash`.
 */
import { validateWorld, type WorldDoc } from '@aether/core';
import type { ColliderDesc } from '@aether/procgen';
import { fromBase64Url, hashJson, toBase64Url, utf8 } from './hash';
import { PHYSICS_ENGINE, PROOF_FORMAT, PROOF_LIMITS, PROOF_VERSION, REPLAY_ENGINE, parseProof, type Proof, type ProofBody, type ProofColliderEntries, type ProofSignature } from './proof';
import { claimHash, DEFAULT_REPLAY, resimulate, type ReplaySettings } from './resimulate';

/** Fixed physics step of the replay (the engine's default; recorded in the proof). */
export const REPLAY_FIXED_DT = 1 / 60;

/** Hash of a world: the canonical JSON of its validated (normalised) form. */
export function worldHash(world: WorldDoc): string {
  const v = validateWorld(world);
  if (!v.ok) throw new Error(`invalid world: ${v.issues.slice(0, 3).map((i) => `${i.path} ${i.message}`).join('; ')}`);
  return hashJson(v.world);
}

/** Content hash of a proof body (everything except `hash` and `signature`). */
export function proofBodyHash(proof: ProofBody | Proof): string {
  const { hash: _h, signature: _s, ...body } = proof as Proof;
  return hashJson(body);
}

/** An Ed25519 key pair, both halves base64url (`privateKey` is PKCS#8; keep it secret). */
export interface SigningKeyPair {
  publicKey: string;
  privateKey: string;
}

/**
 * A signing key: exportable base64url halves, or a non-extractable
 * `CryptoKey` (kept in IndexedDB by the studio) with its raw public key.
 */
export type SigningKey = SigningKeyPair | { publicKey: string; privateKey: CryptoKey };

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error('Web Crypto (crypto.subtle) is not available here');
  return s;
}

/**
 * Generate an Ed25519 key whose private half cannot be exported (for
 * browser storage in IndexedDB); the public half is returned base64url.
 */
export async function generateNonExtractableKey(): Promise<{ publicKey: string; privateKey: CryptoKey }> {
  const pair = (await subtle().generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const pub = new Uint8Array(await subtle().exportKey('raw', pair.publicKey));
  // Re-import the private key as non-extractable: the exportable one is dropped here.
  const pkcs8 = new Uint8Array(await subtle().exportKey('pkcs8', pair.privateKey));
  const priv = await subtle().importKey('pkcs8', pkcs8, { name: 'Ed25519' }, false, ['sign']);
  pkcs8.fill(0);
  return { publicKey: toBase64Url(pub), privateKey: priv };
}

/** Generate a fresh Ed25519 key pair. */
export async function generateSigningKey(): Promise<SigningKeyPair> {
  const pair = (await subtle().generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const pub = new Uint8Array(await subtle().exportKey('raw', pair.publicKey));
  const priv = new Uint8Array(await subtle().exportKey('pkcs8', pair.privateKey));
  return { publicKey: toBase64Url(pub), privateKey: toBase64Url(priv) };
}

/** Short, human-comparable id of a public key (first 16 hex digits of its SHA-256). */
export function keyId(publicKey: string): string {
  const raw = fromBase64Url(publicKey);
  return raw ? hashJson(toBase64Url(raw)).slice(7, 23) : 'invalid';
}

/** Sign a proof (replaces any existing signature). Returns a new proof. */
export async function signProof(proof: Proof, key: SigningKey): Promise<Proof> {
  let priv: CryptoKey;
  if (typeof key.privateKey === 'string') {
    const pkcs8 = fromBase64Url(key.privateKey);
    if (!pkcs8) throw new Error('invalid private key encoding');
    priv = await subtle().importKey('pkcs8', pkcs8 as Uint8Array<ArrayBuffer>, { name: 'Ed25519' }, false, ['sign']);
  } else {
    priv = key.privateKey;
  }
  const sig = new Uint8Array(await subtle().sign({ name: 'Ed25519' }, priv, utf8(proof.hash) as Uint8Array<ArrayBuffer>));
  const signature: ProofSignature = { alg: 'Ed25519', publicKey: key.publicKey, sig: toBase64Url(sig) };
  const { signature: _old, ...rest } = proof;
  return { ...rest, signature };
}

/** Verify a proof's signature over its hash. Never throws. */
export async function verifySignature(proof: Proof): Promise<boolean> {
  const sig = proof.signature;
  if (!sig) return false;
  try {
    const pub = fromBase64Url(sig.publicKey);
    const raw = fromBase64Url(sig.sig);
    if (!pub || pub.length !== 32 || !raw || raw.length !== 64) return false;
    const key = await subtle().importKey('raw', pub as Uint8Array<ArrayBuffer>, { name: 'Ed25519' }, false, ['verify']);
    return await subtle().verify({ name: 'Ed25519' }, key, raw as Uint8Array<ArrayBuffer>, utf8(proof.hash) as Uint8Array<ArrayBuffer>);
  } catch {
    return false;
  }
}

/** Options of {@link createProof}. */
export interface CreateProofOptions {
  settings?: ReplaySettings;
  /**
   * Renderer colliders for entities whose shapes are not derivable from the
   * document (custom generators, imported models). Embedded when they fit
   * the caps; otherwise the proof is marked `external` and cannot be
   * re-simulated elsewhere.
   */
  colliders?: ReadonlyArray<readonly [string, readonly ColliderDesc[]]>;
  /** Sign with this key. */
  key?: SigningKey;
  /** Epoch ms stored as `sealedAt` (default now). */
  now?: number;
  signal?: AbortSignal;
  budgetMs?: number;
}

function colliderNumbers(list: ReadonlyArray<readonly [string, readonly ColliderDesc[]]>): number {
  let n = 0;
  for (const [, descs] of list) {
    for (const d of descs) {
      if (d.kind === 'hull') n += d.points.length;
      else if (d.kind === 'trimesh') n += d.positions.length + d.indices.length;
      else if (d.kind === 'heightfield') n += d.heights.length;
      else n += 8;
    }
  }
  return n;
}

/**
 * Replay `world` once and seal the outcome. Throws when the replay was
 * inconclusive (cut short by its wall-clock budget): a proof must be the
 * verdict of a complete replay.
 */
export async function createProof(world: WorldDoc, opts: CreateProofOptions = {}): Promise<Proof> {
  const settings = opts.settings ?? DEFAULT_REPLAY;
  const v = validateWorld(world);
  if (!v.ok) throw new Error(`invalid world: ${v.issues.slice(0, 3).map((i) => `${i.path} ${i.message}`).join('; ')}`);
  const doc = v.world;
  const given = opts.colliders ?? [];
  const embeddable = given.length <= PROOF_LIMITS.MAX_COLLIDER_ENTITIES && colliderNumbers(given) <= PROOF_LIMITS.MAX_COLLIDER_NUMBERS;
  const entries = embeddable ? ([...given].map(([id, d]) => [id, [...d]]) as unknown as ProofColliderEntries) : undefined;
  const replay = await resimulate(doc, {
    settings,
    ...(entries ? { colliders: entries } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
    ...(opts.budgetMs !== undefined ? { budgetMs: opts.budgetMs } : {}),
  });
  if (replay.inconclusive) throw new Error('The replay ran out of time before it could reach a verdict, so no proof was sealed.');
  const claim = { ...replay.claim, hash: claimHash(replay.claim) };
  const body: ProofBody = {
    format: PROOF_FORMAT,
    v: PROOF_VERSION,
    engine: { replay: REPLAY_ENGINE, physics: PHYSICS_ENGINE },
    sealedAt: opts.now ?? Date.now(),
    world: { hash: hashJson(doc), name: doc.name.slice(0, 200), entities: Object.keys(doc.entities).length, tests: doc.tests.length },
    replay: { maxSeconds: settings.maxSeconds, fixedDt: REPLAY_FIXED_DT, traceHz: settings.traceHz },
    colliders:
      given.length === 0
        ? { mode: 'none' }
        : entries
          ? { mode: 'embedded', hash: hashJson(entries), entries }
          : { mode: 'external', hash: hashJson(given.map(([id, d]) => [id, d])) },
    claim,
    ...(replay.trace ? { trace: replay.trace } : {}),
  };
  const proof: Proof = { ...body, hash: proofBodyHash(body) };
  const own = parseProof(proof);
  if (!own.ok) throw new Error(`The world is too large to seal (${own.error})`);
  return opts.key ? signProof(proof, opts.key) : proof;
}
