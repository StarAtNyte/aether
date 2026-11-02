/**
 * Distant mountain ranges: one cylinder strip per range, drawn at the horizon around the camera.
 *
 * What makes a far range read as mountains rather than a smeared band:
 *
 *  - **A real heightfield, seen from the viewer.** Each range is a ridged-multifractal heightfield (sharp crests,
 *    branching valleys, massifs and passes along it, foothills in front) a kilometre or two deep. It is drawn once on the
 *    CPU as the viewer at the centre sees it, column by column front to back, into a small mask texture, so nearer spurs
 *    overlap the summits behind them and every visible point keeps its true slope, height and depth.
 *  - **A crisp silhouette from geometry.** The strip's top edge is the drawn crest (a thousand columns), not a blurred
 *    texture edge.
 *  - **Rock and snow by height and slope.** Snow lies above a ragged snowline on the gentler ground and is shed by the
 *    steep faces; the gentle lower slopes are dark forest and pasture. The snow field is stored as a distance-like value
 *    and thresholded in the shader, so its edges stay sharp however much the texture is magnified.
 *  - **Lighting and aerial perspective in the shader** from a handful of shared uniforms (sun direction and colour,
 *    skylight, rock, forest and snow colours, the air and the horizon haze): faces toward the sun take its colour, the
 *    others stay in cool skylight, and each range melts into the haze by its own share, more with depth and toward its
 *    foot. A change of hour or sky only sets uniforms; nothing is repainted.
 *
 * Cost: one draw call for all the ranges, about two thousand triangles per range, one 2048-wide RGBA8 mask texture for all of them
 * (painted once, about 0.1 s per range), no per-frame CPU work. Pure TSL nodes on a classic material (identical on the
 * WebGPU and WebGL2 backends).
 */
import {
  BufferAttribute,
  BufferGeometry,
  ClampToEdgeWrapping,
  Color,
  DataTexture,
  DoubleSide,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  type MeshStandardMaterial,
  NoColorSpace,
  RepeatWrapping,
  RGBAFormat,
  Vector3,
} from 'three';
import { T, type Nd } from '../materials/tsl-lite';

/** One range of the backdrop. */
export interface RangeSpec {
  seed: number;
  /** Distance of the range's front from the camera (m); the strip it is drawn on stands there. */
  distance: number;
  /** Depth of the range behind its front (m). */
  depth: number;
  /** Height of the tallest summit (m). */
  height: number;
  /** Size of the main ridges and valleys (m). */
  feature: number;
  /** Snowline as a share of {@link height} (0..1); higher than 1 = no snow. */
  snowline: number;
  /** Share of the horizon haze over the front of the range (aerial perspective: farther ranges take more). */
  haze: number;
  /** Render order (farther ranges first). */
  order: number;
  name: string;
}

/** Mask texture size: columns around the circle, rows up the strip. */
export const RANGE_TEX_W = 2048;
export const RANGE_TEX_H = 224;
/** Depth samples of the heightfield behind each column. */
export const RANGE_DEPTH_SAMPLES = 96;
/** Texture columns per strip column (the strip's crest is their highest point). */
const COLUMN_STEP = 2;
/** Depth of the strip's foot below the ground (m): hidden by the land in front. */
const FOOT = -30;

const TAU = Math.PI * 2;

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function hash3(seed: number, x: number, y: number, z: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1440662683) ^ Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Trilinear value noise in 0..1. */
function noise3(seed: number, x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  let fx = x - xi;
  let fy = y - yi;
  let fz = z - zi;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  fz = fz * fz * (3 - 2 * fz);
  const a = hash3(seed, xi, yi, zi) + (hash3(seed, xi + 1, yi, zi) - hash3(seed, xi, yi, zi)) * fx;
  const b = hash3(seed, xi, yi + 1, zi) + (hash3(seed, xi + 1, yi + 1, zi) - hash3(seed, xi, yi + 1, zi)) * fx;
  const c = hash3(seed, xi, yi, zi + 1) + (hash3(seed, xi + 1, yi, zi + 1) - hash3(seed, xi, yi, zi + 1)) * fx;
  const d = hash3(seed, xi, yi + 1, zi + 1) + (hash3(seed, xi + 1, yi + 1, zi + 1) - hash3(seed, xi, yi + 1, zi + 1)) * fx;
  const ab = a + (b - a) * fy;
  const cd = c + (d - c) * fy;
  return ab + (cd - ab) * fz;
}

/**
 * Ridged multifractal (sharp crests, branching valleys; rough high up, smoother in the valleys), about 0..1. The plane
 * of the ring is (x, y) and z is depth, so the field closes on itself around the circle.
 */
function ridged(seed: number, x: number, y: number, z: number): number {
  let sum = 0;
  let amp = 1;
  let weight = 1;
  let f = 1;
  for (let o = 0; o < 5; o++) {
    const n = noise3(seed + o * 101, x * f, y * f, z * f);
    let r = 1 - Math.abs(2 * n - 1);
    r = r * r * weight;
    weight = Math.min(1, r * 1.8);
    sum += r * amp;
    amp *= 0.48;
    f *= 2.07;
  }
  return sum / 1.55;
}

/** A range's heightfield behind its front and what a viewer at its centre sees of it. */
export interface RangeImage {
  /** RGBA8 mask: r = snow field (0.5 at the snow edge), g = tangent normal, b = up normal, a = depth share. */
  mask: Uint8Array;
  /** Highest point of the strip (m, at the strip's distance). */
  top: number;
  /** Crest of each strip column (m), {@link RANGE_TEX_W} / 2 + 1 values closing the ring. */
  crest: Float32Array;
}

/**
 * Model the range as a real heightfield (ridged peaks rising toward its back, massifs and passes along it) and draw it
 * as the viewer at the centre sees it, column by column front to back (each sample covers the rows above what nearer
 * ground already hides). Nearer spurs overlap the summits behind them, every visible point keeps its true slope and
 * height for the snow, and its depth for the haze.
 */
export function paintRange(spec: Pick<RangeSpec, 'seed' | 'distance' | 'depth' | 'height' | 'feature' | 'snowline'>, W = RANGE_TEX_W, H = RANGE_TEX_H, D = RANGE_DEPTH_SAMPLES): RangeImage {
  const { seed, distance: d0, depth: span, feature } = spec;
  const heights = new Float32Array(W * D);
  const ringR = d0 / feature;
  let peak = 0;
  for (let c = 0; c < W; c++) {
    const a = (c / W) * TAU;
    const cx = Math.cos(a);
    const cy = Math.sin(a);
    // Massifs and passes along the range.
    const massif = 0.45 + 0.55 * smooth(0.2, 0.8, noise3(seed + 7, cx * ringR * 0.22, cy * ringR * 0.22, 3.1));
    for (let k = 0; k < D; k++) {
      const t = k / (D - 1);
      const z = t * span;
      // Foothills in front, the high chain in the middle, falling away a little at the back.
      const envelope = (0.18 + 0.82 * smooth(0, 0.55, t)) * (1 - 0.3 * smooth(0.8, 1, t));
      const r = ridged(seed, cx * ringR, cy * ringR, z / feature);
      const h = Math.pow(Math.max(0, r), 1.25) * envelope * massif;
      heights[c * D + k] = h;
      if (h > peak) peak = h;
    }
  }
  const scale = spec.height / Math.max(1e-6, peak);
  for (let i = 0; i < heights.length; i++) heights[i] = (heights[i] as number) * scale;

  const dx = (TAU * d0) / W;
  const dz = span / (D - 1);
  // Projected height on the strip of each sample, and the top of the strip.
  const proj = new Float32Array(W * D);
  let top = 1;
  for (let c = 0; c < W; c++) {
    for (let k = 0; k < D; k++) {
      const y = (heights[c * D + k] as number) * (d0 / (d0 + k * dz));
      proj[c * D + k] = y;
      if (y > top) top = y;
    }
  }
  const mask = new Uint8Array(W * H * 4);
  const columnTop = new Float32Array(W);
  const snowNoiseF = ringR * 6;
  for (let c = 0; c < W; c++) {
    const cl = (c + W - 1) % W;
    const cr = (c + 1) % W;
    const a = (c / W) * TAU;
    const cx = Math.cos(a);
    const cy = Math.sin(a);
    let row = 0;
    let highest = -1;
    for (let k = 0; k < D && row < H; k++) {
      const y = proj[c * D + k] as number;
      if (y <= highest) continue;
      highest = y;
      const last = Math.min(H - 1, Math.floor((y / top) * (H - 1)));
      if (last < row) continue;
      const h = heights[c * D + k] as number;
      const hx = ((heights[cr * D + k] as number) - (heights[cl * D + k] as number)) / (2 * dx);
      const kb = Math.max(0, k - 1);
      const kf = Math.min(D - 1, k + 1);
      const hz = ((heights[c * D + kf] as number) - (heights[c * D + kb] as number)) / ((kf - kb) * dz);
      const len = Math.hypot(hx, 1, hz);
      const nx = -hx / len;
      const ny = 1 / len;
      const t = k / (D - 1);
      // Snow: above a ragged line, held on the gentler ground, shed by the steep faces.
      const ragged = (noise3(seed + 31, cx * snowNoiseF, cy * snowNoiseF, (t * span) / feature * 6) - 0.5) * 2;
      const field = (h / spec.height - spec.snowline) / 0.07 + (ny - 0.72) * 9 + ragged * 1.1;
      const snow = Math.max(0, Math.min(1, 0.5 + field * 0.1));
      const r = Math.round(snow * 255);
      const g = Math.round((nx * 0.5 + 0.5) * 255);
      const b = Math.round(ny * 255);
      const dd = Math.round(t * 255);
      for (; row <= last; row++) {
        const o = (row * W + c) * 4;
        mask[o] = r;
        mask[o + 1] = g;
        mask[o + 2] = b;
        mask[o + 3] = dd;
      }
    }
    columnTop[c] = Math.max(0, highest);
    // Rows above the crest (cut away by the strip's top edge) repeat the crest's sample, so filtering stays clean.
    const from = Math.max(0, row - 1);
    for (; row < H; row++) mask.copyWithin((row * W + c) * 4, (from * W + c) * 4, (from * W + c) * 4 + 4);
  }
  const columns = W / COLUMN_STEP;
  const crest = new Float32Array(columns + 1);
  for (let i = 0; i < columns; i++) {
    let m = 0;
    for (let j = -1; j <= COLUMN_STEP; j++) m = Math.max(m, columnTop[(i * COLUMN_STEP + j + W) % W] as number);
    crest[i] = m;
  }
  crest[columns] = crest[0] as number;
  return { mask, top, crest };
}

/** Strip geometry: a foot row under the ground and a crest row; uv = (angle share, height share of the strip's top). */
export function rangeGeometry(image: Pick<RangeImage, 'crest' | 'top'>, distance: number): BufferGeometry {
  const columns = image.crest.length - 1;
  const position = new Float32Array((columns + 1) * 2 * 3);
  const uv = new Float32Array((columns + 1) * 2 * 2);
  const index: number[] = [];
  for (let c = 0; c <= columns; c++) {
    const a = (c / columns) * TAU;
    const y = image.crest[c] as number;
    const x = Math.cos(a) * distance;
    const z = Math.sin(a) * distance;
    position.set([x, FOOT, z, x, y, z], c * 6);
    uv.set([c / columns, FOOT / image.top, c / columns, y / image.top], c * 4);
    if (c < columns) {
      const k = c * 2;
      index.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(position, 3));
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.setIndex(index);
  return g;
}

/** The colours and light a range is drawn with; shared by every range of a rig and set on a change of sky. */
export class RangeLook {
  readonly sunDirection = new Vector3(0, 1, 0);
  readonly sun = new Color('#ffffff');
  readonly sky = new Color('#8aa4c0');
  readonly rockLight = new Color('#7a746c');
  readonly rockDark = new Color('#3c3d43');
  readonly snow = new Color('#f2f5fa');
  readonly forest = new Color('#2f3d2c');
  readonly haze = new Color('#c8d4e0');
  /** Blue of the air between the viewer and a range (toward which nearer ranges lean before the horizon colour). */
  readonly air = new Color('#9fb3cc');
  readonly brightness = { value: 1 };
  readonly nodes = {
    sunDirection: T.uniform(this.sunDirection),
    sun: T.uniform(this.sun),
    sky: T.uniform(this.sky),
    rockLight: T.uniform(this.rockLight),
    rockDark: T.uniform(this.rockDark),
    snow: T.uniform(this.snow),
    forest: T.uniform(this.forest),
    haze: T.uniform(this.haze),
    air: T.uniform(this.air),
    brightness: T.uniform(1),
  };

  setBrightness(v: number): void {
    (this.nodes.brightness as unknown as { value: number }).value = v;
  }
}

/**
 * The ranges of a backdrop as one mesh: a strip per range, all reading one mask texture (the ranges' masks stacked in
 * the order given). What differs between ranges (their band of the texture, their share of haze) rides on a vertex
 * attribute, so one material and one draw call serve them all; the depth test sorts the nearer ranges in front.
 */
export function buildRanges(specs: readonly RangeSpec[], look: RangeLook): Mesh | null {
  if (specs.length === 0) return null;
  const images = specs.map((s) => paintRange(s));
  const rows = RANGE_TEX_H * specs.length;
  const data = new Uint8Array(RANGE_TEX_W * rows * 4);
  images.forEach((img, i) => data.set(img.mask, i * RANGE_TEX_W * RANGE_TEX_H * 4));
  const atlas = new DataTexture(data, RANGE_TEX_W, rows, RGBAFormat);
  atlas.wrapS = RepeatWrapping;
  atlas.wrapT = ClampToEdgeWrapping;
  atlas.magFilter = LinearFilter;
  atlas.minFilter = LinearFilter;
  atlas.generateMipmaps = false;
  atlas.colorSpace = NoColorSpace;
  atlas.flipY = false;
  atlas.needsUpdate = true;
  const strips = specs.map((spec, i) => rangeGeometry(images[i] as RangeImage, spec.distance));
  let verts = 0;
  for (const g of strips) verts += g.getAttribute('position').count;
  const position = new Float32Array(verts * 3);
  const uv = new Float32Array(verts * 2);
  const info = new Float32Array(verts * 2);
  const index: number[] = [];
  let o = 0;
  strips.forEach((g, i) => {
    const n = g.getAttribute('position').count;
    position.set(g.getAttribute('position').array as Float32Array, o * 3);
    uv.set(g.getAttribute('uv').array as Float32Array, o * 2);
    for (let k = 0; k < n; k++) info.set([i, (specs[i] as RangeSpec).haze], (o + k) * 2);
    for (const k of Array.from(g.index!.array as ArrayLike<number>)) index.push(k + o);
    o += n;
    g.dispose();
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  geometry.setAttribute('uv', new BufferAttribute(uv, 2));
  geometry.setAttribute('rangeInfo', new BufferAttribute(info, 2));
  geometry.setIndex(index);
  const material = new MeshBasicMaterial({ side: DoubleSide, depthWrite: true, fog: false });
  (material as unknown as { colorNode: Nd }).colorNode = rangeColour(atlas, specs.length, look);
  const mesh = new Mesh(geometry, material);
  mesh.name = 'aether:mountains';
  mesh.frustumCulled = false;
  // Behind everything the scene draws, after the sky dome.
  mesh.renderOrder = Math.min(...specs.map((s) => s.order));
  mesh.userData['atlas'] = atlas;
  return mesh;
}

/** Dispose the mesh built by {@link buildRanges}. */
export function disposeRanges(mesh: Mesh): void {
  mesh.removeFromParent();
  mesh.geometry.dispose();
  (mesh.material as MeshBasicMaterial).dispose();
  (mesh.userData['atlas'] as DataTexture | undefined)?.dispose();
}

function rangeColour(atlas: DataTexture, slots: number, look: RangeLook): Nd {
  const { vec2, vec3, mix, smoothstep, saturate, normalize, dot, max, float, sqrt } = T;
  const n = look.nodes;
  const uv = T.uv();
  const v = saturate(uv.y);
  const info = T.attribute('rangeInfo', 'vec2');
  const hazeShare = info.y;
  // This range's band of the atlas, half a texel in from its edges so the neighbouring band never bleeds in.
  const rows = RANGE_TEX_H * slots;
  const row = v.mul(RANGE_TEX_H - 1).add(info.x.mul(RANGE_TEX_H)).add(0.5).div(rows);
  const m = T.texture(atlas, vec2(uv.x, row));
  // The surface normal of the heightfield: along the ring (painted), up (painted), and toward the viewer (the rest).
  const p = T.positionLocal;
  const inward = normalize(vec3(p.x.negate(), float(0), p.z.negate()));
  const tangent = normalize(vec3(p.z.negate(), float(0), p.x));
  const lateral = m.g.mul(2).sub(1);
  const up = m.b;
  const toward = sqrt(max(float(1).sub(lateral.mul(lateral)).sub(up.mul(up)), 0));
  const normal = normalize(inward.mul(toward).add(tangent.mul(lateral)).add(vec3(0, 1, 0).mul(up)));
  const diffuse = saturate(dot(normal, n.sunDirection));
  // Sharp snow edge from the distance-like snow field.
  const snow = smoothstep(0.46, 0.54, m.r);
  // Rock above, dark forest and pasture on the gentler lower slopes.
  const green = smoothstep(0.62, 0.85, up).mul(float(1).sub(smoothstep(0.18, 0.45, v)));
  const rock = mix(n.rockDark, n.rockLight, smoothstep(0.3, 0.9, up));
  const ground = mix(rock, n.forest, green);
  const albedo = mix(ground, n.snow, snow);
  // Skylight fills every face (more on the upward ones); the sun lights the faces turned toward it.
  const sky = n.sky.mul(mix(float(0.5), float(0.95), up));
  const lit = albedo.mul(sky.add(n.sun.mul(diffuse)));
  // Aerial perspective: more air behind the front of the range and low down; blue air first, then the horizon colour.
  const depth = m.a;
  const foot = float(1).sub(smoothstep(0.0, 0.5, v));
  const thickness = saturate(hazeShare.add(depth.mul(0.22)).add(foot.mul(0.2)));
  const air = mix(n.air, n.haze, saturate(thickness.mul(1.3).sub(0.15)));
  const colour = mix(lit, air, thickness);
  return max(colour, vec3(0, 0, 0)).mul(n.brightness);
}

/** Share of the air's colour over land `metres` from the viewer: the same air the ranges' feet stand in. */
export const LAND_AIR_DISTANCE = 1800;
export const LAND_AIR_MAX = 0.55;

/**
 * Aerial perspective for lit land around the plot, in place of the scene fog: the land then fades into the same air as
 * the mountains behind it (a dense world fog turned the far land into a white band under clear mountains).
 */
export function applyLandAir(material: MeshStandardMaterial, look: RangeLook): void {
  const { vec4, mix, saturate, exp, float, distance } = T;
  const out = (T as unknown as { output: Nd }).output;
  const n = look.nodes;
  const d = distance(T.positionWorld, T.cameraPosition);
  const h = saturate(float(1).sub(exp(d.div(-LAND_AIR_DISTANCE)))).mul(LAND_AIR_MAX);
  const air = mix(n.air, n.haze, 0.5).mul(n.brightness);
  material.fog = false;
  (material as unknown as { outputNode: Nd }).outputNode = vec4(mix(out.rgb, air, h), out.a);
}

