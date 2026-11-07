/**
 * A lightmap bake job as one binary file (`.lbjob`), the form scripts/blender-bake.ts `decodeJob` reads: a bake made outside
 * the page (Cycles or the threaded CPU baker on this computer) from the page's own request (`LightmapController.bakeJob`).
 *
 * Layout: magic `AELJ` (u32 LE), header length (u32 LE), the header JSON, padding to 8 bytes, then every typed array of the
 * job 8-byte aligned. In the header a typed array is `{ $ta: <constructor name>, o: <offset from the data start>, n: <length> }`.
 */

const MAGIC = 0x4a4c4541;

/** The job file of `job` (the key, quality and triangle counts of its `.lmap`, and the worker request). */
export function encodeBakeJob(job: { key: string; quality: string; triCounts: readonly number[]; request: unknown }): Uint8Array {
  const blobs: Array<{ bytes: Uint8Array; o: number }> = [];
  let size = 0;
  const walk = (v: unknown): unknown => {
    if (ArrayBuffer.isView(v)) {
      const bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
      blobs.push({ bytes, o: size });
      const ref = { $ta: v.constructor.name, o: size, n: (v as unknown as { length: number }).length };
      size += Math.ceil(bytes.length / 8) * 8;
      return ref;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  const head = new TextEncoder().encode(JSON.stringify(walk({ key: job.key, quality: job.quality, triCounts: job.triCounts, request: job.request })));
  const start = Math.ceil((8 + head.length) / 8) * 8;
  const out = new Uint8Array(start + size);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, head.length, true);
  out.set(head, 8);
  for (const b of blobs) out.set(b.bytes, start + b.o);
  return out;
}
