/**
 * Sinks: a pedestal basin, a wall-hung basin with an exposed trap, a vessel bowl on a console, and a utility /
 * kitchen sink unit with a steel top. Ceramic shells are lofted with smooth normals, rims are rounded, taps are swept tubes.
 * Rims sit at 0.85 m (utility top 0.9 m). Back against a wall, front +Z.
 */
import { Geom, box, cylinder, extrude, lathe, roundedBox } from '../mesh';
import { PartSet } from '../parts';
import type { P2 } from '../math2';
import { choice, color, flag, int, mat, num, type FurnitureDef } from './kit';
import { loft, pole, superEllipse } from './shape';

type V3 = [number, number, number];

const DEFAULT_WIDTH: Record<string, number> = { pedestal: 0.56, 'wall-hung': 0.6, vessel: 0.8, utility: 0.9 };

/** One ring of a basin shell: the half extents shrink by `ins` (rim thickness) and are then scaled by `k` (the bowl narrowing). */
type Row = readonly [ins: number, k: number, y: number];

/** A basin shell from rows (outer wall up, over the rim, down the inner wall to a flat floor) round a superellipse plan. */
function shell(w: number, d: number, cz: number, n: number, rows: readonly Row[], seg = 32): Geom {
  const rings: V3[][] = rows.map(([ins, k, y]) => superEllipse(Math.max(0.01, (w / 2 - ins) * k), Math.max(0.01, (d / 2 - ins) * k), n, seg, 0, cz).map((q): V3 => [q[0], y, q[1]]));
  return loft(rings, 'out');
}

/** Single-lever mixer on a deck at (x, y, z); the spout reaches toward +Z. */
function mixer(x: number, y: number, z: number, h = 1): Geom {
  const g = new Geom();
  g.merge(cylinder(0.022, 0.02, 0.03, 16).translate(x, y, z));
  g.merge(cylinder(0.014, 0.014, 0.1 * h, 12).translate(x, y + 0.03, z));
  g.merge(
    pole(
      [
        [x, y + 0.1 * h, z],
        [x, y + 0.14 * h, z],
        [x, y + 0.16 * h, z + 0.035],
        [x, y + 0.15 * h, z + 0.09],
        [x, y + 0.115 * h, z + 0.125],
      ],
      0.0105,
      10,
      5,
    ),
  );
  g.merge(roundedBox(0.012, 0.012, 0.055, 0.005, 1).translate(x + 0.008, y + 0.115 * h, z - 0.032).rotateY(0));
  return g;
}

/** Round drain grate with a rim. */
function drain(x: number, y: number, z: number): Geom {
  return cylinder(0.026, 0.026, 0.006, 20).translate(x, y, z).merge(cylinder(0.012, 0.012, 0.008, 12).translate(x, y + 0.004, z));
}

function pedestalBasin(set: PartSet, p: { w: number; ceramic: ReturnType<typeof mat>; tap: ReturnType<typeof mat> }, d: number): void {
  const rim = 0.85;
  const bd = d - 0.04;
  const cz = -d / 2 + bd / 2;
  const rows: Row[] = [
    [0.12, 1, rim - 0.2],
    [0.06, 1, rim - 0.145],
    [0.022, 1, rim - 0.075],
    [0.0, 1, rim - 0.03],
    [0.006, 1, rim - 0.008],
    [0.03, 1, rim],
    [0.055, 1, rim],
    [0.072, 1, rim - 0.008],
    [0.08, 1, rim - 0.025],
    [0.085, 1, rim - 0.035],
    [0.085, 0.9, rim - 0.075],
    [0.085, 0.72, rim - 0.108],
    [0.085, 0.5, rim - 0.125],
    [0.085, 0.2, rim - 0.13],
  ];
  const body = shell(p.w, bd, cz, 2.8, rows);
  // Raised back lip and the tap deck.
  body.merge(roundedBox(p.w - 0.04, 0.085, 0.022, 0.009, 2).translate(0, rim + 0.04, -d / 2 + 0.014));
  // Pedestal column: a flared foot, a waisted stem, a collar under the basin.
  const column = lathe(
    [
      [0.001, 0],
      [0.1, 0],
      [0.112, 0.012],
      [0.104, 0.03],
      [0.075, 0.08],
      [0.058, 0.2],
      [0.055, 0.4],
      [0.066, 0.56],
      [0.1, 0.65],
      [0.12, 0.69],
      [0.001, 0.69],
    ],
    28,
  )
    .scale(1.2, 1, 0.95)
    .translate(0, 0, cz - 0.01);
  set.add(body.merge(column), p.ceramic);
  const f = new Geom().merge(mixer(0, rim, -d / 2 + 0.05)).merge(drain(0, rim - 0.126, cz));
  set.add(f, p.tap);
  set.boxMinMax(-0.14, 0, cz - 0.1, 0.14, 0.7, cz + 0.1);
  set.boxMinMax(-p.w / 2, 0.7, -d / 2, p.w / 2, rim + 0.01, d / 2 - 0.04);
}

function wallHungBasin(set: PartSet, p: { w: number; ceramic: ReturnType<typeof mat>; tap: ReturnType<typeof mat> }, d: number): void {
  const rim = 0.85;
  const bd = d - 0.03;
  const cz = -d / 2 + bd / 2;
  const rows: Row[] = [
    [0.2, 1, rim - 0.17],
    [0.1, 1, rim - 0.15],
    [0.04, 1, rim - 0.11],
    [0.012, 1, rim - 0.06],
    [0.0, 1, rim - 0.022],
    [0.008, 1, rim - 0.004],
    [0.032, 1, rim],
    [0.06, 1, rim],
    [0.076, 1, rim - 0.008],
    [0.084, 1, rim - 0.024],
    [0.088, 0.92, rim - 0.06],
    [0.088, 0.72, rim - 0.095],
    [0.088, 0.46, rim - 0.115],
    [0.088, 0.18, rim - 0.12],
  ];
  const body = shell(p.w, bd, cz, 3, rows);
  body.merge(roundedBox(p.w - 0.03, 0.07, 0.02, 0.008, 2).translate(0, rim + 0.033, -d / 2 + 0.012));
  set.add(body, p.ceramic);
  const f = new Geom().merge(mixer(0, rim, -d / 2 + 0.05)).merge(drain(0, rim - 0.116, cz));
  // Exposed trap: down from the drain, a bend, and into the wall.
  f.merge(pole([[0, rim - 0.12, cz], [0, 0.62, cz], [0, 0.57, cz - 0.005], [0, 0.535, cz - 0.04], [0, 0.525, -d / 2 + 0.012]], 0.016, 12, 5));
  f.merge(cylinder(0.026, 0.026, 0.03, 14).translate(0, rim - 0.17, cz));
  f.merge(cylinder(0.034, 0.034, 0.012, 16).rotateX(90).translate(0, 0.525, -d / 2 + 0.006));
  set.add(f, p.tap);
  set.boxMinMax(-p.w / 2, rim - 0.17, -d / 2, p.w / 2, rim + 0.01, d / 2 - 0.03);
}

function vesselBasin(set: PartSet, p: { w: number; ceramic: ReturnType<typeof mat>; tap: ReturnType<typeof mat>; top: string; body: ReturnType<typeof mat> }, d: number): void {
  const topY = 0.82;
  const th = 0.04;
  const w = p.w;
  const cz = 0;
  // Console: slab, four slim legs and a low shelf.
  set.add(roundedBox(w, th, d, 0.008, 2).translate(0, topY - th / 2 + 0.0, 0), mat(p.top));
  const legs = new Geom();
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) legs.merge(roundedBox(0.04, topY - th, 0.04, 0.008, 1).translate(sx * (w / 2 - 0.05), (topY - th) / 2, sz * (d / 2 - 0.05)));
  legs.merge(roundedBox(w - 0.06, 0.025, d - 0.1, 0.006, 1).translate(0, 0.22, 0));
  set.add(legs, p.body);
  // Round vessel with a thick rounded rim, sitting on the slab.
  const bowl = lathe(
    [
      [0.001, 0],
      [0.07, 0],
      [0.12, 0.012],
      [0.17, 0.05],
      [0.198, 0.1],
      [0.206, 0.13],
      [0.204, 0.15],
      [0.192, 0.158],
      [0.18, 0.152],
      [0.176, 0.13],
      [0.14, 0.06],
      [0.085, 0.032],
      [0.001, 0.028],
    ],
    36,
  )
    .scale(1, 1, 0.92)
    .translate(0, topY, cz + 0.02);
  set.add(bowl, p.ceramic);
  const f = new Geom();
  f.merge(drain(0, topY + 0.03, cz + 0.02));
  // Tall wall-side tap behind the bowl.
  const tz = -d / 2 + 0.06;
  f.merge(cylinder(0.022, 0.02, 0.02, 16).translate(0, topY, tz));
  f.merge(cylinder(0.013, 0.013, 0.2, 12).translate(0, topY + 0.02, tz));
  f.merge(pole([[0, topY + 0.2, tz], [0, topY + 0.25, tz], [0, topY + 0.255, tz + 0.05], [0, topY + 0.235, tz + 0.12], [0, topY + 0.2, tz + 0.15]], 0.0105, 10, 5));
  f.merge(roundedBox(0.012, 0.012, 0.05, 0.005, 1).translate(0.01, topY + 0.15, tz - 0.03));
  set.add(f, p.tap);
  set.boxMinMax(-w / 2, 0, -d / 2, w / 2, topY, d / 2);
  set.boxMinMax(-0.2, topY, -0.18, 0.2, topY + 0.16, 0.22);
}

function utilitySink(set: PartSet, p: { w: number; bowls: number; drainer: boolean; tap: ReturnType<typeof mat>; body: ReturnType<typeof mat> }, d: number): void {
  const topY = 0.9;
  const th = 0.035;
  const w = p.w;
  const steel = mat('brushed-metal');
  // Cabinet: carcass, plinth, two fronts with pulls.
  set.add(box(-w / 2 + 0.01, 0.1, -d / 2, w / 2 - 0.01, topY - th, d / 2 - 0.02), mat('paint', '#e6e2da'));
  set.add(box(-w / 2 + 0.02, 0, -d / 2 + 0.03, w / 2 - 0.02, 0.1, d / 2 - 0.07), mat('paint', '#2f3033'));
  const fr = new Geom();
  const pulls = new Geom();
  const nf = Math.max(1, Math.round(w / 0.45));
  const fw = (w - 0.02) / nf;
  for (let k = 0; k < nf; k++) {
    const x = -w / 2 + 0.01 + fw * (k + 0.5);
    fr.merge(roundedBox(fw - 0.004, topY - th - 0.1 - 0.006, 0.019, 0.002, 1).translate(x, 0.1 + (topY - th - 0.1) / 2, d / 2 - 0.01));
    pulls.merge(roundedBox(0.012, 0.16, 0.02, 0.005, 1).translate(x + (k % 2 === 0 ? 1 : -1) * (fw / 2 - 0.04), topY - th - 0.12, d / 2 + 0.01));
  }
  set.add(fr, p.body);
  set.add(pulls, mat('brushed-metal'));
  // Steel top with bowl cut-outs, bowl walls and floors lofted down.
  const bowlsW = p.drainer ? w * 0.62 : w - 0.1;
  const bowlW = (bowlsW - (p.bowls - 1) * 0.04) / p.bowls;
  const bowlD = d - 0.22;
  const bz = d / 2 - 0.1 - bowlD / 2;
  const x0 = p.drainer ? -w / 2 + 0.05 : -bowlsW / 2;
  const holes: P2[][] = [];
  const top = new Geom();
  const walls = new Geom();
  const floorY = topY - 0.21;
  const deep = new Geom();
  for (let b = 0; b < p.bowls; b++) {
    const cx = x0 + bowlW / 2 + b * (bowlW + 0.04);
    const hole = superEllipse(bowlW / 2, bowlD / 2, 9, 40, cx, bz);
    holes.push(hole);
    const rows = [
      [1, topY],
      [0.995, topY - 0.015],
      [0.94, topY - 0.17],
      [0.9, floorY + 0.01],
      [0.88, floorY],
    ].map(([k, y]) => superEllipse((bowlW / 2) * (k as number), (bowlD / 2) * (k as number), 9, 40, cx, bz).map((q): V3 => [q[0], y as number, q[1]]));
    walls.merge(loft(rows, 'in'));
    const fl = superEllipse((bowlW / 2) * 0.88, (bowlD / 2) * 0.88, 9, 40, cx, bz);
    deep.merge(new Geom().flatPolygon(fl, floorY, true));
    deep.merge(drain(cx, floorY, bz));
  }
  const outline: P2[] = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
  top.merge(new Geom().flatPolygon(outline, topY, true, holes));
  top.merge(extrude(outline, topY - th, topY, { top: false, bottom: true }));
  set.add(top.merge(walls).merge(deep), steel);
  // Drainer grooves on the right-hand side.
  const fx = new Geom();
  if (p.drainer) {
    const dx0 = x0 + bowlsW + 0.06;
    for (let k = 0; k < 7; k++) fx.merge(box(dx0 + 0.03, topY, bz - bowlD / 2 + 0.02 + k * ((bowlD - 0.04) / 7), w / 2 - 0.05, topY + 0.004, bz - bowlD / 2 + 0.04 + k * ((bowlD - 0.04) / 7)));
  }
  // Upstand and a gooseneck tap on the back edge between bowls.
  fx.merge(box(-w / 2, topY, -d / 2, w / 2, topY + 0.07, -d / 2 + 0.014));
  set.add(fx, steel);
  const tx = p.bowls > 1 ? x0 + bowlW + 0.02 : x0 + bowlW / 2;
  const tz = -d / 2 + 0.06;
  const tap = new Geom();
  tap.merge(cylinder(0.03, 0.026, 0.04, 18).translate(tx, topY, tz));
  tap.merge(pole([[tx, topY + 0.03, tz], [tx, topY + 0.28, tz], [tx, topY + 0.38, tz + 0.03], [tx, topY + 0.4, tz + 0.12], [tx, topY + 0.37, tz + 0.2], [tx, topY + 0.32, tz + 0.21]], 0.014, 10, 6));
  tap.merge(roundedBox(0.012, 0.012, 0.06, 0.005, 1).translate(tx + 0.03, topY + 0.1, tz));
  set.add(tap, p.tap);
  set.boxMinMax(-w / 2, 0, -d / 2, w / 2, topY, d / 2);
  set.boxMinMax(tx - 0.03, topY, tz - 0.03, tx + 0.03, topY + 0.4, tz + 0.22);
}

export const SINK: FurnitureDef = {
  id: 'furn-sink',
  kind: 'sink',
  description:
    'Standalone sink / washbasin: `pedestal` (basin on a column), `wall-hung` (basin with exposed chrome trap), `vessel` (round bowl on a stone-topped console) or `utility` (kitchen / laundry unit with a steel top, one or two bowls, a drainer and a gooseneck tap). Ceramic with a rounded rim, drain and mixer; back against a wall. For a bathroom cabinet with a built-in basin use `vanity`.',
  params: {
    style: choice(['pedestal', 'wall-hung', 'vessel', 'utility'], 'pedestal', 'pedestal, wall-hung, vessel (bowl on a console) or utility (kitchen / laundry sink unit)'),
    width: num(0, 0, 1.8, 'width (m); 0 takes the style default (pedestal 0.56, wall-hung 0.6, vessel 0.8, utility 0.9; utility with two bowls is better at 1.2+)'),
    color: color('#f4f2ee', 'ceramic colour'),
    tap: choice(['chrome', 'brass', 'black-metal', 'brushed-metal'], 'chrome', 'tap and trap finish'),
    top: choice(['marble', 'terrazzo', 'concrete', 'oak', 'walnut'], 'marble', 'console top (vessel style)'),
    body: choice(['paint', 'oak', 'walnut', 'black-metal'], 'oak', 'console frame (vessel) or cabinet fronts (utility)'),
    bowls: int(1, 1, 2, 'bowls (utility style)'),
    drainer: flag(true, 'draining board beside the bowls (utility style)'),
  },
  mount: 'floor',
  againstWall: true,
  frontClearance: 0.6,
  size: (p) => {
    const s = p.str('style');
    const w = p.num('width') > 0 ? p.num('width') : (DEFAULT_WIDTH[s] ?? 0.56);
    return s === 'utility' ? [w, 1.3, 0.6] : s === 'vessel' ? [w, 1.1, 0.45] : s === 'wall-hung' ? [w, 1.05, 0.46] : [w, 1.05, 0.48];
  },
  build(p) {
    const set = new PartSet();
    const style = p.str('style');
    const w = p.num('width') > 0 ? p.num('width') : (DEFAULT_WIDTH[style] ?? 0.56);
    const ceramic = mat('ceramic', p.color('color'));
    const tap = mat(p.str('tap'));
    const bodyFin = p.str('body');
    const body = bodyFin === 'paint' ? mat('paint', '#e6e2da') : mat(bodyFin);
    if (style === 'utility') utilitySink(set, { w, bowls: p.int('bowls'), drainer: p.bool('drainer'), tap, body }, 0.6);
    else if (style === 'vessel') vesselBasin(set, { w, ceramic, tap, top: p.str('top'), body }, 0.45);
    else if (style === 'wall-hung') wallHungBasin(set, { w, ceramic, tap }, 0.46);
    else pedestalBasin(set, { w, ceramic, tap }, 0.48);
    return set.build();
  },
};

/** Sink definitions. */
export const SINKS: readonly FurnitureDef[] = [SINK];
