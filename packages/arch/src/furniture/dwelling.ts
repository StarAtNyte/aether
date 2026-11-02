/**
 * Dwellings of a village or street, one crafted part with seven regional types, so a settlement reads as a place and not
 * as one house copied: a stone cottage, a half-timbered house with a jettied upper floor, a whitewashed Mediterranean house,
 * a Japanese machiya, a brick terrace house, an adobe house with vigas and a portal, and a Nordic board-clad house.
 *
 * Each is built from real constructions: walls as boxes round their openings (windows sit in reveals as deep as the wall),
 * roofs with eaves, verges, soffits, ridge caps and chimneys (gable, hip or parapeted flat), dormers, door surrounds,
 * porches, plinths, quoins or timber frames, shutters, window boxes and drainpipes. One mesh per material (stone, plaster,
 * timber, tile, slate, thatch, metal, glass), so a street of them instances as a handful of draw calls per type.
 * Front is +Z; origin at the centre of the footprint on the ground.
 */
import { Geom, box, cylinder, sphere } from '../mesh';
import { PartSet } from '../parts';
import { choice, color, flag, int, num, seeded, type FurnitureDef, type ParamReader } from './kit';
import { beam, chimneyStack, cylX, cylZ, dormer, gableRoof, gableWall, hipRoof, pottedPlant, ridgeCap, roofPlane, wallRun, type Hole, type RoofSkins, type V3 } from './dwelling-kit';

export type DwellingType = 'stone-cottage' | 'timber-frame' | 'mediterranean' | 'machiya' | 'brick-terrace' | 'adobe' | 'nordic';
export const DWELLING_TYPES: readonly DwellingType[] = ['stone-cottage', 'timber-frame', 'mediterranean', 'machiya', 'brick-terrace', 'adobe', 'nordic'];

interface Mat {
  finish: string;
  colors: string[];
  roughness?: number;
}

type Surround = 'stone' | 'plaster' | 'timber' | 'brick' | 'lattice' | 'none';

interface Spec {
  width: number;
  depth: number;
  floors: number;
  floorH: number;
  upperH: number;
  base: number;
  wallT: number;
  wall: Mat;
  plinth: Mat | null;
  plinthH: number;
  roofForm: 'gable' | 'hip' | 'flat';
  roofing: 'tile' | 'slate' | 'thatch' | 'metal';
  roofColors: Record<string, string[]>;
  pitch: [number, number];
  eave: number;
  verge: number;
  roofT: number;
  timber: string[];
  frameColors: string[];
  doorColors: string[];
  shutterColors: string[];
  win: { w: number; h: number; cols: number; rows: number; surround: Surround; shutters: number; box: number };
  bay: number;
  sideWindows: boolean;
  chimney: Mat | null;
  porch: 'none' | 'hood' | 'porch' | 'portal';
  dormers: number;
}

const STONE_C = ['#b3a283', '#9c9686', '#a89a7c', '#b7a88c'];
const SPECS: Record<DwellingType, Spec> = {
  'stone-cottage': {
    width: 8, depth: 5.4, floors: 1, floorH: 2.5, upperH: 2.4, base: 0.25, wallT: 0.5,
    wall: { finish: 'limestone', colors: STONE_C }, plinth: null, plinthH: 0, roofForm: 'gable', roofing: 'slate',
    roofColors: { slate: ['#59606a', '#4d5560', '#5d5a64'], thatch: ['#a88c55', '#9b8150'], tile: ['#9a5a40', '#8a4f3b'], metal: ['#4a5058'] },
    pitch: [37, 44], eave: 0.4, verge: 0.22, roofT: 0.16, timber: ['#4a3626', '#5a4330'], frameColors: ['#efece4', '#d9d3c6', '#3f4a3e'],
    doorColors: ['#3f5a46', '#7a2f2a', '#2f4357', '#5a4330'], shutterColors: ['#4f6478', '#5f7563'],
    win: { w: 0.85, h: 1.05, cols: 2, rows: 3, surround: 'stone', shutters: 0.1, box: 0.35 }, bay: 2.5, sideWindows: true,
    chimney: { finish: 'limestone', colors: ['#a89a7c', '#9c9686'] }, porch: 'hood', dormers: 1,
  },
  'timber-frame': {
    width: 7.6, depth: 6, floors: 2, floorH: 2.55, upperH: 2.4, base: 0.35, wallT: 0.4,
    wall: { finish: 'plaster', colors: ['#e9e0c9', '#e4d6b4', '#efe9d9', '#dccfae'], roughness: 0.95 }, plinth: { finish: 'stone', colors: ['#8f877a', '#7d776c'] }, plinthH: 0.5,
    roofForm: 'gable', roofing: 'tile', roofColors: { tile: ['#a2573c', '#8e4a35', '#7d4a3a'], slate: ['#585f69'], thatch: ['#a88c55'], metal: ['#4a5058'] },
    pitch: [42, 50], eave: 0.45, verge: 0.3, roofT: 0.16, timber: ['#3d2c1f', '#4a3626', '#2f241a'], frameColors: ['#3d2c1f', '#2f241a'],
    doorColors: ['#4a3626', '#2f4a3a', '#6a2f28'], shutterColors: ['#3d2c1f'],
    win: { w: 0.95, h: 1.05, cols: 3, rows: 3, surround: 'timber', shutters: 0, box: 0.3 }, bay: 2.4, sideWindows: true,
    chimney: { finish: 'brick', colors: ['#9a5a44', '#8d5340'] }, porch: 'hood', dormers: 0,
  },
  mediterranean: {
    width: 8, depth: 6.6, floors: 2, floorH: 2.8, upperH: 2.7, base: 0.2, wallT: 0.45,
    wall: { finish: 'plaster', colors: ['#f4efe4', '#f0e6d2', '#efe0c0', '#e8d4b6', '#f2e9dc'], roughness: 0.95 }, plinth: { finish: 'plaster', colors: ['#c9bda8'] }, plinthH: 0.35,
    roofForm: 'gable', roofing: 'tile', roofColors: { tile: ['#b8643f', '#c0714a', '#a85a3c'], slate: ['#59606a'], thatch: ['#a88c55'], metal: ['#4a5058'] },
    pitch: [17, 22], eave: 0.6, verge: 0.3, roofT: 0.14, timber: ['#5a4330', '#4a3626'], frameColors: ['#6b4a2f', '#f2f0eb'],
    doorColors: ['#2f5b78', '#3f6b52', '#7a3d2a', '#2d4f6e'], shutterColors: ['#2f6b8a', '#3e7a5a', '#7a4a2e', '#4a6f8f', '#7d8f4a'],
    win: { w: 0.9, h: 1.35, cols: 2, rows: 2, surround: 'plaster', shutters: 0.85, box: 0.4 }, bay: 2.7, sideWindows: true,
    chimney: { finish: 'plaster', colors: ['#efe5d2'] }, porch: 'none', dormers: 0,
  },
  machiya: {
    width: 5.8, depth: 10.5, floors: 2, floorH: 2.85, upperH: 2.1, base: 0.45, wallT: 0.35,
    wall: { finish: 'plaster', colors: ['#d8cfbc', '#cfc4ad', '#c9bfa8'], roughness: 0.95 }, plinth: { finish: 'stone', colors: ['#6f6b66'] }, plinthH: 0.45,
    roofForm: 'hip', roofing: 'tile', roofColors: { tile: ['#4a4e54', '#43474d', '#52565c'], slate: ['#4a4e54'], thatch: ['#a88c55'], metal: ['#3b4046'] },
    pitch: [19, 23], eave: 0.8, verge: 0.5, roofT: 0.14, timber: ['#3a2b20', '#2f241a', '#44332a'], frameColors: ['#3a2b20'],
    doorColors: ['#3a2b20'], shutterColors: ['#3a2b20'],
    win: { w: 1, h: 0.62, cols: 1, rows: 1, surround: 'lattice', shutters: 0, box: 0 }, bay: 3, sideWindows: false,
    chimney: null, porch: 'none', dormers: 0,
  },
  'brick-terrace': {
    width: 5.2, depth: 8, floors: 2, floorH: 2.7, upperH: 2.55, base: 0.4, wallT: 0.35,
    wall: { finish: 'brick', colors: ['#9a5a44', '#8d5340', '#a46248', '#85503f'], roughness: 0.9 }, plinth: { finish: 'stone', colors: ['#7d776c'] }, plinthH: 0.5,
    roofForm: 'gable', roofing: 'slate', roofColors: { slate: ['#4f5660', '#59606a'], tile: ['#8e4a35'], thatch: ['#a88c55'], metal: ['#4a5058'] },
    pitch: [30, 36], eave: 0.3, verge: 0.0, roofT: 0.14, timber: ['#efece4', '#e4ddcf'], frameColors: ['#f2f0eb', '#e9e4d8'],
    doorColors: ['#1f3d34', '#6a1f26', '#1f2f4a', '#2f2f33'], shutterColors: ['#1f3d34'],
    win: { w: 1.0, h: 1.55, cols: 2, rows: 3, surround: 'brick', shutters: 0, box: 0.2 }, bay: 2.6, sideWindows: false,
    chimney: { finish: 'brick', colors: ['#8d5340', '#9a5a44'] }, porch: 'hood', dormers: 0,
  },
  adobe: {
    width: 9, depth: 6.6, floors: 1, floorH: 2.9, upperH: 2.7, base: 0.15, wallT: 0.55,
    wall: { finish: 'plaster', colors: ['#c79a6a', '#bf8f5f', '#cfa577', '#b98a5c'], roughness: 1 }, plinth: { finish: 'plaster', colors: ['#a97b52'] }, plinthH: 0.4,
    roofForm: 'flat', roofing: 'tile', roofColors: { tile: ['#b8643f'], slate: ['#59606a'], thatch: ['#a88c55'], metal: ['#4a5058'] },
    pitch: [0, 0], eave: 0.0, verge: 0, roofT: 0.2, timber: ['#5a4330', '#6b4f36', '#4a3626'], frameColors: ['#2f6b8a', '#3e7a5a', '#6b4f36'],
    doorColors: ['#2f6b8a', '#3e7a5a', '#8a3d2a', '#6b4f36'], shutterColors: ['#2f6b8a', '#3e7a5a'],
    win: { w: 0.85, h: 1.0, cols: 2, rows: 2, surround: 'timber', shutters: 0.2, box: 0 }, bay: 3, sideWindows: true,
    chimney: { finish: 'plaster', colors: ['#bf8f5f'] }, porch: 'portal', dormers: 0,
  },
  nordic: {
    width: 8.2, depth: 5.8, floors: 1, floorH: 2.6, upperH: 2.5, base: 0.5, wallT: 0.3,
    wall: { finish: 'cladding', colors: ['#8a3a2f', '#a8452f', '#d0a850', '#e9e4d6', '#6a7480', '#4f6a52'] }, plinth: { finish: 'stone', colors: ['#6f6b66', '#7d776c'] }, plinthH: 0.55,
    roofForm: 'gable', roofing: 'metal', roofColors: { metal: ['#3b4046', '#4b3f3a'], tile: ['#4a3f3a', '#5a2f2a'], slate: ['#4f5660'], thatch: ['#8b7a4a'] },
    pitch: [30, 36], eave: 0.45, verge: 0.3, roofT: 0.1, timber: ['#f2f0eb', '#ede8dd'], frameColors: ['#f2f0eb', '#ede8dd'],
    doorColors: ['#2f4a58', '#f2f0eb', '#5a2f2a', '#3f5a46'], shutterColors: ['#f2f0eb'],
    win: { w: 0.95, h: 1.25, cols: 2, rows: 2, surround: 'timber', shutters: 0, box: 0.3 }, bay: 2.6, sideWindows: true,
    chimney: { finish: 'brick', colors: ['#9a5a44', '#c9c4b8'] }, porch: 'porch', dormers: 0,
  },
};

const paint = (c: string, roughness = 0.65) => ({ finish: 'paint' as const, color: c, roughness });
const GLOW = { preset: 'emissive' as const, color: '#ffcf86', emissive: '#ffcf86', emissiveIntensity: 0.9 };

function hash(a: number, b: number, c: number): number {
  const t = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453;
  return t - Math.floor(t);
}

/** Geometry buckets of one dwelling, one per material. */
class Acc {
  wall = new Geom();
  plinth = new Geom();
  trim = new Geom();
  frame = new Geom();
  glass = new Geom();
  glow = new Geom();
  door = new Geom();
  shutter = new Geom();
  stone = new Geom();
  timber = new Geom();
  roof = new Geom();
  soffit = new Geom();
  roofEdge = new Geom();
  ridge = new Geom();
  stack = new Geom();
  cap = new Geom();
  pots = new Geom();
  clay = new Geom();
  gutter = new Geom();
  iron = new Geom();
  soil = new Geom();
  leaves = new Geom();
  bloom = new Geom();
  interior = new Geom();
  fabric = new Geom();
  path = new Geom();
}

type Wall = 'f' | 'b' | 'l' | 'r';
interface Opening {
  wall: Wall;
  floor: number;
  c: number;
  w: number;
  y0: number;
  h: number;
  door: boolean;
  french: boolean;
  lattice: boolean;
}

const D2R = Math.PI / 180;

function resolve(p: ParamReader): { kind: DwellingType; spec: Spec } {
  const k = p.str('type') as DwellingType;
  return { kind: (DWELLING_TYPES as readonly string[]).includes(k) ? k : 'stone-cottage', spec: SPECS[(DWELLING_TYPES as readonly string[]).includes(k) ? k : 'stone-cottage'] };
}

/** Size and door position of dwellings already measured, by their parameters. */
const cache = new Map<string, { size: [number, number, number]; door: [number, number] }>();
let lastDoor: [number, number] = [0, 0];

function build(p: ParamReader): ReturnType<PartSet['build']> {
  const { kind, spec } = resolve(p);
  const variant = p.int('variant');
  const rnd = seeded(variant * 7919 + 101 + DWELLING_TYPES.indexOf(kind) * 31);
  const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length) % a.length] as T;
  const acc = new Acc();

  const W = p.num('width') > 0 ? p.num('width') : spec.width * (0.9 + rnd() * 0.25);
  const Dp = p.num('depth') > 0 ? p.num('depth') : spec.depth * (0.92 + rnd() * 0.2);
  const floors = p.int('floors') > 0 ? p.int('floors') : spec.floors;
  const gableFront = p.bool('gableFront');
  const L = gableFront ? Dp : W;
  const S = gableFront ? W : Dp;
  const t = spec.wallT;
  const base = spec.base;
  const heights = Array.from({ length: floors }, (_, f) => (f === 0 ? spec.floorH : spec.upperH));
  const yF: number[] = [];
  let y = base;
  for (const h of heights) {
    yF.push(y);
    y += h;
  }
  const yTop = y;

  // Roof form and covering.
  const form0 = p.str('roofForm');
  const form = form0 === 'gable' || form0 === 'hip' || form0 === 'flat' ? form0 : spec.roofForm;
  const roofing0 = p.str('roofing');
  const roofing = roofing0 === 'slate' || roofing0 === 'tile' || roofing0 === 'thatch' || roofing0 === 'metal' ? roofing0 : spec.roofing;
  const roofColor = p.color('roofColor') !== '#000000' ? p.color('roofColor') : pick(spec.roofColors[roofing] ?? spec.roofColors['tile'] ?? ['#7a4a3a']);
  const wallColor = p.color('wallColor') !== '#000000' ? p.color('wallColor') : pick(spec.wall.colors);
  const accentColor = p.color('accentColor') !== '#000000' ? p.color('accentColor') : '';
  const pitchDeg = form === 'flat' ? 0 : (roofing === 'thatch' ? Math.max(spec.pitch[0], 45) : spec.pitch[0] + rnd() * (spec.pitch[1] - spec.pitch[0])) + (roofing === 'thatch' && kind !== 'stone-cottage' ? 0 : 0);
  const eave = form === 'flat' ? 0 : spec.eave + (roofing === 'thatch' ? 0.25 : 0);
  const verge = spec.verge + (roofing === 'thatch' ? 0.15 : 0);
  const roofT = spec.roofT + (roofing === 'thatch' ? 0.2 : 0);

  const jetty = kind === 'timber-frame' && floors >= 2 ? 0.32 : 0;
  const zb = -S / 2;
  const zfAt = (f: number): number => S / 2 + (f >= 1 ? jetty : 0);
  const zfTop = S / 2 + jetty;
  const zc = (zb + zfTop) / 2;
  const hs = (zfTop - zb) / 2;
  const frameColor = pick(spec.frameColors);
  const timberColor = pick(spec.timber);
  const doorColor = accentColor || pick(spec.doorColors);
  const shutterColor = accentColor || pick(spec.shutterColors);
  const shuttered = p.str('shutters');
  const shutterShare = shuttered === 'yes' ? 1 : shuttered === 'no' ? 0 : spec.win.shutters;
  const flowers = p.bool('flowers');

  // ---- openings -------------------------------------------------------------------------------------------------
  const ops: Opening[] = [];
  const doorWall: Wall = gableFront ? 'r' : 'f';
  const wallLen = (w: Wall): number => (w === 'f' || w === 'b' ? L : S);
  const wallMid = (w: Wall): number => (w === 'f' || w === 'b' ? 0 : zc);
  const baysOf = (w: Wall): number[] => {
    const len = wallLen(w);
    const n = Math.max(1, Math.min(6, Math.round(len / spec.bay)));
    return Array.from({ length: n }, (_, i) => wallMid(w) - len / 2 + ((i + 0.5) * len) / n);
  };
  const doorBayRnd = rnd();
  for (const w of ['f', 'b', 'l', 'r'] as Wall[]) {
    const side = w === 'l' || w === 'r';
    if (side && !spec.sideWindows && w !== doorWall) continue;
    const isDoorWall = w === doorWall;
    let bays = baysOf(w);
    // Narrow and deep (terrace, machiya) fronts carry a door at one end and a window beside it.
    let doorIdx = -1;
    if (isDoorWall) {
      doorIdx = bays.length <= 2 ? (doorBayRnd < 0.5 ? 0 : bays.length - 1) : bays.length % 2 === 1 && kind !== 'machiya' && doorBayRnd < 0.7 ? (bays.length - 1) / 2 : doorBayRnd < 0.5 ? 0 : bays.length - 1;
      if (kind === 'machiya') doorIdx = doorBayRnd < 0.5 ? 0 : bays.length - 1;
    }
    for (let f = 0; f < floors; f++) {
      if (kind === 'machiya' && w === 'f') {
        const len = wallLen(w);
        const dw = 1.3;
        const dEdge = doorIdx === 0 ? -len / 2 + 0.35 + dw / 2 : len / 2 - 0.35 - dw / 2;
        if (f === 0) {
          ops.push({ wall: w, floor: 0, c: dEdge, w: dw, y0: base, h: 2.05, door: true, french: false, lattice: false });
          const wl = len - dw - 0.9;
          ops.push({ wall: w, floor: 0, c: doorIdx === 0 ? len / 2 - 0.35 - wl / 2 : -len / 2 + 0.35 + wl / 2, w: wl, y0: base + 0.28, h: 1.85, door: false, french: false, lattice: true });
        } else {
          for (const sx of [-1, 1]) ops.push({ wall: w, floor: f, c: sx * len * 0.27, w: 1.05, y0: yF[f]! + 0.8, h: 0.7, door: false, french: false, lattice: true });
        }
        continue;
      }
      if (kind === 'machiya' && w === 'b') {
        for (const c of bays.slice(0, 1)) ops.push({ wall: w, floor: f, c, w: 1.0, y0: yF[f]! + (f === 0 ? 0.9 : 0.8), h: f === 0 ? 1.2 : 0.7, door: false, french: false, lattice: true });
        continue;
      }
      const bayList = side && !isDoorWall ? [wallMid(w)] : bays;
      bayList.forEach((c, i) => {
        const isDoor = isDoorWall && f === 0 && i === doorIdx && !(side && bays.length > 1 && false);
        const sill = f === 0 ? 0.92 : 0.82;
        const room = heights[f]! - sill - 0.35;
        const h = Math.min(spec.win.h * (f === 0 ? 1 : 0.95), room);
        const w0 = Math.min(spec.win.w, (wallLen(w) / bayList.length) - 0.7);
        if (isDoor) {
          const dw = kind === 'brick-terrace' ? 1.05 : kind === 'adobe' ? 1.05 : 1.0;
          ops.push({ wall: w, floor: 0, c, w: dw, y0: base, h: 2.1, door: true, french: false, lattice: false });
        } else {
          const french = spec.win.surround === 'plaster' && f === 1 && isDoorWall && i === doorIdx && kind === 'mediterranean';
          // A Mediterranean house keeps its upper window over the door as a French window onto a balcony.
          ops.push(french ? { wall: w, floor: f, c, w: 1.05, y0: yF[f]! + 0.12, h: 2.1, door: false, french: true, lattice: false } : { wall: w, floor: f, c, w: Math.max(0.5, w0), y0: yF[f]! + sill, h: Math.max(0.6, h), door: false, french: false, lattice: false });
        }
      });
    }
  }

  const doorOp = ops.find((o) => o.door);
  lastDoor = doorOp ? (gableFront ? [-doorOp.c, L / 2] : [doorOp.c, S / 2]) : [0, S / 2];

  // ---- walls ----------------------------------------------------------------------------------------------------
  const holesOf = (w: Wall, f: number): Hole[] => ops.filter((o) => o.wall === w && o.floor === f).map((o) => ({ c: o.c, w: o.w, y0: o.y0, y1: o.y0 + o.h }));
  for (let f = 0; f < floors; f++) {
    const yA = f === 0 ? 0 : yF[f]!;
    const yB = yF[f]! + heights[f]!;
    const zf = zfAt(f);
    wallRun(acc.wall, 'x', zf, 1, t, -L / 2, L / 2, yA, yB, holesOf('f', f));
    wallRun(acc.wall, 'x', zb, -1, t, -L / 2, L / 2, yA, yB, holesOf('b', f));
    wallRun(acc.wall, 'z', L / 2, 1, t, zb + t, zf - t, yA, yB, holesOf('r', f));
    wallRun(acc.wall, 'z', -L / 2, -1, t, zb + t, zf - t, yA, yB, holesOf('l', f));
    // Floor and ceiling of the storey (what shows through the glass).
    acc.interior.merge(box(-L / 2 + t, Math.max(0.005, yF[f]! - 0.22), zb + t, L / 2 - t, yF[f]! - 0.02, zf - t));
  }
  acc.interior.merge(box(-L / 2 + t, yTop - 0.12, zb + t, L / 2 - t, yTop, zfTop - t));

  // ---- plinth ---------------------------------------------------------------------------------------------------
  if (spec.plinth && spec.plinthH > 0) {
    const ph = spec.plinthH;
    const o = 0.04;
    acc.plinth.merge(box(-L / 2 - o, 0, zfAt(0) - t, L / 2 + o, ph, zfAt(0) + o));
    acc.plinth.merge(box(-L / 2 - o, 0, zb - o, L / 2 + o, ph, zb + t));
    acc.plinth.merge(box(L / 2 - t, 0, zb + t, L / 2 + o, ph, zfAt(0) - t));
    acc.plinth.merge(box(-L / 2 - o, 0, zb + t, -L / 2 + t, ph, zfAt(0) - t));
    // The plinth does not close the door.
    for (const o2 of ops) if (o2.door) acc.plinth.merge(new Geom());
  }

  // ---- window dressing, doors ----------------------------------------------------------------------------------
  const place = (loc: Acc, w: Wall, cx: number, cy: number, f: number): void => {
    const rot = w === 'f' ? 0 : w === 'b' ? 180 : w === 'r' ? 90 : -90;
    const outer = w === 'f' ? zfAt(f) : w === 'b' ? zb : w === 'r' ? L / 2 : -L / 2;
    const tx = w === 'f' || w === 'b' ? cx : outer;
    const tz = w === 'f' || w === 'b' ? outer : cx;
    for (const key of Object.keys(loc) as Array<keyof Acc>) {
      const g = loc[key];
      if (g.i.length === 0) continue;
      g.rotateY(rot).translate(tx, cy, tz);
      acc[key].merge(g);
    }
  };

  for (const o of ops) {
    const loc = new Acc();
    const hv = hash(o.c, o.y0, o.wall.charCodeAt(0));
    if (o.door) {
      dressDoor(loc, o, kind, spec, t, base, rnd, flowers);
    } else {
      dressWindow(loc, o, kind, spec, t, hv, shutterShare, flowers, p.bool('lit'));
    }
    place(loc, o.wall, o.c, 0, o.floor);
  }

  // ---- manner of each type: what makes the wall read ------------------------------------------------------------
  const frontZ = zfAt(0);
  if (kind === 'stone-cottage') {
    const n = Math.max(3, Math.round(yTop / 0.4));
    const qh = yTop / n;
    for (let k = 0; k < n; k++) {
      const long = k % 2 === 0;
      for (const sx of [-1, 1]) {
        const y0 = k * qh + 0.015;
        const xa = sx > 0 ? L / 2 - (long ? 0.55 : 0.32) : -L / 2;
        const xb = sx > 0 ? L / 2 : -L / 2 + (long ? 0.55 : 0.32);
        acc.stone.merge(box(xa, y0, frontZ - 0.02, xb, y0 + qh - 0.03, frontZ + 0.03));
        acc.stone.merge(box(xa, y0, zb - 0.03, xb, y0 + qh - 0.03, zb + 0.02));
        const za = long ? 0.32 : 0.55;
        acc.stone.merge(box(sx > 0 ? L / 2 - 0.02 : -L / 2 - 0.03, y0, frontZ - za, sx > 0 ? L / 2 + 0.03 : -L / 2 + 0.02, y0 + qh - 0.03, frontZ));
        acc.stone.merge(box(sx > 0 ? L / 2 - 0.02 : -L / 2 - 0.03, y0, zb, sx > 0 ? L / 2 + 0.03 : -L / 2 + 0.02, y0 + qh - 0.03, zb + za));
      }
    }
  } else if (kind === 'timber-frame') {
    timberFrame(acc.timber, ops, L, zb, zfAt, floors, yF, heights, base, jetty);
  } else if (kind === 'brick-terrace') {
    // Stone string course between the storeys, window cills as a band, a brick corbel cornice under the eaves.
    for (let f = 1; f < floors; f++) acc.stone.merge(box(-L / 2 - 0.03, yF[f]! - 0.14, frontZ - 0.1, L / 2 + 0.03, yF[f]! - 0.02, frontZ + 0.04));
    for (let k = 0; k < 3; k++) acc.wall.merge(box(-L / 2 - 0.02 - k * 0.0, yTop - 0.36 + k * 0.1, frontZ - 0.1, L / 2 + 0.02, yTop - 0.26 + k * 0.1, frontZ + 0.05 + (2 - k) * 0.03 * (k === 0 ? 1 : 1)));
  } else if (kind === 'nordic') {
    // Corner boards, a bargeboard and a weather board at the foot of the cladding.
    const cb = 0.1;
    for (const sx of [-1, 1]) {
      acc.trim.merge(box(sx * L / 2 - (sx > 0 ? cb : 0) - (sx < 0 ? -0.0 : 0) + (sx < 0 ? 0 : 0), 0.5, frontZ - 0.0, sx * L / 2 + (sx < 0 ? cb : 0), yTop, frontZ + 0.03));
      acc.trim.merge(box(sx * L / 2 - (sx > 0 ? cb : 0), 0.5, zb - 0.03, sx * L / 2 + (sx < 0 ? cb : 0), yTop, zb));
    }
    acc.trim.merge(box(-L / 2, base - 0.02, frontZ - 0.0, L / 2, base + 0.1, frontZ + 0.04));
  } else if (kind === 'adobe') {
    adobeDetails(acc, L, zb, frontZ, yTop, t, rnd);
  } else if (kind === 'machiya') {
    machiyaDetails(acc, L, zb, frontZ, yF, heights, base, ops, doorBayRnd < 0.5);
  } else if (kind === 'mediterranean') {
    // Pots and a balcony over the door.
    for (const o of ops) {
      if (o.french) balcony(acc, o.c, frontZ, yF[1]!, o.w + 0.6);
    }
  }

  // ---- roof -----------------------------------------------------------------------------------------------------
  const skins: RoofSkins = { top: acc.roof, soffit: acc.soffit, edge: acc.roofEdge };
  const rise = form === 'flat' ? 0 : hs * Math.tan(pitchDeg * D2R);
  const hl = L / 2;
  let yRidge = yTop;
  if (form === 'gable') {
    yRidge = gableRoof(skins, { zc, hs, hl, yTop, rise, eave, verge, t: roofT });
    for (const sx of [-1, 1] as const) acc.wall.merge(gableWall(zc, hs, yTop, yRidge, sx * hl + (sx > 0 ? 0 : 0), sx, t));
    // Barge boards along the verge edges, and the loft window in the gable.
    if (verge > 0.1) {
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const x = sx * (hl + verge);
          const zz = zc + sz * (hs + eave);
          acc.trim.merge(beamBox(x, yTop - eave * (rise / hs), zz, x, yRidge, zc, 0.05, 0.2));
        }
      }
    }
    if (rise > 1.5 && floors === 1 && !gableFront) {
      for (const sx of [-1, 1]) loftWindow(acc, sx, hl, zc, yTop, rise, t);
    }
    // Ridge cap.
    const rr = roofing === 'thatch' ? 0.2 : roofing === 'metal' ? 0.05 : 0.11;
    if (roofing !== 'metal') acc.ridge.merge(ridgeCap(-hl - verge, hl + verge, yRidge + (roofing === 'thatch' ? 0.1 : 0.03), zc, rr));
    // Rafter tails under the eave for the Mediterranean and Nordic houses.
    if (kind === 'mediterranean' || kind === 'nordic') {
      const n = Math.floor((L + 0.4) / 0.55);
      for (let i = 0; i <= n; i++) {
        const x = -L / 2 - 0.1 + (i * (L + 0.2)) / n;
        for (const sz of [-1, 1]) {
          const zOut = zc + sz * (hs + eave * 0.85);
          const zIn = zc + sz * (hs - 0.02);
          acc.timber.merge(box(x - 0.045, yTop - eave * (rise / hs) * 0.85 - 0.16, Math.min(zIn, zOut), x + 0.045, yTop - 0.02, Math.max(zIn, zOut)));
        }
      }
    }
  } else if (form === 'hip') {
    yRidge = hipRoof(skins, { zc, hs, hl, yTop, rise, eave, verge, t: roofT });
    const rl = Math.max(0.05, hl + eave - (hs + eave));
    acc.ridge.merge(ridgeCap(-rl, rl, yRidge + 0.03, zc, 0.11));
    // Hip ridges.
    const hle = hl + eave;
    const he = hs + eave;
    const yE = yTop - eave * (rise / hs);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) acc.ridge.merge(beamBox(sx * hle, yE, zc + sz * he, sx * rl, yRidge + 0.02, zc, 0.09, 0.09));
    if (kind === 'machiya') {
      for (const sx of [-1, 1]) acc.ridge.merge(cylinder(0.16, 0.12, 0.34, 8).translate(sx * rl, yRidge + 0.12, zc));
    }
  } else {
    // Flat roof: a parapet round the walls with a stone coping, a roof membrane, water spouts and projecting beams.
    const ph = 0.55;
    const pt = 0.26;
    acc.wall.merge(box(-L / 2, yTop, zfTop - pt, L / 2, yTop + ph, zfTop));
    acc.wall.merge(box(-L / 2, yTop, zb, L / 2, yTop + ph, zb + pt));
    acc.wall.merge(box(L / 2 - pt, yTop, zb + pt, L / 2, yTop + ph, zfTop - pt));
    acc.wall.merge(box(-L / 2, yTop, zb + pt, -L / 2 + pt, yTop + ph, zfTop - pt));
    acc.stone.merge(box(-L / 2 - 0.04, yTop + ph, zfTop - pt - 0.04, L / 2 + 0.04, yTop + ph + 0.07, zfTop + 0.04));
    acc.stone.merge(box(-L / 2 - 0.04, yTop + ph, zb - 0.04, L / 2 + 0.04, yTop + ph + 0.07, zb + pt + 0.04));
    acc.stone.merge(box(L / 2 - pt - 0.04, yTop + ph, zb + pt, L / 2 + 0.04, yTop + ph + 0.07, zfTop - pt));
    acc.stone.merge(box(-L / 2 - 0.04, yTop + ph, zb + pt, -L / 2 + pt + 0.04, yTop + ph + 0.07, zfTop - pt));
    acc.roof.merge(box(-L / 2 + pt, yTop, zb + pt, L / 2 - pt, yTop + 0.12, zfTop - pt));
    yRidge = yTop + ph + 0.07;
  }

  // Dormers on the front slope of a steep gable roof.
  const nDorm = p.int('dormers') >= 0 && p.int('dormers') <= 3 ? p.int('dormers') : spec.dormers;
  if (form === 'gable' && nDorm > 0 && rise > 1.4 && !gableFront) {
    const zf = zc + hs * 0.55;
    const yBase = yTop + rise * (1 - 0.55) - 0.05;
    const wd = 1.25;
    const span = Math.min(L - 3, nDorm * 2.6);
    for (let i = 0; i < nDorm; i++) {
      const cx = nDorm === 1 ? 0 : -span / 2 + (i * span) / (nDorm - 1);
      dormer(acc.wall, acc.glass, acc.frame, skins, cx, zf, yBase, wd, 1.25, 1.6, pitchDeg, 0.14);
    }
  }

  // Chimney.
  const chimOpt = p.str('chimney');
  const wantChimney = spec.chimney !== null && chimOpt !== 'none' && (chimOpt !== 'auto' || (kind === 'adobe' ? hash(variant, 1, 2) > 0.4 : true));
  if (wantChimney && spec.chimney) {
    const sx = rnd() < 0.5 ? -1 : 1;
    const cw = kind === 'brick-terrace' ? 0.9 : 0.75;
    const isGableEnd = chimOpt === 'gable' || (chimOpt === 'auto' && (kind === 'stone-cottage' || kind === 'nordic') && rnd() < 0.6 && form === 'gable');
    const cMat = spec.chimney;
    if (form === 'flat') {
      acc.stack.merge(box(sx * (L / 2 - 1.3) - 0.35, yTop, zc - 0.35, sx * (L / 2 - 1.3) + 0.35, yRidge + 0.7, zc + 0.35));
    } else if (isGableEnd) {
      // An external chimney breast up the gable face, standing clear of the wall.
      const cx = sx * (L / 2 + 0.2);
      acc.stack.merge(box(cx - 0.4, 0, zc - cw / 2, cx + 0.4, yRidge - 0.3, zc + cw / 2));
      acc.stack.merge(box(cx - 0.34, yRidge - 0.3, zc - cw / 2 + 0.05, cx + 0.34, yRidge + 0.85, zc + cw / 2 - 0.05));
      chimneyStack(new Geom(), acc.cap, acc.pots, cx, zc, 0.68, cw - 0.1, yRidge + 0.85, yRidge + 0.85, 2);
      acc.cap.merge(box(cx - 0.4, yRidge - 0.34, zc - cw / 2 - 0.03, cx + 0.4, yRidge - 0.3, zc + cw / 2 + 0.03));
    } else {
      const cx = sx * Math.max(0.5, hl - (kind === 'brick-terrace' ? 0.55 : 1.2));
      chimneyStack(acc.stack, acc.cap, acc.pots, cx, zc, cw, 0.65, yTop - 0.4, yRidge + 0.8, kind === 'brick-terrace' ? 3 : 2);
    }
    void cMat;
  }

  // Gutters and downpipes under the eaves of a pitched roof.
  if (form !== 'flat' && roofing !== 'thatch' && kind !== 'machiya') {
    const yG = yTop - eave * (rise / hs) - 0.05;
    for (const sz of [-1, 1]) {
      const z = zc + sz * (hs + eave + 0.04);
      acc.gutter.merge(cylX(0.05, 0.05, L + verge * 2 * (form === 'gable' ? 1 : 0) + (form === 'hip' ? 2 * eave : 0), 8).translate(0, yG, z));
    }
    for (const sx of [-1, 1]) {
      const x = sx * (hl + 0.04);
      acc.gutter.merge(cylinder(0.04, 0.04, yG - 0.1, 8).translate(x, 0.1, zfAt(0) + 0.05));
    }
  }

  // Door step path. On a footing (a house on a slope) stone steps run from the door down to the ground first, then the path.
  const pathLen = p.num('path');
  const footing = Math.max(0, Math.min(6, p.num('footing')));
  if (doorOp && (pathLen > 0 || footing > 0.05)) {
    const loc = new Acc();
    const rise = 0.18;
    const tread = 0.3;
    const n = Math.ceil(footing / rise);
    for (let i = 0; i < n; i++) {
      const top = -i * (footing / n);
      loc.stone.merge(box(-0.65, -footing, 0.05 + i * tread, 0.65, top, 0.05 + (i + 1) * tread));
    }
    const run = 0.05 + n * tread;
    if (pathLen > 0) loc.path.merge(box(-0.55, -footing, run, 0.55, -footing + 0.05, run + pathLen));
    place(loc, doorOp.wall, doorOp.c, 0, 0);
  }
  // The footing: the house stands `footing` metres up on a solid stone base whose foot is the origin, so the low side of a
  // slope shows a masonry base instead of a gap and the high side does not bury the ground floor.
  if (footing > 0.05) {
    for (const key of Object.keys(acc) as Array<keyof Acc>) acc[key].translate(0, footing, 0);
    acc.plinth.merge(box(-L / 2 - 0.08, 0, zb - 0.08, L / 2 + 0.08, footing + 0.03, zfAt(0) + 0.08));
  }

  // ---- finish: orient the house, then one mesh per material -----------------------------------------------------
  // With a gable towards the street the whole house turns a quarter.
  if (gableFront) for (const key of Object.keys(acc) as Array<keyof Acc>) acc[key].rotateY(-90);
  const set = new PartSet();
  const wallMat = { finish: spec.wall.finish as 'plaster', color: wallColor, roughness: spec.wall.roughness ?? 0.9 };
  const plinthMat = spec.plinth ? { finish: spec.plinth.finish as 'stone', color: spec.plinth.colors[Math.floor(rnd() * spec.plinth.colors.length)] ?? '#8f877a' } : wallMat;
  const roofMat = roofing === 'thatch' ? { finish: 'thatch' as const, color: roofColor } : roofing === 'slate' ? { finish: 'slate' as const, color: roofColor } : roofing === 'metal' ? { finish: 'metal-roof' as const, color: roofColor } : { finish: 'roof-tile' as const, color: roofColor };
  const painted = kind === 'nordic' || kind === 'brick-terrace';
  const trimMat = painted ? paint(frameColor, 0.6) : { finish: 'oak' as const, color: timberColor };
  const stoneC = kind === 'adobe' ? '#9d7a55' : kind === 'brick-terrace' ? '#c9c1b0' : kind === 'machiya' ? '#6f6b66' : '#cdbfa3';
  const stoneMat = { finish: 'limestone' as const, color: stoneC };
  const timberMat = { finish: 'oak' as const, color: kind === 'adobe' ? '#6b4f36' : timberColor };
  const potMat = { finish: 'brick' as const, color: '#b5634a' };
  // Equal materials share one mesh (PartSet merges them): the trim, frames, interior, ridge, edge and clay are the same as their neighbours where the type allows.
  set.add(acc.wall, wallMat);
  set.add(acc.interior, wallMat);
  set.add(acc.plinth, plinthMat);
  set.add(acc.trim, trimMat);
  set.add(acc.frame, kind === 'timber-frame' || kind === 'machiya' ? timberMat : painted ? trimMat : paint(frameColor, 0.55));
  set.add(acc.glass, { finish: 'glass' as const });
  set.add(acc.glow, GLOW);
  set.add(acc.door, kind === 'machiya' ? { finish: 'oak' as const, color: '#3a2b20' } : paint(doorColor, 0.55));
  set.add(acc.shutter, paint(shutterColor, 0.65));
  set.add(acc.stone, stoneMat);
  set.add(acc.cap, stoneMat);
  set.add(acc.timber, timberMat);
  set.add(acc.roof, roofMat);
  set.add(acc.roofEdge, roofMat);
  set.add(acc.ridge, roofMat);
  set.add(acc.soffit, { finish: 'oak' as const, color: roofing === 'thatch' ? '#8a7448' : '#6a5a48' });
  set.add(acc.stack, spec.chimney ? { finish: spec.chimney.finish as 'brick', color: spec.chimney.colors[Math.floor(rnd() * spec.chimney.colors.length)] ?? '#9a5a44' } : wallMat);
  set.add(acc.pots, potMat);
  set.add(acc.clay, potMat);
  set.add(acc.gutter, { finish: 'brushed-metal' as const, color: '#7a7f84' });
  set.add(acc.iron, { finish: 'black-metal' as const, color: '#26272a' });
  set.add(acc.soil, { finish: 'soil' as const, color: '#4d3a28' });
  set.add(acc.leaves, { finish: 'foliage' as const, color: '#5f7d45' });
  set.add(acc.bloom, paint(pick(['#c43d3d', '#d9a03a', '#c05a8a', '#e8e4dc']), 0.8));
  set.add(acc.fabric, { finish: 'fabric' as const, color: '#7a2f2a' });
  set.add(acc.path, { finish: 'cobble' as const, color: '#a39b8c' });

  // Colliders: the body, and the roof as a hull (internal frame), then the orientation.
  const cols: Array<[number, number, number, number, number, number]> = [];
  cols.push([-L / 2, 0, zb, L / 2, Math.max(yTop, form === 'flat' ? yRidge : yTop), zfTop]);
  const hullPts: number[] = [];
  if (form !== 'flat') {
    const he = hs + eave;
    const yE = yTop - eave * (rise / hs);
    const hle = hl + (form === 'hip' ? eave : verge);
    for (const sz of [-1, 1]) {
      hullPts.push(-hle, yE, zc + sz * he, hle, yE, zc + sz * he);
    }
    hullPts.push(-hle * 0.7, yRidge, zc, hle * 0.7, yRidge, zc);
  }
  const rot = (x: number, z: number): [number, number] => (gableFront ? [-z, x] : [x, z]);
  for (const c of cols) {
    const a = rot(c[0], c[2]);
    const b = rot(c[3], c[5]);
    set.boxMinMax(Math.min(a[0], b[0]), c[1], Math.min(a[1], b[1]), Math.max(a[0], b[0]), c[4], Math.max(a[1], b[1]));
  }
  if (hullPts.length >= 12) {
    const pts: number[] = [];
    for (let i = 0; i < hullPts.length; i += 3) {
      const r = rot(hullPts[i] as number, hullPts[i + 2] as number);
      pts.push(r[0], hullPts[i + 1] as number, r[1]);
    }
    set.hull(pts);
  }
  return set.build();
}

/** A box between two points that keeps its width `w` horizontal and height `h`. */
function beamBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, w: number, h: number): Geom {
  const g = new Geom();
  beam(g, [x0, y0, z0], [x1, y1, z1], Math.max(w, h * 0.5));
  return g;
}

// ---------------------------------------------------------------------------------------------------------------
// Windows and doors, built facing +Z with the outer wall face at z = 0 and the wall behind it (z in [-t, 0]).
// ---------------------------------------------------------------------------------------------------------------

function dressWindow(loc: Acc, o: Opening, kind: DwellingType, spec: Spec, t: number, hv: number, shutterShare: number, flowers: boolean, lit: boolean): void {
  const w = o.w;
  const h = o.h;
  const cy = o.y0 + h / 2;
  // Local origin is the opening centre; the opening is translated back to y = 0 by the caller using cy.
  const zp = -t * 0.55;
  const fs = 0.055;
  const st = spec.win;
  const glassG = lit && hv > 0.2 ? loc.glow : loc.glass;
  const yy = (v: number): number => v - 0; // local y relative to opening bottom -> caller adds y0
  void yy;
  const b0 = o.y0;
  const gl = (x0: number, y0: number, x1: number, y1: number): void => void glassG.merge(box(x0, y0, zp - 0.004, x1, y1, zp + 0.004));
  if (o.lattice) {
    // Wooden lattice (koshi) over the opening: close-set vertical slats and two rails, a dark room behind.
    gl(-w / 2 + 0.02, b0 + 0.02, w / 2 - 0.02, b0 + h - 0.02);
    const pitch = 0.075;
    const n = Math.floor((w - 0.1) / pitch);
    for (let i = 0; i <= n; i++) {
      const x = -((n * pitch) / 2) + i * pitch;
      loc.frame.merge(box(x - 0.017, b0 + 0.02, -0.07, x + 0.017, b0 + h - 0.02, -0.03));
    }
    for (const yy2 of [b0, b0 + h - 0.06]) loc.frame.merge(box(-w / 2 - 0.05, yy2, -0.09, w / 2 + 0.05, yy2 + 0.06, 0.0));
    loc.frame.merge(box(-w / 2 - 0.05, b0, -0.09, -w / 2 + 0.01, b0 + h, 0.0));
    loc.frame.merge(box(w / 2 - 0.01, b0, -0.09, w / 2 + 0.05, b0 + h, 0.0));
    return;
  }
  gl(-w / 2 + fs, b0 + fs, w / 2 - fs, b0 + h - fs);
  // Sash or casement frame.
  const f = loc.frame;
  f.merge(box(-w / 2, b0, zp - 0.04, w / 2, b0 + fs, zp + 0.045));
  f.merge(box(-w / 2, b0 + h - fs, zp - 0.04, w / 2, b0 + h, zp + 0.045));
  f.merge(box(-w / 2, b0, zp - 0.04, -w / 2 + fs, b0 + h, zp + 0.045));
  f.merge(box(w / 2 - fs, b0, zp - 0.04, w / 2, b0 + h, zp + 0.045));
  const cols = st.cols;
  const rows = st.rows;
  for (let i = 1; i < cols; i++) {
    const x = -w / 2 + (i * w) / cols;
    f.merge(box(x - 0.014, b0 + fs, zp - 0.02, x + 0.014, b0 + h - fs, zp + 0.035));
  }
  for (let j = 1; j < rows; j++) {
    const y2 = b0 + (j * h) / rows;
    f.merge(box(-w / 2 + fs, y2 - 0.014, zp - 0.02, w / 2 - fs, y2 + 0.014, zp + 0.035));
  }
  if (o.french) {
    f.merge(box(-w / 2, b0, zp - 0.04, w / 2, b0 + 0.12, zp + 0.05));
  }
  // Sill.
  const sillMat = kind === 'nordic' || kind === 'timber-frame' ? loc.trim : loc.stone;
  sillMat.merge(box(-w / 2 - 0.08, b0 - 0.06, -t * 0.2, w / 2 + 0.08, b0, 0.09));
  // Surround.
  const sur = st.surround;
  const sw = 0.14;
  if (sur === 'stone') {
    loc.stone.merge(box(-w / 2 - 0.2, b0 + h, -t * 0.4, w / 2 + 0.2, b0 + h + 0.17, 0.05));
    const n = Math.max(2, Math.round(h / 0.3));
    for (let k = 0; k < n; k++) {
      const y0 = b0 + (k * h) / n;
      const long = k % 2 === 0;
      for (const sx of [-1, 1]) loc.stone.merge(box(sx > 0 ? w / 2 - 0.01 : -w / 2 - sw - (long ? 0.08 : 0) + 0.01, y0, -t * 0.2, sx > 0 ? w / 2 + sw + (long ? 0.08 : 0) : -w / 2 + 0.01, y0 + h / n - 0.02, 0.04));
    }
  } else if (sur === 'plaster') {
    // A painted border round the opening.
    const c2 = 0.02;
    loc.trim.merge(box(-w / 2 - sw, b0 + h, -t * 0.4, w / 2 + sw, b0 + h + sw, c2));
    loc.trim.merge(box(-w / 2 - sw, b0, -t * 0.4, -w / 2, b0 + h, c2));
    loc.trim.merge(box(w / 2, b0, -t * 0.4, w / 2 + sw, b0 + h, c2));
  } else if (sur === 'timber') {
    loc.trim.merge(box(-w / 2 - 0.1, b0 + h, -t * 0.4, w / 2 + 0.1, b0 + h + 0.13, 0.06));
    loc.trim.merge(box(-w / 2 - 0.1, b0, -t * 0.4, -w / 2, b0 + h, 0.04));
    loc.trim.merge(box(w / 2, b0, -t * 0.4, w / 2 + 0.1, b0 + h, 0.04));
  } else if (sur === 'brick') {
    // Soldier-course lintel with a keystone, and stone cills.
    loc.stone.merge(box(-w / 2 - 0.1, b0 + h, -t * 0.4, w / 2 + 0.1, b0 + h + 0.12, 0.05));
    loc.stone.merge(box(-0.09, b0 + h, -t * 0.4, 0.09, b0 + h + 0.18, 0.07));
  }
  // Shutters, open against the wall or closed over the glass.
  if (shutterShare > 0 && hv < shutterShare && !o.french) {
    const closed = hv < shutterShare * 0.18 && kind === 'mediterranean';
    const sw2 = closed ? w / 2 + 0.005 : w / 2 - 0.02;
    const rowsN = Math.max(4, Math.round(h / 0.16));
    for (const sx of [-1, 1]) {
      const cx = closed ? sx * (sw2 / 2) : sx * (w / 2 + 0.04 + sw2 / 2);
      loc.shutter.merge(box(cx - sw2 / 2, b0 - 0.01, closed ? 0.015 : 0.005, cx + sw2 / 2, b0 + h + 0.01, closed ? 0.055 : 0.04));
      // Louvre slats in relief.
      for (let k = 0; k < rowsN; k++) {
        const y2 = b0 + 0.08 + (k * (h - 0.12)) / rowsN;
        loc.shutter.merge(box(cx - sw2 / 2 + 0.035, y2, closed ? 0.055 : 0.04, cx + sw2 / 2 - 0.035, y2 + 0.045, closed ? 0.075 : 0.06));
      }
    }
  }
  // A window box with a few blooms.
  if (flowers && st.box > 0 && hv > 1 - st.box && o.floor === 0) {
    loc.timber.merge(box(-w / 2, b0 - 0.3, 0.02, w / 2, b0 - 0.1, 0.24));
    loc.soil.merge(box(-w / 2 + 0.02, b0 - 0.1, 0.04, w / 2 - 0.02, b0 - 0.07, 0.22));
    const n = Math.max(3, Math.round(w / 0.17));
    for (let k = 0; k < n; k++) {
      const x = -w / 2 + 0.1 + (k * (w - 0.2)) / (n - 1);
      loc.leaves.merge(sphere(0.07, 5).translate(x, b0 - 0.04, 0.13));
      if (k % 2 === 0) loc.bloom.merge(sphere(0.042, 5).translate(x + 0.02, b0 + 0.04, 0.17));
    }
  }
  // A lit window shows curtains drawn part-way.
  if (lit && hv > 0.2) {
    const cw = w * 0.2;
    loc.fabric.merge(box(-w / 2 + fs, b0 + h * 0.12, zp + 0.012, -w / 2 + fs + cw, b0 + h - fs, zp + 0.03));
    loc.fabric.merge(box(w / 2 - fs - cw, b0 + h * 0.12, zp + 0.012, w / 2 - fs, b0 + h - fs, zp + 0.03));
  }
}

function dressDoor(loc: Acc, o: Opening, kind: DwellingType, spec: Spec, t: number, base: number, rnd: () => number, flowers: boolean): void {
  const w = o.w;
  const h = o.h;
  const zp = -t * 0.62;
  const b0 = base;
  const leaf = loc.door;
  if (kind === 'machiya') {
    // A sliding lattice door, a noren curtain, a stone threshold.
    leaf.merge(box(-w / 2 + 0.02, b0 + 0.04, zp - 0.025, w / 2 - 0.02, b0 + h - 0.04, zp + 0.025));
    const pitch = 0.08;
    const n = Math.floor((w - 0.14) / pitch);
    for (let i = 0; i <= n; i++) {
      const x = -((n * pitch) / 2) + i * pitch;
      loc.frame.merge(box(x - 0.016, b0 + 0.08, zp + 0.025, x + 0.016, b0 + h - 0.08, zp + 0.05));
    }
    loc.frame.merge(box(-w / 2, b0, zp - 0.04, -w / 2 + 0.05, b0 + h, zp + 0.06));
    loc.frame.merge(box(w / 2 - 0.05, b0, zp - 0.04, w / 2, b0 + h, zp + 0.06));
    loc.frame.merge(box(-w / 2, b0 + h - 0.06, zp - 0.04, w / 2, b0 + h, zp + 0.06));
    loc.fabric.merge(box(-w / 2 + 0.1, b0 + h - 0.8, 0.01, w / 2 - 0.1, b0 + h - 0.1, 0.03));
    loc.stone.merge(box(-w / 2 - 0.15, 0, 0, w / 2 + 0.15, b0, 0.5));
    return;
  }
  // The leaf, recessed in the wall, with raised panels, a knob and a fanlight or glazed top.
  leaf.merge(box(-w / 2 + 0.03, b0 + 0.02, zp - 0.03, w / 2 - 0.03, b0 + h - 0.02, zp + 0.03));
  const pw = (w - 0.3) / 2;
  const glazed = kind === 'brick-terrace' || kind === 'nordic';
  for (const px of [-1, 1]) {
    const x = px * (pw / 2 + 0.05);
    leaf.merge(box(x - pw / 2, b0 + 0.18, zp + 0.03, x + pw / 2, b0 + (glazed ? 1.0 : 0.95), zp + 0.05));
    if (!glazed) leaf.merge(box(x - pw / 2, b0 + 1.1, zp + 0.03, x + pw / 2, b0 + h - 0.2, zp + 0.05));
  }
  if (glazed) {
    loc.glass.merge(box(-w / 2 + 0.16, b0 + 1.18, zp + 0.03, w / 2 - 0.16, b0 + h - 0.16, zp + 0.045));
    loc.frame.merge(box(-0.012, b0 + 1.18, zp + 0.04, 0.012, b0 + h - 0.16, zp + 0.06));
  }
  loc.iron.merge(sphere(0.035, 6).translate(w / 2 - 0.16, b0 + 1.0, zp + 0.08));
  loc.iron.merge(box(w / 2 - 0.24, b0 + 1.04, zp + 0.045, w / 2 - 0.08, b0 + 1.09, zp + 0.06));
  // Frame and surround.
  const sur = kind === 'stone-cottage' ? 'stone' : kind === 'brick-terrace' ? 'stone' : kind === 'timber-frame' || kind === 'nordic' ? 'timber' : kind === 'adobe' ? 'timber' : 'plaster';
  if (sur === 'stone') {
    const n = Math.max(3, Math.round(h / 0.34));
    for (let k = 0; k < n; k++) {
      const y0 = b0 + (k * h) / n;
      const long = k % 2 === 0;
      loc.stone.merge(box(-w / 2 - 0.18 - (long ? 0.08 : 0), y0, -t * 0.5, -w / 2 + 0.01, y0 + h / n - 0.02, 0.05));
      loc.stone.merge(box(w / 2 - 0.01, y0, -t * 0.5, w / 2 + 0.18 + (long ? 0.08 : 0), y0 + h / n - 0.02, 0.05));
    }
    loc.stone.merge(box(-w / 2 - 0.26, b0 + h, -t * 0.5, w / 2 + 0.26, b0 + h + 0.22, 0.07));
    if (kind === 'brick-terrace') loc.stone.merge(box(-w / 2 - 0.3, b0 + h + 0.22, -t * 0.5, w / 2 + 0.3, b0 + h + 0.3, 0.1));
  } else if (sur === 'timber') {
    loc.trim.merge(box(-w / 2 - 0.12, b0, -t * 0.5, -w / 2, b0 + h + 0.12, 0.06));
    loc.trim.merge(box(w / 2, b0, -t * 0.5, w / 2 + 0.12, b0 + h + 0.12, 0.06));
    loc.trim.merge(box(-w / 2 - 0.16, b0 + h, -t * 0.5, w / 2 + 0.16, b0 + h + 0.14, 0.08));
  } else {
    loc.trim.merge(box(-w / 2 - 0.14, b0, -t * 0.5, -w / 2, b0 + h + 0.14, 0.03));
    loc.trim.merge(box(w / 2, b0, -t * 0.5, w / 2 + 0.14, b0 + h + 0.14, 0.03));
    loc.trim.merge(box(-w / 2 - 0.14, b0 + h, -t * 0.5, w / 2 + 0.14, b0 + h + 0.14, 0.03));
  }
  // Steps up to the sill, as many as the base needs.
  const steps = base > 0.3 ? 2 : 1;
  for (let k = 0; k < steps; k++) {
    const rise = (base * (steps - k)) / steps;
    loc.stone.merge(box(-w / 2 - 0.25 - k * 0.05, 0, 0, w / 2 + 0.25 + k * 0.05, rise, 0.38 + (k + 1) * 0.1 + (steps - 1 - k) * 0.12));
  }
  // The porch of the type.
  if (spec.porch === 'hood') {
    loc.trim.merge(box(-w / 2 - 0.5, b0 + h + 0.35, 0.0, w / 2 + 0.5, b0 + h + 0.42, 0.85));
    loc.trim.merge(box(-w / 2 - 0.5, b0 + h + 0.42, 0.85 - 0.05, w / 2 + 0.5, b0 + h + 0.5, 0.88));
    for (const sx of [-1, 1]) {
      beam(loc.trim, [sx * (w / 2 + 0.42), b0 + h + 0.35, 0.78], [sx * (w / 2 + 0.42), b0 + h - 0.1, 0.05], 0.07);
    }
    // A gently pitched slate cover.
    loc.roof.merge(box(-w / 2 - 0.55, b0 + h + 0.5, 0.0, w / 2 + 0.55, b0 + h + 0.56, 0.95));
  } else if (spec.porch === 'porch') {
    // A gabled porch on two posts with a deck.
    const pw2 = w + 1.1;
    const pd = 1.6;
    const ph = h + 0.4;
    loc.timber.merge(box(-pw2 / 2, 0, 0, pw2 / 2, b0 - 0.04 > 0 ? b0 - 0.04 : 0.02, pd));
    for (const sx of [-1, 1]) loc.trim.merge(box(sx * (pw2 / 2 - 0.07) - 0.06, b0, pd - 0.14, sx * (pw2 / 2 - 0.07) + 0.06, b0 + ph, pd - 0.02));
    loc.trim.merge(box(-pw2 / 2 - 0.05, b0 + ph, 0, pw2 / 2 + 0.05, b0 + ph + 0.14, pd + 0.05));
    const rise2 = (pw2 / 2) * 0.42;
    const skins: RoofSkins = { top: loc.roof, soffit: loc.soffit, edge: loc.roofEdge };
    roofPlane(skins, [[-pw2 / 2 - 0.2, b0 + ph + 0.1, pd + 0.2], [-pw2 / 2 - 0.2, b0 + ph + 0.1, -0.05], [0, b0 + ph + 0.1 + rise2, -0.05], [0, b0 + ph + 0.1 + rise2, pd + 0.2]], 0.05, [0, b0 + ph - 0.5, pd / 2]);
    roofPlane(skins, [[pw2 / 2 + 0.2, b0 + ph + 0.1, -0.05], [pw2 / 2 + 0.2, b0 + ph + 0.1, pd + 0.2], [0, b0 + ph + 0.1 + rise2, pd + 0.2], [0, b0 + ph + 0.1 + rise2, -0.05]], 0.05, [0, b0 + ph - 0.5, pd / 2]);
    // Gable front, painted.
    const tri = new Geom();
    tri.quadAuto([-pw2 / 2 - 0.1, b0 + ph + 0.14, pd + 0.1], [pw2 / 2 + 0.1, b0 + ph + 0.14, pd + 0.1], [0, b0 + ph + 0.1 + rise2 - 0.02, pd + 0.1], [0, b0 + ph + 0.1 + rise2 - 0.02, pd + 0.1]);
    loc.trim.merge(tri);
  } else if (spec.porch === 'portal') {
    // Adobe portal: a flat roof on peeled posts with corbels, vigas and a lintel beam; chili ristras hang from it.
    const pw2 = Math.max(w + 2.4, 3.2);
    const pd = 1.9;
    const ph = h + 0.45;
    for (const sx of [-1, 1]) {
      loc.timber.merge(cylinder(0.11, 0.11, ph, 9).translate(sx * (pw2 / 2 - 0.2), b0, pd - 0.2));
      loc.timber.merge(box(sx * (pw2 / 2 - 0.2) - 0.16, b0 + ph - 0.18, pd - 0.36, sx * (pw2 / 2 - 0.2) + 0.16, b0 + ph, pd - 0.04));
    }
    loc.timber.merge(box(-pw2 / 2, b0 + ph, pd - 0.3, pw2 / 2, b0 + ph + 0.24, pd - 0.1));
    const nV = Math.floor(pw2 / 0.4);
    for (let i = 0; i <= nV; i++) {
      const x = -pw2 / 2 + 0.1 + (i * (pw2 - 0.2)) / nV;
      loc.timber.merge(cylZ(0.06, 0.06, pd + 0.25, 8).translate(x, b0 + ph + 0.3, -0.1 + (pd + 0.25) / 2));
    }
    loc.wall.merge(box(-pw2 / 2, b0 + ph + 0.36, -0.1, pw2 / 2, b0 + ph + 0.5, pd + 0.1));
    for (let i = 0; i < 3; i++) loc.fabric.merge(box(-w / 2 + 0.2 + i * 0.3 - 0.0, b0 + ph - 1.0, pd - 0.36, -w / 2 + 0.2 + i * 0.3 + 0.07, b0 + ph - 0.18, pd - 0.3));
    loc.stone.merge(box(-pw2 / 2 + 0.1, 0, 0, pw2 / 2 - 0.1, b0 + 0.02, pd));
  }
  if (flowers) {
    pottedPlant(loc.clay, loc.leaves, w / 2 + 0.55, 0, 0.35, 1);
    if (kind === 'mediterranean' || kind === 'stone-cottage') pottedPlant(loc.clay, loc.leaves, -w / 2 - 0.55, 0, 0.35, 1.15);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The manner of each type
// ---------------------------------------------------------------------------------------------------------------

function timberFrame(g: Geom, ops: Opening[], L: number, zb: number, zfAt: (f: number) => number, floors: number, yF: number[], heights: number[], base: number, jetty: number): void {
  const s = 0.14;
  const pr = 0.05;
  for (let f = 0; f < floors; f++) {
    const y0 = f === 0 ? base : yF[f]!;
    const y1 = yF[f]! + heights[f]!;
    const zf = zfAt(f);
    const hl = L / 2;
    // Sole plate, head plate and corner posts on all four faces.
    for (const [za, dir] of [[zf, 1], [zb, -1]] as const) {
      g.merge(box(-hl, y0, za - (dir < 0 ? 0 : 0), hl, y0 + s, za + dir * pr));
      g.merge(box(-hl, y1 - s, za, hl, y1, za + dir * pr));
      for (const sx of [-1, 1]) g.merge(box(sx * hl - (sx > 0 ? s : 0), y0, za, sx * hl + (sx < 0 ? s : 0), y1, za + dir * pr));
    }
    for (const sx of [-1, 1]) {
      g.merge(box(sx * hl, y0, zb, sx * hl + sx * pr, y0 + s, zf));
      g.merge(box(sx * hl, y1 - s, zb, sx * hl + sx * pr, y1, zf));
    }
    // Studs on front and back between the windows, braces at the ends, mid rails.
    for (const [w, za, dir] of [['f', zf, 1], ['b', zb, -1]] as const) {
      const holes = ops.filter((o) => o.wall === w && o.floor === f && !o.lattice).map((o) => [o.c - o.w / 2 - 0.15, o.c + o.w / 2 + 0.15] as const);
      const rails = ops.filter((o) => o.wall === w && o.floor === f && !o.lattice);
      for (let x = -hl + 0.55; x < hl - 0.3; x += 0.78) {
        if (holes.some(([a, b]) => x + s / 2 > a && x - s / 2 < b)) continue;
        g.merge(box(x - s * 0.4, y0 + s, za, x + s * 0.4, y1 - s, za + dir * pr));
      }
      for (const o of rails) {
        g.merge(box(o.c - o.w / 2 - 0.15, o.y0 + o.h, za, o.c + o.w / 2 + 0.15, o.y0 + o.h + 0.1, za + dir * pr));
        if (!o.door) g.merge(box(o.c - o.w / 2 - 0.15, o.y0 - 0.1, za, o.c + o.w / 2 + 0.15, o.y0, za + dir * pr));
      }
      for (const sx of [-1, 1]) {
        const x0 = sx * (hl - s);
        const x1 = sx * Math.max(hl - 1.2, 0.2);
        const braced = !holes.some(([a, b]) => Math.min(x0, x1) < b && Math.max(x0, x1) > a);
        if (braced) {
          const yA = y0 + s;
          const yB = y1 - s;
          beam(g, [x0, yA + 0.05, za + dir * pr / 2], [x1, yB - 0.05, za + dir * pr / 2], 0.1);
        }
      }
    }
  }
  if (jetty > 0) {
    // The bressumer under the overhang, and the joist ends.
    const zf = zfAt(1);
    g.merge(box(-L / 2 - 0.02, yF[1]! - 0.3, zfAt(0), L / 2 + 0.02, yF[1]! - 0.02, zf + 0.04));
    const n = Math.floor(L / 0.6);
    for (let i = 0; i <= n; i++) {
      const x = -L / 2 + 0.25 + (i * (L - 0.5)) / n;
      g.merge(box(x - 0.06, yF[1]! - 0.28, zfAt(0), x + 0.06, yF[1]! - 0.08, zf + 0.06));
    }
  }
}

function adobeDetails(acc: Acc, L: number, zb: number, zf: number, yTop: number, t: number, rnd: () => number): void {
  // Vigas: round beam ends through the parapet line of the front and back, canales (water spouts), corners rounded by buttresses.
  const n = Math.floor(L / 0.6);
  for (const [za, dir] of [[zf, 1], [zb, -1]] as const) {
    for (let i = 0; i <= n; i++) {
      const x = -L / 2 + 0.35 + (i * (L - 0.7)) / n;
      acc.timber.merge(cylZ(0.07, 0.07, 0.55, 8).translate(x, yTop - 0.3, za + dir * 0.0));
    }
    for (const x of [-L * 0.28, L * 0.31]) acc.stone.merge(box(x - 0.06, yTop + 0.25, za, x + 0.06, yTop + 0.32, za + dir * 0.4));
  }
  void t;
  void rnd;
  // Bands of darker earth plaster at the foot.
  acc.plinth.merge(box(-L / 2 - 0.03, 0, zf - 0.02, L / 2 + 0.03, 0.4, zf + 0.04));
}

function machiyaDetails(acc: Acc, L: number, zb: number, zf: number, yF: number[], heights: number[], base: number, ops: Opening[], doorLeft: boolean): void {
  // The hisashi: a lower tiled eave along the whole front over the ground floor, on timber brackets.
  const yH = yF[1]! - 0.35;
  const out = 1.05;
  const skins: RoofSkins = { top: acc.roof, soffit: acc.soffit, edge: acc.roofEdge };
  const sl = 0.35;
  const ref: V3 = [0, yH - 1, zf - 1];
  roofPlane(skins, [[-L / 2 - 0.3, yH - sl * 0.6, zf + out], [L / 2 + 0.3, yH - sl * 0.6, zf + out], [L / 2 + 0.3, yH + 0.2, zf - 0.02], [-L / 2 - 0.3, yH + 0.2, zf - 0.02]], 0.1, ref);
  for (const sx of [-1, 1]) acc.roofEdge.merge(new Geom());
  // Slim eave posts at the corners of the hisashi.
  for (let i = 0; i <= 4; i++) {
    const x = -L / 2 + 0.1 + (i * (L - 0.2)) / 4;
    beam(acc.timber, [x, yH - 0.08, zf + out - 0.12], [x, yH + 0.1, zf + 0.0], 0.06);
  }
  // A dark timber string course between the floors, and an inugaki bamboo screen at the foot.
  acc.timber.merge(box(-L / 2 - 0.02, yF[1]! - 0.05, zf - 0.04, L / 2 + 0.02, yF[1]! + 0.1, zf + 0.04));
  const n = Math.floor(L / 0.18);
  for (let i = 0; i <= n; i++) {
    const x = -L / 2 + 0.2 + (i * (L - 0.4)) / n;
    acc.timber.merge(box(x - 0.025, 0, zf + out - 0.0 - 0.0, x + 0.025, 0.55, zf + out + 0.05));
  }
  void ops;
  void doorLeft;
  void heights;
  void base;
  void zb;
}

function balcony(acc: Acc, cx: number, zf: number, yFloor: number, w: number): void {
  const d = 0.95;
  acc.stone.merge(box(cx - w / 2, yFloor - 0.16, zf, cx + w / 2, yFloor, zf + d));
  const top = yFloor + 0.95;
  acc.iron.merge(box(cx - w / 2, top - 0.04, zf + d - 0.04, cx + w / 2, top, zf + d));
  acc.iron.merge(box(cx - w / 2, top - 0.04, zf, cx - w / 2 + 0.04, top, zf + d));
  acc.iron.merge(box(cx + w / 2 - 0.04, top - 0.04, zf, cx + w / 2, top, zf + d));
  const nB = Math.round(w / 0.13);
  for (let i = 0; i <= nB; i++) acc.iron.merge(box(cx - w / 2 + (i * (w - 0.025)) / nB, yFloor, zf + d - 0.03, cx - w / 2 + 0.025 + (i * (w - 0.025)) / nB, top, zf + d - 0.005));
  for (const sx of [-1, 1]) {
    const n2 = 6;
    for (let i = 1; i < n2; i++) acc.iron.merge(box(cx + sx * (w / 2 - 0.02) - 0.012, yFloor, zf + (i * d) / n2 - 0.012, cx + sx * (w / 2 - 0.02) + 0.012, top, zf + (i * d) / n2 + 0.012));
  }
}

function loftWindow(acc: Acc, sx: number, hl: number, zc: number, yTop: number, rise: number, t: number): void {
  // A small casement set into the gable wall under the ridge, painted frame with dark glass.
  const x = sx * hl;
  const ww = 0.55;
  const wh = Math.min(0.7, rise * 0.4);
  const y0 = yTop + 0.35;
  const out = sx > 0 ? 1 : -1;
  void t;
  const xa = out > 0 ? x : x - 0.02;
  const xb = out > 0 ? x + 0.02 : x;
  acc.glass.merge(box(xa, y0, zc - ww / 2, xb, y0 + wh, zc + ww / 2));
  const s = 0.05;
  const fx0 = out > 0 ? x : x - 0.05;
  const fx1 = out > 0 ? x + 0.05 : x;
  acc.frame.merge(box(fx0, y0 - s, zc - ww / 2 - s, fx1, y0, zc + ww / 2 + s));
  acc.frame.merge(box(fx0, y0 + wh, zc - ww / 2 - s, fx1, y0 + wh + s, zc + ww / 2 + s));
  acc.frame.merge(box(fx0, y0, zc - ww / 2 - s, fx1, y0 + wh, zc - ww / 2));
  acc.frame.merge(box(fx0, y0, zc + ww / 2, fx1, y0 + wh, zc + ww / 2 + s));
  acc.frame.merge(box(fx0, y0, zc - 0.012, fx1, y0 + wh, zc + 0.012));
}

// ---------------------------------------------------------------------------------------------------------------

function measure(p: ParamReader): { size: [number, number, number]; door: [number, number] } {
  const key = JSON.stringify(['t', p.str('type'), p.num('width'), p.num('depth'), p.int('floors'), p.int('variant'), p.bool('gableFront'), p.str('roofForm'), p.str('roofing'), p.str('chimney'), p.int('dormers'), p.num('path'), p.num('footing'), p.str('shutters'), p.bool('flowers')]);
  const hit = cache.get(key);
  if (hit) return hit;
  const out = build(p);
  const door = lastDoor;
  let ax = 0;
  let az = 0;
  let ay = 0;
  for (const part of out.parts) {
    for (let k = 0; k < part.positions.length; k += 3) {
      ax = Math.max(ax, Math.abs(part.positions[k] as number));
      ay = Math.max(ay, part.positions[k + 1] as number);
      az = Math.max(az, Math.abs(part.positions[k + 2] as number));
    }
  }
  const r = { size: [ax * 2, ay, az * 2] as [number, number, number], door };
  if (cache.size > 400) cache.clear();
  cache.set(key, r);
  return r;
}

/** Where the front door is, in the dwelling's frame: x across the front and the z of the front wall. */
export function dwellingDoor(p: ParamReader): [number, number] {
  return measure(p).door;
}

export const DWELLING: FurnitureDef = {
  id: 'furn-dwelling',
  kind: 'dwelling',
  aliases: [
    'house', 'houses', 'home', 'cottage', 'village house', 'village houses', 'dwelling', 'farmhouse', 'townhouse', 'terraced house', 'row house', 'stone cottage', 'timber frame house', 'half timbered house', 'tudor house', 'mediterranean house', 'whitewashed house',
    'villa', 'machiya', 'japanese townhouse', 'japanese house', 'brick house', 'adobe house', 'pueblo house', 'nordic house', 'scandinavian house', 'wooden house', 'log house', 'thatched cottage', 'fisherman cottage', 'fisherman house',
  ],
  description:
    'A real dwelling in one cheap mesh (one mesh per material): `type` stone-cottage (rubble limestone, quoins, slate or thatch, dormer, external chimney breast), timber-frame (jettied upper floor, oak frame, plaster infill, tile), mediterranean (whitewash, low terracotta roof, rafter tails, shutters, balcony, window boxes), machiya (Japanese townhouse: dark lattice front, plaster upper floor, lower hisashi eave, hip roof of grey tile), brick-terrace (brick, sash windows, stone steps, slate, chimney stacks, party-wall width), adobe (earth plaster, vigas, canales, a portal on posts, parapet), nordic (board cladding, white trim, gabled porch, metal roof). Real roofs with eaves, verges, soffits, ridge caps; walls with reveals, door surrounds, plinths, gutters. `width` is the frontage along X, `depth` runs back (0 = the type\'s own, varied by `variant`), `floors` 0 = type default, `variant` 0 to 99 changes the proportions, the door bay, the colours, the chimney and the window pattern, `gableFront` turns the gable to the street, `roofing` auto|tile|slate|thatch|metal, `roofForm` auto|gable|hip|flat, `shutters`, `chimney`, `dormers`, `flowers`, `lit` (warm windows after dark), `path` (metres of flagstone path in front of the door), `footing` (metres of stone base with steps from the door, for a slope), `wallColor` `roofColor` `accentColor` (door and shutters; #000000 = by type). Front (door side) is +Z. Instance many through shape_land street, along or row.',
  params: {
    type: choice([...DWELLING_TYPES], 'stone-cottage', 'regional house type'),
    width: num(0, 0, 18, 'frontage along X in metres; 0 = the type\'s own with variation'),
    depth: num(0, 0, 18, 'depth in metres; 0 = the type\'s own with variation'),
    floors: int(0, 0, 3, 'storeys; 0 = the type\'s own'),
    variant: int(0, 0, 99, 'changes proportions, colours, door bay, chimney'),
    gableFront: flag(false, 'the gable end faces the street (the door is in it)'),
    roofForm: choice(['auto', 'gable', 'hip', 'flat'], 'auto', 'roof shape'),
    roofing: choice(['auto', 'tile', 'slate', 'thatch', 'metal'], 'auto', 'roof covering'),
    shutters: choice(['auto', 'yes', 'no'], 'auto', 'window shutters'),
    chimney: choice(['auto', 'none', 'ridge', 'gable'], 'auto', 'chimney position'),
    dormers: int(-1, -1, 3, 'dormer windows on the front slope; -1 = the type\'s own'),
    flowers: flag(true, 'window boxes and potted plants'),
    lit: flag(false, 'windows glow warmly (evening)'),
    path: num(0, 0, 20, 'metres of flagstone path in front of the door'),
    footing: num(0, 0, 6, 'metres of stone base under the house, with steps down from the door (a house on a slope: the origin is the foot of the low side)'),
    wallColor: color('#000000', 'wall colour; #000000 = by type'),
    roofColor: color('#000000', 'roof colour; #000000 = by type'),
    accentColor: color('#000000', 'door and shutter colour; #000000 = by type'),
  },
  mount: 'floor',
  againstWall: false,
  frontClearance: 1,
  size: (p) => measure(p).size,
  build: (p) => build(p),
};

export const DWELLINGS: readonly FurnitureDef[] = [DWELLING];
