/**
 * Planar reflection of a horizontal water plane: the scene rendered once per frame from the camera mirrored about
 * the plane, into a half-size target, before the main frame is drawn. The water shader samples it by screen position
 * (mirrored in x), bent by the wave normal.
 *
 * It is drawn by the renderer itself, outside any other pass and in a fixed order (mirror, then frame), because
 * nested rendering from inside a material update corrupts the pass encoder under WebGPU when a post-processing chain
 * owns the main pass. The oblique-near-plane trick (Lengyel) clips everything below the water, so no clip planes or extra
 * shader work are needed. The method follows three.js's `ReflectorNode` (MIT).
 */
import { HalfFloatType, Matrix4, PerspectiveCamera, Plane, RenderTarget, Vector2, Vector3, Vector4, WebGPUCoordinateSystem, type Camera, type Scene } from 'three';
import type { WebGPURenderer } from 'three/webgpu';

const _plane = new Plane();
const _normal = new Vector3(0, 1, 0);
const _origin = new Vector3();
const _camPos = new Vector3();
const _view = new Vector3();
const _target = new Vector3();
const _look = new Vector3(0, 0, -1);
const _rot = new Matrix4();
const _clip = new Vector4();
const _q = new Vector4();
const _size = new Vector2();

/** The mirrored render of one renderer. */
export class PlanarMirror {
  /** Colour target the water shader samples. */
  readonly target = new RenderTarget(2, 2, { type: HalfFloatType, depthBuffer: true });
  private readonly camera = new PerspectiveCamera();
  /** Fraction of the drawing buffer the target covers. */
  scale = 0.5;
  /** True once a frame was drawn into the target (the shader waits for it). */
  ready = false;
  /** Largest target this mirror has had (diagnostics). */
  peak: [number, number] = [0, 0];

  /**
   * Render `scene` mirrored about the plane `y = height`. Returns false (and draws nothing) when the camera is below the
   * plane. `hide` lists the objects or materials that must not appear in the mirror (the water itself); they are restored.
   */
  render(renderer: WebGPURenderer, scene: Scene, camera: Camera, height: number, hide: readonly { visible: boolean }[]): boolean {
    camera.updateMatrixWorld();
    _camPos.setFromMatrixPosition(camera.matrixWorld);
    if (_camPos.y <= height + 0.02) {
      this.ready = false;
      return false;
    }
    // The frame is drawn into the output target while stills are captured (a size of its own), else into the canvas.
    const out = renderer.getOutputRenderTarget();
    if (out) _size.set(out.width, out.height);
    else renderer.getDrawingBufferSize(_size);
    const w = Math.max(2, Math.round((_size.x || 2) * this.scale));
    const h = Math.max(2, Math.round((_size.y || 2) * this.scale));
    if (this.target.width !== w || this.target.height !== h) this.target.setSize(w, h);
    if (w * h > this.peak[0] * this.peak[1]) this.peak = [w, h];

    const mirror = this.camera;
    _origin.set(0, height, 0);
    // Mirror the camera position, look-at point and up vector about the plane.
    _view.subVectors(_origin, _camPos);
    _view.reflect(_normal).negate();
    _view.add(_origin);
    _rot.extractRotation(camera.matrixWorld);
    _look.set(0, 0, -1).applyMatrix4(_rot).add(_camPos);
    _target.subVectors(_origin, _look);
    _target.reflect(_normal).negate();
    _target.add(_origin);
    mirror.coordinateSystem = camera.coordinateSystem;
    mirror.position.copy(_view);
    mirror.up.set(0, 1, 0).applyMatrix4(_rot).reflect(_normal);
    mirror.lookAt(_target);
    const persp = camera as PerspectiveCamera;
    mirror.near = persp.near;
    mirror.far = persp.far;
    mirror.updateMatrixWorld();
    mirror.projectionMatrix.copy(persp.projectionMatrix);
    mirror.projectionMatrixInverse.copy(persp.projectionMatrixInverse);

    // Oblique near plane: the water surface becomes the near clip plane.
    _plane.setFromNormalAndCoplanarPoint(_normal, _origin);
    _plane.applyMatrix4(mirror.matrixWorldInverse);
    _clip.set(_plane.normal.x, _plane.normal.y, _plane.normal.z, _plane.constant);
    const p = mirror.projectionMatrix.elements;
    _q.x = (Math.sign(_clip.x) + (p[8] as number)) / (p[0] as number);
    _q.y = (Math.sign(_clip.y) + (p[9] as number)) / (p[5] as number);
    _q.z = -1;
    _q.w = (1 + (p[10] as number)) / (p[14] as number);
    _clip.multiplyScalar(1 / _clip.dot(_q));
    p[2] = _clip.x;
    p[6] = _clip.y;
    p[10] = renderer.coordinateSystem === WebGPUCoordinateSystem ? _clip.z : _clip.z + 1;
    p[14] = _clip.w;

    const hidden = hide.map((o) => o.visible);
    for (const o of hide) o.visible = false;
    const prevTarget = renderer.getRenderTarget();
    const prevMRT = renderer.getMRT();
    const prevAuto = renderer.autoClear;
    renderer.setMRT(null);
    renderer.setRenderTarget(this.target);
    renderer.autoClear = true;
    try {
      renderer.render(scene, mirror);
      this.ready = true;
    } finally {
      renderer.setMRT(prevMRT);
      renderer.setRenderTarget(prevTarget);
      renderer.autoClear = prevAuto;
      hide.forEach((o, i) => {
        o.visible = hidden[i] as boolean;
      });
    }
    return true;
  }

  /** Release the target. */
  dispose(): void {
    this.target.dispose();
    this.ready = false;
  }
}
