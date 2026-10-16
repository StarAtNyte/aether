/**
 * Fish and butterflies. A fish is a sculpted spindle on a six-bone spine with fins as thin plates; its swim clip is a
 * travelling wave (yaw) whose amplitude grows toward the tail. A butterfly is a slim body with four painted wing plates
 * that flap about the body axis.
 */
import { ellipsoid, sphere, cone } from './sdf';
import { fbm, lin, mixc, noise3, occlusion, sstep } from './living-kit';
import { ellipsoid as ellipsoidMesh, merge, move, rotX, rotY, rotZ } from './vehicle-geo';
import { leaf, tubeMesh } from './living-parts';
const TAU = Math.PI * 2;
const sin = Math.sin;
/** Build a fish. */
export function fish(s) {
    const L = s.length;
    const bones = [];
    const xs = [0.5, 0.3, 0.1, -0.1, -0.3, -0.45].map((f) => f * L);
    const y0 = s.depth * L * 1.1;
    xs.forEach((x, i) => bones.push({ name: `b${i}`, parent: i === 0 ? null : `b${i - 1}`, at: [x, y0, 0] }));
    for (const side of [1, -1]) {
        const k = side === 1 ? 'R' : 'L';
        bones.push({ name: `pec${k}`, parent: 'b1', at: [0.28 * L, y0 - s.depth * L * 0.45, side * s.width * L * 0.8] });
        bones.push({ name: `pel${k}`, parent: 'b2', at: [0.02 * L, y0 - s.depth * L * 0.85, side * s.width * L * 0.4] });
    }
    const prims = [];
    const h = s.depth * L;
    const w = s.width * L;
    prims.push(ellipsoid('b1', [0.22 * L, y0, 0], [0.3 * L, h, w], 0, 0, { k: 0.02 }));
    prims.push(ellipsoid('b2', [0.0, y0 + h * 0.03, 0], [0.26 * L, h * 0.95, w * 0.95], 0, 0, { k: 0.02 }));
    prims.push(ellipsoid('b0', [0.44 * L, y0 - h * 0.1, 0], [0.12 * L, h * 0.62, w * 0.78], 0, 0, { k: 0.02 }));
    prims.push(cone('b3', [-0.14 * L, y0, 0], [-0.32 * L, y0, 0], h * 0.72, h * 0.34, { k: 0.03 }));
    prims.push(cone('b4', [-0.3 * L, y0, 0], [-0.46 * L, y0, 0], h * 0.36, h * 0.3, { k: 0.02 }));
    for (const side of [1, -1])
        prims.push(sphere('b0', [0.45 * L, y0 + h * 0.12, side * w * 0.62], h * 0.12, { carve: true, k: 0.004 }));
    const rigid = [];
    const fin = (len, width, bone, at, rotate) => {
        const m = leaf(len, width, 0.0025, true);
        rotate(m);
        move(m, at[0], at[1], at[2]);
        rigid.push({ bone, mat: 'fin', geo: m, paint: () => lin(s.coat.fin) });
    };
    // Dorsal, anal, tail (forked into two leaves), pectorals and pelvics.
    fin(0.9 * h, 0.24 * L, 'b2', [0.12 * L, y0 + h * 0.8, 0], (m) => { rotZ(m, Math.PI / 2 + 0.25); });
    fin(0.6 * h, 0.13 * L, 'b3', [-0.04 * L, y0 - h * 0.7, 0], (m) => { rotZ(m, -Math.PI / 2 + 0.3); });
    for (const sgn of [1, -1]) {
        const f = leaf(s.tailSpan * L * 0.55, 0.9 * L * s.tailSpan * 0.5, 0.0025, true);
        rotZ(f, Math.PI + sgn * 0.45);
        move(f, -0.46 * L, y0, 0);
        rigid.push({ bone: 'b5', mat: 'fin', geo: f, paint: () => lin(s.coat.fin) });
    }
    for (const side of [1, -1]) {
        const k = side === 1 ? 'R' : 'L';
        const pf = leaf(0.15 * L, 0.07 * L, 0.002, true);
        rotX(pf, Math.PI / 2);
        rotY(pf, -side * (Math.PI - 1.1));
        move(pf, 0.28 * L, y0 - h * 0.45, side * w * 0.8);
        rigid.push({ bone: `pec${k}`, mat: 'fin', geo: pf, paint: () => lin(s.coat.fin) });
        const vf = leaf(0.1 * L, 0.05 * L, 0.002, true);
        rotX(vf, Math.PI / 2);
        rotY(vf, -side * (Math.PI - 0.9));
        move(vf, 0.02 * L, y0 - h * 0.85, side * w * 0.4);
        rigid.push({ bone: `pel${k}`, mat: 'fin', geo: vf, paint: () => lin(s.coat.fin) });
        rigid.push({ bone: 'b0', mat: 'eye', geo: ellipsoidMesh(0.45 * L, y0 + h * 0.12, side * w * 0.6, h * 0.1, h * 0.1, h * 0.08, 8, 10) });
    }
    const c = s.coat;
    const coat = (p, n, sc) => {
        const yRel = (p[1] - (y0 - h)) / (2 * h);
        let col = mixc(lin(c.belly), lin(c.back), sstep(0.3, 0.75, yRel + n[1] * 0.2));
        if (c.side)
            col = mixc(col, lin(c.side), sstep(0.2, 0.5, yRel) * (1 - sstep(0.5, 0.8, yRel)));
        if (c.lateral)
            col = mixc(col, lin(c.lateral), sstep(0.04, 0, Math.abs(yRel - 0.52)) * 0.7 * sstep(-0.4 * L, 0.3 * L, p[0]));
        if (c.spots) {
            const v = noise3(p[0] * c.spots.scale, p[1] * c.spots.scale, p[2] * c.spots.scale);
            col = mixc(col, lin(c.spots.color), sstep(c.spots.cut, c.spots.cut + 0.06, v) * sstep(0.4, 0.7, yRel));
        }
        for (const pt of c.patches ?? []) {
            const v = fbm(p[0] * pt.scale, p[1] * pt.scale * 0.6, (p[2] + 3) * pt.scale);
            col = mixc(col, lin(pt.color), sstep(pt.cut, pt.cut + 0.05, v) * sstep(0.2, 0.55, yRel + n[1] * 0.3));
        }
        // Scale texture: fine diamond rows and a silvery sheen toward the belly.
        const sc2 = Math.abs(sin(p[0] * 520 + p[1] * 260)) * Math.abs(sin(p[0] * 520 - p[1] * 260));
        const ao = occlusion(sc, p, n, 0.02);
        const shade = (0.7 + 0.3 * ao) * (0.94 + sc2 * 0.1);
        return [col[0] * shade, col[1] * shade, col[2] * shade];
    };
    const wave = (amp, hz, lag) => {
        const ch = xs.map((_, i) => ({ bone: `b${i}`, rot: (u) => [0, amp * (0.25 + i * 0.28) * sin(TAU * u - i * lag), 0] }));
        for (const side of [1, -1]) {
            const k = side === 1 ? 'R' : 'L';
            ch.push({ bone: `pec${k}`, rot: (u) => [side * 0.2 * sin(TAU * u * 2), 0, 0.15 * sin(TAU * u * 2 + 1)] });
            ch.push({ bone: `pel${k}`, rot: (u) => [side * 0.12 * sin(TAU * u * 2 + 2), 0, 0] });
        }
        return { name: 'swim', duration: 1 / hz, channels: ch };
    };
    const swim = wave(0.07, s.hz, 0.55);
    const idle = { ...wave(0.025, 0.45, 0.4), name: 'idle', duration: 2.2 };
    const dash = { ...wave(0.12, s.hz * 2.2, 0.5), name: 'dash' };
    return {
        id: s.id,
        name: s.name,
        tags: s.tags,
        bones,
        prims,
        voxel: Math.max(0.0035, L / 90),
        k: 0.02,
        tris: 3500,
        sigma: L * 0.05,
        coat,
        mats: { coat: { color: [1, 1, 1], rough: 0.35, metal: 0.1 }, fin: { color: [1, 1, 1], rough: 0.5, double: true, alpha: 0.9 }, eye: { color: [0.02, 0.02, 0.02], rough: 0.05 } },
        rigid,
        clips: [idle, swim, dash],
        roles: { idle: 'idle', walk: 'swim', run: 'dash' },
    };
}
/** Build a butterfly (wings flap about the body axis; the bind pose has them open). */
export function butterfly(s) {
    const S = s.span;
    const bones = [
        { name: 'root', parent: null, at: [0, 0.01, 0] },
        { name: 'body', parent: 'root', at: [0, 0.01, 0] },
        { name: 'wingR', parent: 'body', at: [0.0, 0.012, 0.004] },
        { name: 'wingL', parent: 'body', at: [0.0, 0.012, -0.004] },
        { name: 'head', parent: 'body', at: [S * 0.32, 0.012, 0] },
    ];
    const prims = [
        ellipsoid('body', [0, 0.012, 0], [S * 0.28, S * 0.045, S * 0.045], 0, 0, { k: 0.004 }),
        ellipsoid('body', [-S * 0.2, 0.012, 0], [S * 0.34, S * 0.032, S * 0.032], -0.1, 0, { k: 0.004 }),
        sphere('head', [S * 0.34, 0.013, 0], S * 0.06, { k: 0.003 }),
    ];
    const rigid = [];
    const wingPaint = (side) => (p) => {
        const t = Math.abs(p[2]) / S;
        const u = p[0] / S;
        const border = sstep(0.62, 0.9, Math.hypot(t * 0.9, u * 1.1) + noise3(p[0] * 90, 0, p[2] * 90) * 0.05);
        let col = mixc(lin(s.base), lin(s.edge), border);
        const veins = Math.abs(sin(Math.atan2(u, t + 0.001) * 14)) < 0.06 ? 1 : 0;
        col = mixc(col, lin(s.veins), veins * (1 - border) * 0.8);
        const dots = noise3(p[0] * 160, 0, p[2] * 160);
        col = mixc(col, lin(s.spot), sstep(0.8, 0.84, dots) * sstep(0.55, 0.75, border) * (1 - sstep(0.88, 0.95, border)));
        void side;
        return col;
    };
    for (const side of [1, -1]) {
        const k = side === 1 ? 'R' : 'L';
        // Fore wing (large, forward) and hind wing (rounded, back), as flat leaves in the XZ plane.
        const fw = leaf(S, S * 0.95, 0.0006, false);
        rotX(fw, Math.PI / 2);
        rotY(fw, side === 1 ? -Math.PI / 2 : Math.PI / 2);
        move(fw, S * 0.1, 0.014, side * 0.004);
        const hw = leaf(S * 0.85, S * 0.8, 0.0006, false);
        rotX(hw, Math.PI / 2);
        rotY(hw, side === 1 ? -Math.PI / 2 : Math.PI / 2);
        move(hw, -S * 0.42, 0.012, side * 0.004);
        rigid.push({ bone: `wing${k}`, mat: 'wing', geo: merge(fw, hw), paint: wingPaint(side) });
    }
    for (const side of [1, -1])
        rigid.push({ bone: 'head', mat: 'bodyc', geo: tubeMesh([[S * 0.38, 0.016, side * 0.002], [S * 0.5, 0.034, side * S * 0.12], [S * 0.56, 0.044, side * S * 0.2]], 0.0006, 0.0005, 4) });
    const flapClip = (hz, amp, name) => ({
        name,
        duration: 1 / hz,
        channels: [
            { bone: 'wingR', rot: (u) => [-amp * Math.cos(TAU * u) - 0.15, 0, 0] },
            { bone: 'wingL', rot: (u) => [amp * Math.cos(TAU * u) + 0.15, 0, 0] },
            { bone: 'root', pos: (u) => [0, 0.01 * sin(TAU * u * 2), 0] },
            { bone: 'body', rot: (u) => [0, 0, 0.1 * sin(TAU * u + 1)] },
        ],
    });
    const slow = {
        name: 'idle',
        duration: 4,
        channels: [
            { bone: 'wingR', rot: (u) => [-0.2 - 0.7 * Math.max(0, sin(TAU * u * 2)) ** 3, 0, 0] },
            { bone: 'wingL', rot: (u) => [0.2 + 0.7 * Math.max(0, sin(TAU * u * 2)) ** 3, 0, 0] },
        ],
    };
    return {
        id: s.id,
        name: s.name,
        tags: s.tags,
        bones,
        prims,
        voxel: 0.0016,
        k: 0.004,
        tris: 1200,
        sigma: 0.004,
        coat: () => lin(s.body),
        mats: { coat: { color: [1, 1, 1], rough: 0.8 }, wing: { color: [1, 1, 1], rough: 0.7, double: true }, bodyc: { color: lin(s.body), rough: 0.8 } },
        rigid,
        clips: [slow, flapClip(7, 0.95, 'walk'), flapClip(9, 1.05, 'run')],
        roles: { idle: 'idle', walk: 'walk', run: 'run' },
    };
}
