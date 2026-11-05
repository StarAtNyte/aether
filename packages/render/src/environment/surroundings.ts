/**
 * Exterior context of a world: what stands beyond the plot. Rooms built from a photograph or a plan stand on a lawn that
 * ends at a bright horizon line; this adds, from data (`environment.surroundings`), the things a window shows:
 *
 *   - a belt of distant hills (two silhouette layers that fade into the haze of the horizon, following the camera so they
 *     stay at infinity),
 *   - a tree line and groves (a few hundred instanced trees in one or two draw calls, merged low-poly geometry with baked
 *     vertex colours, no shadows cast: about 15 to 30 thousand triangles),
 *   - a patchwork of fields beyond the plot (one vertex-coloured ring that fades into the ground at its inner edge).
 *
 * Everything is classic three.js materials (identical on WebGPU and WebGL2), costs three to five draw calls, never
 * enters the physics world, the light volume or the lightmap trace, and is rebuilt only when the data or the sky changes.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type Camera,
} from 'three';
import { rng, type Environment } from '@aether/core';
import type { SkyState } from './sky-state';
import { applyLandAir, buildRanges, disposeRanges, RangeLook, type RangeSpec } from './mountain-range';

export type Surroundings = NonNullable<Environment['surroundings']>;
export type SurroundingsPreset = NonNullable<Surroundings['preset']>;

/** What a preset means before the world's own fields override it. */
export interface ResolvedSurroundings {
  /** Ridge height of the nearer hill layer (m); 0 = none. */
  hills: number;
  /** Distance of the nearer hill layer from the camera (m). */
  hillDistance: number;
  /** Tree-belt density 0..1 (0 = none). */
  trees: number;
  species: 'broadleaf' | 'conifer' | 'mixed';
  /** Patchwork of fields beyond the plot. */
  fields: boolean;
  /** Radius (m) around the origin kept free of trees. */
  clearRadius: number;
  /** Peak height (m) of the far mountain range; 0 = none. */
  mountains: number;
  /** Distance of the mountain range (m). */
  mountainDistance: number;
  seed: number;
}

export const SURROUNDING_PRESETS: Readonly<Record<Exclude<SurroundingsPreset, 'none'>, Omit<ResolvedSurroundings, 'seed'>>> = Object.freeze({
  meadow: { hills: 22, hillDistance: 700, trees: 0.25, species: 'broadleaf', fields: false, clearRadius: 70, mountains: 0, mountainDistance: 1700 },
  countryside: { hills: 45, hillDistance: 650, trees: 0.55, species: 'mixed', fields: true, clearRadius: 55, mountains: 0, mountainDistance: 1700 },
  woodland: { hills: 30, hillDistance: 600, trees: 1, species: 'conifer', fields: false, clearRadius: 45, mountains: 0, mountainDistance: 1700 },
  suburb: { hills: 14, hillDistance: 800, trees: 0.7, species: 'broadleaf', fields: false, clearRadius: 38, mountains: 0, mountainDistance: 1700 },
  alpine: { hills: 60, hillDistance: 650, trees: 0.6, species: 'conifer', fields: false, clearRadius: 60, mountains: 650, mountainDistance: 1700 },
});

/** The preset's values with the world's own fields on top; null when nothing is asked for. */
export function resolveSurroundings(s: Surroundings | undefined): ResolvedSurroundings | null {
  if (!s) return null;
  const preset = s.preset ?? 'countryside';
  if (preset === 'none') return null;
  const base = SURROUNDING_PRESETS[preset];
  return {
    hills: s.hills ?? base.hills,
    hillDistance: s.hillDistance ?? base.hillDistance,
    trees: s.trees ?? base.trees,
    species: s.species ?? base.species,
    fields: s.fields ?? base.fields,
    clearRadius: s.clearRadius ?? base.clearRadius,
    mountains: s.mountains ?? base.mountains,
    mountainDistance: s.mountainDistance ?? base.mountainDistance,
    seed: s.seed ?? 1,
  };
}

/** Trees at full density (0 to 1 scales this). */
export const MAX_TREES = 420;
const HILL_SEGMENTS = 192;
const FIELD_SEGMENTS = 144;
const FIELD_RINGS = 7;
const FIELD_INNER = 80;
const FIELD_OUTER = 1300;

const _c = new Color();
const _a = new Color();
const _b = new Color();
const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _up = new Vector3(0, 1, 0);

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Deterministic value noise in 0..1 on a 2D lattice. */
function lattice(seed: number, x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function valueNoise(seed: number, x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = lattice(seed, xi, yi);
  const b = lattice(seed, xi + 1, yi);
  const c = lattice(seed, xi, yi + 1);
  const d = lattice(seed, xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Ridge profile in 0..1 around the circle: broad swells with smaller knolls on them, periodic so the ring closes. */
export function ridge(seed: number, angle: number): number {
  const t = angle / (Math.PI * 2);
  let sum = 0;
  let amp = 0.55;
  let norm = 0;
  for (let o = 0; o < 4; o++) {
    const f = 2 << o;
    // Periodic noise: sample a circle in the lattice plane so the seam disappears.
    const r = f * 0.35;
    sum += amp * valueNoise(seed + o * 17, Math.cos(t * Math.PI * 2) * r + 40, Math.sin(t * Math.PI * 2) * r + 40);
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

/** Brightness of the unlit scenery for the sun's elevation (they have no lights of their own to dim at dusk). */
export function daylightFactor(elevationDeg: number): number {
  return 0.07 + 0.93 * smooth(-10, 14, Number.isFinite(elevationDeg) ? elevationDeg : 30);
}

interface TreeKind {
  geometry: BufferGeometry;
  share: number;
}

function paint(g: BufferGeometry, color: string, jitter = 0): BufferGeometry {
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  _c.set(color);
  for (let i = 0; i < n; i++) {
    const j = 1 + (jitter === 0 ? 0 : (lattice(7, i, n) - 0.5) * jitter);
    col[i * 3] = _c.r * j;
    col[i * 3 + 1] = _c.g * j;
    col[i * 3 + 2] = _c.b * j;
  }
  g.setAttribute('color', new BufferAttribute(col, 3));
  return g;
}

function merge(parts: BufferGeometry[]): BufferGeometry {
  const flat = parts.map((p) => (p.index ? p.toNonIndexed() : p));
  let n = 0;
  for (const p of flat) n += p.getAttribute('position').count;
  const position = new Float32Array(n * 3);
  const normal = new Float32Array(n * 3);
  const color = new Float32Array(n * 3);
  let o = 0;
  for (const p of flat) {
    position.set(p.getAttribute('position').array as Float32Array, o * 3);
    normal.set(p.getAttribute('normal').array as Float32Array, o * 3);
    color.set(p.getAttribute('color').array as Float32Array, o * 3);
    o += p.getAttribute('position').count;
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(position, 3));
  g.setAttribute('normal', new BufferAttribute(normal, 3));
  g.setAttribute('color', new BufferAttribute(color, 3));
  for (const p of parts) p.dispose();
  for (const p of flat) p.dispose();
  return g;
}

/** A broadleaf tree one metre of crown radius wide and about 5.5 m tall at scale 1: trunk and three lumpy crown blobs. */
export function broadleafGeometry(): BufferGeometry {
  const trunk = paint(new CylinderGeometry(0.16, 0.26, 2.6, 5).translate(0, 1.3, 0), '#4d3a2a');
  const crown = (r: number, x: number, y: number, z: number, tone: string): BufferGeometry => paint(new IcosahedronGeometry(r, 1).scale(1, 0.85, 1).translate(x, y, z), tone, 0.18);
  return merge([trunk, crown(1.55, 0, 3.7, 0, '#2f4a28'), crown(1.1, 0.9, 3.0, 0.3, '#3a5a2e'), crown(1.0, -0.8, 4.5, -0.3, '#294225')]);
}

/** A conifer about 7 m tall at scale 1: trunk and three stacked cones. */
export function coniferGeometry(): BufferGeometry {
  const trunk = paint(new CylinderGeometry(0.14, 0.22, 1.4, 5).translate(0, 0.7, 0), '#46362a');
  const cone = (r: number, h: number, y: number, tone: string): BufferGeometry => paint(new ConeGeometry(r, h, 6).translate(0, y + h / 2, 0), tone, 0.14);
  return merge([trunk, cone(1.7, 2.6, 1.2, '#223a2a'), cone(1.3, 2.4, 2.9, '#27432e'), cone(0.85, 2.1, 4.6, '#2c4a33')]);
}

/** Where the trees stand: positions (x, z), scales and yaw, in belts and groves around a clear plot. Deterministic. */
export function planTrees(s: ResolvedSurroundings): Array<{ x: number; z: number; scale: number; yaw: number; conifer: boolean; tone: number }> {
  const out: Array<{ x: number; z: number; scale: number; yaw: number; conifer: boolean; tone: number }> = [];
  if (s.trees <= 0) return out;
  const random = rng(s.seed * 7919 + 13);
  const target = Math.round(MAX_TREES * Math.max(0, Math.min(1, s.trees)));
  const inner = Math.max(10, s.clearRadius);
  const outer = inner + 120 + 160 * s.trees;
  let guard = 0;
  while (out.length < target && guard++ < target * 40) {
    const angle = random() * Math.PI * 2;
    // More trees near the plot's edge, thinning outward; a noise field makes groves and gaps rather than an even scatter.
    const r = inner + Math.pow(random(), 1.6) * (outer - inner);
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    const grove = valueNoise(s.seed, x / 38, z / 38);
    if (grove < 0.5 - s.trees * 0.18) continue;
    const species = s.species === 'mixed' ? lattice(s.seed + 3, Math.floor(x / 45), Math.floor(z / 45)) > 0.55 : s.species === 'conifer';
    // Trees keep about 3 m apart: the cheap rejection against the last few placed is enough for a distant belt.
    let near = false;
    for (let i = out.length - 1; i >= Math.max(0, out.length - 24); i--) {
      const o = out[i] as { x: number; z: number };
      if ((o.x - x) ** 2 + (o.z - z) ** 2 < 9) {
        near = true;
        break;
      }
    }
    if (near) continue;
    out.push({ x, z, scale: (species ? 1.2 : 1.35) * (0.7 + random() * 0.8) * (1 + Math.min(0.5, (r - inner) / 400)), yaw: random() * Math.PI * 2, conifer: species, tone: 0.85 + random() * 0.3 });
  }
  return out;
}

/** The exterior of one world. Add {@link group} to the scene; call {@link apply} on every environment change. */
export class SurroundingsRig {
  readonly group = new Group();
  private readonly hills = new Group();
  private ranges: Mesh | null = null;
  private readonly look = new RangeLook();
  private land: Mesh | null = null;
  private groundSize: number | null = null;
  private groundColor: string | null = null;
  private farHills: Mesh | null = null;
  private nearHills: Mesh | null = null;
  private fields: Mesh | null = null;
  private trees: InstancedMesh[] = [];
  private kinds: TreeKind[] = [];
  private key = '';
  private lookKey = '';
  private resolved: ResolvedSurroundings | null = null;
  private brightness = 1;

  constructor() {
    this.group.name = 'aether:surroundings';
    this.hills.name = 'aether:hills';
    this.group.add(this.hills);
    this.group.visible = false;
  }

  /** Any of it is on screen. */
  get active(): boolean {
    return this.resolved !== null;
  }

  /** Draw calls the rig adds (mountain ranges 0 or 1, hills 1 or 2, fields or land 1, trees 1 or 2). */
  get drawCalls(): number {
    return this.resolved === null ? 0 : (this.ranges ? 1 : 0) + (this.farHills ? 1 : 0) + (this.nearHills ? 1 : 0) + (this.fields ? 1 : 0) + (this.land ? 1 : 0) + this.trees.length;
  }

  /** Triangles of the instanced trees (all instances). */
  get treeTriangles(): number {
    let n = 0;
    for (const t of this.trees) n += (t.geometry.getAttribute('position').count / 3) * t.count;
    return n;
  }

  /**
   * Build (or rebuild) from the environment and the sky: geometry only when the data changes, colours when the sky does.
   * `fogColor` is the horizon haze the far layers melt into. `ground` is the world's built-in ground (null for a world
   * with its own terrain): when there is one and no field patchwork, rolling land continues it to the hills.
   */
  apply(data: Surroundings | undefined, sky: SkyState, fogColor: string | undefined, ground?: { size: number; color?: string } | null): void {
    const r = resolveSurroundings(data);
    const groundSize = ground && Number.isFinite(ground.size) ? ground.size : null;
    this.groundColor = ground?.color ?? null;
    const key = JSON.stringify([r, groundSize, this.groundColor]);
    if (key !== this.key) {
      this.key = key;
      this.resolved = r;
      this.groundSize = groundSize;
      this.rebuild();
    }
    this.group.visible = r !== null && sky.preset !== 'space';
    if (!r) return;
    // Colours depend on the hour, the horizon and the fog: cheap enough (a few hundred vertices) to redo each time.
    const lookKey = `${sky.horizon}|${fogColor ?? ''}|${Math.round(sky.elevation)}|${sky.lightColor}`;
    if (lookKey === this.lookKey) return;
    this.lookKey = lookKey;
    this.recolor(sky, fogColor);
  }

  /** Multiply the brightness of everything the rig draws (see `EnvironmentRig.setExteriorScale`). */
  setBrightness(scale: number): void {
    this.brightness = scale;
    for (const m of [this.farHills, this.nearHills, this.fields, this.land]) (m?.material as MeshBasicMaterial | undefined)?.color.setScalar(scale);
    this.look.setBrightness(scale);
    for (const t of this.trees) (t.material as MeshStandardMaterial).color.setScalar(scale);
  }

  /** The hills stay at infinity: they follow the camera in the ground plane. */
  update(camera: Camera): void {
    // Field writes: doubles passed to a Vector3.set that V8 does not inline are boxed every frame.
    const p = this.hills.position;
    p.x = camera.position.x;
    p.y = 0;
    p.z = camera.position.z;
  }

  private clear(): void {
    for (const m of [this.farHills, this.nearHills, this.fields, this.land]) {
      if (!m) continue;
      m.removeFromParent();
      m.geometry.dispose();
      (m.material as MeshBasicMaterial).dispose();
    }
    if (this.ranges) disposeRanges(this.ranges);
    this.ranges = null;
    this.land = null;
    this.farHills = null;
    this.nearHills = null;
    this.fields = null;
    for (const t of this.trees) {
      t.removeFromParent();
      t.dispose();
      (t.material as MeshStandardMaterial).dispose();
    }
    this.trees = [];
    for (const k of this.kinds) k.geometry.dispose();
    this.kinds = [];
    this.lookKey = '';
  }

  private rebuild(): void {
    this.clear();
    const r = this.resolved;
    if (!r) return;
    if (r.mountains > 0) {
      this.ranges = buildRanges(planRanges(r), this.look);
      if (this.ranges) this.hills.add(this.ranges);
    }
    if (r.hills > 0) {
      // In front of mountains the land itself rises into foothills (a flat hill band there read as a smear across the
      // mountains' feet).
      if (r.mountains <= 0 || this.groundSize === null) {
        if (r.mountains <= 0) {
          this.farHills = hillRing(r.seed + 101, r.hillDistance * 1.55, r.hills * 1.5, 0);
          this.hills.add(this.farHills);
        }
        this.nearHills = hillRing(r.seed, r.hillDistance, r.hills, 1);
        this.hills.add(this.nearHills);
      }
    }
    if (r.fields) {
      this.fields = fieldRing(r.seed + 55);
      this.group.add(this.fields);
    }
    const land = this.groundSize !== null && !r.fields ? planLand(r, this.groundSize) : null;
    if (land) {
      this.land = landRing(land);
      applyLandAir(this.land.material as MeshStandardMaterial, this.look);
      this.group.add(this.land);
    }
    this.setBrightness(this.brightness);
    const plan = planTrees(r);
    if (plan.length > 0) {
      const makers: Array<{ conifer: boolean; geometry: () => BufferGeometry }> = [
        { conifer: false, geometry: broadleafGeometry },
        { conifer: true, geometry: coniferGeometry },
      ];
      for (const kind of makers) {
        const list = plan.filter((p) => p.conifer === kind.conifer);
        if (list.length === 0) continue;
        const geometry = kind.geometry();
        this.kinds.push({ geometry, share: list.length });
        const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
        const mesh = new InstancedMesh(geometry, material, list.length);
        mesh.name = kind.conifer ? 'aether:trees-conifer' : 'aether:trees-broadleaf';
        // The tree transforms are built once. The default static usage avoids
        // three's unconditional DynamicDrawUsage upload on every render pass.
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.frustumCulled = false;
        list.forEach((t, i) => {
          _q.setFromAxisAngle(_up, t.yaw);
          _p.set(t.x, land ? landHeight(land, t.x, t.z) : 0, t.z);
          _s.set(t.scale, t.scale * (0.9 + (t.tone - 0.85) * 0.5), t.scale);
          _m.compose(_p, _q, _s);
          mesh.setMatrixAt(i, _m);
          mesh.setColorAt(i, _c.setRGB(t.tone, t.tone * (0.96 + (t.scale % 0.1)), t.tone * 0.94));
        });
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        material.color.setScalar(this.brightness);
        this.trees.push(mesh);
        this.group.add(mesh);
      }
    }
  }

  private recolor(sky: SkyState, fogColor: string | undefined): void {
    const light = daylightFactor(sky.elevation);
    const haze = _a.set(fogColor ?? sky.fogColor).lerp(_b.set(sky.horizon), fogColor ? 0.15 : 0.5);
    // Far layer: mostly the haze, a touch of blue-green; near layer: green-brown in shadow, lifted toward the haze at its foot.
    const far = new Color().set('#6a8294').lerp(haze, 0.3).multiplyScalar(0.8 + 0.2 * light);
    const near = new Color().set('#3b5841').lerp(haze, 0.12).multiplyScalar(0.3 + 0.7 * light);
    const foot = haze.clone();
    this.lightRanges(sky, haze, light);
    if (this.land) paintLand(this.land, this.groundColor);
    this.paintHills(this.farHills, far, foot, light, 0.1);
    this.paintHills(this.nearHills, near, foot, light, 0.28);
    if (this.fields) this.paintFields(sky, light, haze);
    // The trees are lit by the scene's lights, so only their instance colours stay as built.
  }

  private paintHills(mesh: Mesh | null, top: Color, foot: Color, light: number, footMix: number): void {
    if (!mesh) return;
    const col = mesh.geometry.getAttribute('color') as BufferAttribute;
    const pos = mesh.geometry.getAttribute('position');
    const h = (mesh.geometry.userData['height'] as number) || 1;
    for (let i = 0; i < col.count; i++) {
      const t = Math.max(0, Math.min(1, pos.getY(i) / h));
      // Darker toward the crest in the lit hills (sunlit slope against the sky), haze at the foot.
      _c.copy(foot).lerp(top, smooth(0, 0.6, t) * (1 - footMix) + footMix * 0.5);
      const n = lattice(5, i % (HILL_SEGMENTS + 1), 3);
      _c.multiplyScalar(0.94 + 0.12 * n * (0.4 + 0.6 * light));
      col.setXYZ(i, _c.r, _c.g, _c.b);
    }
    col.needsUpdate = true;
  }

  /** Sun, skylight and haze of the mountain ranges (and the air over the land): uniforms only. */
  private lightRanges(sky: SkyState, haze: Color, light: number): void {
    if (!this.ranges && !this.land) return;
    const L = sky.lightDirection;
    const look = this.look;
    look.sunDirection.set(L[0], L[1], L[2]).normalize();
    // Below the horizon the sun no longer lights the faces; its colour fades out with the daylight.
    look.sun.set(sky.lightColor).multiplyScalar(1.15 * light * smooth(-4, 6, sky.elevation));
    look.sky.set(sky.zenith).lerp(_c.set('#ffffff'), 0.45).lerp(haze, 0.25).multiplyScalar(0.25 + 0.4 * light);
    look.haze.copy(haze);
    // The air between the viewer and the nearer range: the haze turned toward the deep blue of the sky above.
    look.air.copy(haze).lerp(_c.set(sky.zenith), 0.4).lerp(_c.set('#8fa6c2'), 0.2);
  }

  private paintFields(sky: SkyState, light: number, haze: Color): void {
    const mesh = this.fields;
    if (!mesh) return;
    const col = mesh.geometry.getAttribute('color') as BufferAttribute;
    const pos = mesh.geometry.getAttribute('position');
    const palette = ['#6d8a45', '#8a9a4e', '#a39a52', '#5b7a3f', '#b0a15a', '#7c8f4d'];
    const seed = (mesh.geometry.userData['seed'] as number) || 1;
    const tone = Math.max(0.12, light * 0.75);
    for (let i = 0; i < col.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const r = Math.hypot(x, z);
      // Patches 40 to 120 m across, long axis along a field direction (stretched noise reads as ploughed strips).
      const u = x * 0.012 + z * 0.004;
      const v = z * 0.012 - x * 0.004;
      const cell = valueNoise(seed, u * 1.0, v * 3.2);
      _c.set(palette[Math.min(palette.length - 1, Math.floor(cell * palette.length))] as string);
      _c.multiplyScalar(tone * (0.9 + 0.2 * valueNoise(seed + 9, x * 0.05, z * 0.05)));
      // Far fields melt into the haze of the horizon.
      _c.lerp(haze, smooth(250, 1200, r) * 0.75);
      const alpha = smooth(FIELD_INNER, FIELD_INNER + 70, r) * 0.62;
      col.setXYZW(i, _c.r, _c.g, _c.b, alpha);
    }
    col.needsUpdate = true;
  }

  dispose(): void {
    this.clear();
    this.group.removeFromParent();
  }
}

/** A closed strip of hills `distance` metres out: the top edge follows {@link ridge}, the bottom sits under the ground. */
function hillRing(seed: number, distance: number, height: number, layer: number): Mesh {
  const verts = (HILL_SEGMENTS + 1) * 2;
  const position = new Float32Array(verts * 3);
  const color = new Float32Array(verts * 3);
  const index: number[] = [];
  for (let i = 0; i <= HILL_SEGMENTS; i++) {
    const a = (i / HILL_SEGMENTS) * Math.PI * 2;
    const wave = ridge(seed, a);
    // Fade the ridge to a gentle line where it is low, so there is flat country between the hills as well as ranges.
    const y = height * (0.15 + 0.85 * smooth(0.28, 0.75, wave)) * (0.6 + 0.4 * wave);
    // The distance itself breathes a little so layers do not read as a circle.
    const d = distance * (0.94 + 0.12 * valueNoise(seed + 5, Math.cos(a) * 2 + 9, Math.sin(a) * 2 + 9));
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    position.set([x, y, z, x, -4, z], i * 6);
    if (i < HILL_SEGMENTS) {
      const k = i * 2;
      index.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(position, 3));
  g.setAttribute('color', new BufferAttribute(color, 3));
  g.setIndex(index);
  g.userData['height'] = height;
  const m = new Mesh(g, new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, depthWrite: true, fog: false }));
  m.name = layer === 0 ? 'aether:hills-far' : 'aether:hills-near';
  m.frustumCulled = false;
  // Behind everything the scene draws, after the sky dome.
  m.renderOrder = -6 + layer * 0.1;
  return m;
}

/** A ring of ground patches from the plot's edge to the horizon; the inner edge is transparent so it blends into the lawn. */
function fieldRing(seed: number): Mesh {
  const verts = (FIELD_SEGMENTS + 1) * (FIELD_RINGS + 1);
  const position = new Float32Array(verts * 3);
  const color = new Float32Array(verts * 4);
  const index: number[] = [];
  for (let j = 0; j <= FIELD_RINGS; j++) {
    // Rings get farther apart outward (patches are seen at grazing angles there).
    const r = FIELD_INNER + (FIELD_OUTER - FIELD_INNER) * Math.pow(j / FIELD_RINGS, 1.8);
    for (let i = 0; i <= FIELD_SEGMENTS; i++) {
      const a = (i / FIELD_SEGMENTS) * Math.PI * 2;
      const k = j * (FIELD_SEGMENTS + 1) + i;
      position.set([Math.cos(a) * r, 0.03, Math.sin(a) * r], k * 3);
      if (i < FIELD_SEGMENTS && j < FIELD_RINGS) {
        const n = (FIELD_SEGMENTS + 1);
        index.push(k, k + 1, k + n, k + 1, k + n + 1, k + n);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(position, 3));
  g.setAttribute('color', new BufferAttribute(color, 4));
  g.setIndex(index);
  g.userData['seed'] = seed;
  const material = new MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const m = new Mesh(g, material);
  m.name = 'aether:fields';
  m.frustumCulled = false;
  m.renderOrder = 1;
  return m;
}

/** Farthest a range may stand: inside the camera's far plane (2.5 sky radii) with room for its height. */
export const RANGE_MAX_DISTANCE = 2000;

/**
 * The mountain ranges of a world with mountains: a far, tall, hazy range whose summits stand over a nearer, lower and
 * darker one (the foothill ridge in front of both is the near hill ring).
 */
export function planRanges(r: ResolvedSurroundings): RangeSpec[] {
  if (r.mountains <= 0) return [];
  const near = Math.max(r.hillDistance + 300, Math.min(RANGE_MAX_DISTANCE - 500, r.mountainDistance * 0.85));
  const far = RANGE_MAX_DISTANCE;
  return [
    { seed: r.seed + 307, distance: far, depth: 1800, height: r.mountains * 1.9, feature: 1500, snowline: 0.42, haze: 0.42, order: -6.4, name: 'aether:mountains-far' },
    { seed: r.seed + 211, distance: near, depth: 1100, height: r.mountains * 0.8, feature: 950, snowline: 0.74, haze: 0.14, order: -6.2, name: 'aether:mountains' },
  ];
}

/** Rolling land from the edge of the built-in ground out under the hills. */
export interface LandPlan {
  seed: number;
  /** Radius where the land starts (fading in over the ground). */
  inner: number;
  outer: number;
  /** Height of the rolling relief at full strength (m). */
  relief: number;
  /** Alpine pasture, scrub and rock rather than lowland grass. */
  alpine: boolean;
}

const LAND_SEGMENTS = 192;
const LAND_RINGS = 36;
/** Width (m) of the band over which the land fades in over the built-in ground. */
const LAND_FADE = 50;

export function planLand(r: ResolvedSurroundings, groundSize: number): LandPlan | null {
  // Starts just past the edge of the square ground (its corners stay ground; its skirt runs on under the land) and runs
  // out to the mountains' feet or past the hills.
  const inner = Math.max(r.clearRadius, groundSize / 2 + 8);
  const ranges = planRanges(r);
  const outer = ranges.length > 0 ? Math.min(...ranges.map((g) => g.distance)) - 40 : Math.max(r.hillDistance * 1.6, 500);
  // A ground that already reaches the hills needs no land.
  if (inner + LAND_FADE >= outer) return null;
  return { seed: r.seed + 71, inner, outer, relief: Math.max(4, r.hills * 0.5), alpine: r.mountains > 0 };
}

function fbm(seed: number, x: number, z: number): number {
  return valueNoise(seed, x, z) * 0.6 + valueNoise(seed + 1, x * 2.1, z * 2.1) * 0.28 + valueNoise(seed + 2, x * 4.3, z * 4.3) * 0.12;
}

/** Height of the land at (x, z): flat where it meets the ground, rolling farther out. Never below the ground. */
export function landHeight(p: LandPlan, x: number, z: number): number {
  const r = Math.hypot(x, z);
  const ramp = smooth(p.inner + LAND_FADE * 0.5, p.inner + 240, r);
  if (ramp <= 0) return 0.05;
  const broad = fbm(p.seed, x / 260, z / 260);
  const swell = fbm(p.seed + 5, x / 85, z / 85);
  // Rolling near the plot, rising into foothills toward the outer edge.
  const grow = 0.5 + (p.alpine ? 2.2 : 0.8) * smooth(p.inner + 200, p.outer, r);
  return 0.05 + p.relief * ramp * grow * Math.max(0, smooth(0.25, 0.85, broad) * 0.75 + (swell - 0.35) * 0.45);
}

/** A polar grid of the land, rings closer together near the plot; colours are painted by {@link paintLand}. */
function landRing(p: LandPlan): Mesh {
  const n = LAND_SEGMENTS + 1;
  const verts = n * (LAND_RINGS + 1);
  const position = new Float32Array(verts * 3);
  const color = new Float32Array(verts * 3);
  const index: number[] = [];
  for (let j = 0; j <= LAND_RINGS; j++) {
    const r = p.inner + (p.outer - p.inner) * Math.pow(j / LAND_RINGS, 1.7);
    for (let i = 0; i <= LAND_SEGMENTS; i++) {
      const a = (i / LAND_SEGMENTS) * Math.PI * 2;
      const k = j * n + i;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      position.set([x, landHeight(p, x, z), z], k * 3);
      if (i < LAND_SEGMENTS && j < LAND_RINGS) index.push(k, k + 1, k + n, k + 1, k + n + 1, k + n);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(position, 3));
  g.setAttribute('color', new BufferAttribute(color, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  g.userData['plan'] = p;
  // Lit by the scene's sun and sky like the ground it continues. Opaque: its inner edge fades to the ground's colour.
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const m = new Mesh(g, material);
  m.name = 'aether:land';
  m.frustumCulled = false;
  m.castShadow = false;
  m.receiveShadow = false;
  m.renderOrder = 1;
  return m;
}

// Saturated greens: a warm low sun turns an olive albedo brown.
const ALPINE_LAND = ['#3d5e1e', '#4a6b22', '#355419', '#66703a', '#2a4116'];
const LOWLAND_LAND = ['#46721f', '#57802a', '#3e6420', '#77803c', '#2f4c1a'];

/**
 * Pasture, scrub and rock: patches 50 to 200 m across, scrub in the hollows, bare rock and scree on the steep and high
 * ground of alpine land, the far land paler toward the haze.
 */
function paintLand(mesh: Mesh, groundColor: string | null): void {
  const p = mesh.geometry.userData['plan'] as LandPlan;
  const col = mesh.geometry.getAttribute('color') as BufferAttribute;
  const pos = mesh.geometry.getAttribute('position');
  const nor = mesh.geometry.getAttribute('normal');
  const palette = p.alpine ? ALPINE_LAND : LOWLAND_LAND;
  const rock = new Color(p.alpine ? '#8b857a' : '#8a8466');
  const scrub = new Color(palette[4] as string);
  const forest = new Color(p.alpine ? '#1b2c13' : '#1f3315');
  const edge = new Color();
  for (let i = 0; i < col.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    const patch = valueNoise(p.seed + 21, x / 120 + 3, z / 120 + 3) * 0.7 + valueNoise(p.seed + 22, x / 45, z / 45) * 0.3;
    _c.set(palette[Math.min(palette.length - 1, Math.floor(patch * palette.length))] as string);
    // Hollows hold darker scrub; crests dry out. (`rel`: share of the highest the foothills get.)
    const rel = y / Math.max(1, p.relief * (p.alpine ? 2.7 : 1.3));
    _c.lerp(scrub, (1 - smooth(0.05, 0.35, rel)) * 0.35 * smooth(p.inner + 60, p.inner + 200, r));
    if (p.alpine) {
      const steep = 1 - nor.getY(i);
      const bare = smooth(0.08, 0.2, steep + (valueNoise(p.seed + 23, x / 30, z / 30) - 0.5) * 0.08) * 0.75 + smooth(0.7, 1, rel) * 0.35;
      _c.lerp(rock, Math.min(0.8, bare));
    }
    // Woods: dark stands of trees a hundred metres and more across, thinning out on the high ground.
    const wood = smooth(0.56, 0.68, valueNoise(p.seed + 25, x / 150 + 7, z / 150 + 7)) * (1 - smooth(0.6, 0.9, rel)) * smooth(p.inner + 40, p.inner + 160, r);
    _c.lerp(forest, wood * 0.85);
    _c.multiplyScalar(0.88 + 0.24 * valueNoise(p.seed + 24, x / 14, z / 14));
    // The inner edge takes the ground's colour, so the two meet without a seam.
    if (groundColor) _c.lerp(edge.set(groundColor), 1 - smooth(p.inner, p.inner + LAND_FADE, r));
    col.setXYZ(i, _c.r, _c.g, _c.b);
  }
  col.needsUpdate = true;
}
