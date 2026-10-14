/**
 * Doors and windows. A door is two entities: a static frame (`arch-frame`:
 * jamb linings + architraves) and a moving leaf (`arch-door`) that the
 * existing `door` behaviour swings around its hinge edge. Windows are one
 * static entity (`arch-window`): frame, mullions / transoms, sashes, glass,
 * an interior sill board and an exterior drip sill.
 *
 * Local frames: the leaf is centred on x = 0, z = 0 with its base at y = 0;
 * the frame and window are centred on the wall centreline (z = 0), the
 * window's local y = 0 is its sill.
 */
import { Geom, box, cylinder, roundedBox } from './mesh';
import { PartSet } from './parts';
import type { DoorParams, FrameParams, WindowParams } from './params';
import type { ArchOutput } from './types';

/** Gap between the leaf and the jamb lining on each side (metres). */
export const DOOR_CLEARANCE = 0.006;
/** Jamb lining thickness. */
export const LINING = 0.022;

/** Lever handle + rosette on both faces at `x`, centred at height `y`. */
function lever(x: number, y: number, t: number, toward: 1 | -1): Geom {
  const g = new Geom();
  for (const side of [-1, 1] as const) {
    const z = side * (t / 2);
    const rose = cylinder(0.026, 0.026, 0.01, 20).rotateX(side * 90).translate(x, y, z);
    const neck = cylinder(0.008, 0.008, 0.05, 10).rotateX(side * 90).translate(x, y, z);
    const arm = roundedBox(0.12, 0.016, 0.018, 0.006, 2).translate(x - toward * 0.055, y, z + side * 0.05);
    g.merge(rose).merge(neck).merge(arm);
  }
  return g;
}

/** Door leaf (see the module docs). */
export function buildDoor(p: DoorParams): ArchOutput {
  const set = new PartSet();
  const w = p.width;
  const h = p.height;
  const t = p.thickness;
  const leaf = new Geom();
  const glass = new Geom();
  const stile = Math.min(0.13, w * 0.16);
  const rail = 0.13;
  if (p.style === 'glass') {
    // Frame of stiles and rails around a glass panel.
    leaf.merge(roundedBox(stile, h, t, 0.003, 1).translate(-w / 2 + stile / 2, h / 2, 0));
    leaf.merge(roundedBox(stile, h, t, 0.003, 1).translate(w / 2 - stile / 2, h / 2, 0));
    leaf.merge(roundedBox(w - 2 * stile, rail, t, 0.003, 1).translate(0, h - rail / 2, 0));
    leaf.merge(roundedBox(w - 2 * stile, rail * 1.6, t, 0.003, 1).translate(0, rail * 0.8, 0));
    glass.merge(box(-w / 2 + stile, rail * 1.6, -0.004, w / 2 - stile, h - rail, 0.004));
  } else {
    leaf.merge(roundedBox(w, h, t, p.style === 'slab' ? 0.002 : 0.004, 1).translate(0, h / 2, 0));
    if (p.style === 'panel') {
      // Raised mouldings: two tall panels over one short one, on both faces.
      const mw = 0.012;
      const panels: Array<[number, number, number, number]> = [];
      const inner = w - 2 * stile;
      panels.push([-inner / 2, h * 0.47, inner / 2, h - rail]);
      panels.push([-inner / 2, rail, inner / 2, h * 0.47 - rail * 0.6]);
      for (const side of [-1, 1] as const) {
        for (const [x0, y0, x1, y1] of panels) {
          const z0 = side > 0 ? t / 2 : -t / 2 - 0.006;
          const z1 = side > 0 ? t / 2 + 0.006 : -t / 2;
          leaf.merge(box(x0, y0, z0, x1, y0 + mw, z1));
          leaf.merge(box(x0, y1 - mw, z0, x1, y1, z1));
          leaf.merge(box(x0, y0 + mw, z0, x0 + mw, y1 - mw, z1));
          leaf.merge(box(x1 - mw, y0 + mw, z0, x1, y1 - mw, z1));
        }
      }
    }
  }
  set.add(leaf, p.finish);
  if (glass.i.length > 0) set.add(glass, { finish: 'glass' });
  // Hardware: lever on the handle side, three hinges on the other.
  const hx = (p.handle === 'right' ? 1 : -1) * (w / 2 - 0.07);
  const hardware = lever(hx, 1.0, t, p.handle === 'right' ? 1 : -1);
  const hingeX = (p.handle === 'right' ? -1 : 1) * (w / 2);
  for (const y of [0.2, h / 2, h - 0.25]) hardware.merge(cylinder(0.008, 0.008, 0.1, 10).translate(hingeX, y - 0.05, 0));
  set.add(hardware, p.hardware);
  set.boxMinMax(-w / 2, 0, -t / 2, w / 2, h, t / 2);
  return set.build();
}

/** Door frame: jamb linings inside the opening and architraves on both wall faces. */
export function buildFrame(p: FrameParams): ArchOutput {
  const set = new PartSet();
  const g = new Geom();
  const W = p.width;
  const H = p.height;
  const T = p.wallThickness / 2;
  const L = LINING;
  // Linings.
  g.merge(box(-W / 2, 0, -T, -W / 2 + L, H, T));
  g.merge(box(W / 2 - L, 0, -T, W / 2, H, T));
  g.merge(box(-W / 2, H - L, -T, W / 2, H, T));
  // Architraves (slightly rounded), both faces.
  const c = p.casing;
  if (c > 0.005) {
    for (const side of [-1, 1] as const) {
      const z = side * (T + 0.009);
      g.merge(roundedBox(c, H + c, 0.018, 0.004, 1).translate(-W / 2 - c / 2 + L * 0, (H + c) / 2, z));
      g.merge(roundedBox(c, H + c, 0.018, 0.004, 1).translate(W / 2 + c / 2, (H + c) / 2, z));
      g.merge(roundedBox(W + 2 * c, c, 0.018, 0.004, 1).translate(0, H + c / 2, z));
    }
  }
  set.add(g, p.finish);
  return set.build();
}

/** Window (see the module docs). */
export function buildWindow(p: WindowParams): ArchOutput {
  const set = new PartSet();
  const W = p.width;
  const H = p.height;
  const T = p.wallThickness / 2;
  const frame = new Geom();
  const glass = new Geom();
  const fw = 0.055;
  const fd = Math.min(0.09, p.wallThickness * 0.8);
  // Outer frame.
  frame.merge(box(-W / 2, 0, -fd / 2, W / 2, fw, fd / 2));
  frame.merge(box(-W / 2, H - fw, -fd / 2, W / 2, H, fd / 2));
  frame.merge(box(-W / 2, fw, -fd / 2, -W / 2 + fw, H - fw, fd / 2));
  frame.merge(box(W / 2 - fw, fw, -fd / 2, W / 2, H - fw, fd / 2));
  // Mullions: automatic count keeps panes under ~0.9 m wide (picture windows stay open).
  const auto = p.style === 'picture' || p.style === 'fixed' ? Math.max(0, Math.ceil(W / 2.2) - 1) : Math.max(0, Math.ceil(W / 0.9) - 1);
  const mullions = p.mullions > 0 ? p.mullions : auto;
  const mw = 0.045;
  const xs: number[] = [];
  for (let k = 1; k <= mullions; k++) xs.push(-W / 2 + (W * k) / (mullions + 1));
  for (const x of xs) frame.merge(box(x - mw / 2, fw, -fd / 2 + 0.005, x + mw / 2, H - fw, fd / 2 - 0.005));
  // Transoms for grid windows (and a top light on tall casements).
  const ys: number[] = [];
  if (p.style === 'grid') for (let k = 1; k < Math.max(2, Math.round(H / 0.45)); k++) ys.push((H * k) / Math.max(2, Math.round(H / 0.45)));
  else if (p.style === 'casement' && H > 1.7) ys.push(H * 0.78);
  for (const y of ys) frame.merge(box(-W / 2 + fw, y - mw / 2, -fd / 2 + 0.005, W / 2 - fw, y + mw / 2, fd / 2 - 0.005));
  // Casement / sliding sashes: an inner frame per pane, slightly proud.
  if (p.style === 'casement' || p.style === 'sliding') {
    const edges = [-W / 2 + fw, ...xs.map((x) => x), W / 2 - fw];
    const top = ys.length > 0 ? (ys[0] as number) - mw / 2 : H - fw;
    for (let k = 0; k + 1 < edges.length; k++) {
      const x0 = (edges[k] as number) + (k > 0 ? mw / 2 : 0);
      const x1 = (edges[k + 1] as number) - (k + 2 < edges.length ? mw / 2 : 0);
      const s = 0.035;
      const z0 = p.style === 'sliding' && k % 2 === 1 ? 0.012 : -0.012;
      frame.merge(box(x0, fw, z0 - 0.02, x1, fw + s, z0 + 0.02));
      frame.merge(box(x0, top - s, z0 - 0.02, x1, top, z0 + 0.02));
      frame.merge(box(x0, fw + s, z0 - 0.02, x0 + s, top - s, z0 + 0.02));
      frame.merge(box(x1 - s, fw + s, z0 - 0.02, x1, top - s, z0 + 0.02));
    }
  }
  // Glass: one pane across the opening (thin slab, both faces).
  glass.merge(box(-W / 2 + fw, fw, -0.004, W / 2 - fw, H - fw, 0.004));
  set.add(frame, p.frame);
  set.add(glass, p.glass);
  const inside = p.interior === 'b' ? 1 : -1;
  if (p.sill) {
    const sill = roundedBox(W + 0.08, 0.025, T + 0.035, 0.004, 1).translate(0, -0.0125 + 0.002, inside * ((T + 0.035) / 2));
    set.add(sill, p.sillMaterial);
  }
  // Exterior drip sill (sloped metal strip).
  const drip = box(-W / 2 - 0.03, -0.02, 0, W / 2 + 0.03, 0.0, T + 0.05).rotateX(inside * -6).translate(0, 0, 0);
  drip.scale(1, 1, -inside);
  set.add(drip, { finish: 'brushed-metal', color: '#9da2a7' });
  // Glass blocks movement (the wall collider already covers window holes, this is for free-standing use).
  set.boxMinMax(-W / 2, 0, -0.03, W / 2, H, 0.03);
  return set.build();
}
