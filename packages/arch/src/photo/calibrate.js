import { customPose, entityGeometry, projectGeometry } from '../scene/views';
import { verticalFov } from './camera';
import { PHOTO_BUILDING_ID, PHOTO_ROOM_ID } from './derive';
/** Targets of a description: every visible piece and opening that has a box. `built` maps plan opening ids to built ids. */
export function framingTargets(d, built) {
    const out = [];
    for (const o of d.openings) {
        const id = built[o.id];
        if (o.visible && o.box && id)
            out.push({ label: o.id, ids: [id], box: o.box });
    }
    for (const it of d.items) {
        if (!it.visible || !it.box)
            continue;
        const base = `${PHOTO_BUILDING_ID}-${it.id}`;
        out.push({ label: it.id, ids: it.kind === 'curtain' ? [`${base}-l`, `${base}-r`] : [base], box: it.box });
    }
    return out;
}
function union(boxes) {
    if (boxes.length === 0)
        return null;
    return [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])), Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))];
}
/** Error of one box against the wanted one: mean absolute edge offset, doubled and capped at 1. */
export function boxError(want, got) {
    if (!got)
        return 1;
    const e = (Math.abs(want[0] - got[0]) + Math.abs(want[1] - got[1]) + Math.abs(want[2] - got[2]) + Math.abs(want[3] - got[3])) / 4;
    return Math.min(1, e * 2);
}
/** Framing of precomputed geometry seen through `pose`. */
export function framingOf(geometry, targets, pose, aspect) {
    const boxes = projectGeometry(geometry, pose, aspect);
    const rows = targets.map((t) => {
        const got = union(t.ids.map((id) => boxes.get(id)).filter((b) => b !== undefined));
        return { label: t.label, error: boxError(t.box, got), want: t.box, got };
    });
    return { score: rows.length === 0 ? 1 : 1 - rows.reduce((s, r) => s + r.error, 0) / rows.length, rows };
}
/** Fewest targets that make a fit meaningful (a camera has six degrees of freedom). */
export const MIN_FRAMING_TARGETS = 4;
/** Deterministic pseudo-random numbers (the fit must give the same answer for the same room). */
function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}
/**
 * Refine the photo's camera so the built room frames like the photo. A pattern search from the reported camera and
 * from perturbations of it (deterministic), bounded to plausible cameras inside the room, with a small pull toward
 * the reported values so a few targets cannot send the camera anywhere odd. Returns null when there are too few
 * targets or the room cannot be read.
 */
export function calibrateCamera(world, d, aspect, targets) {
    if (targets.length < MIN_FRAMING_TARGETS)
        return null;
    const geometry = entityGeometry(world, PHOTO_BUILDING_ID);
    if (geometry.length === 0)
        return null;
    const W = d.footprint.width;
    const D = d.footprint.depth;
    const c0 = d.camera;
    const start = [c0.x, c0.z, c0.heading, c0.pitch, c0.fov, c0.height];
    const lo = [0.15, 0.15, c0.heading - 50, -14, Math.max(45, c0.fov - 30), 0.9];
    const hi = [W - 0.15, D - 0.15, c0.heading + 50, 14, Math.min(115, c0.fov + 30), Math.min(2.1, d.footprint.ceiling - 0.3)];
    const scale = [W, D, 60, 14, 40, 1];
    const poseOf = (p) => customPose(world, PHOTO_BUILDING_ID, { name: 'fit', label: 'fit', room: PHOTO_ROOM_ID, at: [p[0], p[1]], height: p[5], heading: p[2], pitch: p[3], fov: verticalFov(p[4], aspect) });
    const cost = (p) => {
        const pose = poseOf(p);
        if (!pose)
            return 9;
        const r = framingOf(geometry, targets, pose, aspect);
        let pull = 0;
        for (let i = 0; i < 6; i++)
            pull += ((p[i] - start[i]) / scale[i]) ** 2;
        return 1 - r.score + 0.02 * pull;
    };
    const clamp = (p) => p.map((v, i) => Math.max(lo[i], Math.min(hi[i], v)));
    const refine = (from) => {
        let p = clamp(from);
        let c = cost(p);
        const step = [0.4, 0.4, 8, 3, 6, 0.15];
        for (let iter = 0; iter < 60; iter++) {
            let moved = false;
            for (let i = 0; i < 6; i++) {
                for (const dir of [1, -1]) {
                    const q = [...p];
                    q[i] = q[i] + dir * step[i];
                    const cq = clamp(q);
                    const cc = cost(cq);
                    if (cc < c - 1e-6) {
                        p = cq;
                        c = cc;
                        moved = true;
                    }
                }
            }
            if (!moved) {
                for (let i = 0; i < 6; i++)
                    step[i] = step[i] / 2;
                if (step[0] < 0.01)
                    break;
            }
        }
        return { p, c };
    };
    const rand = rng(1234567);
    let best = refine(start);
    for (let k = 0; k < 24; k++) {
        const jitter = start.map((v, i) => v + (rand() - 0.5) * 2 * scale[i] * 0.25);
        const r = refine(jitter);
        if (r.c < best.c)
            best = r;
    }
    const poseBefore = poseOf(start);
    const poseAfter = poseOf(best.p);
    if (!poseBefore || !poseAfter)
        return null;
    const before = framingOf(geometry, targets, poseBefore, aspect);
    const after = framingOf(geometry, targets, poseAfter, aspect);
    const camera = { x: round(best.p[0], 2), z: round(best.p[1], 2), heading: round(best.p[2], 1), pitch: round(best.p[3], 1), fov: round(best.p[4], 1), height: round(best.p[5], 2) };
    return { camera, before, after, improved: after.score > before.score + 0.03 };
}
function round(v, n) {
    const m = 10 ** n;
    return Math.round(v * m) / m;
}
/** Plain-text lines for the model: the worst boxes, where the photo has them and where the render does. */
export function framingText(r, limit = 8) {
    const pct = (b) => `x ${Math.round(b[0] * 100)}–${Math.round(b[2] * 100)}%, y ${Math.round(b[1] * 100)}–${Math.round(b[3] * 100)}%`;
    const worst = r.rows.filter((x) => x.error > 0.12).sort((a, b) => b.error - a.error).slice(0, limit);
    if (worst.length === 0)
        return `Framing: everything the photo shows is where the photo has it (score ${Math.round(r.score * 100)}%).`;
    return [
        `Framing score ${Math.round(r.score * 100)}% (the camera is already fitted as well as it can be to where the photo shows things; what is left is a piece in the wrong place or of the wrong size). Worst, as image boxes (% of the picture width and height):`,
        ...worst.map((x) => `- ${x.label}: photo ${pct(x.want)}; render ${x.got ? pct(x.got) : 'not in the picture'}`),
    ].join('\n');
}
