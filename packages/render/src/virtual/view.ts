/**
 * Camera → object-space view parameters shared by the virtual-geometry
 * systems (scatter fields and cluster DAG meshes). Allocation-free.
 */
import { Frustum, Matrix4, Vector3, type Object3D, type PerspectiveCamera } from 'three';

const _inv = new Matrix4();
const _vp = new Matrix4();
const _local = new Matrix4();
const _frustum = new Frustum();
const _cam = new Vector3();
const _s = new Vector3();

/** Object-space camera position, frustum and pixel scale (filled by {@link localView}). */
export interface LocalView {
  cx: number;
  cy: number;
  cz: number;
  /** Pixels per object unit at distance 1. */
  pixelScale: number;
  /** 6 planes × (nx, ny, nz, d), normalised, inside where n·p + d ≥ 0. */
  planes: Float64Array;
}

/** A reusable {@link LocalView}. */
export function createLocalView(): LocalView {
  return { cx: 0, cy: 0, cz: 0, pixelScale: 1, planes: new Float64Array(24) };
}

/** Pixels per world unit at distance 1 for a perspective camera and a viewport `heightPx` tall. */
export function projectionScale(camera: PerspectiveCamera, heightPx: number): number {
  const fov = (camera.fov * Math.PI) / 180;
  const zoom = camera.zoom > 0 ? camera.zoom : 1;
  return (heightPx * zoom) / (2 * Math.tan(fov / 2));
}

/**
 * Express `camera` in the local space of `object` (whose world matrix must be
 * current): camera position, frustum planes and the pixel scale (uniform
 * object scale folded in, the largest axis for non-uniform scales).
 */
export function localView(camera: PerspectiveCamera, object: Object3D, heightPx: number, out: LocalView): LocalView {
  const world = object.matrixWorld;
  _inv.copy(world).invert();
  _cam.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(_inv);
  out.cx = _cam.x;
  out.cy = _cam.y;
  out.cz = _cam.z;
  _s.setFromMatrixScale(world);
  const scale = Math.max(Math.abs(_s.x), Math.abs(_s.y), Math.abs(_s.z), 1e-9);
  out.pixelScale = projectionScale(camera, heightPx) * scale;
  // Frustum of (projection × view × world): planes come out in object space.
  _vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  _local.multiplyMatrices(_vp, world);
  _frustum.setFromProjectionMatrix(_local, camera.coordinateSystem);
  for (let i = 0; i < 6; i++) {
    const p = _frustum.planes[i];
    if (!p) continue;
    // Frustum planes are normalised in the space they were built in (object space here).
    out.planes[i * 4] = p.normal.x;
    out.planes[i * 4 + 1] = p.normal.y;
    out.planes[i * 4 + 2] = p.normal.z;
    out.planes[i * 4 + 3] = p.constant;
  }
  return out;
}
