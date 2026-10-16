import { MeshBuilder } from '../kernel/mesh';
import { boxCollider, cylinderCollider } from '../colliders';
import { mixLinear } from '../color';
import { defineGenerator, glow, hullOf, lin, MAT, paintNoise, paintSolid, pColor, pNum, pVariant, shade } from './kit';
function piece(api, mesh, color, material, variation = 0.08, freq = 3) {
    paintNoise(mesh, api, shade(color, -variation), shade(color, variation), freq);
    api.add(mesh, material);
    return mesh;
}
const car = defineGenerator({
    id: 'car',
    description: 'Stylized car facing +X: painted body with wheel arches, glass cabin, 4 wheels with rims, emissive head/tail lights. Sedan, pickup or van.',
    category: 'vehicles',
    params: {
        length: pNum(4, 2, 8, 'length in meters'),
        color: pColor('#d6322f', 'paint color'),
        variant: pVariant(2, '0 sedan, 1 pickup truck, 2 van'),
    },
    run(p, api) {
        const L = p.num('length');
        const variant = p.int('variant');
        const W = L * 0.45;
        const wr = L * 0.088;
        const clear = wr * 0.55;
        const H1 = wr * 2.25 + (variant === 1 ? wr * 0.25 : 0);
        const paint = p.color('color');
        const xF = L * 0.32;
        const xR = -L * 0.3;
        const ar = wr * 1.18;
        // side silhouette with wheel arches (concave polygon, extruded across Z)
        const side = [[-L / 2, clear], [xR - ar, clear]];
        const arch = (cx) => {
            for (let i = 0; i <= 8; i++) {
                const a = Math.PI - (i / 8) * Math.PI;
                side.push([cx + Math.cos(a) * ar, wr + Math.sin(a) * ar * 0.95]);
            }
        };
        arch(xR);
        side.push([xF - ar, clear]);
        arch(xF);
        side.push([L / 2 - wr * 0.2, clear], [L / 2, wr * 1.1], [L / 2, H1 * 0.78], [L / 2 - wr * 1.1, H1], [-L / 2 + wr * 0.4, H1], [-L / 2, H1 * 0.85]);
        const body = api.extrude(side, W);
        const b0 = lin(shade(paint, -0.18));
        const b1 = lin(shade(paint, 0.1));
        body.paintFn((_x, y, _z, _nx, ny, _nz, out) => mixLinear(b0, b1, (y - clear) / (H1 - clear) * 0.8 + (ny > 0.5 ? 0.3 : 0), out));
        api.add(body, MAT.paint);
        // cabin (glass) + roof + pillars
        const cabH = variant === 2 ? H1 * 0.95 : H1 * 0.62;
        const c0 = variant === 1 ? -L * 0.12 : variant === 2 ? -L / 2 + wr * 0.3 : -L * 0.3;
        const c1 = variant === 2 ? L * 0.3 : L * 0.16;
        const slopeF = variant === 2 ? wr * 1.2 : wr * 1.5;
        const slopeR = variant === 1 ? wr * 0.2 : variant === 2 ? wr * 0.1 : wr * 1.0;
        const cabW = W * 0.86;
        const cabin = api.extrude([[c0, H1], [c1, H1], [c1 - slopeF, H1 + cabH], [c0 + slopeR, H1 + cabH]], cabW);
        api.add(cabin, { preset: 'glass', color: '#1f2c3a', roughness: 0.05, metalness: 0.3 });
        piece(api, api.box(c1 - slopeF - c0 - slopeR + 0.1, wr * 0.12, cabW + 0.04).translate((c1 - slopeF + c0 + slopeR) / 2, H1 + cabH, 0), paint, MAT.paint, 0.05);
        for (const sz of [-1, 1]) {
            const z = (sz * (cabW + 0.02)) / 2;
            const pillar = (bx, tx) => {
                piece(api, api.limb([bx, H1, z], [tx, H1 + cabH, z], wr * 0.08, wr * 0.08, 4), paint, MAT.paint, 0.04);
            };
            pillar(c1, c1 - slopeF);
            pillar(c0, c0 + slopeR);
            pillar((c0 + c1) / 2 + wr * 0.2, (c0 + c1) / 2 + wr * 0.2 - (slopeF - slopeR) * 0.3);
            piece(api, api.box(wr * 0.3, wr * 0.18, wr * 0.15).translate(c1 - wr * 0.2, H1 + wr * 0.25, sz * (W / 2 + wr * 0.08)), paint, MAT.paint, 0.04);
        }
        if (variant === 1) {
            // pickup bed walls
            const bx0 = -L / 2 + wr * 0.1;
            const bx1 = c0 - wr * 0.1;
            for (const sz of [-1, 1])
                piece(api, api.box(bx1 - bx0, wr * 0.6, wr * 0.12).translate((bx0 + bx1) / 2, H1 + wr * 0.3, (sz * (W - wr * 0.12)) / 2), paint, MAT.paint, 0.05);
            piece(api, api.box(wr * 0.12, wr * 0.6, W).translate(bx0 + wr * 0.06, H1 + wr * 0.3, 0), paint, MAT.paint, 0.05);
            piece(api, api.box(bx1 - bx0, wr * 0.04, W * 0.94).translate((bx0 + bx1) / 2, H1 + wr * 0.02, 0), '#2a2a2e', MAT.plastic, 0.05);
        }
        // wheels
        for (const x of [xF, xR]) {
            for (const sz of [-1, 1]) {
                const z = sz * (W / 2 - wr * 0.3);
                api.add(api.cylinder(wr, wr, wr * 0.7, 14).rotate(90, 0, 0).translate(x, wr, z), MAT.rubber);
                piece(api, api.cylinder(wr * 0.58, wr * 0.58, wr * 0.74, 8).rotate(90, 0, 0).translate(x, wr, z), '#c9ced6', MAT.metal, 0.06);
                piece(api, api.cylinder(wr * 0.15, wr * 0.15, wr * 0.8, 6).rotate(90, 0, 0).translate(x, wr, z), '#4a4e55', MAT.metal, 0.04);
            }
        }
        // bumpers, grille, lights
        piece(api, api.box(wr * 0.3, wr * 0.45, W * 1.02).translate(L / 2 + wr * 0.05, wr * 1.1, 0), '#2a2b30', MAT.plastic, 0.05);
        piece(api, api.box(wr * 0.3, wr * 0.45, W * 1.02).translate(-L / 2 - wr * 0.05, wr * 1.1, 0), '#2a2b30', MAT.plastic, 0.05);
        piece(api, api.box(wr * 0.1, wr * 0.5, W * 0.4).translate(L / 2 + 0.005, H1 * 0.62, 0), '#16171a', MAT.plastic, 0.03);
        for (const sz of [-1, 1]) {
            api.add(api.box(wr * 0.12, wr * 0.32, W * 0.2).translate(L / 2 + 0.01, H1 * 0.65, sz * W * 0.33), glow('#fff4d6', 3));
            api.add(api.box(wr * 0.12, wr * 0.28, W * 0.18).translate(-L / 2 - 0.01, H1 * 0.7, sz * W * 0.35), glow('#ff2a2a', 2.5));
        }
        api.collider(boxCollider(0, (clear + H1) / 2, 0, L, H1 - clear, W));
        api.collider(boxCollider((c0 + c1) / 2, H1 + cabH / 2, 0, c1 - c0, cabH, cabW));
        api.collider(boxCollider(0, wr * 0.8, 0, L * 0.92, wr * 1.6, W));
        return api.build();
    },
});
/** Lofted boat hull: stations along X from stern to bow, V-shaped sections. Open at the top. */
function hull(api, L, W, D, stations, ring) {
    const b = new MeshBuilder((stations + 1) * (ring + 1) + ring + 2, stations * ring * 6 + ring * 3);
    const halfWidth = (t) => {
        const bow = Math.max(0, (t - 0.5) / 0.5);
        const stern = 0.82 + 0.18 * Math.min(1, t / 0.2);
        return (W / 2) * stern * Math.max(0.0, 1 - Math.pow(bow, 1.8));
    };
    const depth = (t) => D * (1 - 0.55 * Math.pow(Math.max(0, (t - 0.6) / 0.4), 2)) * (0.85 + 0.15 * Math.min(1, t / 0.15));
    const sheer = (t) => D * 0.22 * Math.pow(Math.max(0, (t - 0.55) / 0.45), 2);
    for (let i = 0; i <= stations; i++) {
        const t = i / stations;
        const x = -L / 2 + t * L;
        const w = Math.max(i === stations ? 0 : 0.002, halfWidth(t));
        const d = depth(t);
        for (let k = 0; k <= ring; k++) {
            const th = -Math.PI / 2 + (k / ring) * Math.PI;
            const z = Math.sin(th) * w;
            const y = sheer(t) - Math.pow(Math.cos(th), 0.75) * d;
            b.vertex(x, y, z, 0, 0, Math.sign(z), t, k / ring);
        }
    }
    for (let i = 0; i < stations; i++) {
        for (let k = 0; k < ring; k++) {
            const a = i * (ring + 1) + k;
            const c = a + ring + 1;
            b.quad(a, c, c + 1, a + 1);
        }
    }
    // transom (stern plate)
    const center = b.vertex(-L / 2, sheer(0) - depth(0) * 0.35, 0, -1, 0, 0, 0.5, 0.5);
    for (let k = 0; k < ring; k++)
        b.tri(center, k, k + 1);
    const mesh = api.fromBuilder(b).recomputeNormals();
    // orient outward: side vertices must have normals pointing away from the centerline
    let score = 0;
    const pos = mesh.positions;
    const nrm = mesh.normals;
    for (let i = 0; i < pos.length; i += 3)
        score += nrm[i + 2] * pos[i + 2] - nrm[i + 1] * 0.01;
    if (score < 0) {
        mesh.flipWinding();
        for (let i = 0; i < nrm.length; i++)
            nrm[i] = -nrm[i];
    }
    return mesh;
}
const boat = defineGenerator({
    id: 'boat',
    description: 'Boat facing +X with a lofted V hull: wooden rowboat with oars, sailboat with mast and sails, or motorboat with cabin.',
    category: 'vehicles',
    params: {
        length: pNum(5, 2, 30, 'length in meters'),
        color: pColor('#f2efe6', 'hull color'),
        accentColor: pColor('#2c5d8a', 'stripe / trim color'),
        variant: pVariant(2, '0 rowboat, 1 sailboat, 2 motorboat'),
    },
    run(p, api) {
        const L = p.num('length');
        const variant = p.int('variant');
        const W = L * (variant === 0 ? 0.36 : 0.32);
        const D = L * (variant === 0 ? 0.12 : 0.14);
        const hullC = variant === 0 && p.color('color') === '#f2efe6' ? '#9a6a3c' : p.color('color');
        const accent = p.color('accentColor');
        const h = hull(api, L, W, D, 14, 10);
        const c0 = lin(shade(hullC, -0.12));
        const c1 = lin(shade(hullC, 0.06));
        const stripe = lin(accent);
        const bottom = lin('#7a2b26');
        h.paintFn((x, y, z, _nx, _ny, _nz, out) => {
            if (variant === 0) {
                mixLinear(c0, c1, (Math.floor((y + D) * 9 / D) % 2) * 0.6 + 0.15 * api.noise.noise3(x * 3, y * 3, z * 3), out);
                return;
            }
            mixLinear(c0, c1, 0.5 + 0.3 * api.noise.noise3(x, y * 4, z), out);
            if (y > -D * 0.18)
                mixLinear(out, stripe, 1, out);
            else if (y < -D * 0.62)
                mixLinear(out, bottom, 1, out);
        });
        if (variant === 0) {
            api.add(h, MAT.wood);
            const inner = h.clone().flipWinding();
            const n = inner.normals;
            for (let i = 0; i < n.length; i++)
                n[i] = -n[i];
            paintNoise(inner, api, shade(hullC, -0.3), shade(hullC, -0.1), 3);
            api.add(inner, MAT.wood);
            for (const f of [-0.25, 0.12]) {
                piece(api, api.box(L * 0.09, D * 0.08, W * 0.86 * (f > 0 ? 0.92 : 1)).translate(f * L, -D * 0.3, 0), shade(hullC, 0.1), MAT.wood, 0.06);
            }
            for (const sz of [-1, 1]) {
                const a = [-L * 0.05, -D * 0.05, sz * W * 0.4];
                const b2 = [L * 0.25, -D * 0.4, sz * W * 1.05];
                piece(api, api.limb(a, b2, L * 0.012, L * 0.012, 5), '#c49a5e', MAT.wood, 0.05);
                piece(api, api.box(L * 0.14, L * 0.006, L * 0.05).rotate(0, sz * -28, -8).translate(b2[0] + L * 0.05, b2[1] - D * 0.08, b2[2] + sz * L * 0.025), '#c49a5e', MAT.wood, 0.05);
            }
        }
        else {
            api.add(h, MAT.paint);
            // deck: outline from the gunwale, slightly below the sheer
            const deckPts = [];
            const ring = 10;
            const pos = h.positions;
            for (let i = 0; i <= 14; i++)
                deckPts.push([pos[(i * (ring + 1)) * 3], pos[(i * (ring + 1)) * 3 + 2]]);
            for (let i = 14; i >= 0; i--)
                deckPts.push([pos[(i * (ring + 1) + ring) * 3], pos[(i * (ring + 1) + ring) * 3 + 2]]);
            const clean = deckPts.filter((q, i) => i === 0 || Math.hypot(q[0] - deckPts[i - 1][0], q[1] - deckPts[i - 1][1]) > 1e-4);
            const deck = api.extrude(clean, D * 0.06).rotate(90, 0, 0).translate(0, -D * 0.04, 0);
            piece(api, deck, '#b88a57', MAT.wood, 0.1, 4);
            if (variant === 1) {
                const mastH = L * 1.1;
                const mx = L * 0.08;
                piece(api, api.cylinder(L * 0.012, L * 0.016, mastH, 6).translate(mx, mastH / 2, 0), '#d9d4c7', MAT.metal, 0.04);
                piece(api, api.cylinder(L * 0.01, L * 0.01, L * 0.45, 6).rotate(0, 0, 90).translate(mx - L * 0.22, mastH * 0.12, 0), '#d9d4c7', MAT.metal, 0.04);
                const sail = api.extrude([[0, 0], [-L * 0.44, 0], [-L * 0.01, mastH * 0.86]], L * 0.01).translate(mx - L * 0.01, mastH * 0.14, 0);
                const sw0 = lin('#e9e4d8');
                const sw1 = lin('#ffffff');
                sail.paintFn((_x, y, _z, _nx, _ny, _nz, out) => mixLinear(sw0, sw1, (Math.floor(y * 3) % 2) * 0.6 + 0.2, out));
                api.add(sail, { ...MAT.fabric, flatShading: false });
                const jib = api.extrude([[0, 0], [L * 0.4, 0], [0, mastH * 0.7]], L * 0.008).translate(mx + L * 0.02, mastH * 0.1, 0);
                paintSolid(jib, accent);
                api.add(jib, { ...MAT.fabric, flatShading: false });
                api.collider(cylinderCollider(mx, mastH / 2, 0, L * 0.02, mastH));
            }
            else {
                const cw = W * 0.7;
                piece(api, api.box(L * 0.32, D * 0.9, cw).translate(-L * 0.05, D * 0.45, 0), '#f6f4ee', MAT.paint, 0.04);
                const glass = api.extrude([[0, 0], [L * 0.12, 0], [0, D * 0.6]], cw * 0.95).translate(L * 0.11, D * 0.9, 0);
                api.add(glass, { preset: 'glass', color: '#1f2c3a', roughness: 0.05, metalness: 0.3 });
                piece(api, api.box(L * 0.2, D * 0.08, cw * 1.04).translate(-L * 0.07, D * 0.94, 0), accent, MAT.paint, 0.05);
                piece(api, api.box(L * 0.07, D * 1.1, W * 0.18).translate(-L / 2 - L * 0.02, -D * 0.1, 0), '#2a2b30', MAT.plastic, 0.05);
                for (const sz of [-1, 1])
                    api.add(api.box(L * 0.02, D * 0.1, D * 0.1).translate(L * 0.3, -D * 0.02, sz * W * 0.32), glow(sz > 0 ? '#2aff6a' : '#ff2a2a', 2));
                api.collider(boxCollider(-L * 0.05, D * 0.45, 0, L * 0.32, D * 0.9, cw));
            }
        }
        api.collider(hullOf(h));
        return api.build();
    },
});
/** Vehicle generators in catalog order. */
export const VEHICLE_GENERATORS = [car, boat];
