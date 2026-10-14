/**
 * The voxel worker's message handler, independent of the worker global so
 * it can run inline (no module workers, Node tests) with identical
 * behaviour. One {@link VoxelJobContext} is kept per terrain key; a reply
 * always echoes the key it was computed for, so the main thread drops
 * results that belong to an outdated configuration.
 */
import { ChunkData } from '../chunk';
import { VoxelJobContext } from '../jobs';
import { asIdentity, meshTransfer, packedTransfer, ToWorker, type FromWorker } from '../protocol';

/** A reply plus the buffers to transfer with it. */
export interface WorkerReply {
  message: FromWorker;
  transfer: ArrayBuffer[];
}

/** Most terrain configurations kept compiled at once. */
const MAX_CONTEXTS = 2;

/** Stateful handler: feed it messages, post its replies. */
export class VoxelWorkerHandler {
  private readonly contexts = new Map<string, VoxelJobContext>();

  private context(key: string): VoxelJobContext | undefined {
    return this.contexts.get(key);
  }

  /** Handle one raw message; returns the reply (null for `config`, which has none) or an error reply. */
  handle(raw: unknown): WorkerReply | null {
    const parsed = ToWorker.safeParse(raw);
    if (!parsed.success) {
      const id = typeof raw === 'object' && raw !== null && typeof (raw as { id?: unknown }).id === 'number' ? Math.max(0, Math.floor((raw as { id: number }).id)) : 0;
      return { message: { type: 'error', id, message: 'malformed voxel job' }, transfer: [] };
    }
    const msg = parsed.data;
    try {
      if (msg.type === 'config') {
        if (!this.contexts.has(msg.key)) {
          const ctx = new VoxelJobContext(asIdentity(msg.identity));
          this.contexts.set(msg.key, ctx);
          while (this.contexts.size > MAX_CONTEXTS) this.contexts.delete(this.contexts.keys().next().value as string);
        }
        return null;
      }
      const ctx = this.context(msg.key);
      if (!ctx) return { message: { type: 'error', id: msg.id, message: 'unknown terrain configuration' }, transfer: [] };
      const t0 = now();
      if (msg.type === 'generate') {
        const { chunk, top } = ctx.generate(msg.cx, msg.cz);
        const packed = chunk.pack();
        return { message: { type: 'generated', id: msg.id, key: msg.key, chunk: packed, top, ms: now() - t0 }, transfer: packedTransfer(packed) };
      }
      const chunks: Array<ChunkData | null> = [];
      for (const p of msg.chunks) {
        if (!p) {
          chunks.push(null);
          continue;
        }
        const c = ChunkData.fromPacked(p, ctx.reg.size - 1);
        if (!c) return { message: { type: 'error', id: msg.id, message: 'malformed chunk' }, transfer: [] };
        chunks.push(c);
      }
      const mesh = ctx.mesh(chunks, msg.tops);
      return { message: { type: 'meshed', id: msg.id, key: msg.key, mesh, ms: now() - t0 }, transfer: meshTransfer(mesh) };
    } catch (err) {
      return { message: { type: 'error', id: 'id' in msg ? msg.id : 0, message: err instanceof Error ? err.message.slice(0, 500) : 'voxel job failed' }, transfer: [] };
    }
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
