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
import { BoxGeometry, BufferAttribute, BufferGeometry, Color, Group, InstancedMesh, LineBasicMaterial, LineSegments, Matrix4, Mesh, MeshBasicMaterial, Quaternion, Vector3, } from 'three';
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
    group = new Group();
    components = null;
    componentParent = null;
    markers = null;
    markerGeometry = null;
    markerMaterial = null;
    wire = null;
    selEdges = null;
    selFaces = null;
    lineMaterial = null;
    selLineMaterial = null;
    faceMaterial = null;
    brush = null;
    joint = null;
    view = null;
    markerScale = 0.02;
    constructor() {
        this.group.name = 'aether:edit-overlay';
    }
    // ---------------------------------------------------------------------------
    // Mesh components
    // ---------------------------------------------------------------------------
    /** Show (or with null hide) the components of the mesh being edited. */
    setComponents(view) {
        this.clearComponents();
        this.view = view;
        if (!view)
            return;
        const g = new Group();
        g.name = 'edit:components';
        g.matrixAutoUpdate = false;
        view.target.add(g);
        // Entity objects do not auto-update their matrices: give the overlay its world matrix now
        // (later moves of the entity update its children through the parent's flag).
        g.updateMatrixWorld(true);
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
            this.wire.updateMatrixWorld(true);
        }
        if (view.selectedFaces.length > 0) {
            const idx = [];
            const src = view.bundle.full.getIndex();
            if (src) {
                for (let i = 0; i < view.selectedFaces.length; i++) {
                    const t = view.selectedFaces[i];
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
            this.selFaces.updateMatrixWorld(true);
        }
        if (view.selectedEdges.length > 0) {
            const eg = new BufferGeometry();
            eg.setAttribute('position', view.bundle.position);
            eg.setIndex(new BufferAttribute(Uint32Array.from(view.selectedEdges), 1));
            this.selEdges = new LineSegments(eg, this.selLineMaterial);
            this.selEdges.raycast = () => undefined;
            this.selEdges.renderOrder = SPRITE_ORDER + 1;
            g.add(this.selEdges);
            this.selEdges.updateMatrixWorld(true);
        }
        this.buildMarkers(view);
    }
    buildMarkers(view) {
        const g = this.components;
        if (!g)
            return;
        const n = view.bundle.vertexCount;
        const selected = new Set();
        for (let i = 0; i < view.selectedVertices.length; i++)
            selected.add(view.selectedVertices[i]);
        const showAll = view.mode === 'vertex' && n <= MAX_VERTEX_MARKERS;
        const candidates = view.markerVertices;
        const list = showAll ? (candidates ? Array.from(candidates) : Array.from({ length: n }, (_, i) => i)) : [...selected];
        if (list.length === 0)
            return;
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
        for (let i = 0; i < list.length; i++)
            im.setColorAt(i, selected.has(list[i]) ? _accent : _white);
        if (im.instanceColor)
            im.instanceColor.needsUpdate = true;
        this.markers = im;
        g.add(im);
        im.updateMatrixWorld(true);
        this.refreshMarkers();
    }
    /** Re-place vertex markers after a live preview moved vertices (O(markers), allocation-free). */
    refreshMarkers() {
        const im = this.markers;
        const view = this.view;
        if (!im || !view)
            return;
        const list = im.userData['vertexList'];
        const pos = view.bundle.position.array;
        // Markers keep a constant size regardless of the entity's scale.
        view.target.updateWorldMatrix(true, false);
        view.target.matrixWorld.decompose(_p, _q, _s);
        const sx = this.markerScale / (Math.abs(_s.x) || 1);
        const sy = this.markerScale / (Math.abs(_s.y) || 1);
        const sz = this.markerScale / (Math.abs(_s.z) || 1);
        for (let i = 0; i < list.length; i++) {
            const v = list[i];
            _m.makeScale(sx, sy, sz).setPosition(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
            im.setMatrixAt(i, _m);
        }
        im.instanceMatrix.needsUpdate = true;
    }
    /** True while components are shown. */
    get editing() {
        return this.view !== null;
    }
    clearComponents() {
        for (const o of [this.wire, this.selEdges, this.selFaces])
            o?.geometry.dispose();
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
    setBrush(brush) {
        if (!brush) {
            if (this.brush)
                this.brush.visible = false;
            return;
        }
        if (!this.brush) {
            // A circle as line segments (WebGPU has no line loops).
            const segs = 64;
            const pts = new Float32Array(segs * 6);
            for (let i = 0; i < segs; i++) {
                const a0 = (i / segs) * Math.PI * 2;
                const a1 = ((i + 1) / segs) * Math.PI * 2;
                pts[i * 6] = Math.cos(a0);
                pts[i * 6 + 1] = Math.sin(a0);
                pts[i * 6 + 3] = Math.cos(a1);
                pts[i * 6 + 4] = Math.sin(a1);
            }
            const geo = new BufferGeometry();
            geo.setAttribute('position', new BufferAttribute(pts, 3));
            this.brush = new LineSegments(geo, new LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.9 }));
            this.brush.name = 'edit:brush';
            this.brush.renderOrder = SPRITE_ORDER + 3;
            this.brush.raycast = () => undefined;
            this.brush.frustumCulled = false;
            this.group.add(this.brush);
        }
        const b = this.brush;
        b.visible = true;
        _n.set(brush.normal[0], brush.normal[1], brush.normal[2]);
        if (_n.lengthSq() < 1e-12)
            _n.set(0, 1, 0);
        _n.normalize();
        b.quaternion.setFromUnitVectors(_up, _n);
        b.position.set(brush.point[0] + _n.x * 0.02, brush.point[1] + _n.y * 0.02, brush.point[2] + _n.z * 0.02);
        const r = Math.max(0.01, brush.radius);
        b.scale.set(r, r, r);
        b.material.color.setHex(brush.erase ? 0xff5a5a : 0xffffff);
    }
    // ---------------------------------------------------------------------------
    // Joints
    // ---------------------------------------------------------------------------
    /** Visualise a joint: anchor point, hinge / slide axis and a link to the target anchor (world space); null hides it. */
    setJoint(joint) {
        if (this.joint) {
            this.joint.traverse((o) => {
                const g = o.geometry;
                if (g)
                    g.dispose();
                const m = o.material;
                if (m && !Array.isArray(m))
                    m.dispose();
            });
            this.joint.removeFromParent();
            this.joint = null;
        }
        if (!joint)
            return;
        const g = new Group();
        g.name = 'edit:joint';
        const [ax, ay, az] = joint.anchor;
        const len = Math.max(1e-6, Math.hypot(joint.axis[0], joint.axis[1], joint.axis[2]));
        const L = 1.2;
        const pts = [];
        if (joint.type === 'revolute' || joint.type === 'prismatic') {
            const dx = (joint.axis[0] / len) * L;
            const dy = (joint.axis[1] / len) * L;
            const dz = (joint.axis[2] / len) * L;
            pts.push(ax - dx, ay - dy, az - dz, ax + dx, ay + dy, az + dz);
        }
        if (joint.target)
            pts.push(ax, ay, az, joint.target[0], joint.target[1], joint.target[2]);
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
    dispose() {
        this.clearComponents();
        this.setJoint(null);
        if (this.brush) {
            this.brush.geometry.dispose();
            this.brush.material.dispose();
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
