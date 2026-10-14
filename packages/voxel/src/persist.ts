/**
 * Game saves: player-modified chunks plus the player's state, encoded to a
 * compact binary form (deflate-compressed where `CompressionStream`
 * exists) for IndexedDB and for export/import as a file.
 *
 * A save never stores generated terrain: unmodified chunks regenerate from
 * the seed, deterministically. Each modified chunk is stored palette-packed
 * (≈ 4 bits per block before compression).
 *
 * Decoding treats the bytes as hostile: a magic header and version, hard
 * caps on chunk count and sizes (checked before allocating), a streaming
 * decompression cap against zip bombs, palette/index validation through
 * `ChunkData.fromPacked`, and a zod schema for the JSON part.
 */
import { z } from 'zod';
import { ChunkData } from './chunk';
import { HEIGHT, MAX_CHUNK_COORD } from './constants';

/** Most modified chunks a save may hold. */
export const MAX_SAVED_CHUNKS = 4096;
/** Most bytes a decompressed save may have. */
export const MAX_SAVE_BYTES = 96 * 1024 * 1024;
/** Most bytes of the JSON part. */
const MAX_META_BYTES = 256 * 1024;

const MAGIC = 0x41565831; // "AVX1"
const FORMAT = 1;

/** An inventory slot. */
export const SavedStack = z.object({ item: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/), count: z.number().int().min(1).max(64) }).nullable();

/** The player part of a save. */
export const SavedPlayer = z.object({
  position: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
  yaw: z.number().finite(),
  pitch: z.number().finite(),
  health: z.number().min(0).max(20),
  hunger: z.number().min(0).max(20),
  slots: z.array(SavedStack).max(36),
  selected: z.number().int().min(0).max(8),
  /** Hours on the day/night clock (0–24). */
  hour: z.number().min(0).max(24),
  day: z.number().int().min(0).max(1_000_000),
  spawn: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
});
export type SavedPlayer = z.infer<typeof SavedPlayer>;

/** Save metadata (JSON part). */
export const SaveMeta = z.object({
  /** Which terrain this save belongs to (`saveIdentity`). */
  terrain: z.string().max(200),
  savedAt: z.number().int().nonnegative(),
  player: SavedPlayer.nullable(),
});
export type SaveMeta = z.infer<typeof SaveMeta>;

/** One saved chunk. */
export interface SavedChunk {
  cx: number;
  cz: number;
  top: number;
  data: ChunkData;
}

/** A decoded save. */
export interface VoxelSave {
  meta: SaveMeta;
  chunks: SavedChunk[];
}

/** True when the platform can deflate (all current browsers and Node ≥ 18). */
export function canCompress(): boolean {
  return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
}

class Writer {
  private buf = new Uint8Array(1024);
  private view = new DataView(this.buf.buffer);
  length = 0;

  private grow(n: number): void {
    if (this.length + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.length + n) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }
  u8(v: number): void {
    this.grow(1);
    this.view.setUint8(this.length, v);
    this.length += 1;
  }
  u16(v: number): void {
    this.grow(2);
    this.view.setUint16(this.length, v, true);
    this.length += 2;
  }
  i32(v: number): void {
    this.grow(4);
    this.view.setInt32(this.length, v, true);
    this.length += 4;
  }
  u32(v: number): void {
    this.grow(4);
    this.view.setUint32(this.length, v, true);
    this.length += 4;
  }
  bytes(b: Uint8Array): void {
    this.grow(b.length);
    this.buf.set(b, this.length);
    this.length += b.length;
  }
  result(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

class Reader {
  private readonly view: DataView;
  pos = 0;
  constructor(private readonly buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  need(n: number): void {
    if (this.pos + n > this.buf.length) throw new SaveFormatError('save is truncated');
  }
  u8(): number {
    this.need(1);
    return this.view.getUint8(this.pos++);
  }
  u16(): number {
    this.need(2);
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }
  i32(): number {
    this.need(4);
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }
  u32(): number {
    this.need(4);
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }
  bytes(n: number): Uint8Array<ArrayBuffer> {
    this.need(n);
    const out = this.buf.slice(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
}

/** A save that cannot be read. */
export class SaveFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SaveFormatError';
  }
}

/** Encode a save (uncompressed binary). */
export function encodeSaveRaw(save: VoxelSave): Uint8Array {
  if (save.chunks.length > MAX_SAVED_CHUNKS) throw new SaveFormatError(`too many modified chunks (${save.chunks.length}, max ${MAX_SAVED_CHUNKS})`);
  const w = new Writer();
  w.u32(MAGIC);
  w.u16(FORMAT);
  const meta = new TextEncoder().encode(JSON.stringify(SaveMeta.parse(save.meta)));
  if (meta.length > MAX_META_BYTES) throw new SaveFormatError('save metadata too large');
  w.u32(meta.length);
  w.bytes(meta);
  w.u32(save.chunks.length);
  for (const c of save.chunks) {
    const p = c.data.pack();
    w.i32(c.cx);
    w.i32(c.cz);
    w.u16(Math.max(0, Math.min(HEIGHT, c.top + 1)));
    w.u8(p.bits);
    w.u32(p.palette.length);
    w.bytes(new Uint8Array(p.palette.buffer, p.palette.byteOffset, p.palette.byteLength));
    w.u32(p.words.length);
    w.bytes(new Uint8Array(p.words.buffer, p.words.byteOffset, p.words.byteLength));
  }
  return w.result();
}

/** Decode an uncompressed save; `maxBlockId` bounds palette ids. Throws {@link SaveFormatError}. */
export function decodeSaveRaw(bytes: Uint8Array, maxBlockId: number): VoxelSave {
  if (bytes.length > MAX_SAVE_BYTES) throw new SaveFormatError('save is too large');
  const r = new Reader(bytes);
  if (r.u32() !== MAGIC) throw new SaveFormatError('not a world save');
  const version = r.u16();
  if (version !== FORMAT) throw new SaveFormatError(`unsupported save version ${version}`);
  const metaLen = r.u32();
  if (metaLen > MAX_META_BYTES) throw new SaveFormatError('save metadata too large');
  let metaJson: unknown;
  try {
    metaJson = JSON.parse(new TextDecoder().decode(r.bytes(metaLen)));
  } catch {
    throw new SaveFormatError('save metadata is not valid JSON');
  }
  const meta = SaveMeta.safeParse(metaJson);
  if (!meta.success) throw new SaveFormatError('save metadata is invalid');
  const count = r.u32();
  if (count > MAX_SAVED_CHUNKS) throw new SaveFormatError('save has too many chunks');
  const chunks: SavedChunk[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < count; i++) {
    const cx = r.i32();
    const cz = r.i32();
    if (Math.abs(cx) > MAX_CHUNK_COORD || Math.abs(cz) > MAX_CHUNK_COORD) throw new SaveFormatError('chunk coordinate out of range');
    const top = r.u16() - 1;
    if (top >= HEIGHT) throw new SaveFormatError('chunk height out of range');
    const bits = r.u8();
    const palLen = r.u32();
    if (palLen < 1 || palLen > 65536) throw new SaveFormatError('chunk palette out of range');
    const palette = new Uint16Array(r.bytes(palLen * 2).buffer);
    const wordLen = r.u32();
    if (wordLen > (HEIGHT * 256 * 16) / 32) throw new SaveFormatError('chunk data too large');
    const words = new Uint32Array(r.bytes(wordLen * 4).buffer);
    const data = ChunkData.fromPacked({ palette, bits, words }, maxBlockId);
    if (!data) throw new SaveFormatError('chunk data is corrupt');
    const id = `${cx},${cz}`;
    if (seen.has(id)) throw new SaveFormatError('chunk saved twice');
    seen.add(id);
    chunks.push({ cx, cz, top, data });
  }
  return { meta: meta.data, chunks };
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream, cap: number): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  void writer.write(bytes as unknown as BufferSource).then(() => writer.close()).catch(() => undefined);
  const reader = stream.readable.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > cap) {
      await reader.cancel().catch(() => undefined);
      throw new SaveFormatError('save is too large once decompressed');
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Header byte of a stored save: 0 raw, 1 deflate-raw. */
const STORED_RAW = 0;
const STORED_DEFLATE = 1;

/** Encode a save for storage / download (compressed when possible). */
export async function encodeSave(save: VoxelSave): Promise<Uint8Array> {
  const raw = encodeSaveRaw(save);
  if (!canCompress()) {
    const out = new Uint8Array(raw.length + 1);
    out[0] = STORED_RAW;
    out.set(raw, 1);
    return out;
  }
  const packed = await pipe(raw, new CompressionStream('deflate-raw'), MAX_SAVE_BYTES);
  const out = new Uint8Array(packed.length + 1);
  out[0] = STORED_DEFLATE;
  out.set(packed, 1);
  return out;
}

/** Decode a stored save (see {@link encodeSave}). Throws {@link SaveFormatError}. */
export async function decodeSave(bytes: Uint8Array, maxBlockId: number): Promise<VoxelSave> {
  if (!(bytes instanceof Uint8Array) || bytes.length < 2) throw new SaveFormatError('not a world save');
  if (bytes.length > MAX_SAVE_BYTES) throw new SaveFormatError('save is too large');
  const mode = bytes[0];
  const body = bytes.subarray(1);
  if (mode === STORED_RAW) return decodeSaveRaw(body, maxBlockId);
  if (mode !== STORED_DEFLATE) throw new SaveFormatError('not a world save');
  if (!canCompress()) throw new SaveFormatError('this browser cannot read compressed saves');
  let raw: Uint8Array;
  try {
    raw = await pipe(body, new DecompressionStream('deflate-raw'), MAX_SAVE_BYTES);
  } catch (err) {
    if (err instanceof SaveFormatError) throw err;
    throw new SaveFormatError('save data is corrupt');
  }
  return decodeSaveRaw(raw, maxBlockId);
}

/** Encode one chunk record for per-chunk storage (IndexedDB rows). */
export async function encodeChunk(c: SavedChunk): Promise<Uint8Array> {
  return encodeSave({ meta: { terrain: '', savedAt: 0, player: null }, chunks: [c] });
}

/** Decode one chunk record. */
export async function decodeChunk(bytes: Uint8Array, maxBlockId: number): Promise<SavedChunk> {
  const s = await decodeSave(bytes, maxBlockId);
  const c = s.chunks[0];
  if (!c || s.chunks.length !== 1) throw new SaveFormatError('not a chunk record');
  return c;
}
