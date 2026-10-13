/**
 * Editor overlays drawn on top of the scene, identical on WebGPU and WebGL2:
 *
 * - mesh components of the mesh being edited: vertex markers (instanced
 *   boxes), the wireframe of its edges and the selected faces / edges /
 *   vertices; edges and faces share the mounted position attribute, so live
 *   previews move them for free;
 * - the sculpt / paint brush ring;
 * - joints of the selected entity (anchor, axis, link to the target).
 *
 * Everything is created on demand and disposed when hidden.
 */
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineLoop,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
  type Object3D,
} from 'three';
import type { Vec3 } from '@aether/core';
import type { MeshGeometryBundle } from '../geometry/mesh-asset';

/** Component selection mode. */
export type ComponentMode = 'vertex' | 'edge' | 'face';

/** What to draw for the mesh being edited (indices refer to the mounted mesh). */
export interface ComponentView {
  /** The entity object the mesh is mounted under (overlays follow its transform). */
  target: Object3D;
  bundle: MeshGeometryBundle;
  mode: ComponentMode;
  /** Welded edges as vertex index pairs (wireframe). */
  edges: Uint32Array;
  selectedVertices: ArrayLike<number>;
  /** Selected edges as vertex index pairs. */
  selectedEdges: ArrayLike<number>;
  selectedFaces: ArrayLike<number>;
}

/** Most vertex markers drawn (beyond this only selected vertices get markers). */
export const MAX_VERTEX_MARKERS = 20_000;
const ACCENT = 0xff9f1c;
const WIRE = 0x9fd8ff;
const SPRITE_ORDER = 20;

const _m = new Matrix4();
const _q = new Quaternion();
const _up = new Vector3(0, 0, 1);
const _n = new Vector3();
const _s = new Vector3();
const _p = new Vector3();
const _white = new Color(0xffffff);
const _accent = new Color(ACCENT);

/** Editor overlay group. Add {@link group} to the scene once. */
export class EditOverlay {
  readonly group = new Group();
  private components: Group | null = null;
  private componentParent: Object3D | null = null;
  private markers: InstancedMesh | null = null;
  private markerGeometry: BoxGeometry | null = null;
  private markerMaterial: MeshBasicMaterial | null = null;
  private wire: LineSegments | null = null;
  private selEdges: LineSegments | null = null;
  private selFaces: Mesh | null = null;
  private lineMaterial: LineBasicMaterial | null = null;
  private selLineMaterial: LineBasicMaterial | null = null;
  private faceMaterial: MeshBasicMaterial | null = null;
  private brush: LineLoop | null = null;
  private joint: Group | null = null;
  private view: ComponentView | null = null;
  private markerScale = 0.02;

  constructor() {
    this.group.name = 'aether:edit-overlay';
  }

  // ---------------------------------------------------------------------------
  // Mesh components
  // ---------------------------------------------------------------------------

  /** Show (or with null hide) the components of the mesh being edited. */
  setComponents(view: ComponentView | null): void {
    this.clearComponents();
    this.view = view;
    if (!view) return;
    const g = new Group();
    g.name = 'edit:components';
    g.matrixAutoUpdate = false;
    view.target.add(g);
    this.components = g;
    this.componentParent = view.target;
    this.lineMaterial ??= new LineBasicMaterial({ color: WIRE, transparent: true, opacity: 0.55, depthTest: true });
    this.selLineMaterial ??= new LineBasicMaterial({ color: ACCENT, depthTest: false, transparent: true });
    this.faceMaterial ??= new MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    // Wireframe of every edge (shares the live position attribute).
    if (view.edges.length > 0) {
      const wg = new BufferGeometry();
      wg.setAttribute('position', view.bundle.position);
      wg.setIndex(new BufferAttribute(Uint32Array.from(view.edges), 1));
      this.wire = new LineSegments(wg, this.lineMaterial);
      this.wire.raycast = () => undefined;
      this.wire.renderOrder = SPRITE_ORDER;
      g.add(this.wire);
    }
    if (view.selectedFaces.length > 0) {
      const idx: number[] = [];
      const src = view.bundle.full.getIndex();
      if (src) {
        for (let i = 0; i < view.selectedFaces.length; i++) {
          const t = view.selectedFaces[i] as number;
          idx.push(src.getX(t * 3), src.getX(t * 3 + 1), src.getX(t * 3 + 2));
        }
      }
      const fg = new BufferGeometry();
      fg.setAttribute('position', view.bundle.position);
      fg.setIndex(new BufferAttribute(Uint32Array.from(idx), 1));
      this.selFaces = new Mesh(fg, this.faceMaterial);
      this.selFaces.raycast = () => undefined;
      this.selFaces.renderOrder = SPRITE_ORDER;
      g.add(this.selFaces);
    }
    if (view.selectedEdges.length > 0) {
      const eg = new BufferGeometry();
      eg.setAttribute('position', view.bundle.position);
      eg.setIndex(new BufferAttribute(Uint32Array.from(view.selectedEdges as ArrayLike<number>), 1));
      this.selEdges = new LineSegments(eg, this.selLineMaterial);
      this.selEdges.raycast = () => undefined;
      this.selEdges.renderOrder = SPRITE_ORDER + 1;
      g.add(this.selEdges);
    }
    this.buildMarkers(view);
  }

  private buildMarkers(view: ComponentView): void {
    const g = this.components;
    if (!g) return;
    const n = view.bundle.vertexCount;
    const selected = new Set<number>();
    for (let i = 0; i < view.selectedVertices.length; i++) selected.add(view.selectedVertices[i] as number);
    const showAll = view.mode === 'vertex' && n <= MAX_VERTEX_MARKERS;
    const list: number[] = showAll ? Array.from({ length: n }, (_, i) => i) : [...selected];
    if (list.length === 0) return;
    const bb = view.bundle.full.boundingBox;
    const size = bb ? Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z) : 1;
    this.markerScale = Math.max(0.004, Math.min(0.2, size * 0.012));
    this.markerGeometry ??= new BoxGeometry(1, 1, 1);
    this.markerMaterial ??= new MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true });
    const im = new InstancedMesh(this.markerGeometry, this.markerMaterial, list.length);
    im.name = 'edit:vertices';
    im.raycast = () => undefined;
    im.renderOrder = SPRITE_ORDER + 2;
    im.frustumCulled = false;
    im.userData['vertexList'] = Uint32Array.from(list);
    for (let i = 0; i < list.length; i++) im.setColorAt(i, selected.has(list[i] as number) ? _accent : _white);
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    this.markers = im;
    g.add(im);
    this.refreshMarkers();
  }

  /** Re-place vertex markers after a live preview moved vertices (O(markers), allocation-free). */
  refreshMarkers(): void {
    const im = this.markers;
    const view = this.view;
    if (!im || !view) return;
    const list = im.userData['vertexList'] as Uint32Array;
    const pos = view.bundle.position.array as Float32Array;
    // Markers keep a constant size regardless of the entity's scale.
    view.target.updateWorldMatrix(true, false);
    view.target.matrixWorld.decompose(_p, _q, _s);
    const sx = this.markerScale / (Math.abs(_s.x) || 1);
    const sy = this.markerScale / (Math.abs(_s.y) || 1);
    const sz = this.markerScale / (Math.abs(_s.z) || 1);
    for (let i = 0; i < list.length; i++) {
      const v = list[i] as number;
      _m.makeScale(sx, sy, sz).setPosition(pos[v * 3] as number, pos[v * 3 + 1] as number, pos[v * 3 + 2] as number);
      im.setMatrixAt(i, _m);
    }
    im.instanceMatrix.needsUpdate = true;
  }

  /** True while components are shown. */
  get editing(): boolean {
    return this.view !== null;
  }

  private clearComponents(): void {
    for (const o of [this.wire, this.selEdges, this.selFaces]) o?.geometry.dispose();
    this.markers?.dispose();
    this.wire = null;
    this.selEdges = null;
    this.selFaces = null;
    this.markers = null;
    if (this.components) {
      this.components.removeFromParent();
      this.components = null;
    }
    this.componentParent = null;
    this.view = null;
  }

  // ---------------------------------------------------------------------------
  // Brush
  // ---------------------------------------------------------------------------

  /** Show the brush ring at a world point, facing `normal`, with a world radius; null hides it. */
  setBrush(brush: { point: Vec3; normal: Vec3; radius: number; erase?: boolean } | null): void {
    if (!brush) {
      if (this.brush) this.brush.visible = false;
      return;
    }
    if (!this.brush) {
      const segs = 64;
      const pts = new Float32Array(segs * 3);
      for (let i = 0; i < segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        pts[i * 3] = Math.cos(a);
        pts[i * 3 + 1] = Math.sin(a);
      }
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(pts, 3));
      this.brush = new LineLoop(geo, new LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.9 }));
      this.brush.name = 'edit:brush';
      this.brush.renderOrder = SPRITE_ORDER + 3;
      this.brush.raycast = () => undefined;
      this.brush.frustumCulled = false;
      this.group.add(this.brush);
    }
    const b = this.brush;
    b.visible = true;
    _n.set(brush.normal[0], brush.normal[1], brush.normal[2]);
    if (_n.lengthSq() < 1e-12) _n.set(0, 1, 0);
    _n.normalize();
    b.quaternion.setFromUnitVectors(_up, _n);
    b.position.set(brush.point[0] + _n.x * 0.02, brush.point[1] + _n.y * 0.02, brush.point[2] + _n.z * 0.02);
    const r = Math.max(0.01, brush.radius);
    b.scale.set(r, r, r);
    (b.material as LineBasicMaterial).color.setHex(brush.erase ? 0xff5a5a : 0xffffff);
  }

  // ---------------------------------------------------------------------------
  // Joints
  // ---------------------------------------------------------------------------

  /** Visualise a joint: anchor point, hinge / slide axis and a link to the target anchor (world space); null hides it. */
  setJoint(joint: { anchor: Vec3; axis: Vec3; target: Vec3 | null; type: string } | null): void {
    if (this.joint) {
      this.joint.traverse((o) => {
        const g = (o as Partial<Mesh>).geometry;
        if (g) g.dispose();
        const m = (o as Partial<Mesh>).material;
        if (m && !Array.isArray(m)) m.dispose();
      });
      this.joint.removeFromParent();
      this.joint = null;
    }
    if (!joint) return;
    const g = new Group();
    g.name = 'edit:joint';
    const [ax, ay, az] = joint.anchor;
    const len = Math.max(1e-6, Math.hypot(joint.axis[0], joint.axis[1], joint.axis[2]));
    const L = 1.2;
    const pts: number[] = [];
    if (joint.type === 'revolute' || joint.type === 'prismatic') {
      const dx = (joint.axis[0] / len) * L;
      const dy = (joint.axis[1] / len) * L;
      const dz = (joint.axis[2] / len) * L;
      pts.push(ax - dx, ay - dy, az - dz, ax + dx, ay + dy, az + dz);
    }
    if (joint.target) pts.push(ax, ay, az, joint.target[0], joint.target[1], joint.target[2]);
    if (pts.length > 0) {
      const lg = new BufferGeometry();
      lg.setAttribute('position', new BufferAttribute(Float32Array.from(pts), 3));
      const lines = new LineSegments(lg, new LineBasicMaterial({ color: 0xffd166, depthTest: false, transparent: true }));
      lines.renderOrder = SPRITE_ORDER + 1;
      lines.raycast = () => undefined;
      g.add(lines);
    }
    const knob = new Mesh(new BoxGeometry(0.16, 0.16, 0.16), new MeshBasicMaterial({ color: 0xffd166, depthTest: false, transparent: true }));
    knob.position.set(ax, ay, az);
    knob.rotation.set(Math.PI / 4, Math.PI / 4, 0);
    knob.renderOrder = SPRITE_ORDER + 2;
    knob.raycast = () => undefined;
    g.add(knob);
    this.joint = g;
    this.group.add(g);
  }

  /** Release everything. */
  dispose(): void {
    this.clearComponents();
    this.setJoint(null);
    if (this.brush) {
      this.brush.geometry.dispose();
      (this.brush.material as LineBasicMaterial).dispose();
      this.brush.removeFromParent();
      this.brush = null;
    }
    this.markerGeometry?.dispose();
    this.markerMaterial?.dispose();
    this.lineMaterial?.dispose();
    this.selLineMaterial?.dispose();
    this.faceMaterial?.dispose();
    this.group.removeFromParent();
  }
}
