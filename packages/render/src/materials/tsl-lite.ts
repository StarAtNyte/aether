/**
 * A small structural view of three's TSL (shader node) API.
 *
 * TSL nodes are dynamically typed (swizzles, operator methods, implicit conversions) and the generated type
 * definitions reject ordinary arithmetic on them (`float` against `vec3` varyings, uniform array elements without
 * swizzles). Shader code here therefore goes through this façade: every node is an {@link Nd}, the functions we use are
 * declared with `Nd` in and out, and the single unchecked cast lives in this file.
 */
import * as TSL from 'three/tsl';

/** A TSL node: arithmetic, swizzles and the few methods the shaders use. */
export interface Nd {
  add(o: Nd | number): Nd;
  sub(o: Nd | number): Nd;
  mul(o: Nd | number): Nd;
  div(o: Nd | number): Nd;
  negate(): Nd;
  length(): Nd;
  oneMinus(): Nd;
  element(i: number): Nd;
  sample(uv: Nd): Nd;
  clone(): Nd;
  addAssign(o: Nd): Nd;
  mulAssign(o: Nd | number): Nd;
  x: Nd;
  y: Nd;
  z: Nd;
  w: Nd;
  r: Nd;
  g: Nd;
  b: Nd;
  xy: Nd;
  xz: Nd;
  xyz: Nd;
  rgb: Nd;
  uvNode?: Nd;
  target?: import('three').Object3D;
}

type NodeArg = Nd | number;

/** The TSL functions and built-in nodes the shaders of this package use. */
export interface Tsl {
  float(v: NodeArg): Nd;
  vec2(...v: NodeArg[]): Nd;
  vec3(...v: Array<NodeArg | import('three').Color | import('three').Vector3>): Nd;
  vec4(...v: NodeArg[]): Nd;
  mix(a: Nd, b: Nd, t: NodeArg): Nd;
  smoothstep(a: NodeArg, b: NodeArg, x: Nd): Nd;
  step(edge: NodeArg, x: NodeArg): Nd;
  saturate(x: Nd): Nd;
  clamp(x: Nd, lo: NodeArg, hi: NodeArg): Nd;
  dot(a: Nd, b: Nd): Nd;
  normalize(a: Nd): Nd;
  exp(a: Nd): Nd;
  sin(a: Nd): Nd;
  cos(a: Nd): Nd;
  pow(a: Nd, b: NodeArg): Nd;
  abs(a: Nd): Nd;
  max(a: Nd, b: NodeArg): Nd;
  min(a: Nd, b: NodeArg): Nd;
  fract(a: Nd): Nd;
  floor(a: Nd): Nd;
  select(cond: Nd, a: NodeArg, b: NodeArg): Nd;
  texture(tex: import('three').Texture, uv?: Nd): Nd;
  texture3D(tex: import('three').Texture, uvw?: Nd): Nd;
  transformDirection(dir: Nd, matrix: Nd): Nd;
  getViewPosition(uv: Nd, depth: Nd, inverseProjection: Nd): Nd;
  perspectiveDepthToViewZ(depth: Nd, near: Nd, far: Nd): Nd;
  mx_noise_float(p: Nd): Nd;
  viewportDepthTexture(uv: Nd): Nd;
  viewportSharedTexture(uv: Nd): Nd;
  reflector(opts: { resolutionScale?: number; bounces?: boolean; target?: import('three').Object3D }): Nd;
  uniform(v: unknown): Nd;
  uniformArray(v: unknown[], type: string): Nd;
  positionWorld: Nd;
  normalWorld: Nd;
  positionView: Nd;
  positionLocal: Nd;
  positionGeometry: Nd;
  cameraPosition: Nd;
  cameraNear: Nd;
  cameraFar: Nd;
  cameraViewMatrix: Nd;
  cameraWorldMatrix: Nd;
  cameraProjectionMatrixInverse: Nd;
  materialColor: Nd;
  diffuseColor: Nd;
  screenUV: Nd;
  faceDirection: Nd;
  time: Nd;
}

/** The typed façade over `three/tsl`. */
export const T: Tsl = TSL as unknown as Tsl;
