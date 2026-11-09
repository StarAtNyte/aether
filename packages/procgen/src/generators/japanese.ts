/**
 * Japanese houses: a parametric free-standing house in three presets, each built from the parts the real ones have.
 *
 * - minka (farmhouse): a raised timber floor on stone footings, a deep covered veranda (engawa) on outer posts, shoji
 *   screens in a timber frame, plaster and charred-board walls, a hipped roof of tile or thatch with deep, upturned eaves.
 * - chashitsu (tea house): a small square hut, a covered veranda, a bamboo-lattice window and a crawl-in door
 *   (nijiri-guchi), a thatch-like roof and a stone basin (tsukubai).
 * - machiya (townhouse): narrow and deep, a dark lattice front (koshi), a plaster upper floor with slit windows, a small
 *   lower eave (hisashi) over the entrance, a noren curtain, a hipped tile roof.
 *
 * The roof is a smooth hipped surface (concave slopes, eaves that turn up at the corners) with a visible thickness and
 * rafter tails. The garden (`garden`) adds a gravel apron, stepping stones and the basin. The origin is the middle of the
 * house on the ground; the front (door side) is +Z. Meshes are merged per material (a handful of draws).
 */
import type { MaterialSpec } from '@aether/core';
import type { Mesh } from '../kernel/mesh';
import { boxCollider } from '../colliders';
import { defineGenerator, glow, pBool, pColor, pInt, pNum, shade } from './kit';

type Style = 'minka' | 'chashitsu' | 'machiya';
const STYLES: readonly Style[] = ['minka', 'chashitsu', 'machiya'];

interface Preset {
  w: number;
  d: number;
  /** Wall (post) height above the floor. */
  wh: number;
  floor: number;
  eave: number;
  rise: number;
  veranda: number;
  upper: number;
}

const PRESETS: Record<Style, Preset> = {
  minka: { w: 10, d: 7, wh: 2.55, floor: 0.6, eave: 1.25, rise: 2.7, veranda: 1.3, upper: 0 },
  chashitsu: { w: 3.6, d: 3.6, wh: 2.25, floor: 0.5, eave: 0.95, rise: 1.7, veranda: 0.95, upper: 0 },
  machiya: { w: 5.6, d: 11, wh: 2.7, floor: 0.45, eave: 0.8, rise: 2.5, veranda: 0, upper: 2.3 },
};

const timber = (color: string): MaterialSpec => ({ finish: 'oak', color, roughness: 0.7 });
const plaster = (color: string): MaterialSpec => ({ finish: 'plaster', color, roughness: 0.92 });
const stoneMat = (color: string): MaterialSpec => ({ finish: 'stone', color, roughness: 0.9 });

const japaneseHouse = defineGenerator({
  id: 'japanese-house',
  description:
    'Japanese house, crafted: use it for any Japanese house, tea house (chashitsu), minka, machiya or ryokan, never a European cottage. Raised floor, covered veranda (engawa), shoji screens, hipped roof of tile or thatch with deep upturned eaves; garden:true adds gravel, stepping stones and a basin (flat ground only). `style` 0 minka 10 x 7 m, 1 tea house 3.6 m, 2 machiya 5.6 x 11 m; width/depth 0 = the style\'s own. Front is +Z. Settled on terrain by default.',
  category: 'architecture',
  params: {
    style: pInt(0, 0, 2, '0 minka farmhouse, 1 chashitsu tea house, 2 machiya townhouse'),
    width: pNum(0, 0, 24, 'frontage along X in meters (0 = the style\'s own)'),
    depth: pNum(0, 0, 24, 'depth along Z in meters (0 = the style\'s own)'),
    roofing: pInt(0, 0, 2, '0 the style\'s own (tile, thatch for the tea house), 1 tile, 2 thatch'),
    wallColor: pColor('#e9e0cc', 'plaster wall colour'),
    woodColor: pColor('#5a4130', 'frame, floor and shutter timber'),
    roofColor: pColor('#4a4f52', 'roof tile colour (thatch uses its own straw tone)'),
    garden: pBool(false, 'gravel apron, stepping stones and a stone water basin (tsukubai) in front'),
    lights: pBool(false, 'the shoji glow warmly (evening)'),
    variant: pInt(0, 0, 99, 'changes the proportions and the stepping-stone path'),
  },
  run(p, api) {
    const style = STYLES[p.int('style')] ?? 'minka';
    const pre = PRESETS[style];
    const W = p.num('width') > 0 ? p.num('width') : pre.w;
    const D = p.num('depth') > 0 ? p.num('depth') : pre.d;
    const roofing = p.int('roofing');
    const thatch = roofing === 2 || (roofing === 0 && style === 'chashitsu');
    const wall = p.color('wallColor');
    const woodC = p.color('woodColor');
    const roofC = p.color('roofColor');
    const lit = p.bool('lights');
    const variant = p.int('variant');
    const { wh, floor: fh, eave, veranda } = pre;
    const upperH = pre.upper;
    const rise = pre.rise * (0.9 + ((variant * 37) % 21) / 100);
    const bodyH = wh + upperH;

    const wood = timber(woodC);
    const darkWood = timber(shade(woodC, -0.45));
    const parts = new Map<string, { mat: MaterialSpec; mesh: Mesh | null }>();
    const put = (key: string, mat: MaterialSpec, mesh: Mesh): void => {
      const e = parts.get(key);
      if (e) e.mesh = e.mesh ? e.mesh.merge(mesh) : mesh;
      else parts.set(key, { mat, mesh });
    };
    const box = (key: string, mat: MaterialSpec, w: number, h: number, d: number, x: number, y: number, z: number): void => put(key, mat, api.box(w, h, d).translate(x, y, z));

    // ---- Bays: posts at a regular grid along the front and back, and along the sides ----
    const nx = Math.max(2, Math.round(W / 1.8));
    const nz = Math.max(2, Math.round(D / 2.2));
    const bx = W / nx;
    const postX = (i: number): number => -W / 2 + i * bx;
    const postZ = (j: number): number => -D / 2 + j * (D / nz);

    // ---- Footings, shadowed crawlspace and the floor ----
    // A tint that differs with the size: the renderer batches the parts of identical materials across houses, and a house of another size must not share its footings.
    const footing = stoneMat(shade('#85807a', ((p.int('style') * 7 + Math.round(W * 10) * 3 + Math.round(D * 10) * 5) % 13) * 0.007));
    const postSet: Array<[number, number]> = [];
    for (let i = 0; i <= nx; i++) postSet.push([postX(i), -D / 2], [postX(i), D / 2]);
    for (let j = 1; j < nz; j++) postSet.push([-W / 2, postZ(j)], [W / 2, postZ(j)]);
    for (const [x, z] of postSet) put('footing', footing, api.cylinder(0.17, 0.2, fh, 8).translate(x, fh / 2, z));
    box('crawl', timber('#1d1713'), W - 0.3, fh - 0.08, D - 0.3, 0, (fh - 0.08) / 2, 0);
    const floorMat: MaterialSpec = { finish: 'decking', color: shade(woodC, 0.12), roughness: 0.6 };
    box('floor', floorMat, W + 0.12, 0.12, D + 0.12, 0, fh - 0.06, 0);
    if (style === 'machiya') {
      // The earthen entrance passage (doma) is level with the street: a stone threshold and a step up into the house.
      box('stone', stoneMat('#6f6b66'), 1.5, 0.1, 1.2, -W / 2 + 1.0, 0.05, D / 2 + 0.55);
      box('stone', stoneMat('#6f6b66'), 1.5, fh * 0.55, 0.4, -W / 2 + 1.0, fh * 0.275, D / 2 + 0.2);
    }

    // ---- Veranda (engawa) on outer posts, under the same roof ----
    const frontEdge = D / 2 + veranda;
    if (veranda > 0) {
      const boards = Math.round(veranda / 0.16);
      const bw = veranda / boards;
      for (let k = 0; k < boards; k++) box('engawa', { finish: 'decking', color: shade(woodC, 0.2), roughness: 0.55 }, W + 0.3, 0.07, bw - 0.015, 0, fh - 0.035, D / 2 + bw * (k + 0.5));
      box('beam', wood, W + 0.3, 0.14, 0.12, 0, fh - 0.14, frontEdge - 0.05);
      const np = Math.max(2, Math.round(W / 2.4));
      for (let i = 0; i <= np; i++) {
        const x = -W / 2 + 0.1 + (i * (W - 0.2)) / np;
        put('post', wood, api.box(0.13, wh, 0.13).translate(x, fh + wh / 2, frontEdge - 0.12));
        put('footing', footing, api.cylinder(0.14, 0.17, fh * 0.9, 8).translate(x, fh * 0.45, frontEdge - 0.12));
      }
      // The outer beam (keta) carries the eave.
      box('beam', wood, W + 0.5, 0.22, 0.16, 0, fh + wh - 0.05, frontEdge - 0.12);
    }

    // ---- Posts and head beams of the body ----
    const postH = wh + upperH;
    for (const [x, z] of postSet) put('post', wood, api.box(0.14, postH, 0.14).translate(x, fh + postH / 2, z));
    for (const z of [-D / 2, D / 2]) box('beam', wood, W + 0.14, 0.22, 0.14, 0, fh + wh - 0.11, z);
    for (const x of [-W / 2, W / 2]) box('beam', wood, 0.14, 0.22, D + 0.14, x, fh + wh - 0.11, 0);
    if (upperH > 0) for (const z of [-D / 2, D / 2]) box('beam', wood, W + 0.14, 0.2, 0.14, 0, fh + bodyH - 0.1, z);

    // ---- Walls ----
    const wallMat = plaster(wall);
    const skirt = timber('#241c17');
    const sill = fh + 0.06;
    const shojiMat: MaterialSpec = lit ? glow('#ffe2a8', 0.9) : { finish: 'plaster', color: '#f4ecd6', roughness: 0.95 };
    const kumiko = timber(shade(woodC, -0.3));
    /** One shoji panel (paper in a lattice of thin bars) facing +Z at the front plane. */
    const shoji = (cx: number, pw: number, ph: number, y0: number, z: number): void => {
      box('paper', shojiMat, pw - 0.04, ph - 0.04, 0.025, cx, y0 + ph / 2, z);
      box('kumiko', kumiko, pw, 0.045, 0.05, cx, y0 + 0.02, z);
      box('kumiko', kumiko, pw, 0.045, 0.05, cx, y0 + ph - 0.02, z);
      for (const s of [-1, 1]) box('kumiko', kumiko, 0.045, ph, 0.05, cx + (s * (pw - 0.045)) / 2, y0 + ph / 2, z);
      const hb = Math.max(2, Math.round(ph / 0.32));
      for (let k = 1; k < hb; k++) box('kumiko', kumiko, pw - 0.04, 0.02, 0.04, cx, y0 + (ph * k) / hb, z);
      const vb = Math.max(1, Math.round(pw / 0.34));
      for (let k = 1; k < vb; k++) box('kumiko', kumiko, 0.02, ph - 0.04, 0.04, cx - pw / 2 + (pw * k) / vb, y0 + ph / 2, z);
    };
    const sideWall = (axis: 'x' | 'z', pos: number, len: number, n: number, y0: number, h: number): void => {
      const step = len / n;
      for (let i = 0; i < n; i++) {
        const c = -len / 2 + step * (i + 0.5);
        const tall = h - 0.45;
        const dims: [number, number, number] = axis === 'z' ? [step - 0.14, tall, 0.09] : [0.09, tall, step - 0.14];
        const at = (y: number): [number, number, number] => (axis === 'z' ? [c, y, pos] : [pos, y, c]);
        put('wall', wallMat, api.box(...dims).translate(...at(y0 + 0.62 + (tall - 0.62) / 2)));
        const sd: [number, number, number] = axis === 'z' ? [step - 0.14, 0.62, 0.1] : [0.1, 0.62, step - 0.14];
        put('skirt', skirt, api.box(...sd).translate(...at(y0 + 0.31)));
      }
    };

    if (style === 'machiya') {
      // Ground floor: a dark lattice front (koshi) of fine vertical slats over a dark interior, a noren curtain at the entrance.
      const lat = timber('#2a1f19');
      box('crawl', timber('#181210'), W - 0.2, wh - 0.1, 0.1, 0, fh + wh / 2, D / 2 - 0.2);
      const doorW = 1.4;
      const dx0 = -W / 2 + 0.2;
      const slats = Math.round((W - 0.4 - doorW) / 0.075);
      for (let k = 0; k <= slats; k++) {
        const x = dx0 + doorW + ((W - 0.4 - doorW) * k) / slats;
        put('lattice', lat, api.box(0.035, wh - 0.55, 0.05).translate(x, fh + 0.3 + (wh - 0.55) / 2, D / 2 + 0.02));
      }
      for (const y of [fh + 0.28, fh + 0.9, fh + wh - 0.3]) box('lattice', lat, W - 0.3 - doorW, 0.05, 0.08, doorW / 2, y, D / 2 + 0.03);
      box('noren', { finish: 'plaster', color: '#1e2f4a', roughness: 1 }, doorW - 0.2, 0.75, 0.02, dx0 + doorW / 2, fh + wh - 0.55, D / 2 + 0.05);
      box('noren', { finish: 'plaster', color: '#efe9dc', roughness: 1 }, 0.22, 0.2, 0.025, dx0 + doorW / 2, fh + wh - 0.55, D / 2 + 0.06);
      // Upper floor: plaster with two slit windows (mushiko mado) of vertical bars.
      box('wall', wallMat, W - 0.14, upperH - 0.22, 0.1, 0, fh + wh + (upperH - 0.2) / 2 - 0.0, D / 2 - 0.02);
      for (const cx of [-W * 0.22, W * 0.22]) {
        box('crawl', timber('#181210'), 1.5, 0.6, 0.06, cx, fh + wh + upperH * 0.5, D / 2 + 0.04);
        for (let k = 0; k <= 12; k++) put('lattice', lat, api.box(0.03, 0.6, 0.04).translate(cx - 0.72 + (1.44 * k) / 12, fh + wh + upperH * 0.5, D / 2 + 0.08));
        box('lattice', lat, 1.56, 0.07, 0.07, cx, fh + wh + upperH * 0.5 + 0.33, D / 2 + 0.06);
        box('lattice', lat, 1.56, 0.07, 0.07, cx, fh + wh + upperH * 0.5 - 0.33, D / 2 + 0.06);
      }
      // The small lower eave (hisashi) over the entrance floor, tilted down at the front.
      put('roof', { finish: 'roof-tile', color: roofC, roughness: 0.8 }, api.box(W + 0.5, 0.1, 0.95).rotate(-14, 0, 0).translate(0, fh + wh + 0.02, D / 2 + 0.4));
      box('rafter', wood, W + 0.5, 0.12, 0.08, 0, fh + wh - 0.08, D / 2 + 0.75);
      sideWall('z', -D / 2, W, nx, fh, bodyH);
      sideWall('x', -W / 2, D, nz, fh, bodyH);
      sideWall('x', W / 2, D, nz, fh, bodyH);
    } else {
      // Back and side walls: plaster over a charred-board skirt, with a window on the side.
      sideWall('z', -D / 2, W, nx, fh, wh);
      sideWall('x', -W / 2, D, nz, fh, wh);
      sideWall('x', W / 2, D, nz, fh, wh);
      // Front: shoji in tracks. The bay layout leaves one open (a dark room behind) when the house is large.
      const openBay = style === 'minka' ? Math.floor(nx / 2) : -1;
      box('beam', darkWood, W, 0.07, 0.14, 0, fh + wh - 0.27, D / 2 + 0.01);
      box('beam', darkWood, W, 0.06, 0.14, 0, sill, D / 2 + 0.01);
      for (let i = 0; i < nx; i++) {
        const cx = postX(i) + bx / 2;
        const ph = wh - 0.35 - 0.1;
        if (i === openBay) {
          box('crawl', timber('#2a2018'), bx - 0.14, ph, 0.04, cx, sill + 0.03 + ph / 2, D / 2 - 0.16);
          box('floor', { finish: 'plaster', color: '#bda878', roughness: 1 }, bx - 0.14, 0.04, 0.9, cx, fh + 0.02, D / 2 - 0.4);
          shoji(cx - bx / 4 - 0.02 + bx / 2 - 0.1, bx / 2 - 0.12, ph, sill + 0.03, D / 2 - 0.12);
          continue;
        }
        shoji(cx - bx / 4, bx / 2 - 0.04, ph, sill + 0.03, D / 2 + 0.015);
        shoji(cx + bx / 4, bx / 2 - 0.04, ph, sill + 0.03, D / 2 - 0.035);
      }
      // Transom (ranma): a slatted band above the screens.
      const rn = Math.round(W / 0.12);
      for (let k = 0; k <= rn; k++) put('kumiko', kumiko, api.box(0.022, 0.2, 0.05).translate(-W / 2 + (W * k) / rn, fh + wh - 0.14, D / 2));
      if (style === 'chashitsu') {
        // Crawl-in door (nijiri-guchi) and a bamboo-lattice window on the side wall.
        box('crawl', timber('#2e2218'), 0.66, 0.66, 0.05, W / 2 + 0.006, fh + 0.45, -D * 0.12);
        put('post', wood, api.box(0.03, 0.78, 0.84).translate(W / 2 + 0.03, fh + 0.5, -D * 0.12));
        const bamboo = timber('#9c8a4a');
        for (let k = 0; k < 6; k++) put('bamboo', bamboo, api.cylinder(0.014, 0.014, 0.7, 5).translate(-W / 2 - 0.045, fh + 1.2, -D * 0.2 - 0.35 + k * 0.14));
        for (let k = 0; k < 4; k++) put('bamboo', bamboo, api.cylinder(0.012, 0.012, 0.72, 5).rotate(90, 0, 0).translate(-W / 2 - 0.05, fh + 0.98 + k * 0.14, -D * 0.2));
        box('wall', timber('#1a1410'), 0.04, 0.7, 0.8, -W / 2 - 0.02, fh + 1.2, -D * 0.2);
      }
    }

    // ---- Roof: a smooth hipped surface with concave slopes and eaves that turn up at the corners ----
    const front = Math.max(eave, veranda + 0.45);
    const zMin = -D / 2 - eave;
    const zMax = D / 2 + front;
    const hx = W / 2 + eave;
    const hz = (zMax - zMin) / 2;
    const czr = (zMax + zMin) / 2;
    const eaveY = fh + bodyH + 0.04;
    const umax = Math.min(hx, hz);
    const rf = (x: number, z: number): number => {
      const u = Math.max(0, Math.min(hx - Math.abs(x), hz - Math.abs(z)));
      const t = Math.min(1, u / umax);
      const corner = 0.2 * Math.pow(Math.abs(x) / hx, 7) * Math.pow(Math.abs(z) / hz, 7);
      const lip = u < 0.45 ? 0.09 * Math.pow(1 - u / 0.45, 2) : 0;
      return eaveY + rise * Math.pow(t, 1.35) + corner + lip;
    };
    const thick = thatch ? 0.32 : 0.16;
    const roofMat: MaterialSpec = thatch ? { finish: 'thatch', color: '#a8946a', roughness: 1, doubleSided: true } : { finish: 'roof-tile', color: roofC, roughness: 0.75, doubleSided: true };
    const seg = 44;
    put('roof', roofMat, api.heightfield(seg, seg, hx * 2, hz * 2, rf).translate(0, 0, czr));
    put('soffit', timber(shade(woodC, -0.2)), api.heightfield(seg, seg, hx * 2, hz * 2, (x, z) => rf(x, z) - thick).translate(0, 0, czr));
    // Fascia: a band round the edge of the roof closing the gap between the top and the underside.
    const edge = 64;
    const fasciaMat = thatch ? timber('#8a7650') : timber(shade(roofC, -0.25));
    for (let k = 0; k < edge; k++) {
      const a = (k + 0.5) / edge;
      const x = -hx + 2 * hx * a;
      const z = -hz + 2 * hz * a;
      const sx = (2 * hx) / edge;
      const sz = (2 * hz) / edge;
      for (const s of [-1, 1]) {
        put('fascia', fasciaMat, api.box(sx + 0.02, thick + 0.02, 0.05).translate(x, rf(x, s * (hz - 0.01)) - thick / 2, czr + s * (hz - 0.02)));
        put('fascia', fasciaMat, api.box(0.05, thick + 0.02, sz + 0.02).translate(s * (hx - 0.02), rf(s * (hx - 0.01), z) - thick / 2, czr + z));
      }
    }
    // Rafter tails under the eaves.
    const tail = (x: number, z: number, along: 'x' | 'z', len: number): void => {
      if (along === 'z') put('rafter', wood, api.box(0.08, 0.1, len).translate(x, eaveY - 0.12, z));
      else put('rafter', wood, api.box(len, 0.1, 0.08).translate(x, eaveY - 0.12, z));
    };
    const rn2 = Math.round((W + eave) / 0.5);
    for (let k = 0; k <= rn2; k++) {
      const x = -W / 2 - eave * 0.5 + ((W + eave) * k) / rn2;
      tail(x, -D / 2 - eave / 2 + 0.05, 'z', eave);
      tail(x, D / 2 + front / 2 - 0.05, 'z', front);
    }
    const rn3 = Math.round(D / 0.5);
    for (let k = 0; k <= rn3; k++) {
      const z = -D / 2 + (D * k) / rn3;
      for (const s of [-1, 1]) tail(s * (W / 2 + eave / 2 - 0.05), z, 'x', eave);
    }
    // Ridge cap (or a finial on a square roof).
    const ridgeHalf = Math.abs(hx - hz);
    const ridgeY = eaveY + rise;
    const ridgeMat = thatch ? timber('#8f7a4a') : { finish: 'roof-tile' as const, color: shade(roofC, -0.15), roughness: 0.7 };
    if (ridgeHalf > 0.3) {
      const alongX = hx >= hz;
      const len = ridgeHalf * 2 + 0.5;
      const cap = api.cylinder(thatch ? 0.2 : 0.15, thatch ? 0.2 : 0.15, len, 8).rotate(alongX ? 0 : 90, 0, alongX ? 90 : 0).translate(0, ridgeY + 0.07, czr);
      put('ridge', ridgeMat, cap);
      // Ornamental end tiles (onigawara).
      for (const s of [-1, 1]) {
        put('ridge', ridgeMat, api.box(alongX ? 0.18 : 0.34, 0.36, alongX ? 0.34 : 0.18).translate(alongX ? s * (ridgeHalf + 0.15) : 0, ridgeY + 0.2, alongX ? czr : czr + s * (ridgeHalf + 0.15)));
      }
    } else {
      put('ridge', ridgeMat, api.cone(0.18, 0.55, 8).translate(0, ridgeY + 0.1, czr));
      put('ridge', ridgeMat, api.sphere(0.1, 1).translate(0, ridgeY + 0.5, czr));
    }

    // ---- Garden: gravel apron, stepping stones, the stone basin ----
    if (p.bool('garden')) {
      const gz = frontEdge + 1.55;
      put('gravel', { finish: 'gravel', color: '#cfc7b4', roughness: 1 }, api.box(W + 1.4, 0.04, 3.1).translate(0, 0.02, gz - 0.2));
      const side = variant % 2 === 0 ? 1 : -1;
      for (let k = 0; k < 6; k++) {
        const z = frontEdge + 0.35 + k * 0.52;
        const x = Math.sin(k * 1.7 + variant) * 0.45 + (veranda > 0 ? side * 0.4 : -W / 2 + 1);
        const r = 0.27 + 0.05 * ((k * 7 + variant) % 3);
        put('steps', stoneMat('#7a766f'), api.cylinder(r * 0.95, r, 0.1, 9).scale(1, 1, 0.8).rotate(0, k * 40, 0).translate(x, 0.07, z));
      }
      // Tsukubai: a basin carved in a low stone, a bamboo spout, a few stones round it.
      const bxp = -side * (Math.min(W, 6) / 2 - 0.5);
      const bzp = frontEdge + 1.1;
      put('basin', stoneMat('#6e6a64'), api.lathe([[0, 0], [0.3, 0], [0.32, 0.36], [0.3, 0.42], [0.2, 0.42], [0.19, 0.3], [0, 0.3]], 14).translate(bxp, 0.02, bzp));
      put('water', { preset: 'water', color: '#2f4f5a', opacity: 0.9, roughness: 0.05 }, api.cylinder(0.19, 0.19, 0.01, 14).translate(bxp, 0.33, bzp));
      put('bamboo', timber('#8e9a52'), api.cylinder(0.03, 0.03, 0.62, 6).rotate(0, 0, 90).rotate(0, 25, 0).translate(bxp + 0.28, 0.62, bzp - 0.12));
      put('bamboo', timber('#8e9a52'), api.cylinder(0.035, 0.035, 0.62, 6).translate(bxp + 0.5, 0.31, bzp - 0.25));
      for (let k = 0; k < 4; k++) put('steps', stoneMat('#8a857c'), api.icosphereRock(0.17 + 0.04 * (k % 2), 0.5).translate(bxp + Math.cos(k * 1.9) * 0.62, 0.17, bzp + Math.sin(k * 1.9) * 0.62));
    }

    for (const { mat, mesh } of parts.values()) if (mesh) api.add(mesh, mat);
    // Colliders: the floor and the enclosed body; the veranda deck; nothing for the lattice and the roof.
    api.collider(boxCollider(0, fh / 2, 0, W + 0.1, fh, D + 0.1));
    api.collider(boxCollider(0, fh + bodyH / 2, 0, W, bodyH, D));
    if (veranda > 0) api.collider(boxCollider(0, fh / 2, D / 2 + veranda / 2, W, fh, veranda));
    return api.build();
  },
});

export const JAPANESE_GENERATORS = [japaneseHouse];
