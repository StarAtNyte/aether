/**
 * Birds from one anatomy: a sculpted body, neck and head, a beak, legs, a fanned tail and three-segment wings built
 * from overlapping feather plates. The bind pose has the wings spread; the perched clip folds them against the body, the
 * fly clip flaps them (shoulder, elbow and wrist lag behind each other so the tip whips), the glide clip holds them out.
 * Songbird, crow, gull, hawk, duck and parrot differ by numbers.
 */
import { cone, ellipsoid, sphere } from './sdf';
import { fbm, lin, mixc, noise3, occlusion, sstep } from './living-kit';
import { ellipsoid as ellipsoidMesh, loft, merge, move, rotX, rotY, rotZ } from './vehicle-geo';
import { leaf, tubeMesh } from './living-parts';
const TAU = Math.PI * 2;
const sin = Math.sin;
const half = (x) => x / 2;
/** Build a bird. */
export function bird(s) {
    // Posture: body axis tilted up in front (perched) -- bind pose is the flight posture, level.
    const L = s.body;
    const H = s.leg + s.bodyH * 0.9;
    const bones = [];
    const bone = (name, parent, at) => void bones.push({ name, parent, at });
    bone('root', null, [0, H, 0]);
    bone('body', 'root', [0, H, 0]);
    bone('neck', 'body', [L * 0.42, H + s.bodyH * 0.35, 0]);
    const headAt = [L * 0.42 + s.neck * 0.8, H + s.bodyH * 0.35 + s.neck * 0.55, 0];
    bone('head', 'neck', headAt);
    bone('tail', 'body', [-L * 0.45, H + s.bodyH * 0.05, 0]);
    for (const side of [1, -1]) {
        const k = side === 1 ? 'R' : 'L';
        const sh = [L * 0.12, H + s.bodyH * 0.55, side * s.bodyW * 0.7];
        const el = [sh[0] - s.span * 0.04, sh[1], side * (s.bodyW * 0.7 + s.span * 0.42)];
        const wr = [el[0] - s.span * 0.08, el[1], side * (s.bodyW * 0.7 + s.span * 0.72)];
        bone(`wing${k}1`, 'body', sh);
        bone(`wing${k}2`, `wing${k}1`, el);
        bone(`wing${k}3`, `wing${k}2`, wr);
        const hip = [-L * 0.02, H - s.bodyH * 0.6, side * s.bodyW * 0.55];
        bone(`leg${k}1`, 'body', hip);
        bone(`leg${k}2`, `leg${k}1`, [hip[0] + s.leg * 0.12, hip[1] - s.leg * 0.5, hip[2]]);
    }
    const prims = [];
    prims.push(ellipsoid('body', [0, H, 0], [L * 0.5, s.bodyH, s.bodyW], 0.0, 0, { k: 0.02 }));
    prims.push(ellipsoid('body', [L * 0.27, H + s.bodyH * 0.12, 0], [L * 0.3, s.bodyH * 1.08, s.bodyW * 1.04], 0.1, 0, { k: 0.02 }));
    prims.push(ellipsoid('body', [-L * 0.3, H + s.bodyH * 0.05, 0], [L * 0.3, s.bodyH * 0.7, s.bodyW * 0.66], -0.12, 0, { k: 0.02 }));
    const nb = [L * 0.42, H + s.bodyH * 0.35, 0];
    prims.push(cone('neck', nb, headAt, s.bodyW * 0.62, s.head * 0.82, { k: 0.02 }));
    const hc = [headAt[0] + s.head * 0.2, headAt[1] + s.head * 0.1, 0];
    prims.push(sphere('head', hc, s.head, { k: 0.015 }));
    prims.push(ellipsoid('head', [hc[0] + s.head * 0.35, hc[1] - s.head * 0.1, 0], [s.head * 0.8, s.head * 0.7, s.head * 0.78], 0, 0, { k: 0.01 }));
    for (const side of [1, -1])
        prims.push(sphere('head', [hc[0] + s.head * 0.35, hc[1] + s.head * 0.2, side * s.head * 0.88], s.head * 0.22, { carve: true, k: 0.006 }));
    const rigid = [];
    // Beak: an upper and a lower cone, colour 'beak'.
    const bx = hc[0] + s.head * 0.9;
    const by = hc[1] - s.head * 0.15;
    const upper = ellipsoidMesh(bx + s.beak * 0.42, by + s.beakH * 0.12, 0, s.beak * 0.6, s.beakH * 0.62, s.beakH * 0.75, 8, 12);
    const lower = ellipsoidMesh(bx + s.beak * 0.36, by - s.beakH * 0.34, 0, s.beak * 0.5, s.beakH * 0.34, s.beakH * 0.58, 8, 12);
    rigid.push({ bone: 'head', mat: 'beak', geo: upper });
    rigid.push({ bone: 'head', mat: 'beak', geo: lower });
    if (s.hook)
        rigid.push({ bone: 'head', mat: 'beak', geo: ellipsoidMesh(bx + s.beak * 0.95, by - s.beakH * 0.12, 0, s.beak * 0.14, s.beakH * 0.42, s.beakH * 0.5, 8, 10) });
    for (const side of [1, -1]) {
        rigid.push({ bone: 'head', mat: 'eye', geo: ellipsoidMesh(hc[0] + s.head * 0.35, hc[1] + s.head * 0.2, side * s.head * 0.86, s.head * 0.2, s.head * 0.2, s.head * 0.17, 8, 10) });
    }
    // Tail: a fan of five feathers.
    const tailGeo = [];
    for (let i = 0; i < 5; i++) {
        const f = leaf(s.tail, s.tailW * 0.75, 0.0025, true);
        rotY(f, Math.PI);
        rotY(f, (i - 2) * 0.2);
        move(f, -L * 0.45, H + s.bodyH * 0.02, 0);
        tailGeo.push(f);
    }
    rigid.push({ bone: 'tail', mat: 'feather', geo: merge(...tailGeo), paint: (p) => mixTail(p) });
    const mixTail = (p) => {
        const t = Math.min(1, Math.max(0, (-L * 0.45 - p[0]) / s.tail));
        return mixc(lin(s.coat.tail), mixc(lin(s.coat.tail), [0.04, 0.035, 0.03], 0.5), sstep(0.6, 1, t));
    };
    // Legs: thin tubes with three forward toes.
    for (const side of [1, -1]) {
        const k = side === 1 ? 'R' : 'L';
        const hip = [-L * 0.02, H - s.bodyH * 0.6, side * s.bodyW * 0.55];
        const knee = [hip[0] + s.leg * 0.12, hip[1] - s.leg * 0.5, hip[2]];
        const foot = [knee[0] - s.leg * 0.02, 0.004, hip[2]];
        rigid.push({ bone: `leg${k}1`, mat: 'leg', geo: tubeMesh([hip, knee], s.legR * 1.3, s.legR, 6) });
        rigid.push({ bone: `leg${k}2`, mat: 'leg', geo: tubeMesh([knee, foot], s.legR, s.legR * 0.8, 6) });
        for (const a of [-0.5, 0, 0.5]) {
            const toe = [foot[0] + Math.cos(a) * s.leg * 0.22, 0.004, foot[2] + Math.sin(a) * s.leg * 0.22];
            rigid.push({ bone: `leg${k}2`, mat: 'leg', geo: tubeMesh([foot, toe], s.legR * 0.7, s.legR * 0.45, 5) });
        }
    }
    // Wings: inner, middle and hand plates; the hand plate carries a fan of primaries.
    for (const side of [1, -1]) {
        const k = side === 1 ? 'R' : 'L';
        const sh = bones.find((b) => b.name === `wing${k}1`)?.at;
        const el = bones.find((b) => b.name === `wing${k}2`)?.at;
        const wr = bones.find((b) => b.name === `wing${k}3`)?.at;
        const plate = (a, b, c0, c1, thick, bn, mat) => {
            const len = Math.abs(b[2] - a[2]);
            const m = loft([{ x: 0, hw: thick / 2, y0: -c0 * 0.5, y1: c0 * 0.5, e: 7 }, { x: len * 0.5, hw: thick / 2, y0: -(c0 + c1) * 0.25, y1: (c0 + c1) * 0.25, e: 7 }, { x: len, hw: thick / 2, y0: -c1 * 0.5, y1: c1 * 0.5, e: 7 }], { ring: 12 });
            // leaf runs along +X with width in Y: lay it along Z, width along X (chord).
            rotX(m, Math.PI / 2);
            rotY(m, side === 1 ? -Math.PI / 2 : Math.PI / 2);
            // Place so the base is at `a` and the plate trails behind the leading edge.
            move(m, a[0] - (c0 + c1) * 0.2, a[1], a[2]);
            rigid.push({ bone: bn, mat, geo: m, paint: (p) => wingPaint(p, a[2], len, side) });
        };
        const wingPaint = (p, z0, len, sd) => {
            const t = Math.min(1, Math.max(0, ((p[2] - z0) * sd) / len));
            return mixc(lin(s.coat.wing), lin(s.coat.wingTip), 0.5 * (0.2 + 0.8 * t));
        };
        plate(sh, el, s.chord, s.chord * 0.92, 0.004, `wing${k}1`, 'feather');
        plate(el, wr, s.chord * 0.92, s.chord * 0.8, 0.004, `wing${k}2`, 'feather');
        // Hand: primaries fanned from the wrist.
        const prim = [];
        const tipZ = side * (s.bodyW * 0.7 + s.span);
        const handLen = Math.abs(tipZ - wr[2]);
        for (let i = 0; i < 6; i++) {
            const len = handLen * (1 - 0.04 * Math.abs(i - 2));
            const f = leaf(len, s.tipChord * 0.55, 0.003, true);
            rotX(f, Math.PI / 2);
            rotY(f, side === 1 ? -Math.PI / 2 : Math.PI / 2);
            rotY(f, (i - 2) * 0.05 * side);
            move(f, wr[0] - s.chord * (0.36 - i * 0.07), wr[1], wr[2]);
            prim.push(f);
        }
        rigid.push({ bone: `wing${k}3`, mat: 'feather', geo: merge(...prim), paint: (p) => wingPaint(p, wr[2], handLen, side) });
    }
    const coat = (p, n, sc) => {
        const c = s.coat;
        const yRel = (p[1] - (H - s.bodyH)) / (s.bodyH * 2);
        let col = mixc(lin(c.belly), lin(c.back), sstep(0.25, 0.75, yRel * 0.7 + n[1] * 0.4 + 0.15));
        // Head, throat and cap.
        if (p[0] > L * 0.4)
            col = mixc(col, lin(c.head), sstep(L * 0.4, L * 0.6, p[0]) * 0.9);
        if (c.cap)
            col = mixc(col, lin(c.cap), sstep(0.2, 0.7, n[1]) * sstep(L * 0.5, L * 0.6, p[0]));
        if (c.throat)
            col = mixc(col, lin(c.throat), sstep(0.1, 0.7, -n[1]) * sstep(L * 0.42, L * 0.55, p[0]));
        const m = fbm(p[0] * 60, p[1] * 60, p[2] * 60);
        col = mixc(col, mixc(col, lin(c.back), 0.6), (m - 0.45) * (s.streak ?? 0.7));
        // Feather scallops: fine rows along the body.
        const rows = noise3(p[0] * 110, p[1] * 40, p[2] * 40);
        const ao = occlusion(sc, p, n, 0.015);
        const shade = (0.6 + 0.4 * ao) * (0.9 + (rows - 0.5) * 0.18);
        return [col[0] * shade, col[1] * shade, col[2] * shade];
    };
    // ---- Clips ------------------------------------------------------------------------------------------------------
    const flap = (hz, amp) => {
        const dur = 1 / hz;
        const ch = [];
        for (const side of [1, -1]) {
            const k = side === 1 ? 'R' : 'L';
            const sg = -side; // positive roll lifts the left wing, lowers the right
            ch.push({ bone: `wing${k}1`, rot: (u) => [sg * amp * sin(TAU * u), 0, 0.06 * sin(TAU * u + 1)] });
            ch.push({ bone: `wing${k}2`, rot: (u) => [sg * amp * 0.55 * sin(TAU * u - 0.7), 0, 0] });
            ch.push({ bone: `wing${k}3`, rot: (u) => [sg * amp * 0.7 * sin(TAU * u - 1.5), 0, 0.12 * sin(TAU * u - 0.8)] });
        }
        ch.push({ bone: 'root', pos: (u) => [0, 0.18 * s.span * 0.2 * -sin(TAU * u + 0.4), 0] });
        ch.push({ bone: 'body', rot: (u) => [0, 0, 0.05 * sin(TAU * u + 0.5)] });
        ch.push({ bone: 'neck', rot: (u) => [0, 0, 0.03 * sin(TAU * u)] });
        ch.push({ bone: 'tail', rot: (u) => [0, 0, 0.1 * sin(TAU * u - 0.3)] });
        for (const side of [1, -1]) {
            const k = side === 1 ? 'R' : 'L';
            ch.push({ bone: `leg${k}1`, rot: () => [0, 0, -1.1] }, { bone: `leg${k}2`, rot: () => [0, 0, 1.0] });
        }
        return { name: 'fly', duration: dur, channels: ch };
    };
    const glide = {
        name: 'glide',
        duration: 4,
        channels: [
            ...[1, -1].flatMap((side) => {
                const k = side === 1 ? 'R' : 'L';
                return [
                    { bone: `wing${k}1`, rot: (u) => [-side * (0.12 + 0.03 * sin(TAU * u)), 0, 0] },
                    { bone: `wing${k}2`, rot: (u) => [-side * 0.05 * sin(TAU * u + 1), 0, 0] },
                    { bone: `wing${k}3`, rot: (u) => [-side * 0.1 * sin(TAU * u + 2), 0, 0] },
                    { bone: `leg${k}1`, rot: () => [0, 0, -1.1] },
                    { bone: `leg${k}2`, rot: () => [0, 0, 1.0] },
                ];
            }),
            { bone: 'tail', rot: (u) => [0, 0.1 * sin(TAU * u), 0] },
            { bone: 'root', rot: (u) => [0.06 * sin(TAU * u), 0, 0] },
        ],
    };
    // Perched: wings folded, a slow look around, a tail flick, breathing.
    const foldCh = [];
    for (const side of [1, -1]) {
        const k = side === 1 ? 'R' : 'L';
        foldCh.push({ bone: `wing${k}1`, rot: () => [0, -side * 1.5, side * 1.45] });
        foldCh.push({ bone: `wing${k}2`, rot: () => [0, side * 2.7, 0] });
        foldCh.push({ bone: `wing${k}3`, rot: () => [0, side * 2.6, 0] });
    }
    const perch = {
        name: 'perch',
        duration: 5,
        channels: [
            ...foldCh,
            { bone: 'root', rot: () => [0, 0, s.swims ? 0.04 : 0.5] },
            { bone: 'body', rot: (u) => [0, 0, 0.02 * sin(TAU * u * 3)] },
            { bone: 'neck', rot: (u) => [0, 0.35 * sin(TAU * u), (s.swims ? 0.1 : -0.45) + 0.05 * sin(TAU * u * 2)] },
            { bone: 'head', rot: (u) => [0, 0.5 * sin(TAU * u * 2 + 1) * sstep(0.2, 0.5, (u * 2) % 1), 0.25 + 0.1 * sin(TAU * u * 4)] },
            { bone: 'tail', rot: (u) => [0, 0, -0.5 + 0.25 * Math.max(0, sin(TAU * u * 2 + 2)) ** 4] },
            ...[1, -1].flatMap((side) => {
                const k = side === 1 ? 'R' : 'L';
                return [
                    { bone: `leg${k}1`, rot: () => [0, 0, -0.5] },
                    { bone: `leg${k}2`, rot: () => [0, 0, 0.5] },
                ];
            }),
        ],
    };
    const clips = [perch, flap(s.flapHz, 0.85), flap(s.flapHz * 0.6, 0.55), glide];
    clips[1] = { ...clips[1], name: 'fly' };
    clips[2] = { ...clips[2], name: 'flap' };
    void half;
    return {
        id: s.id,
        name: s.name,
        tags: s.tags,
        bones,
        prims,
        voxel: Math.max(0.0035, s.head / 6),
        k: 0.02,
        tris: 3500,
        sigma: 0.012,
        coat,
        mats: {
            coat: { color: [1, 1, 1], rough: 0.9 },
            feather: { color: [1, 1, 1], rough: 0.85, double: true },
            beak: { color: lin(s.beakColor), rough: 0.4 },
            eye: { color: [0.01, 0.01, 0.01], rough: 0.08 },
            leg: { color: lin(s.legColor), rough: 0.7 },
        },
        rigid,
        clips,
        roles: { idle: 'perch', walk: s.swims ? 'perch' : 'flap', run: 'fly' },
    };
}
void cone;
void rotZ;
