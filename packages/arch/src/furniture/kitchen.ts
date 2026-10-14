/**
 * Kitchen: a straight counter run (base cabinets, worktop, sink with tap,
 * induction hob, splashback and wall cabinets), an island with a waterfall
 * worktop and overhang for stools, a tall fridge and a cooker hood.
 * Worktops at 0.9 m, base cabinets 0.6 m deep, wall cabinets from 1.45 m.
 */
import type { MaterialSpec } from '@aether/core';
import { Geom, box, cylinder, roundedBox, tube } from '../mesh';
import { PartSet } from '../parts';
import { choice, color, flag, mat, num, type FurnitureDef } from './kit';

const WORKTOPS = ['marble', 'terrazzo', 'concrete', 'oak', 'walnut', 'black-metal'];
const FRONTS = ['paint', 'oak', 'walnut', 'ash'];

function frontMat(kind: string, tint: string): MaterialSpec {
  return kind === 'paint' ? mat('paint', tint) : mat(kind);
}

/** Row of cabinet doors / drawers across [x0, x1] at height [y0, y1] on the plane z. */
function fronts(g: Geom, handles: Geom, x0: number, x1: number, y0: number, y1: number, z: number, unit: number, drawers: boolean): void {
  const n = Math.max(1, Math.round((x1 - x0) / unit));
  const fw = (x1 - x0) / n;
  for (let k = 0; k < n; k++) {
    const x = x0 + fw * (k + 0.5);
    if (drawers) {
      const rows = 3;
      const fh = (y1 - y0) / rows;
      for (let r = 0; r < rows; r++) {
        const y = y0 + fh * (r + 0.5);
        g.merge(roundedBox(fw - 0.004, fh - 0.004, 0.019, 0.002, 1).translate(x, y, z));
        handles.merge(roundedBox(Math.min(0.3, fw * 0.5), 0.012, 0.02, 0.005, 1).translate(x, y + fh / 2 - 0.035, z + 0.02));
      }
    } else {
      g.merge(roundedBox(fw - 0.004, y1 - y0 - 0.004, 0.019, 0.002, 1).translate(x, (y0 + y1) / 2, z));
      handles.merge(roundedBox(Math.min(0.3, fw * 0.5), 0.012, 0.02, 0.005, 1).translate(x, y1 - 0.045, z + 0.02));
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
  },
  mount: 'floor',
  againstWall: true,
  frontClearance: 1.0,
  size: (p) => [p.num('length'), p.bool('upper') ? 2.2 : 0.92, 0.64],
  build(p) {
    const set = new PartSet();
    const L = p.num('length');
    const d = 0.62;
    const front = frontMat(p.str('fronts'), p.color('color'));
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
      fronts(g, handles, -L / 2 + 0.005, Math.max(-L / 2 + 0.005, hobSpan[0] as number), plinth + 0.005, top - t - 0.005, d / 2 - 0.01, 0.6, false);
      fronts(g, handles, hobSpan[0] as number, hobSpan[1] as number, plinth + 0.005, top - t - 0.005, d / 2 - 0.01, 0.8, true);
      fronts(g, handles, Math.min(L / 2 - 0.005, hobSpan[1] as number), L / 2 - 0.005, plinth + 0.005, top - t - 0.005, d / 2 - 0.01, 0.6, false);
    } else fronts(g, handles, -L / 2 + 0.005, L / 2 - 0.005, plinth + 0.005, top - t - 0.005, d / 2 - 0.01, 0.6, false);
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
      set.add(basin.merge(tap), mat('brushed-metal'));
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
        ug.merge(roundedBox(fw - 0.004, 0.75 - 0.004, 0.019, 0.002, 1).translate(x, 1.825, -d / 2 + ud - 0.01));
        uh.merge(roundedBox(0.012, 0.012, 0.02, 0.005, 1).scale(1, 1, 1).translate(x + (k % 2 === 0 ? fw / 2 - 0.04 : -fw / 2 + 0.04), 1.5, -d / 2 + ud + 0.01));
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
  },
  mount: 'floor',
  againstWall: false,
  frontClearance: 1.0,
  size: (p) => [p.num('width'), 0.92, p.num('depth')],
  build(p) {
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
    fronts(g, handles, -w / 2 + t + 0.005, w / 2 - t - 0.005, 0.09, top - t - 0.005, zc + body / 2 - 0.01, 0.6, false);
    set.add(g, frontMat(p.str('fronts'), p.color('color'))).add(handles, mat('brushed-metal'));
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
  description: 'Tall fridge-freezer with steel doors and bar handles; back against a wall.',
  params: {
    width: num(0.7, 0.55, 0.95, 'width (m)'),
    finish: choice(['brushed-metal', 'paint', 'black-metal'], 'brushed-metal', 'door finish'),
  },
  mount: 'floor',
  againstWall: true,
  frontClearance: 1.0,
  size: (p) => [p.num('width'), 1.9, 0.68],
  build(p) {
    const set = new PartSet();
    const w = p.num('width');
    const d = 0.68;
    const face = p.str('finish') === 'paint' ? mat('paint', '#e9e6e0') : mat(p.str('finish'));
    set.add(roundedBox(w, 1.9, d - 0.04, 0.01, 1).translate(0, 0.95, -0.02), mat('paint', '#d7d4cf'));
    const doors = new Geom();
    doors.merge(roundedBox(w - 0.006, 1.2, 0.04, 0.008, 2).translate(0, 0.68 + 0.6, d / 2 - 0.02));
    doors.merge(roundedBox(w - 0.006, 0.66, 0.04, 0.008, 2).translate(0, 0.34, d / 2 - 0.02));
    set.add(doors, face);
    const bars = new Geom();
    bars.merge(roundedBox(0.02, 0.5, 0.03, 0.008, 2).translate(-w / 2 + 0.05, 1.2, d / 2 + 0.03));
    bars.merge(roundedBox(0.02, 0.35, 0.03, 0.008, 2).translate(-w / 2 + 0.05, 0.45, d / 2 + 0.03));
    set.add(bars, mat('chrome'));
    set.boxMinMax(-w / 2, 0, -d / 2, w / 2, 1.9, d / 2);
    return set.build();
  },
};

/** Kitchen definitions. */
export const KITCHEN_SET: readonly FurnitureDef[] = [KITCHEN, ISLAND, FRIDGE];
