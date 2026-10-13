/**
 * Move / rotate / scale gizmo for the editor, wrapping three's
 * TransformControls (loaded lazily, like OrbitControls). The gizmo moves the
 * rendered object directly while dragging (render-only, no document change)
 * and reports the final local transform once on release, so a drag is one
 * undoable edit. While a handle is dragged the orbit camera is disabled.
 */
import type { Camera, Object3D } from 'three';
import type { Vec3 } from '@aether/core';
import type { OrbitControlsLike } from './camera-rig';

/** Gizmo modes. */
export type GizmoMode = 'translate' | 'rotate' | 'scale';

/** Final local transform after a drag (rotation in degrees, XYZ Euler). */
export interface GizmoChange {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  mode: GizmoMode;
}

/** The subset of TransformControls used here (lets tests use a fake). */
export interface TransformControlsLike {
  object: Object3D | undefined;
  dragging: boolean;
  axis: string | null;
  enabled: boolean;
  setMode(mode: GizmoMode): void;
  setSize(size: number): void;
  attach(object: Object3D): unknown;
  detach(): unknown;
  getHelper(): Object3D;
  addEventListener(type: string, listener: (e: { value?: unknown }) => void): void;
  dispose(): void;
}

const RAD = 180 / Math.PI;
const round = (v: number, step: number): number => Math.round(v / step) * step;

/** Local transform of an object as document values (rounded to keep documents tidy). */
export function readTransform(o: Object3D, mode: GizmoMode): GizmoChange {
  return {
    position: [round(o.position.x, 0.001), round(o.position.y, 0.001), round(o.position.z, 0.001)],
    rotation: [round(o.rotation.x * RAD, 0.01), round(o.rotation.y * RAD, 0.01), round(o.rotation.z * RAD, 0.01)],
    scale: [Math.max(0.001, round(o.scale.x, 0.001)), Math.max(0.001, round(o.scale.y, 0.001)), Math.max(0.001, round(o.scale.z, 0.001))],
    mode,
  };
}

/** Editor transform gizmo. See module docs. */
export class TransformGizmo {
  private tc: TransformControlsLike | null = null;
  private loading: Promise<TransformControlsLike | null> | null = null;
  private onCommit: ((change: GizmoChange) => void) | null = null;
  private mode: GizmoMode = 'translate';
  private disposed = false;

  /**
   * @param create factory for the controls (dynamic import of TransformControls in the renderer)
   * @param addHelper adds the gizmo's helper object to the scene
   * @param orbit the camera controls disabled while dragging
   * @param requestRender marks the next on-demand frame dirty
   */
  constructor(
    private readonly create: () => Promise<TransformControlsLike>,
    private readonly addHelper: (helper: Object3D) => void,
    private readonly orbit: OrbitControlsLike | null,
    private readonly requestRender: () => void,
  ) {}

  private ensure(): Promise<TransformControlsLike | null> {
    if (this.tc) return Promise.resolve(this.tc);
    this.loading ??= this.create().then(
      (tc) => {
        if (this.disposed) {
          tc.dispose();
          return null;
        }
        tc.setSize(0.85);
        tc.addEventListener('change', () => this.requestRender());
        tc.addEventListener('dragging-changed', (e) => {
          if (this.orbit) this.orbit.enabled = e.value !== true;
        });
        tc.addEventListener('mouseUp', () => {
          const o = tc.object;
          if (o && this.onCommit) this.onCommit(readTransform(o, this.mode));
        });
        this.addHelper(tc.getHelper());
        this.tc = tc;
        return tc;
      },
      () => null,
    );
    return this.loading;
  }

  /** Attach to an object in a mode; `onCommit` receives the transform after each drag. */
  async attach(object: Object3D, mode: GizmoMode, onCommit: (change: GizmoChange) => void): Promise<void> {
    const tc = await this.ensure();
    if (!tc || this.disposed) return;
    this.mode = mode;
    this.onCommit = onCommit;
    tc.setMode(mode);
    if (tc.object !== object) tc.attach(object);
    tc.getHelper().visible = true;
    this.requestRender();
  }

  /** Detach (no gizmo shown). */
  detach(): void {
    this.onCommit = null;
    if (!this.tc) return;
    if (this.tc.object) this.tc.detach();
    this.tc.getHelper().visible = false;
    if (this.orbit) this.orbit.enabled = true;
    this.requestRender();
  }

  /** The attached object (undefined when detached). */
  get object(): Object3D | undefined {
    return this.tc?.object;
  }

  /** True while a handle is hovered or dragged: a click must not change the selection. */
  get busy(): boolean {
    return !!this.tc && !!this.tc.object && (this.tc.dragging || this.tc.axis !== null);
  }

  /** The helper object (hidden during captures), or null before first use. */
  get helper(): Object3D | null {
    return this.tc ? this.tc.getHelper() : null;
  }

  /** Release the controls and their GPU resources. */
  dispose(): void {
    this.disposed = true;
    this.onCommit = null;
    if (this.tc) {
      this.tc.detach();
      this.tc.getHelper().removeFromParent();
      this.tc.dispose();
      this.tc = null;
    }
  }
}

/** Default factory: three's TransformControls bound to a camera and canvas. */
export async function createTransformControls(camera: Camera, canvas: HTMLElement): Promise<TransformControlsLike> {
  const { TransformControls } = await import('three/addons/controls/TransformControls.js');
  return new TransformControls(camera, canvas) as unknown as TransformControlsLike;
}
