import { boxCollider, cylinderCollider } from '../colliders';
import { mixLinear } from '../color';
import { defineGenerator, glow, hullOf, jitter, lin, MAT, paintGradientY, paintNoise, paintSolid, pBool, pColor, pNum, pVariant, shade, } from './kit';
/** Add a noise-tinted piece. */
function piece(api, mesh, color, material, variation = 0.1, freq = 3) {
    paintNoise(mesh, api, shade(color, -variation), shade(color, variation), freq);
    api.add(mesh, material);
    return mesh;
}
const lampPost = defineGenerator({
    id: 'lamp-post',
    description: 'Street lamp: ornate cast base, slim pole and a glowing lantern (classic), curved arm (modern) or twin lanterns.',
    category: 'props',
    params: {
        height: pNum(3.5, 1.5, 10, 'height in meters'),
        color: pColor('#2d2d33', 'metal color'),
        lightColor: pColor('#ffd27a', 'light color'),
        variant: pVariant(2, '0 classic lantern, 1 modern arm, 2 twin lanterns'),
    },
    run(p, api) {
        const H = p.num('height');
        const c = p.color('color');
        const light = p.color('lightColor');
        const variant = p.int('variant');
        const k = H / 3.5;
        piece(api, api.lathe([[0, 0], [0.26 * k, 0], [0.26 * k, 0.1 * k], [0.16 * k, 0.22 * k], [0.09 * k, 0.45 * k], [0, 0.45 * k]], 8), c, MAT.metal, 0.08);
        const poleTop = variant === 1 ? H : H * 0.86;
        piece(api, api.cylinder(0.045 * k, 0.065 * k, poleTop - 0.4 * k, 8).translate(0, 0.4 * k + (poleTop - 0.4 * k) / 2, 0), c, MAT.metal, 0.06);
        piece(api, api.torus(0.075 * k, 0.025 * k, 6, 12).rotate(90, 0, 0).translate(0, H * 0.45, 0), c, MAT.metal, 0.05);
        const lantern = (x, y) => {
            const s = 0.2 * k;
            api.add(api.box(s * 1.4, s * 1.8, s * 1.4).translate(x, y, 0), glow(light, 2.5));
            for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
                piece(api, api.box(0.025 * k, s * 1.9, 0.025 * k).translate(x + dx * s * 0.72, y, dz * s * 0.72), c, MAT.metal, 0.04);
            }
            piece(api, api.cone(s * 1.25, s * 0.8, 4).rotate(0, 45, 0).translate(x, y + s * 1.3, 0), c, MAT.metal, 0.05);
            piece(api, api.box(s * 1.6, 0.04 * k, s * 1.6).translate(x, y - s * 0.95, 0), c, MAT.metal, 0.05);
            piece(api, api.sphere(0.04 * k, 0).translate(x, y + s * 1.8, 0), c, MAT.metal, 0.05);
        };
        if (variant === 0)
            lantern(0, H * 0.86 + 0.22 * k);
        else if (variant === 2) {
            piece(api, api.box(1.1 * k, 0.05 * k, 0.05 * k).translate(0, H * 0.86, 0), c, MAT.metal, 0.05);
            lantern(-0.5 * k, H * 0.86 - 0.25 * k);
            lantern(0.5 * k, H * 0.86 - 0.25 * k);
            piece(api, api.sphere(0.06 * k, 0).translate(0, H * 0.86 + 0.08 * k, 0), c, MAT.metal, 0.05);
        }
        else {
            const arm = [];
            for (let i = 0; i <= 6; i++) {
                const t = i / 6;
                arm.push([Math.sin(t * Math.PI * 0.5) * 0.7 * k, H - 0.02 * k + Math.sin(t * Math.PI) * 0.18 * k - t * 0.1 * k, 0]);
            }
            piece(api, api.tube(arm, 0.035 * k, 6), c, MAT.metal, 0.05);
            const head = api.cylinder(0.09 * k, 0.2 * k, 0.12 * k, 10).translate(0.7 * k, H - 0.15 * k, 0);
            piece(api, head, c, MAT.metal, 0.05);
            api.add(api.cylinder(0.17 * k, 0.17 * k, 0.02 * k, 10).translate(0.7 * k, H - 0.22 * k, 0), glow(light, 3));
        }
        api.collider(cylinderCollider(0, 0.225 * k, 0, 0.26 * k, 0.45 * k));
        api.collider(cylinderCollider(0, H / 2, 0, 0.07 * k, H));
        return api.build();
    },
});
const bench = defineGenerator({
    id: 'bench',
    description: 'Park bench with wooden slats on cast-iron side frames, or a rustic log bench.',
    category: 'props',
    params: {
        length: pNum(1.8, 0.8, 5, 'length (x) in meters'),
        color: pColor('#a0703c', 'wood color'),
        frameColor: pColor('#3a3a3a', 'frame color'),
        variant: pVariant(1, '0 park bench, 1 rustic log bench'),
    },
    run(p, api) {
        const L = p.num('length');
        const wood = p.color('color');
        const frame = p.color('frameColor');
        if (p.int('variant') === 1) {
            const seat = api.cylinder(0.22, 0.22, L, 9).rotate(0, 0, 90).scale(1, 0.55, 1).translate(0, 0.42, 0);
            piece(api, seat, wood, MAT.bark, 0.15, 4);
            for (const sx of [-1, 1]) {
                const stump = api.cylinder(0.17, 0.2, 0.36, 8).translate(sx * L * 0.33, 0.18, 0);
                piece(api, stump, shade(wood, -0.15), MAT.bark, 0.12, 5);
            }
            api.collider(boxCollider(0, 0.27, 0, L, 0.54, 0.44));
            return api.build();
        }
        const seatY = 0.45;
        for (let i = 0; i < 4; i++) {
            piece(api, api.box(L, 0.04, 0.1).translate(0, seatY, -0.17 + i * 0.115), jitter(api, wood, 0.1), MAT.wood, 0.08, 4);
        }
        for (let i = 0; i < 3; i++) {
            const slat = api.box(L, 0.1, 0.035).translate(0, 0.16 + i * 0.13, 0).rotate(-14, 0, 0).translate(0, seatY + 0.07, -0.25);
            piece(api, slat, jitter(api, wood, 0.1), MAT.wood, 0.08, 4);
        }
        const supports = L > 2.4 ? [-L / 2 + 0.12, 0, L / 2 - 0.12] : [-L / 2 + 0.12, L / 2 - 0.12];
        for (const x of supports) {
            piece(api, api.box(0.05, seatY, 0.05).translate(x, seatY / 2, 0.17), frame, MAT.metal, 0.04);
            piece(api, api.box(0.05, 0.9, 0.05).rotate(-12, 0, 0).translate(x, 0.45, -0.21), frame, MAT.metal, 0.04);
            piece(api, api.box(0.05, 0.05, 0.48).translate(x, seatY - 0.04, -0.02), frame, MAT.metal, 0.04);
            piece(api, api.box(0.05, 0.04, 0.42).translate(x, 0.66, 0.0), frame, MAT.metal, 0.04);
            piece(api, api.box(0.05, 0.22, 0.04).translate(x, 0.56, 0.17), frame, MAT.metal, 0.04);
        }
        api.collider(boxCollider(0, seatY / 2 + 0.01, 0, L, seatY + 0.02, 0.5));
        api.collider({ kind: 'box', halfExtents: [L / 2, 0.22, 0.03], offset: [0, seatY + 0.28, -0.3], rotation: [-14, 0, 0] });
        return api.build();
    },
});
const table = defineGenerator({
    id: 'table',
    description: 'Wooden table: four-legged dining table, round pedestal table, or picnic table with attached benches.',
    category: 'props',
    params: {
        width: pNum(1.6, 0.5, 5, 'width (x) in meters (diameter for round)'),
        depth: pNum(0.9, 0.4, 3, 'depth (z) in meters'),
        height: pNum(0.75, 0.3, 1.5, 'height in meters'),
        color: pColor('#9a6a3c', 'wood color'),
        variant: pVariant(2, '0 four legs, 1 round pedestal, 2 picnic table'),
    },
    run(p, api) {
        const W = p.num('width');
        const D = p.num('depth');
        const H = p.num('height');
        const c = p.color('color');
        const variant = p.int('variant');
        const t = 0.05;
        if (variant === 1) {
            piece(api, api.cylinder(W / 2, W / 2, t, 16).translate(0, H - t / 2, 0), c, MAT.wood, 0.1, 3);
            piece(api, api.cylinder(0.05, 0.07, H - t, 8).translate(0, (H - t) / 2, 0), shade(c, -0.2), MAT.wood, 0.06);
            piece(api, api.cylinder(W * 0.18, W * 0.22, 0.05, 8).translate(0, 0.025, 0), shade(c, -0.25), MAT.wood, 0.06);
            api.collider(cylinderCollider(0, H - t / 2, 0, W / 2, t));
            api.collider(cylinderCollider(0, (H - t) / 2, 0, 0.08, H - t));
            return api.build();
        }
        if (variant === 2) {
            const planks = 5;
            for (let i = 0; i < planks; i++) {
                piece(api, api.box(W, t, D / planks - 0.02).translate(0, H - t / 2, -D / 2 + (D / planks) * (i + 0.5)), jitter(api, c, 0.08), MAT.wood, 0.06, 4);
            }
            for (const sz of [-1, 1]) {
                piece(api, api.box(W, t, 0.28).translate(0, H * 0.58, sz * (D / 2 + 0.3)), jitter(api, c, 0.08), MAT.wood, 0.06, 4);
                api.collider(boxCollider(0, H * 0.58, sz * (D / 2 + 0.3), W, t, 0.28));
            }
            for (const sx of [-1, 1]) {
                for (const sz of [-1, 1]) {
                    const a = [sx * (W / 2 - 0.15), 0, sz * (D / 2 + 0.45)];
                    const b = [sx * (W / 2 - 0.15), H - t, 0];
                    piece(api, api.limb(a, b, 0.05, 0.05, 4), shade(c, -0.15), MAT.wood, 0.05);
                }
                piece(api, api.box(0.08, 0.08, D + 1.0).translate(sx * (W / 2 - 0.15), H * 0.58 - t, 0), shade(c, -0.15), MAT.wood, 0.05);
            }
            api.collider(boxCollider(0, H - t / 2, 0, W, t, D));
            api.collider(boxCollider(0, (H - t) / 2, 0, W - 0.2, H - t, 0.1));
            return api.build();
        }
        piece(api, api.box(W, t, D).translate(0, H - t / 2, 0), c, MAT.wood, 0.1, 3);
        piece(api, api.box(W - 0.12, 0.09, D - 0.12).translate(0, H - t - 0.045, 0), shade(c, -0.15), MAT.wood, 0.05);
        for (const sx of [-1, 1]) {
            for (const sz of [-1, 1]) {
                const x = sx * (W / 2 - 0.08);
                const z = sz * (D / 2 - 0.08);
                piece(api, api.cylinder(0.035, 0.028, H - t, 6).translate(x, (H - t) / 2, z), shade(c, -0.1), MAT.wood, 0.05);
                api.collider(boxCollider(x, (H - t) / 2, z, 0.07, H - t, 0.07));
            }
        }
        api.collider(boxCollider(0, H - t / 2, 0, W, t, D));
        return api.build();
    },
});
const chair = defineGenerator({
    id: 'chair',
    description: 'Chair: wooden dining chair with slatted back, upholstered armchair, or a bar stool.',
    category: 'props',
    params: {
        height: pNum(0.9, 0.5, 1.5, 'total height in meters'),
        color: pColor('#8b5a2b', 'wood / frame color'),
        fabricColor: pColor('#3f6e8c', 'cushion color'),
        variant: pVariant(2, '0 dining chair, 1 armchair, 2 stool'),
    },
    run(p, api) {
        const H = p.num('height');
        const c = p.color('color');
        const fabric = p.color('fabricColor');
        const variant = p.int('variant');
        const seatH = H * (variant === 2 ? 0.75 : 0.5);
        const S = variant === 1 ? 0.75 : 0.45;
        if (variant === 2) {
            piece(api, api.cylinder(0.2, 0.2, 0.06, 12).translate(0, seatH, 0), fabric, MAT.fabric, 0.08);
            for (let k = 0; k < 4; k++) {
                const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
                piece(api, api.limb([Math.cos(a) * 0.22, 0, Math.sin(a) * 0.22], [Math.cos(a) * 0.12, seatH - 0.03, Math.sin(a) * 0.12], 0.02, 0.018, 5), c, MAT.metal, 0.04);
            }
            piece(api, api.torus(0.17, 0.012, 4, 16).rotate(90, 0, 0).translate(0, seatH * 0.35, 0), c, MAT.metal, 0.04);
            api.collider(cylinderCollider(0, seatH / 2, 0, 0.22, seatH + 0.03));
            return api.build();
        }
        if (variant === 1) {
            piece(api, api.box(S, seatH * 0.6, S).translate(0, seatH * 0.3 + 0.08, 0), fabric, MAT.fabric, 0.08);
            piece(api, api.box(S - 0.1, 0.12, S - 0.12).translate(0, seatH + 0.02, 0.04), shade(fabric, 0.08), MAT.fabric, 0.06);
            piece(api, api.box(S, H - seatH * 0.6, 0.16).rotate(-8, 0, 0).translate(0, seatH * 0.6 + (H - seatH * 0.6) / 2, -S / 2 + 0.08), fabric, MAT.fabric, 0.08);
            for (const sx of [-1, 1])
                piece(api, api.box(0.12, seatH * 0.5, S).translate(sx * (S / 2 - 0.06), seatH * 0.85, 0), shade(fabric, -0.05), MAT.fabric, 0.06);
            for (const sx of [-1, 1]) {
                for (const sz of [-1, 1])
                    piece(api, api.cylinder(0.025, 0.02, 0.08, 6).translate(sx * (S / 2 - 0.06), 0.04, sz * (S / 2 - 0.06)), c, MAT.wood, 0.04);
            }
            api.collider(boxCollider(0, seatH / 2 + 0.04, 0, S, seatH + 0.08, S));
            api.collider(boxCollider(0, (seatH + H) / 2, -S / 2 + 0.08, S, H - seatH, 0.16));
            return api.build();
        }
        piece(api, api.box(S, 0.04, S).translate(0, seatH, 0), c, MAT.wood, 0.1, 4);
        piece(api, api.box(S - 0.06, 0.03, S - 0.08).translate(0, seatH + 0.035, 0.01), fabric, MAT.fabric, 0.06);
        for (const sx of [-1, 1]) {
            for (const sz of [-1, 1]) {
                const x = sx * (S / 2 - 0.03);
                const z = sz * (S / 2 - 0.03);
                const top = sz < 0 ? H : seatH;
                piece(api, api.box(0.04, top, 0.04).translate(x, top / 2, z), shade(c, -0.1), MAT.wood, 0.05);
            }
        }
        for (let i = 0; i < 3; i++) {
            piece(api, api.box(S - 0.06, 0.05, 0.025).translate(0, seatH + 0.15 + i * ((H - seatH - 0.2) / 2.2), -S / 2 + 0.03), jitter(api, c, 0.08), MAT.wood, 0.05);
        }
        api.collider(boxCollider(0, seatH / 2, 0, S, seatH + 0.02, S));
        api.collider(boxCollider(0, (seatH + H) / 2, -S / 2 + 0.03, S, H - seatH, 0.05));
        return api.build();
    },
});
const crate = defineGenerator({
    id: 'crate',
    description: 'Shipping crate: framed wooden crate with diagonal brace, slatted crate, or sci-fi metal cargo box with glowing strips.',
    category: 'props',
    params: {
        size: pNum(1, 0.3, 4, 'edge length in meters'),
        color: pColor('#b07d45', 'main color'),
        variant: pVariant(2, '0 framed wood, 1 slatted wood, 2 sci-fi metal'),
    },
    run(p, api) {
        const S = p.num('size');
        const c = p.color('color');
        const variant = p.int('variant');
        const e = S * 0.09;
        if (variant === 2) {
            const metal = c === '#b07d45' ? '#5c6670' : c;
            piece(api, api.box(S * 0.96, S * 0.96, S * 0.96).translate(0, S / 2, 0), metal, MAT.metal, 0.08, 2);
            for (const sy of [0.04, 0.96])
                piece(api, api.box(S, S * 0.08, S).translate(0, S * sy, 0), shade(metal, -0.25), MAT.metal, 0.05);
            for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
                piece(api, api.box(S * 0.1, S, S * 0.1).translate((x * S) / 2 - x * S * 0.05, S / 2, (z * S) / 2 - z * S * 0.05), shade(metal, -0.3), MAT.metal, 0.05);
            }
            api.add(api.box(S * 0.6, S * 0.04, S * 0.02).translate(0, S * 0.5, S * 0.485), glow('#38e1ff', 3));
            api.add(api.box(S * 0.02, S * 0.04, S * 0.6).translate(S * 0.485, S * 0.5, 0), glow('#38e1ff', 3));
            api.collider(boxCollider(0, S / 2, 0, S, S, S));
            return api.build();
        }
        const panel = api.box(S - e * 0.6, S - e * 0.6, S - e * 0.6).translate(0, S / 2, 0);
        const p0 = lin(shade(c, -0.12));
        const p1 = lin(shade(c, 0.1));
        panel.paintFn((x, y, z, nx, ny, _nz, out) => {
            const u = Math.abs(ny) > 0.5 ? x : Math.abs(nx) > 0.5 ? z : x;
            const v = Math.abs(ny) > 0.5 ? z : y;
            const board = Math.floor((v / S) * 4 + 8);
            mixLinear(p0, p1, (board % 2) * 0.5 + 0.25 + 0.2 * api.noise.noise3(u * 3, v * 9, board), out);
        });
        api.add(panel, MAT.wood);
        if (variant === 1) {
            // slats with gaps around a dark core
            paintSolid(panel, shade(c, -0.55));
            for (let i = 0; i < 4; i++) {
                const y = S * (0.12 + i * 0.25);
                for (const [w, d] of [[S, S * 0.98], [S * 0.98, S]])
                    piece(api, api.box(w, S * 0.17, d).translate(0, y, 0), jitter(api, c, 0.1), MAT.wood, 0.08, 4);
            }
        }
        const frameC = shade(c, -0.22);
        for (const sy of [-1, 1]) {
            for (const sz of [-1, 1]) {
                piece(api, api.box(S, e, e).translate(0, S / 2 + (sy * (S - e)) / 2, (sz * (S - e)) / 2), frameC, MAT.wood, 0.08);
                piece(api, api.box(e, e, S - 2 * e).translate((sy * (S - e)) / 2, S / 2 + (sz * (S - e)) / 2, 0), frameC, MAT.wood, 0.08);
                piece(api, api.box(e, S - 2 * e, e).translate((sy * (S - e)) / 2, S / 2, (sz * (S - e)) / 2), frameC, MAT.wood, 0.08);
            }
        }
        if (variant === 0) {
            const diag = Math.SQRT2 * (S - 2 * e);
            for (const sz of [-1, 1])
                piece(api, api.box(e * 0.8, diag, e * 0.5).rotate(0, 0, 45 * sz).translate(0, S / 2, (sz * S) / 2), frameC, MAT.wood, 0.08);
            for (const sx of [-1, 1])
                piece(api, api.box(e * 0.5, diag, e * 0.8).rotate(45 * sx, 0, 0).translate((sx * S) / 2, S / 2, 0), frameC, MAT.wood, 0.08);
        }
        api.collider(boxCollider(0, S / 2, 0, S, S, S));
        return api.build();
    },
});
const barrel = defineGenerator({
    id: 'barrel',
    description: 'Barrel: bulging wooden cask with metal hoops, steel oil drum, or red explosive barrel with hazard band.',
    category: 'props',
    params: {
        height: pNum(1.1, 0.4, 3, 'height in meters'),
        color: pColor('#8a5a2e', 'body color'),
        hoopColor: pColor('#55585e', 'hoop color'),
        variant: pVariant(2, '0 wooden cask, 1 steel drum, 2 explosive'),
    },
    run(p, api) {
        const H = p.num('height');
        const variant = p.int('variant');
        const R = H * 0.34;
        const hoop = p.color('hoopColor');
        if (variant === 0) {
            const body = api.lathe([[0, 0], [R * 0.84, 0], [R * 0.95, H * 0.2], [R, H * 0.5], [R * 0.95, H * 0.8], [R * 0.84, H], [0, H]], 14);
            const c = p.color('color');
            const s0 = lin(shade(c, -0.18));
            const s1 = lin(shade(c, 0.1));
            const top = lin(shade(c, -0.05));
            body.paintFn((x, y, z, _nx, ny, _nz, out) => {
                if (Math.abs(ny) > 0.9) {
                    mixLinear(top, s0, 0.3 + 0.3 * api.noise.noise2(x * 8, z * 8), out);
                    return;
                }
                const stave = Math.floor(((Math.atan2(x, z) + Math.PI) / (Math.PI * 2)) * 14);
                mixLinear(s0, s1, (stave % 2) * 0.5 + 0.25 * api.noise.noise3(x * 2, y * 6, z * 2) + 0.2, out);
            });
            api.add(body, MAT.wood);
            for (const [f, rr] of [[0.1, 0.9], [0.3, 0.985], [0.7, 0.985], [0.9, 0.9]]) {
                piece(api, api.cylinder(R * rr + 0.012, R * rr + 0.012, H * 0.05, 14).translate(0, H * f, 0), hoop, MAT.metal, 0.06);
            }
        }
        else {
            const c = variant === 2 ? '#c62f2f' : p.color('color') === '#8a5a2e' ? '#3d6e8f' : p.color('color');
            const body = api.cylinder(R * 0.92, R * 0.92, H, 16).translate(0, H / 2, 0);
            const c0 = lin(shade(c, -0.15));
            const c1 = lin(shade(c, 0.08));
            body.paintFn((x, y, z, _nx, _ny, _nz, out) => mixLinear(c0, c1, 0.5 + 0.4 * api.noise.noise3(x * 3, y * 3, z * 3), out));
            api.add(body, MAT.paint);
            if (variant === 2) {
                // hazard band: alternating yellow/black panels around the drum
                const panels = 14;
                const pw = 2 * R * 0.93 * Math.sin(Math.PI / panels) * 1.02;
                for (let k = 0; k < panels; k++) {
                    const ang = (k / panels) * 360;
                    const panel = api.box(pw, H * 0.16, 0.012).translate(0, H * 0.5, R * 0.925).rotate(0, ang, 0);
                    paintSolid(panel, k % 2 ? '#1f1f22' : '#f2c230');
                    api.add(panel, MAT.paint);
                }
            }
            for (const f of [0.02, 0.33, 0.66, 0.98])
                piece(api, api.torus(R * 0.93, H * 0.018, 4, 16).rotate(90, 0, 0).translate(0, H * f, 0), shade(c, -0.25), MAT.metal, 0.05);
            piece(api, api.cylinder(R * 0.12, R * 0.12, H * 0.03, 8).translate(R * 0.45, H + H * 0.012, 0), '#9aa0a6', MAT.metal, 0.05);
        }
        api.collider(cylinderCollider(0, H / 2, 0, R * 0.95, H));
        return api.build();
    },
});
const campfire = defineGenerator({
    id: 'campfire',
    description: 'Campfire: ring of stones, crossed logs and layered glowing flame cones with embers (or just embers).',
    category: 'props',
    params: {
        size: pNum(1.2, 0.4, 5, 'diameter in meters'),
        flameColor: pColor('#ff7a1a', 'outer flame color'),
        lit: pBool(true, 'show flames'),
        variant: pVariant(1, '0 teepee logs, 1 log cabin stack'),
    },
    run(p, api) {
        const S = p.num('size');
        const ringR = S * 0.42;
        const stones = 10;
        for (let k = 0; k < stones; k++) {
            const a = (k / stones) * Math.PI * 2 + api.rng() * 0.2;
            const r = api.icosphereRock(S * api.range(0.08, 0.11), 0.6, 1).scale(1, 0.7, 1).translate(Math.cos(a) * ringR, S * 0.04, Math.sin(a) * ringR);
            const g = jitter(api, '#85827c', 0.15);
            paintNoise(r, api, shade(g, -0.2), shade(g, 0.1), 6);
            api.add(r, MAT.stone);
        }
        const logR = S * 0.055;
        const logL = S * 0.62;
        const char = lin('#1d1512');
        const wood = lin('#6e4a2c');
        const paintLog = (log) => log.paintFn((x, y, z, _nx, _ny, _nz, out) => {
            mixLinear(wood, char, Math.min(1, Math.max(0, (S * 0.35 - Math.hypot(x, z)) / (S * 0.3)) + 0.2 * api.noise.noise3(x * 9, y * 9, z * 9)), out);
        });
        if (p.int('variant') === 1) {
            for (let layer = 0; layer < 3; layer++) {
                for (const s of [-1, 1]) {
                    const log = api.cylinder(logR, logR, logL * 0.8, 6).rotate(0, 0, 90);
                    if (layer % 2)
                        log.rotate(0, 90, 0);
                    const off = s * S * 0.13;
                    log.translate(layer % 2 ? off : 0, logR + layer * logR * 1.8, layer % 2 ? 0 : off);
                    api.add(paintLog(log), MAT.bark);
                }
            }
        }
        else {
            for (let k = 0; k < 5; k++) {
                const a = (k / 5) * 360 + api.rng() * 20;
                const log = api.cylinder(logR, logR * 1.1, logL, 6).translate(0, logL / 2, 0).rotate(0, 0, 58).translate(S * 0.3, 0, 0).rotate(0, a, 0);
                api.add(paintLog(log), MAT.bark);
            }
        }
        const flame = p.color('flameColor');
        api.add(api.cylinder(S * 0.2, S * 0.24, S * 0.03, 8).translate(0, S * 0.015, 0), glow('#ff3b12', 2.2));
        if (p.bool('lit')) {
            api.add(api.cone(S * 0.2, S * 0.62, 7).rotate(api.range(-6, 6), api.rng() * 360, api.range(-6, 6)).translate(0, S * 0.36, 0), glow(flame, 3));
            for (let k = 0; k < 3; k++) {
                const a = (k / 3) * Math.PI * 2 + 0.4;
                const h = S * api.range(0.3, 0.45);
                api.add(api.cone(S * 0.09, h, 6).rotate(Math.sin(a) * 12, 0, -Math.cos(a) * 12).translate(Math.cos(a) * S * 0.1, h / 2 + S * 0.06, Math.sin(a) * S * 0.1), glow(flame, 3));
            }
            api.add(api.cone(S * 0.11, S * 0.42, 6).translate(0, S * 0.27, 0), glow('#ffd23f', 4));
        }
        for (let k = 0; k < 8; k++) {
            const a = api.rng() * Math.PI * 2;
            const r = api.range(0.05, 0.25) * S;
            api.add(api.box(S * 0.03, S * 0.02, S * 0.03).rotate(0, api.rng() * 90, 0).translate(Math.cos(a) * r, S * 0.03, Math.sin(a) * r), glow('#ff5a1f', 2.5));
        }
        api.collider(cylinderCollider(0, S * 0.07, 0, ringR + S * 0.1, S * 0.14));
        return api.build();
    },
});
const tent = defineGenerator({
    id: 'tent',
    description: 'Camping tent: A-frame canvas tent with poles and guy ropes, dome tent, or tipi.',
    category: 'props',
    params: {
        size: pNum(2.5, 1, 10, 'length in meters'),
        color: pColor('#c8553d', 'canvas color'),
        variant: pVariant(2, '0 A-frame, 1 dome, 2 tipi'),
    },
    run(p, api) {
        const S = p.num('size');
        const c = p.color('color');
        const variant = p.int('variant');
        const pole = '#6b4a2f';
        const canvas = (mesh) => paintGradientY(mesh, api, shade(c, -0.2), shade(c, 0.12), 0, S * 0.8, 0.12);
        let body;
        if (variant === 1) {
            const R = S * 0.5;
            const prof = [];
            for (let i = 0; i <= 6; i++) {
                const a = (i / 6) * (Math.PI / 2);
                prof.push([i === 6 ? 0 : R * Math.cos(a), R * 0.75 * Math.sin(a)]);
            }
            body = api.lathe([[0, 0], ...prof], 8);
            canvas(body);
            api.add(body, MAT.fabric);
            for (const yaw of [45, 135]) {
                const arc = [];
                for (let i = 0; i <= 12; i++) {
                    const a = (i / 12) * Math.PI;
                    arc.push([Math.cos(a) * R * 1.01, Math.sin(a) * R * 0.76, 0]);
                }
                piece(api, api.tube(arc, S * 0.012, 5).rotate(0, yaw, 0), '#30343a', MAT.metal, 0.04);
            }
            const door = api.extrude([[-R * 0.3, 0], [R * 0.3, 0], [0, R * 0.55]], 0.04).translate(0, 0.01, R * 0.9);
            paintSolid(door, shade(c, -0.6));
            api.add(door, MAT.fabric);
        }
        else if (variant === 2) {
            const R = S * 0.45;
            body = api.cone(R, S * 1.1, 9).translate(0, S * 0.55, 0);
            const stripe0 = lin(shade(c, -0.15));
            const stripe1 = lin('#efe4cf');
            body.paintFn((x, y, z, _nx, _ny, _nz, out) => mixLinear(stripe0, stripe1, (Math.floor(y * 3 / S * 2) % 3 === 1 ? 0.9 : 0.1) + 0.08 * api.noise.noise3(x * 3, y * 3, z * 3), out));
            api.add(body, MAT.fabric);
            for (let k = 0; k < 5; k++) {
                const a = (k / 5) * Math.PI * 2;
                piece(api, api.limb([Math.cos(a) * R * 0.25, S * 0.85, Math.sin(a) * R * 0.25], [-Math.cos(a) * R * 0.08, S * 1.3, -Math.sin(a) * R * 0.08], S * 0.015, S * 0.012, 4), pole, MAT.wood, 0.05);
            }
            const door = api.extrude([[-R * 0.25, 0], [R * 0.25, 0], [0, S * 0.45]], 0.04).translate(0, 0.01, R * 0.62).rotate(-21, 0, 0);
            paintSolid(door, shade(c, -0.6));
            api.add(door, MAT.fabric);
        }
        else {
            const W = S * 0.7;
            const H = S * 0.55;
            body = api.extrude([[-W / 2, 0], [W / 2, 0], [0, H]], S);
            canvas(body);
            api.add(body, MAT.fabric);
            const door = api.extrude([[-W * 0.28, 0], [W * 0.28, 0], [0, H * 0.82]], 0.03).translate(0, 0.005, S / 2 + 0.01);
            paintSolid(door, shade(c, -0.6));
            api.add(door, MAT.fabric);
            for (const sz of [-1, 1])
                piece(api, api.cylinder(0.025, 0.025, H + 0.15, 5).translate(0, (H + 0.15) / 2, sz * (S / 2 + 0.04)), pole, MAT.wood, 0.05);
            for (const sx of [-1, 1]) {
                for (const sz of [-1, 1]) {
                    const peg = [sx * (W / 2 + 0.45), 0.02, sz * (S / 2 + 0.3)];
                    piece(api, api.limb([0, H + 0.1, sz * (S / 2 + 0.04)], peg, 0.006, 0.006, 3), '#d8cfbd', MAT.fabric, 0.03);
                    piece(api, api.box(0.04, 0.12, 0.04).translate(peg[0], 0.06, peg[2]), pole, MAT.wood, 0.05);
                }
            }
        }
        api.collider(hullOf(body));
        return api.build();
    },
});
const dock = defineGenerator({
    id: 'dock',
    description: 'Wooden pier/jetty along X: plank deck on posts with stringers, bollards, rope and an optional lantern post.',
    category: 'props',
    params: {
        length: pNum(8, 2, 40, 'length (x) in meters'),
        width: pNum(3, 1, 10, 'width (z) in meters'),
        height: pNum(1.2, 0.3, 5, 'deck height above ground/water in meters'),
        color: pColor('#8b5a2b', 'wood color'),
        variant: pVariant(1, '0 plain, 1 with lantern and rope rails'),
    },
    run(p, api) {
        const L = p.num('length');
        const W = p.num('width');
        const H = p.num('height');
        const c = p.color('color');
        const planks = Math.max(4, Math.min(100, Math.round(L / 0.3)));
        const pw = L / planks;
        for (let i = 0; i < planks; i++) {
            const x = -L / 2 + pw * (i + 0.5);
            piece(api, api.box(pw * 0.88, 0.07, W * api.range(0.97, 1.03)).translate(x, H - 0.035, api.range(-0.03, 0.03)), jitter(api, c, 0.12), MAT.wood, 0.08, 3);
        }
        for (const sz of [-1, 1])
            piece(api, api.box(L, 0.18, 0.14).translate(0, H - 0.16, sz * (W / 2 - 0.2)), shade(c, -0.25), MAT.wood, 0.06);
        const posts = Math.max(2, Math.min(9, Math.round(L / 2.2) + 1));
        for (let i = 0; i < posts; i++) {
            const x = -L / 2 + 0.15 + (i * (L - 0.3)) / (posts - 1);
            for (const sz of [-1, 1]) {
                const ph = H + (i === posts - 1 || i === 0 ? 0.4 : 0.05);
                piece(api, api.cylinder(0.11, 0.13, ph, 7).translate(x, ph / 2, sz * (W / 2 - 0.05)), shade(c, -0.3), MAT.bark, 0.1, 4);
                api.collider(cylinderCollider(x, ph / 2, sz * (W / 2 - 0.05), 0.12, ph));
            }
        }
        piece(api, api.lathe([[0, 0], [0.13, 0], [0.12, 0.2], [0.17, 0.27], [0, 0.3]], 8).translate(L / 2 - 0.5, H, W / 2 - 0.35), '#2f3136', MAT.metal, 0.05);
        if (p.int('variant') === 1) {
            for (const sz of [-1, 1]) {
                const rope = [];
                for (let i = 0; i <= 16; i++) {
                    const x = -L / 2 + 0.15 + (i / 16) * (L - 0.3);
                    const t = ((i / 16) * (posts - 1)) % 1;
                    rope.push([x, H + 0.35 - Math.sin(t * Math.PI) * 0.15, sz * (W / 2 - 0.05)]);
                }
                piece(api, api.tube(rope, 0.02, 4), '#cdb891', MAT.fabric, 0.05);
            }
            const lx = L / 2 - 0.15;
            piece(api, api.box(0.1, 1.4, 0.1).translate(lx, H + 0.7, -W / 2 + 0.05), shade(c, -0.3), MAT.wood, 0.05);
            piece(api, api.box(0.4, 0.06, 0.06).translate(lx - 0.15, H + 1.35, -W / 2 + 0.05), shade(c, -0.3), MAT.wood, 0.05);
            api.add(api.box(0.16, 0.22, 0.16).translate(lx - 0.3, H + 1.18, -W / 2 + 0.05), glow('#ffcf70', 2.5));
        }
        api.collider(boxCollider(0, H - 0.07, 0, L, 0.14, W));
        return api.build();
    },
});
const statue = defineGenerator({
    id: 'statue',
    description: 'Monument on a stepped pedestal: heroic figure raising a sword, abstract spiral sculpture, or a bust on a fluted column.',
    category: 'props',
    params: {
        height: pNum(2.5, 0.5, 20, 'total height in meters'),
        color: pColor('#c9c3b5', 'figure color (try #b08d57 for bronze)'),
        pedestalColor: pColor('#8f8a82', 'pedestal color'),
        variant: pVariant(2, '0 hero, 1 abstract spiral, 2 bust on column'),
    },
    run(p, api) {
        const H = p.num('height');
        const c = p.color('color');
        const ped = p.color('pedestalColor');
        const variant = p.int('variant');
        const pedH = H * (variant === 2 ? 0.55 : 0.3);
        const pw = H * 0.32;
        const mat = c === '#b08d57' ? { ...MAT.metal } : { ...MAT.stone };
        if (variant === 2) {
            piece(api, api.box(pw * 1.2, pedH * 0.08, pw * 1.2).translate(0, pedH * 0.04, 0), ped, MAT.stone, 0.08);
            const col = api.cylinder(pw * 0.32, pw * 0.36, pedH * 0.84, 16).translate(0, pedH * 0.5, 0);
            const f0 = lin(shade(ped, -0.15));
            const f1 = lin(shade(ped, 0.1));
            col.paintFn((x, _y, z, _nx, _ny, _nz, out) => mixLinear(f0, f1, Math.floor(((Math.atan2(x, z) + Math.PI) / (Math.PI * 2)) * 16) % 2 ? 0.2 : 0.85, out));
            api.add(col, MAT.stone);
            piece(api, api.box(pw, pedH * 0.08, pw).translate(0, pedH * 0.96, 0), ped, MAT.stone, 0.08);
            const bustH = H - pedH;
            const shoulders = api.lathe([[0, 0], [bustH * 0.32, 0], [bustH * 0.34, bustH * 0.18], [bustH * 0.2, bustH * 0.36], [bustH * 0.08, bustH * 0.42], [0, bustH * 0.42]], 10).scale(1, 1, 0.6).translate(0, pedH, 0);
            piece(api, shoulders, c, mat, 0.08);
            piece(api, api.icosphere(bustH * 0.2, 2).scale(0.85, 1.05, 0.95).translate(0, pedH + bustH * 0.62, 0), c, mat, 0.06);
            piece(api, api.box(bustH * 0.07, bustH * 0.09, bustH * 0.08).translate(0, pedH + bustH * 0.6, bustH * 0.2), c, mat, 0.05);
            api.collider(cylinderCollider(0, pedH / 2, 0, pw * 0.6, pedH));
            api.collider(cylinderCollider(0, pedH + bustH * 0.45, 0, bustH * 0.3, bustH * 0.9));
            return api.build();
        }
        piece(api, api.box(pw * 1.3, pedH * 0.25, pw * 1.3).translate(0, pedH * 0.125, 0), shade(ped, -0.1), MAT.stone, 0.08);
        piece(api, api.box(pw, pedH * 0.6, pw).translate(0, pedH * 0.55, 0), ped, MAT.stone, 0.08);
        piece(api, api.box(pw * 1.12, pedH * 0.15, pw * 1.12).translate(0, pedH * 0.925, 0), shade(ped, 0.08), MAT.stone, 0.08);
        api.collider(boxCollider(0, pedH / 2, 0, pw * 1.3, pedH, pw * 1.3));
        const fh = H - pedH;
        if (variant === 1) {
            const path = [];
            for (let i = 0; i <= 40; i++) {
                const t = i / 40;
                const a = t * Math.PI * 5;
                const r = fh * 0.22 * (1 - t * 0.7);
                path.push([Math.cos(a) * r, pedH + t * fh, Math.sin(a) * r]);
            }
            piece(api, api.tube(path, fh * 0.05, 8, (t) => 1.2 - 0.7 * t), c, MAT.metal, 0.1);
            piece(api, api.sphere(fh * 0.07, 1).translate(0, pedH + fh * 1.02, 0), '#e5b93c', MAT.metal, 0.05);
            api.collider(cylinderCollider(0, pedH + fh / 2, 0, fh * 0.25, fh));
            return api.build();
        }
        const u = fh / 1.9;
        const y0 = pedH;
        const limb = (a, b, r0, r1) => {
            piece(api, api.limb([a[0] * u, y0 + a[1] * u, a[2] * u], [b[0] * u, y0 + b[1] * u, b[2] * u], r0 * u, r1 * u, 7), c, mat, 0.08);
        };
        limb([-0.12, 0, 0.05], [-0.11, 0.48, 0], 0.07, 0.08);
        limb([-0.11, 0.48, 0], [-0.1, 0.92, 0], 0.08, 0.1);
        limb([0.12, 0, -0.08], [0.11, 0.46, 0.02], 0.07, 0.08);
        limb([0.11, 0.46, 0.02], [0.1, 0.92, 0], 0.08, 0.1);
        const torso = api.lathe([[0, 0], [0.17, 0.02], [0.2, 0.3], [0.24, 0.5], [0.12, 0.62], [0, 0.64]], 9).scale(u, u, u * 0.62).translate(0, y0 + 0.88 * u, 0);
        piece(api, torso, c, mat, 0.08);
        piece(api, api.icosphere(0.12 * u, 1).scale(0.9, 1.1, 1).translate(0, y0 + 1.66 * u, 0), c, mat, 0.06);
        limb([0.22, 1.42, 0], [0.38, 1.7, 0.05], 0.06, 0.05);
        limb([0.38, 1.7, 0.05], [0.42, 1.95, 0.05], 0.05, 0.045);
        limb([-0.22, 1.42, 0], [-0.3, 1.15, 0.1], 0.06, 0.05);
        limb([-0.3, 1.15, 0.1], [-0.28, 0.9, 0.18], 0.05, 0.045);
        const sword = api.box(0.035 * u, 0.75 * u, 0.012 * u).translate(0.42 * u, y0 + 2.3 * u, 0.05 * u);
        piece(api, sword, '#d9dde3', MAT.metal, 0.05);
        piece(api, api.box(0.2 * u, 0.03 * u, 0.04 * u).translate(0.42 * u, y0 + 1.95 * u, 0.05 * u), '#e5b93c', MAT.metal, 0.05);
        const cape = api.extrude([[-0.2, 1.5], [0.2, 1.5], [0.3, 0.55], [0, 0.45], [-0.3, 0.55]], 0.03).scale(u, u, u).translate(0, y0, -0.16 * u);
        piece(api, cape, shade(c, -0.12), mat, 0.08);
        api.collider(cylinderCollider(0, y0 + 0.9 * u, 0, 0.3 * u, 1.8 * u));
        return api.build();
    },
});
/** Prop generators in catalog order. */
export const PROP_GENERATORS = [lampPost, bench, table, chair, crate, barrel, campfire, tent, dock, statue];
