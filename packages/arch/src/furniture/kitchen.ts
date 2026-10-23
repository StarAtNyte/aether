/**
 * Kitchen: a straight counter run (base cabinets, worktop, sink with tap,
 * induction hob, splashback and wall cabinets), an island with a waterfall
 * worktop and overhang for stools, a tall fridge and a cooker hood.
 * Worktops at 0.9 m, base cabinets 0.6 m deep, wall cabinets from 1.45 m.
 */
import type { MaterialSpec } from '@aether/core';
import { Geom, box, cylinder, lathe, roundedBox, tube } from '../mesh';
import { pole } from './shape';
import { PartSet } from '../parts';
import { choice, color, drawerBox, emitFront, flag, mat, num, MovableSink, type FurnitureDef } from './kit';

const WORKTOPS = ['marble', 'terrazzo', 'concrete', 'oak', 'walnut', 'black-metal'];
const FRONTS = ['paint', 'oak', 'walnut', 'ash'];

function frontMat(kind: string, tint: string): MaterialSpec {
  return kind === 'paint' ? mat('paint', tint) : mat(kind);
}

/** Where fronts go: static geometry, or movable parts when the piece is interactive. */
interface FrontCtx {
  sink: MovableSink | undefined;
  prefix: string;
  front: MaterialSpec;
  handle: MaterialSpec;
  /** Running counter of drawers / doors handed out (stable ids). */
  n: { drawer: number; door: number };
}

/** Row of cabinet doors / drawers across [x0, x1] at height [y0, y1] on the plane z. */
function fronts(g: Geom, handles: Geom, x0: number, x1: number, y0: number, y1: number, z: number, unit: number, drawers: boolean, ctx: FrontCtx): void {
  const n = Math.max(1, Math.round((x1 - x0) / unit));
  const fw = (x1 - x0) / n;
  for (let k = 0; k < n; k++) {
    const x = x0 + fw * (k + 0.5);
    if (drawers) {
      const rows = 3;
      const fh = (y1 - y0) / rows;
      for (let r = 0; r < rows; r++) {
        const y = y0 + fh * (r + 0.5);
        const i = ctx.n.drawer++;
        emitFront(ctx.sink, { front: g, handle: handles }, {
          id: `${ctx.prefix}drawer-${i}`, name: 'Drawer', kind: 'drawer', center: [x, y, z], size: [fw - 0.004, fh - 0.004, 0.019], motion: { type: 'slide', offset: [0, 0, 0.4] },
          front: roundedBox(fw - 0.004, fh - 0.004, 0.019, 0.002, 1).translate(x, y, z),
          handle: roundedBox(Math.min(0.3, fw * 0.5), 0.012, 0.02, 0.005, 1).translate(x, y + fh / 2 - 0.035, z + 0.02),
          body: drawerBox(x, y, fw, fh, z, 0.45),
          frontMaterial: ctx.front, handleMaterial: ctx.handle, bodyMaterial: mat('paint', '#d9d4cb'),
        });
      }
    } else {
      const i = ctx.n.door++;
      const hinge = k % 2 === 0 ? 'left' : 'right';
      emitFront(ctx.sink, { front: g, handle: handles }, {
        id: `${ctx.prefix}door-${i}`, name: 'Cabinet door', kind: 'door', center: [x, (y0 + y1) / 2, z], size: [fw - 0.004, y1 - y0 - 0.004, 0.019], motion: { type: 'swing', hinge, angle: hinge === 'left' ? -105 : 105 },
        front: roundedBox(fw - 0.004, y1 - y0 - 0.004, 0.019, 0.002, 1).translate(x, (y0 + y1) / 2, z),
        handle: roundedBox(Math.min(0.3, fw * 0.5), 0.012, 0.02, 0.005, 1).translate(x, y1 - 0.045, z + 0.02),
        frontMaterial: ctx.front, handleMaterial: ctx.handle,
      });
    }
  }
}

export const KITCHEN: FurnitureDef = {
  id: 'furn-kitchen',
  kind: 'kitchen',
  description: 'Straight kitchen run against a wall: base cabinets, 0.9 m worktop, sink with tap, induction hob, tiled splashback and wall cabinets. Front faces +Z.',
  params: {
    length: num(3, 1.2, 8, 'run length (m)'),
    worktop: choice(WORKTOPS, 'marble', 'worktop finish'),
    fronts: choice(FRONTS, 'paint', 'cabinet front finish'),
    color: color('#d9d4cb', 'paint colour of the fronts'),
    sink: choice(['left', 'center', 'right', 'none'], 'left', 'sink position'),
    hob: choice(['left', 'center', 'right', 'none'], 'right', 'hob position'),
    upper: flag(true, 'wall cabinets'),
    splashback: choice(['subway-tile', 'tile', 'marble', 'none'], 'subway-tile', 'splashback finish'),
    interactive: flag(false, 'drawers and cabinet doors are separate parts that open'),
  },
  interactive: true,
  mount: 'floor',
  againstWall: true,
  frontClearance: 1.0,
  size: (p) => [p.num('length'), p.bool('upper') ? 2.2 : 0.92, 0.64],
  build(p, _seed, sink) {
    const set = new PartSet();
    const L = p.num('length');
    const d = 0.62;
    const front = frontMat(p.str('fronts'), p.color('color'));
    const fctx: FrontCtx = { sink, prefix: '', front, handle: mat('brushed-metal'), n: { drawer: 0, door: 0 } };
    const plinth = 0.1;
    const top = 0.9;
    const t = 0.03;
    set.add(box(-L / 2, plinth, -d / 2, L / 2, top - t, d / 2 - 0.02), mat('paint', '#ede9e2'));
    set.add(box(-L / 2 + 0.01, 0, -d / 2 + 0.03, L / 2 - 0.01, plinth, d / 2 - 0.07), mat('paint', '#2f3033'));
    const g = new Geom();
    const handles = new Geom();
    const slot = (pos: string): number => (pos === 'left' ? -L / 2 + 0.55 : pos === 'right' ? L / 2 - 0.55 : 0);
    const sinkX = p.str('sink') === 'none' ? null : slot(p.str('sink'));
    const hobX = p.str('hob') === 'none' ? null : slot(p.str('hob')) + (sinkX !== null && Math.abs(slot(p.str('hob')) - sinkX) < 0.9 ? (slot(p.str('hob')) >= sinkX ? 0.9 : -0.9) : 0);
    // Drawers under the hob, doors elsewhere.
    const hobSpan = hobX !== null ? [hobX - 0.4, hobX + 0.4] : null;
    if (hobSpan) {
      fronts(g, handles, -L / 2 + 0.005, Math.max(-L / 2 + 0.005, hobSpan[0] as number), plinth + 0.005, top - t - 0.005, d / 2 - 0.01, 0.6, false, fctx);
      fronts(g, handles, hobSpan[0] as number, hobSpan[1] as number, plinth + 0.005, top - t - 0.005, d / 2 - 0.01, 0.8, true, fctx);
      fronts(g, handles, Math.min(L / 2 - 0.005, hobSpan[1] as number), L / 2 - 0.005, plinth + 0.005, top - t - 0.005, d / 2 - 0.01, 0.6, false, fctx);
    } else fronts(g, handles, -L / 2 + 0.005, L / 2 - 0.005, plinth + 0.005, top - t - 0.005, d / 2 - 0.01, 0.6, false, fctx);
    // Worktop (with a sink cut-out drawn as a recessed basin).
    const worktop = new Geom();
    if (sinkX !== null) {
      const sx0 = sinkX - 0.3;
      const sx1 = sinkX + 0.3;
      worktop.merge(box(-L / 2, top - t, -d / 2, sx0, top, d / 2 + 0.02));
      worktop.merge(box(sx1, top - t, -d / 2, L / 2, top, d / 2 + 0.02));
      worktop.merge(box(sx0, top - t, -d / 2, sx1, top, -d / 2 + 0.12));
      worktop.merge(box(sx0, top - t, d / 2 - 0.1, sx1, top, d / 2 + 0.02));
      const basin = new Geom();
      basin.merge(box(sx0, top - 0.22, -d / 2 + 0.12, sx1, top - 0.2, d / 2 - 0.1));
      basin.merge(box(sx0, top - 0.22, -d / 2 + 0.12, sx0 + 0.01, top - t, d / 2 - 0.1));
      basin.merge(box(sx1 - 0.01, top - 0.22, -d / 2 + 0.12, sx1, top - t, d / 2 - 0.1));
      basin.merge(box(sx0, top - 0.22, -d / 2 + 0.12, sx1, top - t, -d / 2 + 0.13));
      basin.merge(box(sx0, top - 0.22, d / 2 - 0.11, sx1, top - t, d / 2 - 0.1));
      const tap = tube([[sinkX, top, -d / 2 + 0.07], [sinkX, top + 0.3, -d / 2 + 0.07], [sinkX, top + 0.34, -d / 2 + 0.12], [sinkX, top + 0.3, -d / 2 + 0.22]], 0.012, 10);
      tap.merge(cylinder(0.025, 0.025, 0.05, 16).translate(sinkX, top, -d / 2 + 0.07));
      if (sink) {
        // Interactive: the tap is its own part so it can be turned on (water runs from the spout into the basin).
        sink.add({
          id: 'tap', name: 'Tap', kind: 'tap', center: [sinkX, top + 0.17, -d / 2 + 0.14], size: [0.07, 0.36, 0.26], motion: { type: 'toggle', stream: { from: [sinkX, top + 0.29, -d / 2 + 0.22], to: [sinkX, top - 0.2, -d / 2 + 0.22] } },
          parts: [{ geom: tap, material: mat('brushed-metal') }],
        });
        set.add(basin, mat('brushed-metal'));
      } else set.add(basin.merge(tap), mat('brushed-metal'));
    } else worktop.merge(box(-L / 2, top - t, -d / 2, L / 2, top, d / 2 + 0.02));
    set.add(worktop, mat(p.str('worktop')));
    if (hobX !== null) {
      set.add(box(hobX - 0.3, top, -d / 2 + 0.05, hobX + 0.3, top + 0.006, d / 2 - 0.05), { finish: 'glass', color: '#111214', opacity: 1, roughness: 0.08 });
    }
    set.add(g, front).add(handles, mat('brushed-metal'));
    const upper = p.bool('upper');
    if (p.str('splashback') !== 'none') {
      const sb = box(-L / 2, top, -d / 2, L / 2, upper ? 1.45 : top + 0.6, -d / 2 + 0.012);
      set.add(sb, mat(p.str('splashback'), p.str('splashback') === 'marble' ? undefined : '#f1efea'));
    }
    if (upper) {
      const ud = 0.35;
      set.add(box(-L / 2, 1.45, -d / 2, L / 2, 2.2, -d / 2 + ud - 0.02), mat('paint', '#ede9e2'));
      const ug = new Geom();
      const uh = new Geom();
      for (let k = 0; k < Math.max(1, Math.round(L / 0.6)); k++) {
        const n = Math.max(1, Math.round(L / 0.6));
        const fw = L / n;
        const x = -L / 2 + fw * (k + 0.5);
        if (hobX !== null && Math.abs(x - hobX) < fw / 2 + 0.01) continue; // hood goes here
        const hinge = k % 2 === 0 ? 'right' : 'left';
        emitFront(sink, { front: ug, handle: uh }, {
          id: `upper-${k}`, name: 'Wall cabinet door', kind: 'door', center: [x, 1.825, -d / 2 + ud - 0.01], size: [fw - 0.004, 0.75 - 0.004, 0.019], motion: { type: 'swing', hinge, angle: hinge === 'left' ? -105 : 105 },
          front: roundedBox(fw - 0.004, 0.75 - 0.004, 0.019, 0.002, 1).translate(x, 1.825, -d / 2 + ud - 0.01),
          handle: roundedBox(0.012, 0.012, 0.02, 0.005, 1).translate(x + (k % 2 === 0 ? fw / 2 - 0.04 : -fw / 2 + 0.04), 1.5, -d / 2 + ud + 0.01),
          frontMaterial: front, handleMaterial: mat('brushed-metal'),
        });
      }
      set.add(ug, front).add(uh, mat('brushed-metal'));
      if (hobX !== null) set.add(box(hobX - 0.3, 1.6, -d / 2, hobX + 0.3, 1.68, -d / 2 + 0.5).merge(box(hobX - 0.12, 1.68, -d / 2, hobX + 0.12, 2.2, -d / 2 + 0.25)), mat('brushed-metal'));
      // Under-cabinet light strip.
      set.add(box(-L / 2 + 0.05, 1.44, -d / 2 + 0.25, L / 2 - 0.05, 1.45, -d / 2 + 0.28), { preset: 'emissive', color: '#ffe4bd', emissive: '#ffd9a8', emissiveIntensity: 2.4 });
    }
    set.boxMinMax(-L / 2, 0, -d / 2, L / 2, top, d / 2);
    return set.build();
  },
};

export const ISLAND: FurnitureDef = {
  id: 'furn-island',
  kind: 'island',
  description: 'Kitchen island with a waterfall worktop, cabinet fronts on the +Z side and a seating overhang on −Z.',
  params: {
    width: num(2.2, 1.2, 4, 'length (m)'),
    depth: num(1.0, 0.8, 1.4, 'depth (m)'),
    worktop: choice(WORKTOPS, 'marble', 'worktop finish'),
    fronts: choice(FRONTS, 'oak', 'front finish'),
    color: color('#d9d4cb', 'paint colour of the fronts'),
    interactive: flag(false, 'drawers and cabinet doors are separate parts that open'),
  },
  interactive: true,
  mount: 'floor',
  againstWall: false,
  frontClearance: 1.0,
  size: (p) => [p.num('width'), 0.92, p.num('depth')],
  build(p, _seed, sink) {
    const set = new PartSet();
    const w = p.num('width');
    const d = p.num('depth');
    const top = 0.92;
    const t = 0.04;
    const body = d - 0.3;
    const zc = 0.15;
    set.add(box(-w / 2 + t, 0.08, zc - body / 2, w / 2 - t, top - t, zc + body / 2 - 0.02), mat('paint', '#ede9e2'));
    const g = new Geom();
    const handles = new Geom();
    const islandFront = frontMat(p.str('fronts'), p.color('color'));
    fronts(g, handles, -w / 2 + t + 0.005, w / 2 - t - 0.005, 0.09, top - t - 0.005, zc + body / 2 - 0.01, 0.6, false, { sink, prefix: '', front: islandFront, handle: mat('brushed-metal'), n: { drawer: 0, door: 0 } });
    set.add(g, islandFront).add(handles, mat('brushed-metal'));
    const wt = new Geom();
    wt.merge(box(-w / 2, top - t, -d / 2, w / 2, top, d / 2));
    wt.merge(box(-w / 2, 0, -d / 2, -w / 2 + t, top - t, d / 2));
    wt.merge(box(w / 2 - t, 0, -d / 2, w / 2, top - t, d / 2));
    set.add(wt, mat(p.str('worktop')));
    set.boxMinMax(-w / 2, 0, -d / 2 + 0.3, w / 2, top, d / 2);
    set.boxMinMax(-w / 2, top - t, -d / 2, w / 2, top, -d / 2 + 0.3);
    return set.build();
  },
};

export const FRIDGE: FurnitureDef = {
  id: 'furn-fridge',
  kind: 'fridge',
  description:
    'Fridge / refrigerator with rounded steel doors and bar handles; back against a wall. `layout`: bottom-freezer (default tall fridge over a freezer door), single (one door; use a low `height` for an under-counter fridge), side-by-side (narrow freezer door beside a fridge door) or french (two upper doors over a freezer drawer).',
  params: {
    width: num(0.7, 0.5, 1.1, 'width (m); side-by-side and french are best at 0.85-1.0'),
    height: num(1.9, 0.8, 2.1, 'height (m): 0.85 under-counter, 1.9 tall'),
    layout: choice(['bottom-freezer', 'single', 'side-by-side', 'french'], 'bottom-freezer', 'door arrangement'),
    finish: choice(['brushed-metal', 'paint', 'black-metal'], 'brushed-metal', 'door finish'),
    interactive: flag(false, 'the doors are separate parts that open'),
  },
  interactive: true,
  mount: 'floor',
  againstWall: true,
  frontClearance: 1.0,
  size: (p) => [p.num('width'), p.num('height'), 0.68],
  build(p, _seed, sink) {
    const set = new PartSet();
    const w = p.num('width');
    const H = p.num('height');
    const d = 0.68;
    const face = p.str('finish') === 'paint' ? mat('paint', '#e9e6e0') : mat(p.str('finish'));
    const layout = H < 1.2 ? 'single' : p.str('layout');
    set.add(roundedBox(w, H - 0.02, d - 0.04, 0.01, 1).translate(0, 0.01 + (H - 0.02) / 2, -0.02), mat('paint', '#d7d4cf'));
    // Plinth grille and a top trim line.
    set.add(box(-w / 2 + 0.02, 0, -d / 2 + 0.05, w / 2 - 0.02, 0.025, d / 2 - 0.05), mat('black-metal'));
    const doors = new Geom();
    const bars = new Geom();
    const barMat = mat('chrome');
    interface Door { id: string; name: string; kind: 'door' | 'drawer'; xc: number; dw: number; yc: number; h: number; hy: number; bh: number; hx: number; hinge: 'left' | 'right'; horizontal?: boolean }
    const list: Door[] = [];
    const y0 = 0.03;
    const top = H - 0.005;
    const edge = (xc: number, dw: number, hinge: 'left' | 'right'): number => (hinge === 'right' ? xc - dw / 2 + 0.05 : xc + dw / 2 - 0.05);
    if (layout === 'single') list.push({ id: 'door-0', name: 'Fridge door', kind: 'door', xc: 0, dw: w - 0.006, yc: (y0 + top) / 2, h: top - y0, hy: Math.min(top - 0.2, y0 + (top - y0) * 0.7), bh: Math.min(0.55, (top - y0) * 0.45), hx: edge(0, w, 'right'), hinge: 'right' });
    else if (layout === 'side-by-side') {
      const fw = w * 0.4;
      const rw = w - fw;
      list.push({ id: 'door-0', name: 'Freezer door', kind: 'door', xc: -w / 2 + fw / 2, dw: fw - 0.005, yc: (y0 + top) / 2, h: top - y0, hy: H * 0.55, bh: 0.6, hx: edge(-w / 2 + fw / 2, fw, 'left'), hinge: 'left' });
      list.push({ id: 'door-1', name: 'Fridge door', kind: 'door', xc: w / 2 - rw / 2, dw: rw - 0.005, yc: (y0 + top) / 2, h: top - y0, hy: H * 0.55, bh: 0.6, hx: edge(w / 2 - rw / 2, rw, 'right'), hinge: 'right' });
    } else {
      const lowH = H * 0.32;
      const upY0 = y0 + lowH + 0.012;
      const upH = top - upY0;
      if (layout === 'french') {
        list.push({ id: 'door-0', name: 'Fridge door', kind: 'door', xc: -w / 4, dw: w / 2 - 0.005, yc: upY0 + upH / 2, h: upH, hy: upY0 + upH * 0.45, bh: 0.45, hx: edge(-w / 4, w / 2, 'left'), hinge: 'left' });
        list.push({ id: 'door-1', name: 'Fridge door', kind: 'door', xc: w / 4, dw: w / 2 - 0.005, yc: upY0 + upH / 2, h: upH, hy: upY0 + upH * 0.45, bh: 0.45, hx: edge(w / 4, w / 2, 'right'), hinge: 'right' });
        list.push({ id: 'drawer-0', name: 'Freezer drawer', kind: 'drawer', xc: 0, dw: w - 0.006, yc: y0 + lowH / 2, h: lowH, hy: y0 + lowH - 0.06, bh: w * 0.7, hx: 0, hinge: 'right', horizontal: true });
      } else {
        list.push({ id: 'door-0', name: 'Fridge door', kind: 'door', xc: 0, dw: w - 0.006, yc: upY0 + upH / 2, h: upH, hy: upY0 + upH * 0.45, bh: Math.min(0.55, upH * 0.45), hx: edge(0, w, 'right'), hinge: 'right' });
        list.push({ id: 'door-1', name: 'Freezer door', kind: 'door', xc: 0, dw: w - 0.006, yc: y0 + lowH / 2, h: lowH, hy: y0 + lowH * 0.62, bh: Math.min(0.35, lowH * 0.6), hx: edge(0, w, 'right'), hinge: 'right' });
      }
    }
    for (const f of list) {
      const handle = f.horizontal ? roundedBox(f.bh, 0.02, 0.03, 0.008, 2).translate(f.xc, f.hy, d / 2 + 0.03) : roundedBox(0.02, f.bh, 0.03, 0.008, 2).translate(f.hx, f.hy, d / 2 + 0.03);
      emitFront(sink, { front: doors, handle: bars }, {
        id: f.id, name: f.name, kind: f.kind, center: [f.xc, f.yc, d / 2 - 0.02], size: [f.dw, f.h, 0.04],
        motion: f.kind === 'drawer' ? { type: 'slide', offset: [0, 0, 0.45] } : { type: 'swing', hinge: f.hinge, angle: f.hinge === 'right' ? 110 : -110 },
        front: roundedBox(f.dw, f.h, 0.04, 0.012, 2).translate(f.xc, f.yc, d / 2 - 0.02),
        handle,
        frontMaterial: face, handleMaterial: barMat,
      });
    }
    set.add(doors, face);
    set.add(bars, barMat);
    set.boxMinMax(-w / 2, 0, -d / 2, w / 2, H, d / 2);
    return set.build();
  },
};

export const OVEN: FurnitureDef = {
  id: 'furn-oven',
  kind: 'oven',
  description: 'Freestanding cooker (range): four-burner hob with cast grates, control knobs, a glazed oven door with a bar handle and a plinth; 0.9 m tall, back against a wall. Pair with an `extractor` above it.',
  params: {
    width: num(0.6, 0.5, 1.2, 'width (m): 0.6 standard, 0.9 / 1.1 range cooker (6 burners from 0.9)'),
    finish: choice(['brushed-metal', 'paint', 'black-metal'], 'brushed-metal', 'body finish'),
    color: color('#e9e6e0', 'paint colour (when the finish is paint)'),
    trim: choice(['chrome', 'brass', 'black-metal'], 'chrome', 'knobs and handle finish'),
  },
  mount: 'floor',
  againstWall: true,
  frontClearance: 1.0,
  size: (p) => [p.num('width'), 0.95, 0.62],
  build(p) {
    const set = new PartSet();
    const w = p.num('width');
    const d = 0.6;
    const body = p.str('finish') === 'paint' ? mat('paint', p.color('color')) : mat(p.str('finish'));
    const trim = mat(p.str('trim'));
    const top = 0.9;
    set.add(roundedBox(w, top - 0.06, d, 0.012, 2).translate(0, 0.06 + (top - 0.06) / 2, 0), body);
    set.add(box(-w / 2 + 0.02, 0, -d / 2 + 0.04, w / 2 - 0.02, 0.06, d / 2 - 0.04), mat('black-metal'));
    // Hob plate (glass) with burners and grates.
    set.add(roundedBox(w - 0.02, 0.01, d - 0.02, 0.004, 1).translate(0, top + 0.005, 0), { finish: 'glass', color: '#101114', opacity: 1, roughness: 0.08 });
    const six = w >= 0.85;
    const cols = six ? 3 : 2;
    const rows = 2;
    const burners = new Geom();
    const grates = new Geom();
    const cw = (w - 0.06) / cols;
    const cd = (d - 0.14) / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = -w / 2 + 0.03 + cw * (c + 0.5);
        const z = -d / 2 + 0.07 + cd * (r + 0.5) - 0.01;
        const rad = Math.min(0.085, cw * 0.36, cd * 0.4) * (r === 0 && c === 0 ? 1 : 0.85);
        burners.merge(lathe([[rad * 0.5, 0.0], [rad * 0.52, 0.016], [rad * 0.62, 0.02], [rad * 0.62, 0.012], [rad * 0.5, 0.0]], 20).translate(x, top + 0.01, z));
        burners.merge(cylinder(rad * 0.33, rad * 0.3, 0.022, 16).translate(x, top + 0.01, z));
        for (const a of [0, 60, 120]) grates.merge(box(-rad * 1.25, 0.03, -0.008, rad * 1.25, 0.04, 0.008).rotateY(a).translate(x, top + 0.01, z));
      }
    }
    set.add(burners, mat('black-metal'));
    // One continuous cast frame joins each row of grates.
    const gx0 = -w / 2 + 0.035;
    const gx1 = w / 2 - 0.035;
    grates.merge(box(gx0, top + 0.036, -d / 2 + 0.04, gx1, top + 0.046, -d / 2 + 0.05)).merge(box(gx0, top + 0.036, d / 2 - 0.05, gx1, top + 0.046, d / 2 - 0.04));
    grates.merge(box(gx0, top + 0.036, -d / 2 + 0.04, gx0 + 0.01, top + 0.046, d / 2 - 0.04)).merge(box(gx1 - 0.01, top + 0.036, -d / 2 + 0.04, gx1, top + 0.046, d / 2 - 0.04));
    set.add(grates, mat('black-metal'));
    // Door, window, handle and knob strip.
    const doorH = 0.58;
    const doorY = 0.06 + doorH / 2 + 0.01;
    set.add(roundedBox(w - 0.02, doorH, 0.04, 0.012, 2).translate(0, doorY, d / 2 + 0.005), body);
    set.add(roundedBox(w - 0.2, doorH - 0.2, 0.012, 0.01, 2).translate(0, doorY - 0.03, d / 2 + 0.027), { finish: 'glass', color: '#17181b', opacity: 1, roughness: 0.06 });
    const handle = new Geom();
    handle.merge(pole([[-w / 2 + 0.08, doorY + doorH / 2 - 0.045, d / 2 + 0.02], [-w / 2 + 0.08, doorY + doorH / 2 - 0.045, d / 2 + 0.07], [w / 2 - 0.08, doorY + doorH / 2 - 0.045, d / 2 + 0.07], [w / 2 - 0.08, doorY + doorH / 2 - 0.045, d / 2 + 0.02]], 0.012, 8, 2));
    const nk = six ? 6 : 5;
    for (let k = 0; k < nk; k++) {
      const x = -w / 2 + 0.08 + ((w - 0.16) * k) / (nk - 1);
      handle.merge(cylinder(0.021, 0.018, 0.028, 16).rotateX(90).translate(x, 0.8, d / 2 + 0.02));
    }
    set.add(handle, trim);
    set.boxMinMax(-w / 2, 0, -d / 2, w / 2, top + 0.05, d / 2 + 0.07);
    return set.build();
  },
};

export const EXTRACTOR: FurnitureDef = {
  id: 'furn-extractor',
  kind: 'extractor',
  description: 'Cooker hood on a wall: a tapered steel canopy with a chimney flue running up (`height` is the flue height above the canopy), filter grille and lights underneath. Origin at the bottom of the canopy, back at z = 0 on the wall; mount about 0.65 m above the hob.',
  params: {
    width: num(0.6, 0.45, 1.2, 'width (m): match the hob'),
    height: num(0.75, 0.3, 1.2, 'flue height above the canopy (m)'),
    finish: choice(['brushed-metal', 'paint', 'black-metal', 'brass'], 'brushed-metal', 'hood finish'),
  },
  mount: 'wall',
  againstWall: true,
  frontClearance: 0.6,
  size: (p) => [p.num('width'), 0.18 + p.num('height'), 0.5],
  build(p) {
    const set = new PartSet();
    const w = p.num('width');
    const fin = p.str('finish') === 'paint' ? mat('paint', '#e9e6e0') : mat(p.str('finish'));
    const lowD = 0.5;
    const topD = Math.min(0.3, w * 0.55);
    const topW = Math.min(w * 0.55, 0.36);
    // Canopy: a frustum from the wide underside to the flue base (back stays on the wall).
    const g = new Geom();
    const c0: Array<[number, number, number]> = [[-w / 2, 0, 0], [w / 2, 0, 0], [w / 2, 0, lowD], [-w / 2, 0, lowD]];
    const c1: Array<[number, number, number]> = [[-topW / 2, 0.18, 0], [topW / 2, 0.18, 0], [topW / 2, 0.18, topD], [-topW / 2, 0.18, topD]];
    for (let k = 1; k < 4; k++) {
      const a = c0[k] as [number, number, number];
      const b = c0[(k + 1) % 4] as [number, number, number];
      const a1 = c1[k] as [number, number, number];
      const b1 = c1[(k + 1) % 4] as [number, number, number];
      // Faces: front (k=2), right (1), left (3): wound to face out.
      g.quadAuto(a, b, b1, a1);
    }
    g.quadAuto([-w / 2, 0, lowD], [w / 2, 0, lowD], [topW / 2, 0.18, topD], [-topW / 2, 0.18, topD]);
    g.merge(roundedBox(w - 0.004, 0.012, lowD, 0.004, 1).translate(0, 0.006, lowD / 2));
    set.add(g, fin);
    set.add(box(-topW / 2, 0.18, 0, topW / 2, 0.18 + p.num('height'), topD), fin);
    set.add(box(-w / 2 + 0.05, -0.004, 0.05, w / 2 - 0.05, 0.0, lowD - 0.05), mat('black-metal'));
    set.add(box(-w / 4 - 0.02, -0.006, lowD - 0.1, -w / 4 + 0.02, -0.002, lowD - 0.07).merge(box(w / 4 - 0.02, -0.006, lowD - 0.1, w / 4 + 0.02, -0.002, lowD - 0.07)), { preset: 'emissive', color: '#fff0d6', emissive: '#ffe2b0', emissiveIntensity: 2 });
    set.boxMinMax(-w / 2, 0, 0, w / 2, 0.18, lowD);
    set.boxMinMax(-topW / 2, 0.18, 0, topW / 2, 0.18 + p.num('height'), topD);
    return set.build();
  },
};

/** Kitchen definitions. */
export const KITCHEN_SET: readonly FurnitureDef[] = [KITCHEN, ISLAND, FRIDGE, OVEN, EXTRACTOR];
