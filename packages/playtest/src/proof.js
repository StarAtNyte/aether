/**
 * The proof of a playtest: what travels with a share link or a published
 * game so a viewer can replay the bot's run or re-run it.
 *
 * A proof is **bound to the world's gameplay content** by a hash (the parts
 * that decide whether the game works: entities' pose, shape, physics and
 * behaviours, the rules, the state, the player and the physics environment —
 * not colours, names or lighting). A viewer recomputes the hash; if it does
 * not match, the proof is stale and is shown as such. The hash is an
 * integrity check, not a signature: only re-running the bot (which anyone
 * can do in the browser) is a proof of its own.
 *
 * The wire form is a small zod-validated JSON object with the trace
 * quantised to 16-bit integers (≈ 8 bytes a frame) in base64.
 */
import { z } from 'zod';
import { hashString, stableStringify } from '@aether/core';
import { PLAYTEST_LIMITS, TRACE_STRIDE } from './types';
/** Bot version: bump when a change in the bot can change a verdict. */
export const BOT_VERSION = 1;
/** Which bot a world needs: a building is walked room by room, anything else is played. */
export function playtestKindOf(world) {
    for (const id in world.entities)
        if (world.entities[id]?.arch?.role === 'building')
            return 'walkthrough';
    return 'game';
}
/** Hash of the gameplay-relevant content of a world (16 hex characters). */
export function hashWorld(world) {
    const entities = {};
    for (const id of Object.keys(world.entities).sort()) {
        const e = world.entities[id];
        entities[id] = { p: e.parent, t: e.transform, s: e.shape, ph: e.physics, j: e.joint, b: e.behaviors, st: e.state, tp: e.template, n: e.npc };
    }
    const gameplay = {
        entities,
        rules: world.rules,
        state: world.state,
        player: world.player,
        gravity: world.environment.gravity,
        ground: world.environment.ground === null ? null : world.environment.ground.size,
        generators: world.generators,
        scripts: world.scripts,
        meshes: Object.keys(world.meshes).sort(),
        voxel: world.voxel === undefined ? null : true,
        seed: world.seed,
    };
    const text = stableStringify(gameplay);
    const a = hashString(text);
    const b = hashString(`${text.length}|${text}`);
    return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}
// ---------------------------------------------------------------------------
// Wire format
// ---------------------------------------------------------------------------
const Vec3Wire = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const EventWire = z.object({
    t: z.number().finite().min(0).max(100_000),
    kind: z.enum(['pickup', 'door', 'goal', 'fall', 'stuck', 'room', 'win', 'lose', 'start']),
    label: z.string().max(80),
    position: Vec3Wire,
});
/** Compact trace on the wire. */
export const TraceWire = z.object({
    dt: z.number().finite().min(1 / 60).max(1),
    frames: z.number().int().min(2).max(PLAYTEST_LIMITS.MAX_TRACE_FRAMES + 1),
    /** Bounding box used to quantise: min then max of x, y, z. */
    box: z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]),
    /** Base64 of `frames × 4` little-endian uint16 (x, y, z in the box, yaw 0..360). */
    data: z.string().max(PLAYTEST_LIMITS.MAX_TRACE_FRAMES * 11 + 64).regex(/^[A-Za-z0-9+/]*={0,2}$/),
    events: z.array(EventWire).max(400),
});
const ObjectiveWire = z.object({
    id: z.string().max(120),
    label: z.string().max(120),
    kind: z.enum(['collect', 'goal', 'zone', 'room', 'plate', 'talk', 'press']),
    status: z.enum(['done', 'unreachable', 'blocked', 'untouched', 'pending']),
    required: z.boolean(),
    at: z.number().finite().optional(),
});
/** The proof as stored in share links and published builds. */
export const ProofWire = z.object({
    v: z.literal(1),
    bot: z.number().int().min(1).max(1000),
    kind: z.enum(['game', 'walkthrough']),
    status: z.enum(['passed', 'failed', 'inconclusive', 'unsupported']),
    worldHash: z.string().regex(/^[0-9a-f]{16}$/),
    seconds: z.number().finite().min(0).max(100_000),
    steps: z.number().int().min(0).max(100_000_000),
    summary: z.string().max(400),
    objectives: z.array(ObjectiveWire).max(PLAYTEST_LIMITS.MAX_OBJECTIVES),
    /** Failure messages (empty when passed). */
    issues: z.array(z.string().max(300)).max(PLAYTEST_LIMITS.MAX_FINDINGS),
    falls: z.number().int().min(0).max(10_000),
    trace: TraceWire.optional(),
    /** Wall-clock time of the original run in ms (informational). */
    ms: z.number().finite().min(0).max(10_000_000),
});
function b64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000)
        bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
}
function unb64(text) {
    const bin = atob(text);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++)
        out[i] = bin.charCodeAt(i);
    return out;
}
function packTrace(t) {
    const n = t.frames;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let f = 0; f < n; f++) {
        for (let k = 0; k < 3; k++) {
            const v = t.poses[f * TRACE_STRIDE + k];
            if (v < min[k])
                min[k] = v;
            if (v > max[k])
                max[k] = v;
        }
    }
    const span = [0, 1, 2].map((k) => Math.max(1e-3, max[k] - min[k]));
    const buf = new Uint8Array(n * TRACE_STRIDE * 2);
    const dv = new DataView(buf.buffer);
    for (let f = 0; f < n; f++) {
        for (let k = 0; k < 3; k++) {
            const q = Math.round(((t.poses[f * TRACE_STRIDE + k] - min[k]) / span[k]) * 65535);
            dv.setUint16((f * TRACE_STRIDE + k) * 2, Math.max(0, Math.min(65535, q)), true);
        }
        const yaw = ((t.poses[f * TRACE_STRIDE + 3] % 360) + 360) % 360;
        dv.setUint16((f * TRACE_STRIDE + 3) * 2, Math.round((yaw / 360) * 65535), true);
    }
    const events = t.events.slice(0, 400).map((e) => ({ t: e.t, kind: e.kind, label: e.label, position: [e.position[0], e.position[1], e.position[2]] }));
    return { dt: t.dt, frames: n, box: [min[0], min[1], min[2], max[0], max[1], max[2]], data: b64(buf), events };
}
/** Make the compact, validated proof of a report. */
export function toProof(report) {
    const proof = {
        v: 1,
        bot: BOT_VERSION,
        kind: report.kind,
        status: report.status,
        worldHash: report.worldHash,
        seconds: Math.round(report.seconds * 100) / 100,
        steps: report.steps,
        summary: report.summary.slice(0, 400),
        objectives: report.objectives.slice(0, PLAYTEST_LIMITS.MAX_OBJECTIVES).map((o) => ({ id: o.id.slice(0, 120), label: o.label.slice(0, 120), kind: o.kind, status: o.status, required: o.required, ...(o.at !== undefined ? { at: o.at } : {}) })),
        issues: report.findings.filter((f) => f.severity !== 'info').slice(0, PLAYTEST_LIMITS.MAX_FINDINGS).map((f) => f.message.slice(0, 300)),
        falls: report.falls,
        ms: Math.round(report.wallMs),
    };
    if (report.trace)
        proof.trace = packTrace(report.trace);
    return proof;
}
/** Validate untrusted proof data (a share link, a manifest). Returns null when malformed. */
export function parseProof(raw) {
    const r = ProofWire.safeParse(raw);
    if (!r.success)
        return null;
    const p = r.data;
    if (p.trace) {
        const bytes = Math.floor((p.trace.data.length * 3) / 4) - (p.trace.data.endsWith('==') ? 2 : p.trace.data.endsWith('=') ? 1 : 0);
        if (bytes !== p.trace.frames * TRACE_STRIDE * 2)
            return null;
    }
    return p;
}
/** Decode a wire trace back to floats (null when malformed). */
function unpackTrace(t) {
    let bytes;
    try {
        bytes = unb64(t.data);
    }
    catch {
        return null;
    }
    if (bytes.length !== t.frames * TRACE_STRIDE * 2)
        return null;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const poses = new Float32Array(t.frames * TRACE_STRIDE);
    for (let f = 0; f < t.frames; f++) {
        for (let k = 0; k < 3; k++) {
            const lo = t.box[k];
            const hi = t.box[k + 3];
            poses[f * TRACE_STRIDE + k] = lo + (dv.getUint16((f * TRACE_STRIDE + k) * 2, true) / 65535) * Math.max(1e-3, hi - lo);
        }
        poses[f * TRACE_STRIDE + 3] = (dv.getUint16((f * TRACE_STRIDE + 3) * 2, true) / 65535) * 360;
    }
    return { dt: t.dt, frames: t.frames, poses, events: t.events.map((e) => ({ t: e.t, kind: e.kind, label: e.label, position: [e.position[0], e.position[1], e.position[2]] })) };
}
/** Decode a proof's trace back to floats (null when absent or malformed). */
export function proofTrace(proof) {
    return proof.trace ? unpackTrace(proof.trace) : null;
}
// ---------------------------------------------------------------------------
// Evidence: the bot's winning run as carried inside a sealed replay proof
// ---------------------------------------------------------------------------
/** Caps of the evidence trace: a sealed proof must stay small enough for a share link. */
export const EVIDENCE_LIMITS = Object.freeze({ MAX_FRAMES: 400, MAX_EVENTS: 20 });
/**
 * The bot's winning run, in the compact form that is embedded in (and hashed
 * and signed with) an `@aether/verifier` replay proof. Only a passed run
 * becomes evidence. `worldHash` is {@link hashWorld} of the gameplay content;
 * the seal's own content hash binds the whole world on top of it.
 */
export const EvidenceWire = z
    .object({
    v: z.literal(1),
    bot: z.number().int().min(1).max(1000),
    kind: z.enum(['game', 'walkthrough']),
    status: z.literal('passed'),
    worldHash: z.string().regex(/^[0-9a-f]{16}$/),
    seconds: z.number().finite().min(0).max(100_000),
    steps: z.number().int().min(0).max(100_000_000),
    summary: z.string().max(400),
    objectives: z.object({ done: z.number().int().min(0).max(PLAYTEST_LIMITS.MAX_OBJECTIVES), total: z.number().int().min(0).max(PLAYTEST_LIMITS.MAX_OBJECTIVES) }).strict(),
    falls: z.number().int().min(0).max(10_000),
    trace: TraceWire.optional(),
})
    .strict();
/** Keep about `max` frames of a trace (every n-th, always the last) and at most `maxEvents` events. */
export function thinTrace(t, max = EVIDENCE_LIMITS.MAX_FRAMES, maxEvents = EVIDENCE_LIMITS.MAX_EVENTS) {
    const stride = Math.max(1, Math.ceil(t.frames / max));
    const keep = [];
    for (let f = 0; f < t.frames; f += stride)
        keep.push(f);
    if (keep[keep.length - 1] !== t.frames - 1)
        keep.push(t.frames - 1);
    const poses = new Float32Array(keep.length * TRACE_STRIDE);
    keep.forEach((f, i) => poses.set(t.poses.subarray(f * TRACE_STRIDE, (f + 1) * TRACE_STRIDE), i * TRACE_STRIDE));
    let events = t.events;
    if (events.length > maxEvents) {
        const step = events.length / maxEvents;
        events = Array.from({ length: maxEvents }, (_, i) => events[Math.min(events.length - 1, Math.floor(i * step))]);
        const win = t.events.find((e) => e.kind === 'win');
        if (win && !events.includes(win))
            events[events.length - 1] = win;
    }
    return { dt: Math.min(1, t.dt * stride), frames: keep.length, poses, events };
}
/** Evidence of a passed run (null for any other verdict). The trace is thinned to travel in a link. */
export function toEvidence(proof) {
    if (proof.status !== 'passed')
        return null;
    const trace = proofTrace(proof);
    const done = proof.objectives.filter((o) => o.status === 'done').length;
    const ev = {
        v: 1,
        bot: proof.bot,
        kind: proof.kind,
        status: 'passed',
        worldHash: proof.worldHash,
        seconds: proof.seconds,
        steps: proof.steps,
        summary: proof.summary.slice(0, 400),
        objectives: { done, total: proof.objectives.length },
        falls: proof.falls,
        ...(trace && trace.frames >= 2 ? { trace: packTrace(thinTrace(trace)) } : {}),
    };
    return ev;
}
/** The evidence's run as a ghost trace (null when it carries none or it is malformed). */
export function evidenceTrace(ev) {
    return ev.trace ? unpackTrace(ev.trace) : null;
}
/** Plain sentence about a piece of evidence ("A bot played it to the end in 41 s, reaching 6 of 6 goals."). */
export function evidenceSentence(ev) {
    const walk = ev.kind === 'walkthrough';
    const secs = Math.round(ev.seconds);
    return `A bot ${walk ? 'walked every room' : 'played it to the win'} in ${secs} s of play (${ev.objectives.done} of ${ev.objectives.total} ${walk ? 'rooms' : 'goals'} reached).`;
}
/** `fresh` when the proof was made for exactly this gameplay content. */
export function proofFreshness(proof, world) {
    return proof.worldHash === hashWorld(world) ? 'fresh' : 'stale';
}
/** True when a proof may be shown with a green badge: a passed run on this very world. */
export function proofIsGreen(proof, world) {
    return proof.status === 'passed' && proofFreshness(proof, world) === 'fresh';
}
