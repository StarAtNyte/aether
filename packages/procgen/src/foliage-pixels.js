/**
 * Procedural foliage cards: RGBA8 images of leaf clusters, needle sprays, grass blades and fern fronds
 * with a hard-cut alpha (the renderer draws them alpha-tested, so they need no sorting and cast real
 * leaf shadows). A tree is a few hundred quads carrying these, not tens of thousands of leaves.
 *
 * - Colours are neutral-green *ratios* around 0.7-1.0: the card's vertex colours (shade inside the
 *   crown, light on top, an autumn tint) multiply them, so one texture serves every season.
 * - Pixels under transparent areas hold the card's mean colour, so mip levels never pick up a dark
 *   halo around the cut-out.
 * - Pure and deterministic (seeded per kind): identical in the compute worker, inline and in tests.
 */
import { rng } from '@aether/core';
/** Default card edge length in pixels. */
export const FOLIAGE_TEXTURE_SIZE = 256;
/** Largest edge the synthesiser accepts. */
export const MAX_FOLIAGE_TEXTURE_SIZE = 1024;
/** Alpha at or above which a pixel is solid (the renderer's alpha test). */
export const FOLIAGE_ALPHA_CUT = 128;
/** A card under construction: colour and coverage per pixel. */
class Canvas {
    n;
    rgb;
    a;
    constructor(n) {
        this.n = n;
        this.rgb = new Float32Array(n * n * 3);
        this.a = new Float32Array(n * n);
    }
    /** Paint `color` where `dist(px, py)` (pixels, negative inside) says so, within a bounding box. */
    stamp(x0, y0, x1, y1, dist, color) {
        const n = this.n;
        const ix0 = Math.max(0, Math.floor(x0));
        const iy0 = Math.max(0, Math.floor(y0));
        const ix1 = Math.min(n - 1, Math.ceil(x1));
        const iy1 = Math.min(n - 1, Math.ceil(y1));
        for (let y = iy0; y <= iy1; y++) {
            for (let x = ix0; x <= ix1; x++) {
                const d = dist(x + 0.5, y + 0.5);
                const cover = Math.min(1, Math.max(0, 0.5 - d));
                if (cover <= 0)
                    continue;
                const i = y * n + x;
                const c = color(x + 0.5, y + 0.5);
                const prev = this.a[i];
                // "Over": the new shape covers the old by `cover`; where nothing was drawn it takes the colour outright.
                const w = prev <= 0 ? 1 : cover;
                this.rgb[i * 3] = this.rgb[i * 3] * (1 - w) + c[0] * w;
                this.rgb[i * 3 + 1] = this.rgb[i * 3 + 1] * (1 - w) + c[1] * w;
                this.rgb[i * 3 + 2] = this.rgb[i * 3 + 2] * (1 - w) + c[2] * w;
                this.a[i] = Math.max(prev, cover);
            }
        }
    }
    /** RGBA8 with the mean colour under transparent pixels. */
    bake() {
        const n = this.n;
        const out = new Uint8Array(n * n * 4);
        let r = 0;
        let g = 0;
        let b = 0;
        let count = 0;
        for (let i = 0; i < n * n; i++) {
            if (this.a[i] >= 0.5) {
                r += this.rgb[i * 3];
                g += this.rgb[i * 3 + 1];
                b += this.rgb[i * 3 + 2];
                count++;
            }
        }
        const mean = count > 0 ? [r / count, g / count, b / count] : [0.7, 0.85, 0.5];
        for (let i = 0; i < n * n; i++) {
            const solid = this.a[i] > 0;
            const k = i * 4;
            out[k] = to8(solid ? this.rgb[i * 3] : mean[0]);
            out[k + 1] = to8(solid ? this.rgb[i * 3 + 1] : mean[1]);
            out[k + 2] = to8(solid ? this.rgb[i * 3 + 2] : mean[2]);
            out[k + 3] = Math.round(Math.min(1, this.a[i] * 1.0) * 255);
        }
        return out;
    }
}
function to8(v) {
    return Math.max(0, Math.min(255, Math.round(v * 255)));
}
/** Distance (pixels) from a point to the segment a-b. */
function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
/**
 * One leaf: an ovate blade from (cx, cy) along `angle` (radians, 0 = +x, y down), `len` long and `wid` wide,
 * with a pointed tip, a pale midrib and a darker rim.
 */
function leaf(c, cx, cy, angle, len, wid, tone, tint) {
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    const reach = len + wid;
    const hw = wid / 2;
    c.stamp(cx - reach, cy - reach, cx + reach, cy + reach, (px, py) => {
        const dx = px - cx;
        const dy = py - cy;
        const x = dx * ca + dy * sa;
        const y = -dx * sa + dy * ca;
        const u = x / len;
        if (u < -0.05 || u > 1.05)
            return Math.hypot(Math.min(0, x) + Math.max(0, x - len), y) + 0.5;
        const w = hw * Math.pow(Math.max(0, Math.sin(Math.PI * Math.min(1, Math.max(0, u)) ** 0.78)), 0.85) * (1 - 0.18 * u);
        return Math.abs(y) - w;
    }, (px, py) => {
        const dx = px - cx;
        const dy = py - cy;
        const x = dx * ca + dy * sa;
        const y = -dx * sa + dy * ca;
        const u = Math.min(1, Math.max(0, x / len));
        const w = hw * Math.pow(Math.max(0, Math.sin(Math.PI * u ** 0.78)), 0.85) * (1 - 0.18 * u) + 1e-3;
        const rim = Math.min(1, Math.abs(y) / w);
        const rib = Math.max(0, 1 - Math.abs(y) / 0.9) * 0.16;
        const k = tone * (1 - 0.2 * rim * rim) + rib - 0.12 * (1 - u);
        return [tint[0] * k, tint[1] * k, tint[2] * k];
    });
}
/** A thick line with round ends. */
function stroke(c, ax, ay, bx, by, width, color) {
    const hw = width / 2;
    const l2 = (bx - ax) ** 2 + (by - ay) ** 2;
    c.stamp(Math.min(ax, bx) - hw - 1, Math.min(ay, by) - hw - 1, Math.max(ax, bx) + hw + 1, Math.max(ay, by) + hw + 1, (px, py) => segDist(px, py, ax, ay, bx, by) - hw, (px, py) => color(l2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / l2))));
}
const WOOD = [0.5, 0.4, 0.3];
function broadleafCard(n, small) {
    const r = rng(small ? 0x5b1e : 0x0a1f);
    const c = new Canvas(n);
    // A short leafy twig from the bottom centre: leaves sit along it and at its end, fanning outward.
    const base = [n * 0.5, n * 0.96];
    const count = small ? 54 : 30;
    const len = n * (small ? 0.19 : 0.26);
    const wid = len * (small ? 0.58 : 0.62);
    const items = [];
    for (let i = 0; i < count; i++) {
        const t = r();
        const spread = (r() - 0.5) * 2;
        const reach = (0.12 + 0.62 * Math.sqrt(t)) * n;
        const ang = -Math.PI / 2 + spread * (0.35 + 0.6 * t);
        const x = base[0] + Math.cos(ang) * reach * (0.55 + 0.5 * Math.abs(spread));
        const y = base[1] - Math.sin(-ang) * reach * 0.0 + Math.sin(ang) * reach;
        items.push({ x, y, a: -Math.PI / 2 + spread * (0.9 + 0.5 * r()) + (r() - 0.5) * 0.5, tone: 0.72 + r() * 0.3, s: 0.8 + r() * 0.45 });
    }
    // Back to front: lower leaves first.
    items.sort((p, q) => q.y - p.y);
    for (const it of items)
        stroke(c, base[0] + (it.x - base[0]) * 0.35, base[1] + (it.y - base[1]) * 0.35, it.x, it.y, 1.6, () => WOOD);
    for (const it of items)
        leaf(c, it.x, it.y, it.a, len * it.s, wid * it.s, it.tone, [0.86, 0.98, 0.62]);
    return c.bake();
}
function needleCard(n) {
    const r = rng(0x7e21);
    const c = new Canvas(n);
    // A spray along +x (the branch) with paired needles sweeping forward: twig at mid height, tip on the right.
    const mid = n * 0.5;
    const pairs = 52;
    stroke(c, n * 0.02, mid, n * 0.98, mid + (r() - 0.5) * 3, 3.2, (t) => [WOOD[0] * (1 - 0.2 * t), WOOD[1] * (1 - 0.2 * t), WOOD[2] * (1 - 0.2 * t)]);
    for (let i = 0; i < pairs; i++) {
        const t = (i + r() * 0.6) / pairs;
        const x = n * (0.06 + 0.9 * t);
        for (const sd of [-1, 1]) {
            const ang = (0.9 + r() * 0.35) * sd; // radians off the twig direction
            const len = n * (0.3 - 0.18 * t) * (0.8 + r() * 0.4);
            const dx = Math.cos(ang) * len;
            const dy = Math.sin(ang) * len;
            const tone = 0.7 + r() * 0.3;
            stroke(c, x, mid, x + dx, mid + dy, 3.6 - 1.2 * t, (u) => [0.78 * tone * (0.82 + 0.28 * u), 0.96 * tone * (0.82 + 0.3 * u), 0.62 * tone * (0.8 + 0.2 * u)]);
        }
    }
    return c.bake();
}
function grassCard(n) {
    const r = rng(0x6a55);
    const c = new Canvas(n);
    // Many thin, curved blades of different heights (a real tuft is dozens of hair-fine blades, not a few fat ones).
    const blades = 44;
    for (let i = 0; i < blades; i++) {
        const x0 = n * (0.08 + 0.84 * r());
        const tall = r() < 0.3;
        const h = n * ((tall ? 0.72 : 0.38) + (tall ? 0.26 : 0.3) * r());
        const lean = (r() - 0.5) * n * 0.42;
        const bend = (r() - 0.5) * n * 0.16;
        const w0 = n * (0.009 + 0.011 * r());
        const tone = 0.62 + r() * 0.38;
        const dry = r() < 0.14;
        const top = n - h;
        c.stamp(Math.min(x0, x0 + lean + bend) - w0 - 3, top - 2, Math.max(x0, x0 + lean + bend) + w0 + 3, n, (px, py) => {
            const t = Math.min(1, Math.max(0, (n - py) / h));
            if (py < top - 1)
                return 5;
            const xc = x0 + lean * t * t + bend * Math.sin(t * Math.PI);
            const w = w0 * Math.pow(Math.max(0, 1 - t), 0.6) + 0.3;
            return Math.abs(px - xc) - w;
        }, (_px, py) => {
            const t = Math.min(1, Math.max(0, (n - py) / h));
            return dry ? [0.95 * tone, 0.88 * tone, 0.55 * tone] : [(0.5 + 0.45 * t) * tone, (0.74 + 0.24 * t) * tone, (0.34 + 0.2 * t) * tone];
        });
    }
    return c.bake();
}
function fernCard(n) {
    const r = rng(0x3f09);
    const c = new Canvas(n);
    // A frond along +x with a gentle droop; leaflets in pairs shrinking toward the tip.
    const rib = (t) => [n * (0.03 + 0.94 * t), n * (0.5 + 0.12 * t * t)];
    let prev = rib(0);
    for (let i = 1; i <= 24; i++) {
        const p = rib(i / 24);
        stroke(c, prev[0], prev[1], p[0], p[1], 3, () => [0.5, 0.55, 0.38]);
        prev = p;
    }
    for (let i = 1; i <= 17; i++) {
        const t = i / 18;
        const p = rib(t);
        const len = n * 0.34 * Math.sin(Math.PI * Math.min(1, 0.12 + t * 0.9)) * (1 - 0.35 * t) + n * 0.03;
        for (const sd of [-1, 1]) {
            const ang = sd * (1.05 - 0.4 * t + (r() - 0.5) * 0.12);
            leaf(c, p[0], p[1], ang, len * (0.9 + r() * 0.2), len * 0.2, 0.7 + r() * 0.3, [0.8, 0.98, 0.6]);
        }
    }
    return c.bake();
}
/** A round blossom: five overlapping petals around a slightly darker heart (a neutral card: the vertex colour tints it). */
function blossom(c, cx, cy, r, tone) {
    const petals = 5;
    const rot = (cx * 0.37 + cy * 0.21) % (Math.PI * 2);
    for (let k = 0; k < petals; k++) {
        const a = rot + (k / petals) * Math.PI * 2;
        const px = cx + Math.cos(a) * r * 0.5;
        const py = cy + Math.sin(a) * r * 0.5;
        const pr = r * 0.52;
        c.stamp(px - pr - 1, py - pr - 1, px + pr + 1, py + pr + 1, (x, y) => Math.hypot(x - px, y - py) - pr, (x, y) => {
            const edge = Math.hypot(x - px, y - py) / pr;
            const k2 = tone * (1 - 0.1 * edge * edge);
            return [k2, k2 * 0.97, k2 * 0.98];
        });
    }
    c.stamp(cx - r * 0.25, cy - r * 0.25, cx + r * 0.25, cy + r * 0.25, (x, y) => Math.hypot(x - cx, y - cy) - r * 0.2, () => [tone * 0.7, tone * 0.62, tone * 0.5]);
}
function blossomCard(n) {
    const r = rng(0xb105);
    const c = new Canvas(n);
    // A flowering twig from the bottom centre: sprays of blossoms along and at the end of dark side twigs.
    const base = [n * 0.5, n * 0.97];
    const spots = [];
    for (let i = 0; i < 46; i++) {
        const t = r();
        const spread = (r() - 0.5) * 2;
        const reach = (0.1 + 0.66 * Math.sqrt(t)) * n;
        const ang = -Math.PI / 2 + spread * (0.3 + 0.62 * t);
        spots.push({ x: base[0] + Math.cos(ang) * reach * (0.6 + 0.45 * Math.abs(spread)), y: base[1] + Math.sin(ang) * reach, s: 0.8 + r() * 0.5, tone: 0.8 + r() * 0.2 });
    }
    spots.sort((p, q) => q.y - p.y);
    for (const it of spots)
        stroke(c, base[0] + (it.x - base[0]) * 0.3, base[1] + (it.y - base[1]) * 0.3, it.x, it.y, 1.8, () => [0.32, 0.26, 0.22]);
    for (const it of spots)
        blossom(c, it.x, it.y, n * 0.075 * it.s, it.tone);
    return c.bake();
}
function flowerCard(n) {
    const r = rng(0xf10e);
    const c = new Canvas(n);
    // A clump of slim stems topped with open flowers. The card is neutral: the generator's vertex colours run from
    // leaf green at the bottom to the flower colour at the top, so stems come out green and heads coloured.
    const stems = 11;
    for (let i = 0; i < stems; i++) {
        const x0 = n * (0.12 + 0.76 * r());
        const h = n * (0.45 + 0.45 * r());
        const lean = (r() - 0.5) * n * 0.22;
        const topX = x0 + lean;
        const topY = n - h;
        stroke(c, x0, n, topX, topY, 1.6, () => [0.78, 0.84, 0.66]);
        // A pair of narrow leaves low on the stem.
        leaf(c, x0, n - h * 0.25, -Math.PI / 2 - 0.9, n * 0.12, n * 0.035, 0.75, [0.78, 0.9, 0.62]);
        leaf(c, x0, n - h * 0.3, -Math.PI / 2 + 0.9, n * 0.1, n * 0.03, 0.7, [0.78, 0.9, 0.62]);
        const pr = n * (0.045 + 0.03 * r());
        blossom(c, topX, topY, pr * 1.5, 0.85 + 0.15 * r());
    }
    return c.bake();
}
/**
 * RGBA8 pixels (`size × size`) of a foliage card. Deterministic; `size` is clamped to a power of two between
 * 32 and {@link MAX_FOLIAGE_TEXTURE_SIZE}.
 */
export function foliagePixels(kind, size = FOLIAGE_TEXTURE_SIZE) {
    const n = Math.max(32, Math.min(MAX_FOLIAGE_TEXTURE_SIZE, 2 ** Math.round(Math.log2(Math.max(32, size)))));
    switch (kind) {
        case 'broadleaf':
            return { size: n, rgba: broadleafCard(n, false) };
        case 'shrub':
            return { size: n, rgba: broadleafCard(n, true) };
        case 'needles':
            return { size: n, rgba: needleCard(n) };
        case 'grass':
            return { size: n, rgba: grassCard(n) };
        case 'fern':
            return { size: n, rgba: fernCard(n) };
        case 'blossom':
            return { size: n, rgba: blossomCard(n) };
        case 'flower':
            return { size: n, rgba: flowerCard(n) };
    }
}
