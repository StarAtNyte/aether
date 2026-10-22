/**
 * Rectify: draw a room surface flat and in metres from the photograph, by projecting every texel of the surface through the
 * photo's camera. What stands in front of the surface (furniture, windows, people's boxes from the description), what is too
 * oblique to read, and what falls outside the picture is marked invalid; the rest is the photograph's own pixels.
 */
import { newImage, pyramid, sampleBilinear, type FImage } from './raster';
import { planePoint, project, viewCosine, type CameraModel, type PlaneSpec } from './project';

/** [x0, y0, x1, y1] in 0..1 of the picture. */
export type Box = readonly [number, number, number, number];

/** A rectified surface. */
export interface Rectified {
  image: FImage;
  /** 1 where the texel shows the surface itself. */
  valid: Uint8Array;
  /** Texels per metre. */
  ppm: number;
  /** Share of texels that are valid. */
  coverage: number;
  /** The plane it samples. */
  plane: PlaneSpec;
}

/** Options of {@link rectify}. */
export interface RectifyOptions {
  /** Texels per metre (default 160, at most 8 M texels in all). */
  ppm?: number;
  /** Boxes of things in front of the surface (grown by `pad`); texels projecting into them are invalid. */
  occluders?: readonly Box[];
  /** Box of the picture the surface appears in; texels outside it are invalid. */
  region?: Box;
  /** How much each occluder box grows (share of the picture side, default 0.012). */
  pad?: number;
  /** Texels whose view ray is flatter than this to the surface are invalid (cosine, default 0.22). */
  minCosine?: number;
  /** Only this part of the plane, in metres: [s0, t0, s1, t1] (default all). */
  window?: readonly [number, number, number, number];
}

const inBox = (b: Box, u: number, v: number, pad: number): boolean => u >= b[0] - pad && u <= b[2] + pad && v >= b[1] - pad && v <= b[3] + pad;

/** Rectify `plane` from `photo` (linear RGB) seen by `cam`. */
export function rectify(photo: FImage, cam: CameraModel, plane: PlaneSpec, opts: RectifyOptions = {}): Rectified {
  const win = opts.window ?? [0, 0, plane.width, plane.height];
  const ww = Math.max(0.05, win[2] - win[0]);
  const wh = Math.max(0.05, win[3] - win[1]);
  const maxTexels = 8_000_000;
  const ppm = Math.max(8, Math.min(opts.ppm ?? 160, Math.sqrt(maxTexels / (ww * wh))));
  const W = Math.max(2, Math.round(ww * ppm));
  const H = Math.max(2, Math.round(wh * ppm));
  const out = newImage(W, H);
  const valid = new Uint8Array(W * H);
  const levels = pyramid(photo);
  const pad = opts.pad ?? 0.012;
  const minCos = opts.minCosine ?? 0.22;
  const px = [0, 0, 0];
  let ok = 0;
  const step = 1 / ppm;
  for (let y = 0; y < H; y++) {
    const t = win[1] + (y + 0.5) * step;
    for (let x = 0; x < W; x++) {
      const s = win[0] + (x + 0.5) * step;
      const p = planePoint(plane, s, t);
      const a = project(cam, p);
      if (!a || a.u < 0.003 || a.u > 0.997 || a.v < 0.003 || a.v > 0.997) continue;
      if (opts.region && !inBox(opts.region, a.u, a.v, 0)) continue;
      if (viewCosine(cam, plane, p) < minCos) continue;
      let blocked = false;
      if (opts.occluders) for (const b of opts.occluders) if (inBox(b, a.u, a.v, pad)) { blocked = true; break; }
      if (blocked) continue;
      // How many photo pixels one texel spans: pick the pyramid level so a texel reads about one pixel (no aliasing).
      const b = project(cam, planePoint(plane, s + step, t));
      const c = project(cam, planePoint(plane, s, t + step));
      const fx = b ? Math.hypot((b.u - a.u) * photo.width, (b.v - a.v) * photo.height) : 1;
      const fy = c ? Math.hypot((c.u - a.u) * photo.width, (c.v - a.v) * photo.height) : 1;
      const level = Math.max(0, Math.min(levels.length - 1, Math.log2(Math.max(1, Math.max(fx, fy)))));
      const l0 = Math.floor(level);
      const l1 = Math.min(levels.length - 1, l0 + 1);
      const img0 = levels[l0] as FImage;
      sampleBilinear(img0, a.u * img0.width, a.v * img0.height, px);
      const o = (y * W + x) * 3;
      if (l1 !== l0 && level - l0 > 0.01) {
        const img1 = levels[l1] as FImage;
        const q = [0, 0, 0];
        sampleBilinear(img1, a.u * img1.width, a.v * img1.height, q);
        const k = level - l0;
        out.data[o] = (px[0] as number) * (1 - k) + (q[0] as number) * k;
        out.data[o + 1] = (px[1] as number) * (1 - k) + (q[1] as number) * k;
        out.data[o + 2] = (px[2] as number) * (1 - k) + (q[2] as number) * k;
      } else {
        out.data[o] = px[0] as number;
        out.data[o + 1] = px[1] as number;
        out.data[o + 2] = px[2] as number;
      }
      valid[y * W + x] = 1;
      ok++;
    }
  }
  return { image: out, valid, ppm, coverage: ok / (W * H), plane };
}
