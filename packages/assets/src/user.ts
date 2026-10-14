/**
 * User-imported assets: identity, metadata schema and the import pipeline
 * (format detection by content → validation → sanitised bytes). Storage is
 * the host's job (the studio keeps them in IndexedDB with the project).
 */
import { z } from 'zod';
import { sanitizeName, validateGltf, type GltfLimits, type GltfReport } from './import/glb';
import { validateHdr, validateImage, type ImageLimits } from './import/image';

/** Ids of user assets: `user-` + 12 hex characters of the content's SHA-256. */
export const USER_ASSET_ID = /^user-[0-9a-f]{12}$/;

/** True for ids naming user-imported (not library) assets. */
export function isUserAssetId(id: string): boolean {
  return USER_ASSET_ID.test(id);
}

export const UserAssetKind = z.enum(['model', 'image', 'hdri']);
export type UserAssetKind = z.infer<typeof UserAssetKind>;

/** Metadata stored next to the bytes (validated again whenever it is read back). */
export const UserAssetMeta = z.object({
  id: z.string().regex(USER_ASSET_ID),
  kind: UserAssetKind,
  name: z.string().max(64),
  mime: z.enum(['model/gltf-binary', 'image/png', 'image/jpeg', 'image/webp', 'image/vnd.radiance']),
  bytes: z.number().int().min(1).max(64 * 1024 * 1024),
  /** Models: triangles and clip names. Images / HDRIs: pixel size. */
  triangles: z.number().int().min(0).optional(),
  clips: z.array(z.string().max(64)).max(64).optional(),
  width: z.number().int().min(1).max(16384).optional(),
  height: z.number().int().min(1).max(16384).optional(),
  /** Licence / credit the user entered (shown in credits; free text, sanitised). */
  credit: z.string().max(200).optional(),
  createdAt: z.number().int().min(0),
});
export type UserAssetMeta = z.infer<typeof UserAssetMeta>;

/** An accepted import: sanitised bytes plus metadata. */
export interface UserAssetImport {
  meta: UserAssetMeta;
  data: Uint8Array;
  /** Model facts (models only). */
  report?: GltfReport;
}

export type UserAssetResult = { ok: true; asset: UserAssetImport } | { ok: false; error: string };

/** Lowercase hex SHA-256 of `data` (Web Crypto; available in browsers, workers and Node ≥ 20). */
export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Display name from a file name: extension dropped, sanitised, never empty. */
export function assetNameFromFile(fileName: string): string {
  const base = sanitizeName(fileName.replace(/\.[a-z0-9]{1,8}$/i, '').replace(/[_-]+/g, ' '), 64);
  return base || 'Imported asset';
}

/** What a file looks like by content (never by extension). */
export function sniffAssetKind(bytes: Uint8Array): UserAssetKind | null {
  if (bytes.byteLength >= 4 && bytes[0] === 0x67 && bytes[1] === 0x6c && bytes[2] === 0x54 && bytes[3] === 0x46) return 'model';
  if (bytes.byteLength >= 2 && bytes[0] === 0x23 && bytes[1] === 0x3f) return 'hdri';
  if (validateImage(bytes.subarray(0, Math.min(bytes.byteLength, 64 * 1024)), { maxBytes: Infinity, maxSide: Infinity }).ok) return 'image';
  const first = bytes.findIndex((b) => b !== 0x20 && b !== 0x0a && b !== 0x0d && b !== 0x09 && b !== 0xef && b !== 0xbb && b !== 0xbf);
  if (first >= 0 && bytes[first] === 0x7b) return 'model';
  return null;
}

/**
 * Validate and normalise an imported file. Models become sanitised GLBs,
 * images and HDRIs keep their bytes after header validation. The id is
 * derived from the stored bytes, so importing the same file twice dedupes.
 */
export async function importUserAsset(bytes: Uint8Array, fileName: string, opts: { now?: number; gltf?: Partial<GltfLimits>; image?: Partial<ImageLimits>; hdr?: Partial<ImageLimits> } = {}): Promise<UserAssetResult> {
  const kind = sniffAssetKind(bytes);
  const name = assetNameFromFile(fileName);
  const createdAt = Math.max(0, Math.floor(opts.now ?? Date.now()));
  if (kind === 'model') {
    const r = validateGltf(bytes, opts.gltf);
    if (!r.ok) return r;
    const id = `user-${(await sha256Hex(r.glb)).slice(0, 12)}`;
    return { ok: true, asset: { data: r.glb, report: r.report, meta: { id, kind, name, mime: 'model/gltf-binary', bytes: r.glb.byteLength, triangles: r.report.triangles, clips: r.report.animations.slice(0, 64), createdAt } } };
  }
  if (kind === 'image') {
    const r = validateImage(bytes, opts.image);
    if (!r.ok) return r;
    const id = `user-${(await sha256Hex(bytes)).slice(0, 12)}`;
    return { ok: true, asset: { data: bytes, meta: { id, kind, name, mime: r.info.mime, bytes: bytes.byteLength, width: r.info.width, height: r.info.height, createdAt } } };
  }
  if (kind === 'hdri') {
    const r = validateHdr(bytes, opts.hdr);
    if (!r.ok) return r;
    const id = `user-${(await sha256Hex(bytes)).slice(0, 12)}`;
    return { ok: true, asset: { data: bytes, meta: { id, kind, name, mime: 'image/vnd.radiance', bytes: bytes.byteLength, width: r.width, height: r.height, createdAt } } };
  }
  return { ok: false, error: 'unsupported file (use .glb / .gltf models, PNG / JPEG / WebP images or .hdr environments)' };
}
