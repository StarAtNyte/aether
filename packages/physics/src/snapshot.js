/**
 * Snapshot container: `MAGIC | u32 metaLength | meta JSON (UTF-8) | Rapier snapshot`.
 * The meta block carries the handle ↔ entity maps that Rapier's own snapshot
 * does not know about. Snapshots are treated as untrusted input on restore:
 * sizes are bounded and the meta block is zod-validated.
 */
import { z } from 'zod';
import { Entity, inspectUntrusted, Vec3 } from '@aether/core';
const MAGIC = new Uint8Array([0x41, 0x45, 0x50, 0x48, 0x59, 0x53, 0x00, 0x01]); // "AEPHYS\0\1"
const HEADER = MAGIC.length + 4;
/** Upper bound for the meta block (entity maps + runtime-spawned entities). */
export const MAX_META_BYTES = 32 * 1024 * 1024;
const Handle = z.number();
/** Serialized body record. */
export const BodyMeta = z.object({
    id: z.string().min(1).max(128),
    body: Handle,
    colliders: z.array(Handle).max(100_000),
    sensors: z.array(Handle).max(100_000),
    joint: Handle.nullable(),
    anchor: Handle.nullable(),
    jointTarget: z.string().max(128).nullable(),
    type: z.enum(['static', 'dynamic', 'kinematic']),
    scale: Vec3,
    /** Present for runtime-spawned entities (not in the WorldDoc). */
    entity: Entity.optional(),
});
/** Serialized PhysicsWorld state outside of Rapier. */
export const SnapshotMeta = z.object({
    v: z.literal(1),
    fixedDt: z.number().positive().max(1),
    steps: z.number().int().min(0),
    accumulator: z.number().min(0).max(1),
    ground: z.object({ body: Handle, colliders: z.array(Handle).max(1024), size: z.number().positive() }).nullable(),
    bodies: z.array(BodyMeta).max(100_000),
    externals: z.array(z.object({ handle: Handle, id: z.string().min(1).max(128) })).max(10_000),
    contacts: z.array(z.tuple([z.string().max(300), z.number().int().min(0)])).max(1_000_000),
});
/** Pack meta + Rapier bytes into one buffer. */
export function encodeSnapshot(meta, rapierBytes) {
    const json = new TextEncoder().encode(JSON.stringify(meta));
    if (json.length > MAX_META_BYTES)
        throw new RangeError('physics snapshot meta too large');
    const out = new Uint8Array(HEADER + json.length + rapierBytes.length);
    out.set(MAGIC, 0);
    new DataView(out.buffer, out.byteOffset, out.byteLength).setUint32(MAGIC.length, json.length, true);
    out.set(json, HEADER);
    out.set(rapierBytes, HEADER + json.length);
    return out;
}
/**
 * Split and validate a snapshot buffer.
 * @throws Error for anything that is not a well-formed snapshot of this version.
 */
export function decodeSnapshot(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length < HEADER)
        throw new Error('invalid physics snapshot: too short');
    for (let i = 0; i < MAGIC.length; i++)
        if (bytes[i] !== MAGIC[i])
            throw new Error('invalid physics snapshot: bad magic');
    const len = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(MAGIC.length, true);
    if (len > MAX_META_BYTES || HEADER + len > bytes.length)
        throw new Error('invalid physics snapshot: bad meta length');
    let raw;
    try {
        raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(HEADER, HEADER + len)));
    }
    catch {
        throw new Error('invalid physics snapshot: meta is not JSON');
    }
    const guard = inspectUntrusted(raw);
    if (!guard.ok)
        throw new Error(`invalid physics snapshot: ${guard.message}`);
    const parsed = SnapshotMeta.safeParse(raw);
    if (!parsed.success)
        throw new Error('invalid physics snapshot: meta failed validation');
    const rapierBytes = bytes.slice(HEADER + len);
    if (rapierBytes.length === 0)
        throw new Error('invalid physics snapshot: missing world data');
    return { meta: parsed.data, rapierBytes };
}
