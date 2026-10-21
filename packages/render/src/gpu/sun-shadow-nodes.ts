/**
 * Shader side of the sun's shadows (policy in `environment/sun-shadow-plan.ts`):
 *
 * - {@link softShadowFilter}: a contact-hardening (PCSS-style) filter for any directional shadow map. The blocker
 *   search keeps the map's hardware depth comparison (so three's sun shafts can still march through the same map, and
 *   every tap is bilinear-filtered): each search tap compares at four depths in front of the receiver and the mean
 *   distance to the blocker follows from those exceedance fractions (E[D] = ∫ P(D > Δ) dΔ). The penumbra is that
 *   distance times the sun's apparent size, filtered with rotated Vogel-disk taps whose rotation can advance each frame
 *   so temporal AA converges it into a smooth gradient.
 * - {@link SunCascades}: three's `CSMShadowNode` (its cascade lights, shadow maps and life cycle) with Aether's
 *   placement: focus boxes snapped to whole texels plus the content fit as the outermost map, chosen per fragment by
 *   containment with a blended band at each box's edge, instead of slices along the view depth.
 */
import { Matrix4, Vector2, Vector3, type Camera, type DirectionalLight, type LightShadow, type Object3D, type OrthographicCamera, type PerspectiveCamera } from 'three';
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';
import * as TSL from 'three/tsl';
import type { Node, NodeBuilder, Renderer } from 'three/webgpu';
import { CASCADE_BLEND, focusHalf, pcfRadius, snapToTexel, viewFocus, type SunShadowPlan } from '../environment/sun-shadow-plan';

/** A TSL node, typed loosely: TSL is dynamically typed and its generated types reject ordinary node arithmetic. */
interface N {
  add(o: N | number): N;
  sub(o: N | number): N;
  mul(o: N | number): N;
  div(o: N | number): N;
  oneMinus(): N;
  greaterThan(o: N | number): N;
  compare(z: N): N;
  depth(layer: N | number): N;
  setGroup(g: unknown): N;
  toVar(): N;
  assign(o: N | number): N;
  addAssign(o: N | number): N;
  subAssign(o: N | number): N;
  x: N;
  y: N;
  z: N;
  xy: N;
  r: N;
}

interface Tsl {
  Fn(fn: (inputs: FilterInputs, builder: NodeBuilder) => N): (inputs: FilterInputs) => N;
  Fn(fn: (builder: NodeBuilder) => N): () => N;
  If(cond: N, body: () => void): void;
  float(v: number | N): N;
  vec2(x: number | N, y?: number | N): N;
  vec4(...v: Array<number | N>): N;
  texture(tex: unknown, uv?: N): N;
  reference(name: string, type: string, object: object): N;
  uniform(v: unknown): N;
  clamp(x: N, lo: N | number, hi: N | number): N;
  max(a: N, b: N | number): N;
  min(a: N, b: N | number): N;
  abs(a: N): N;
  smoothstep(a: N | number, b: N | number, x: N): N;
  interleavedGradientNoise(p: N): N;
  vogelDiskSample(i: number, n: number, phi: N): N;
  lightShadowMatrix(light: object): N;
  shadow(light: object, shadow: LightShadow): Node;
  screenCoordinate: N;
  shadowPositionWorld: N;
  renderGroup: unknown;
}

const T = TSL as unknown as Tsl;

/** The inputs three's shadow node passes to a shadow filter (`LightShadow.filterNode`). */
export interface FilterInputs {
  depthTexture: { isArrayTexture?: boolean };
  shadowCoord: N;
  shadow: LightShadow;
  depthLayer: N | number;
}

/** A shadow filter: what `LightShadow.filterNode` holds. */
export type ShadowFilterFn = (inputs: FilterInputs) => N;

/** `LightShadow` with the node hooks three's node renderer reads (absent from its type definitions). */
export type NodeLightShadow = LightShadow & { filterNode?: ShadowFilterFn; shadowNode?: Node | SunCascades };

/**
 * Per-frame rotation offset of the shadow filters' sampling pattern (pixels). The renderer advances it while temporal
 * AA refines a resting view, so the rotated taps average into a smooth penumbra; 0 keeps a fixed pattern.
 */
export const shadowNoiseOffset = T.uniform(new Vector2(0, 0));
/** The offset's value (write `x`, `y`). */
export const shadowNoiseValue = (shadowNoiseOffset as unknown as { value: Vector2 }).value;

/** Distances (m) in front of the receiver at which the blocker search compares (exceedance levels). */
export const BLOCKER_LEVELS: readonly [number, number, number] = Object.freeze([0.35, 1.8, 7]) as readonly [number, number, number];
/** Longest blocker distance (m) the search radius allows for. */
export const BLOCKER_REACH = 18;

/**
 * Mean blocker distance (m) from exceedance fractions: `p[k]` is the share of the blocked taps whose blocker is more
 * than `BLOCKER_LEVELS[k]` in front of the receiver (non-increasing). Trapezoids of E[D] = ∫ P(D > Δ) dΔ, with the
 * tail beyond the last level counted as half a level. Pure (the shader evaluates the same expression).
 */
export function meanBlockerDistance(p1: number, p2: number, p3: number): number {
  const [d1, d2, d3] = BLOCKER_LEVELS;
  return (d1 * (1 + p1)) / 2 + ((d2 - d1) * (p1 + p2)) / 2 + ((d3 - d2) * (p2 + p3)) / 2 + p3 * d3 * 0.5;
}

/** Options of {@link softShadowFilter}. */
export interface SoftFilterOptions {
  blockerSamples: number;
  filterSamples: number;
  /** Apparent sun diameter (radians). */
  sunAngle: number;
  /** Smallest penumbra (m). */
  minPenumbra: number;
}

/**
 * A contact-hardening shadow filter for directional (orthographic) shadow maps. Works with the map's comparison
 * sampler on both backends (no raw depth reads), so it can replace three's PCF filter on any directional shadow.
 */
export function softShadowFilter(opts: SoftFilterOptions): ShadowFilterFn {
  const nb = Math.max(3, Math.min(16, Math.round(opts.blockerSamples)));
  const nf = Math.max(4, Math.min(32, Math.round(opts.filterSamples)));
  const k = Math.max(1e-4, Math.tan(Math.max(1e-4, opts.sunAngle)));
  const minPen = Math.max(0.001, opts.minPenumbra);
  return T.Fn(({ depthTexture, shadowCoord, shadow, depthLayer }: FilterInputs, builder: NodeBuilder): N => {
    const cam = shadow.camera as OrthographicCamera;
    const near = T.reference('near', 'float', cam).setGroup(T.renderGroup);
    const far = T.reference('far', 'float', cam).setGroup(T.renderGroup);
    const left = T.reference('left', 'float', cam).setGroup(T.renderGroup);
    const right = T.reference('right', 'float', cam).setGroup(T.renderGroup);
    const mapSize = T.reference('mapSize', 'vec2', shadow).setGroup(T.renderGroup);
    const width = right.sub(left);
    const range = far.sub(near);
    const texel = T.float(1).div(mapSize.x);
    // Toward the light in depth: a smaller depth normally, a larger one with a reversed depth buffer.
    const toward = (builder.renderer as Renderer & { reversedDepthBuffer?: boolean }).reversedDepthBuffer ? 1 : -1;
    const lit = (uv: N, z: N): N => {
      let t = T.texture(depthTexture, uv);
      if (depthTexture.isArrayTexture) t = t.depth(depthLayer);
      return t.compare(z);
    };
    const zr = shadowCoord.z;
    const phi = T.interleavedGradientNoise(T.screenCoordinate.xy.add(shadowNoiseOffset)).mul(6.28318530718);
    const search = T.clamp(T.float(BLOCKER_REACH * k).div(width), texel.mul(1.5), texel.mul(40));
    const dz1 = T.float(BLOCKER_LEVELS[0]).div(range).mul(toward);
    const dz2 = T.float(BLOCKER_LEVELS[1]).div(range).mul(toward);
    const dz3 = T.float(BLOCKER_LEVELS[2]).div(range).mul(toward);
    const b0 = T.float(0).toVar();
    const b1 = T.float(0).toVar();
    const b2 = T.float(0).toVar();
    const b3 = T.float(0).toVar();
    for (let i = 0; i < nb; i++) {
      const uv = shadowCoord.xy.add(T.vogelDiskSample(i, nb, phi).mul(search));
      b0.addAssign(lit(uv, zr).oneMinus());
      b1.addAssign(lit(uv, zr.add(dz1)).oneMinus());
      b2.addAssign(lit(uv, zr.add(dz2)).oneMinus());
      b3.addAssign(lit(uv, zr.add(dz3)).oneMinus());
    }
    const result = T.float(1).toVar();
    T.If(b0.greaterThan(0.001), () => {
      const inv = T.float(1).div(T.max(b0, 0.001));
      const p1 = T.min(b1.mul(inv), 1);
      const p2 = T.min(b2.mul(inv), p1);
      const p3 = T.min(b3.mul(inv), p2);
      const [d1, d2, d3] = BLOCKER_LEVELS;
      const mean = p1.add(1).mul(d1 / 2).add(p1.add(p2).mul((d2 - d1) / 2)).add(p2.add(p3).mul((d3 - d2) / 2)).add(p3.mul(d3 * 0.5));
      const penumbra = T.max(mean.mul(k), minPen);
      const radius = T.clamp(penumbra.div(width), texel, search);
      // Wider kernels reach further across a sloped receiver: move the reference toward the light with the kernel.
      const zf = zr.add(radius.mul(width).mul(0.35).div(range).mul(toward));
      const sum = T.float(0).toVar();
      for (let i = 0; i < nf; i++) sum.addAssign(lit(shadowCoord.xy.add(T.vogelDiskSample(i, nf, phi.add(1.9)).mul(radius)), zf));
      result.assign(sum.mul(1 / nf));
    });
    return result;
  });
}

interface CsmInternals {
  _init(builder: { camera: Camera; renderer: Renderer }): void;
}

/** A cascade light of three's CSM node (an `Object3D` with a shadow and a target). */
type CascadeLight = Object3D & { target: Object3D; shadow: NodeLightShadow; isDirectionalLight?: boolean };

const _orient = new Matrix4();
const _inverse = new Matrix4();
const _dir = new Vector3();
const _p = new Vector3();
const _q = new Vector3();
const _up = new Vector3(0, 1, 0);
const _fwd = new Vector3();
const _eye: [number, number, number] = [0, 0, 0];
const _forward: [number, number, number] = [0, 0, 0];
const _target: [number, number, number] = [0, 0, 0];
const _focus: [number, number, number] = [0, 0, 0];

/** Where the focus cascades look: hints the renderer refreshes before each draw. */
export interface FocusHints {
  /** Orbit / follow target, when the camera has one. */
  target: Vector3 | null;
  /** Ground height (m) for the view-ray fallback. */
  groundY: number;
  /** Farthest focus (m). */
  maxDistance: number;
}

/**
 * The sun's cascades: `plan.cascades - 1` focus boxes and the content fit (the sun's own fitted shadow camera, copied
 * each draw) as the outermost map. Construct, assign to `sun.shadow.shadowNode`; the cascade lights are created on
 * the first shader build (three's CSM life cycle) and follow the hints on every render. Allocation-free per frame.
 */
export class SunCascades extends CSMShadowNode {
  readonly hints: FocusHints = { target: null, groundY: 0, maxDistance: 200 };
  private half0 = 0;
  private readonly filter: ShadowFilterFn | null;
  /** World-space PCF penumbra (m) of the filter-less tiers. */
  private readonly pcfPenumbra = 0.06;

  constructor(
    private readonly sun: DirectionalLight,
    private readonly mainCamera: PerspectiveCamera,
    private readonly plan: SunShadowPlan,
  ) {
    super(sun, { cascades: Math.max(2, plan.cascades), maxFar: 1e5, lightMargin: 0 });
    this.filter = plan.filter === 'pcss' ? softShadowFilter(plan) : null;
  }

  /** The cascade lights (empty before the first shader build). */
  get cascadeLights(): readonly CascadeLight[] {
    return this.lights as unknown as CascadeLight[];
  }

  /** The outermost (content-fitted) cascade's light, flagged directional so three's sun shafts can march its map. */
  get outerLight(): CascadeLight | null {
    const l = this.cascadeLights[this.cascadeLights.length - 1];
    return l ?? null;
  }

  /** Where the cascades are (diagnostics): centre, half size and map edge of each, finest first, and the focus. */
  describe(): { focus: [number, number, number]; boxes: Array<{ center: [number, number, number]; half: number; size: number; hasMap: boolean }> } {
    return {
      focus: [_focus[0], _focus[1], _focus[2]],
      boxes: this.cascadeLights.map((l) => {
        const c = l.shadow.camera as OrthographicCamera;
        return { center: [l.target.position.x, l.target.position.y, l.target.position.z], half: (c.right - c.left) / 2, size: l.shadow.mapSize.x, hasMap: Boolean(l.shadow.map) };
      }),
    };
  }

  /** Splits along the view depth are not used. */
  override updateFrustums(): void {}

  override setup(builder: NodeBuilder): Node {
    if (this.camera === null) {
      (CSMShadowNode.prototype as unknown as CsmInternals)._init.call(this, { camera: this.mainCamera, renderer: builder.renderer as Renderer });
      this.configure();
    }
    return this.selection();
  }

  private configure(): void {
    const lights = this.cascadeLights;
    const last = lights.length - 1;
    lights.forEach((l, i) => {
      const size = i === last ? this.plan.outerMapSize : this.plan.nearMapSize;
      l.shadow.mapSize.set(size, size);
      l.shadow.bias = this.sun.shadow.bias;
      l.shadow.normalBias = this.sun.shadow.normalBias;
      l.shadow.radius = this.sun.shadow.radius;
      if (this.filter) l.shadow.filterNode = this.filter;
      l.name = `sun-cascade-${i}`;
    });
    const outer = lights[last];
    if (outer) outer.isDirectionalLight = true;
    this.place();
  }

  /** Per fragment: the finest box that holds the point, blended into the next one over the box's outer band. */
  private selection(): Node {
    const nodes = (this as unknown as { _shadowNodes: N[] })._shadowNodes;
    const lights = this.cascadeLights;
    return T.Fn((builder: NodeBuilder) => {
      this.setupShadowPosition(builder);
      const acc = T.float(0).toVar();
      const left = T.float(1).toVar();
      const last = lights.length - 1;
      for (let i = 0; i < last; i++) {
        const light = lights[i];
        const node = nodes[i];
        if (!light || !node) continue;
        const c = T.lightShadowMatrix(light).mul(T.vec4(T.shadowPositionWorld.x, T.shadowPositionWorld.y, T.shadowPositionWorld.z, 1));
        const e = T.max(T.abs(c.x.sub(0.5)), T.abs(c.y.sub(0.5))).mul(2);
        const w = T.smoothstep(1, 1 - CASCADE_BLEND, e).mul(left).toVar();
        T.If(w.greaterThan(0.001), () => {
          acc.addAssign(node.mul(w));
          left.subAssign(w);
        });
      }
      const outer = nodes[last];
      if (outer) {
        T.If(left.greaterThan(0.001), () => {
          acc.addAssign(outer.mul(left));
        });
      } else acc.addAssign(left);
      return acc;
    })() as unknown as Node;
  }

  override updateBefore(): boolean | undefined {
    this.place();
    return undefined;
  }

  /** Move the cascades: the outer copies the sun's content fit, the focus boxes follow the view. */
  private place(): void {
    const lights = this.cascadeLights;
    const sun = this.sun;
    const parent = sun.parent;
    if (lights.length === 0 || !parent) return;
    for (const l of lights) {
      if (l.parent === null) parent.add(l.target, l);
    }
    const last = lights.length - 1;
    const outer = lights[last];
    if (!outer) return;
    const sc = sun.shadow.camera;
    outer.position.copy(sun.position);
    outer.target.position.copy(sun.target.position);
    outer.updateMatrixWorld();
    outer.target.updateMatrixWorld();
    const oc = outer.shadow.camera as OrthographicCamera;
    if (oc.left !== sc.left || oc.right !== sc.right || oc.top !== sc.top || oc.bottom !== sc.bottom || oc.near !== sc.near || oc.far !== sc.far) {
      oc.left = sc.left;
      oc.right = sc.right;
      oc.top = sc.top;
      oc.bottom = sc.bottom;
      oc.near = sc.near;
      oc.far = sc.far;
      oc.updateProjectionMatrix();
    }
    // Depth bias in world terms (a fixed fraction of a 1 km depth range would lift shadows half a metre off the ground).
    const outerTexel = (sc.right - sc.left) / outer.shadow.mapSize.x;
    outer.shadow.bias = -(0.6 * outerTexel + 0.02) / Math.max(1, sc.far - sc.near);
    outer.shadow.normalBias = Math.max(0.01, 0.35 * outerTexel);
    outer.shadow.radius = this.filter ? 1 : pcfRadius(this.pcfPenumbra * 2, outerTexel);
    if (last === 0) return;
    // Light space: z toward the light. Only the rotation of the look-at matrix is used.
    _dir.subVectors(sun.position, sun.target.position);
    if (_dir.lengthSq() < 1e-8) return;
    _dir.normalize();
    _orient.lookAt(sun.position, sun.target.position, Math.abs(_dir.y) > 0.999 ? _fwd.set(0, 0, 1) : _up);
    _inverse.copy(_orient).invert();
    const lightZ = _p.copy(sun.position).applyMatrix4(_inverse).z;
    const cam = this.mainCamera;
    cam.getWorldPosition(_q);
    _eye[0] = _q.x;
    _eye[1] = _q.y;
    _eye[2] = _q.z;
    cam.getWorldDirection(_fwd);
    _forward[0] = _fwd.x;
    _forward[1] = _fwd.y;
    _forward[2] = _fwd.z;
    const h = this.hints;
    if (h.target) {
      _target[0] = h.target.x;
      _target[1] = h.target.y;
      _target[2] = h.target.z;
    }
    const halfFov = ((cam.fov ?? 55) * Math.PI) / 360;
    const distance = viewFocus(_eye, _forward, h.target ? _target : null, h.groundY, halfFov, h.maxDistance, 20, _focus);
    this.half0 = focusHalf(distance, this.half0, this.plan);
    // Boxes reach further ahead of the focus than behind it (the eye looks past it).
    const fh = Math.hypot(_forward[0], _forward[2]) || 1;
    const outerHalf = (sc.right - sc.left) / 2;
    for (let i = 0; i < last; i++) {
      const l = lights[i];
      if (!l) continue;
      const half = Math.min(this.half0 * this.plan.ratio ** i, Math.max(this.half0, outerHalf));
      const ahead = 0.35 * half;
      _p.set(_focus[0] + (_forward[0] / fh) * ahead, _focus[1], _focus[2] + (_forward[2] / fh) * ahead).applyMatrix4(_inverse);
      const texel = (2 * half) / l.shadow.mapSize.x;
      _p.set(snapToTexel(_p.x, texel), snapToTexel(_p.y, texel), lightZ).applyMatrix4(_orient);
      l.position.copy(_p);
      l.target.position.copy(_p).sub(_dir);
      l.updateMatrixWorld();
      l.target.updateMatrixWorld();
      const c = l.shadow.camera as OrthographicCamera;
      if (c.right !== half || c.near !== sc.near || c.far !== sc.far) {
        c.left = -half;
        c.right = half;
        c.top = half;
        c.bottom = -half;
        c.near = sc.near;
        c.far = sc.far;
        c.updateProjectionMatrix();
      }
      const range = Math.max(1, c.far - c.near);
      // Depth bias in world terms: about half a texel plus a centimetre; normal offset a third of a texel.
      l.shadow.bias = -(0.6 * texel + 0.01) / range;
      l.shadow.normalBias = Math.max(0.006, 0.35 * texel);
      l.shadow.radius = this.filter ? 1 : pcfRadius(this.pcfPenumbra, texel);
    }
  }

  /** Release the cascade lights and their shadow maps. */
  override dispose(): void {
    const nodes = (this as unknown as { _shadowNodes: Array<{ dispose(): void }> })._shadowNodes;
    for (const n of nodes) n.dispose();
    nodes.length = 0;
    super.dispose();
  }
}
