/**
 * Move / rotate / scale gizmo for one or many selected objects, on both
 * backends. three's TransformControls drives an invisible PIVOT object; the
 * pivot's change since the drag started is applied to every target's world
 * matrix (render-only, allocation-free per pointer move), and on release
 * each target's new LOCAL transform is reported once, so a drag of any
 * number of objects is one undoable edit.
 *
 * Options: world/local space, pivot (selection centre, active object
 * origin, or each object about its own origin), grid / angle / scale
 * snapping, surface snapping (the selection rests on whatever is under the
 * pointer) and vertex snapping (the pivot jumps to the nearest vertex of the
 * triangle under the pointer).
 */
import { Box3, Matrix4, Object3D, Quaternion, Vector3 } from 'three';
const RAD = 180 / Math.PI;
const round = (v, step) => Math.round(v / step) * step;
// Scratch (pointer moves must not allocate).
const _delta = new Matrix4();
const _inv = new Matrix4();
const _m = new Matrix4();
const _t = new Matrix4();
const _pos = new Vector3();
const _quat = new Quaternion();
const _scale = new Vector3();
const _box = new Box3();
const _one = new Box3();
/** Read a local transform as document values (rounded to keep documents tidy). */
export function readLocal(id, o) {
    return {
        id,
        position: [round(o.position.x, 0.001), round(o.position.y, 0.001), round(o.position.z, 0.001)],
        rotation: [round(o.rotation.x * RAD, 0.01), round(o.rotation.y * RAD, 0.01), round(o.rotation.z * RAD, 0.01)],
        scale: [Math.max(0.001, round(o.scale.x, 0.001)), Math.max(0.001, round(o.scale.y, 0.001)), Math.max(0.001, round(o.scale.z, 0.001))],
    };
}
/** Drop targets whose ancestor is also a target (moving the parent already moves them). */
export function topLevelTargets(targets) {
    const set = new Set(targets.map((t) => t.object));
    return targets.filter((t) => {
        for (let o = t.object.parent; o; o = o.parent)
            if (set.has(o))
                return false;
        return true;
    });
}
/** Multi-object transform gizmo. See the module docs. */
export class SelectionGizmo {
    create;
    addToScene;
    orbit;
    requestRender;
    snapHit;
    tc = null;
    loading = null;
    pivot = new Object3D();
    targets = [];
    targetObjects = [];
    targetIds = [];
    start = [];
    parentInv = [];
    pivotStart = new Matrix4();
    pivotStartInv = new Matrix4();
    /** Height of the pivot above the selection's lowest point (surface snap keeps objects on top). */
    pivotLift = 0;
    mode = 'translate';
    opts = { space: 'world', pivot: 'center', translationSnap: null, rotationSnapDeg: null, scaleSnap: null, surfaceSnap: false, vertexSnap: false };
    onCommit = null;
    onLive = null;
    disposed = false;
    /**
     * @param create factory for the controls (TransformControls bound to camera + canvas)
     * @param addToScene adds the gizmo helper and the pivot to the scene
     * @param orbit camera controls disabled while dragging
     * @param requestRender marks the next on-demand frame dirty
     * @param snapHit raycast under the pointer for surface / vertex snapping (targets excluded)
     */
    constructor(create, addToScene, orbit, requestRender, snapHit = () => null) {
        this.create = create;
        this.addToScene = addToScene;
        this.orbit = orbit;
        this.requestRender = requestRender;
        this.snapHit = snapHit;
        this.pivot.name = 'aether:gizmo-pivot';
    }
    ensure() {
        if (this.tc)
            return Promise.resolve(this.tc);
        this.loading ??= this.create().then((tc) => {
            if (this.disposed) {
                tc.dispose();
                return null;
            }
            tc.setSize(0.85);
            tc.addEventListener('change', () => this.requestRender());
            tc.addEventListener('dragging-changed', (e) => {
                if (this.orbit)
                    this.orbit.enabled = e.value !== true;
                if (e.value === true)
                    this.beginDrag();
            });
            tc.addEventListener('objectChange', () => this.applyDrag());
            tc.addEventListener('mouseUp', () => this.endDrag());
            this.addToScene(tc.getHelper());
            this.addToScene(this.pivot);
            this.tc = tc;
            this.applyOptions();
            return tc;
        }, () => null);
        return this.loading;
    }
    /**
     * Attach to targets in a mode. `onCommit` receives the new local
     * transforms after each drag; `onLive` (optional) is told which targets
     * moved during a drag (e.g. to refresh overlays).
     */
    async attach(targets, mode, opts, onCommit, onLive) {
        const tc = await this.ensure();
        if (!tc || this.disposed)
            return;
        if (tc.dragging)
            return;
        this.targets = topLevelTargets(targets);
        this.targetObjects = this.targets.map((t) => t.object);
        this.targetIds = this.targets.map((t) => t.id);
        if (this.targets.length === 0) {
            this.detach();
            return;
        }
        this.mode = mode;
        this.onCommit = onCommit;
        this.onLive = onLive ?? null;
        this.setOptions(opts);
        tc.setMode(mode);
        this.placePivot();
        if (tc.object !== this.pivot)
            tc.attach(this.pivot);
        tc.getHelper().visible = true;
        this.requestRender();
    }
    /** Change behaviour (also while dragging: e.g. a held modifier toggles snapping). */
    setOptions(opts) {
        this.opts = {
            space: opts.space ?? 'world',
            pivot: opts.pivot ?? 'center',
            translationSnap: positiveOrNull(opts.translationSnap),
            rotationSnapDeg: positiveOrNull(opts.rotationSnapDeg),
            scaleSnap: positiveOrNull(opts.scaleSnap),
            surfaceSnap: opts.surfaceSnap === true,
            vertexSnap: opts.vertexSnap === true,
        };
        this.applyOptions();
    }
    applyOptions() {
        const tc = this.tc;
        if (!tc)
            return;
        tc.setSpace(this.opts.space);
        // Surface / vertex snapping replace the grid while translating.
        tc.setTranslationSnap(this.opts.surfaceSnap || this.opts.vertexSnap ? null : this.opts.translationSnap);
        tc.setRotationSnap(this.opts.rotationSnapDeg !== null ? this.opts.rotationSnapDeg / RAD : null);
        tc.setScaleSnap(this.opts.scaleSnap);
    }
    /** Put the pivot at the selection centre / active origin, oriented for local space. */
    placePivot() {
        const first = this.targets[0];
        if (!first)
            return;
        _box.makeEmpty();
        for (const t of this.targets) {
            t.object.updateWorldMatrix(true, true);
            _one.setFromObject(t.object);
            if (!_one.isEmpty())
                _box.union(_one);
        }
        first.object.getWorldPosition(_pos);
        if (this.opts.pivot === 'center' && this.targets.length > 1 && !_box.isEmpty())
            _box.getCenter(_pos);
        this.pivot.position.copy(_pos);
        if (this.opts.space === 'local')
            first.object.getWorldQuaternion(this.pivot.quaternion);
        else
            this.pivot.quaternion.identity();
        this.pivot.scale.set(1, 1, 1);
        this.pivot.updateMatrixWorld(true);
        this.pivotLift = _box.isEmpty() ? 0 : _pos.y - _box.min.y;
    }
    beginDrag() {
        this.pivot.updateMatrixWorld(true);
        this.pivotStart.copy(this.pivot.matrixWorld);
        this.pivotStartInv.copy(this.pivotStart).invert();
        while (this.start.length < this.targets.length)
            this.start.push(new Matrix4());
        while (this.parentInv.length < this.targets.length)
            this.parentInv.push(new Matrix4());
        for (let i = 0; i < this.targets.length; i++) {
            const o = this.targets[i].object;
            o.updateWorldMatrix(true, false);
            this.start[i].copy(o.matrixWorld);
            const p = this.parentInv[i];
            if (o.parent)
                p.copy(o.parent.matrixWorld).invert();
            else
                p.identity();
        }
    }
    applyDrag() {
        const tc = this.tc;
        if (!tc || !tc.dragging || this.targets.length === 0)
            return;
        if (this.mode === 'translate' && (this.opts.surfaceSnap || this.opts.vertexSnap)) {
            const hit = this.snapHit(this.targetObjects);
            if (hit) {
                if (this.opts.vertexSnap && hit.vertex)
                    this.pivot.position.copy(hit.vertex);
                else
                    this.pivot.position.set(hit.point.x, hit.point.y + this.pivotLift, hit.point.z);
            }
        }
        this.pivot.updateMatrixWorld(true);
        _delta.multiplyMatrices(this.pivot.matrixWorld, this.pivotStartInv);
        const individual = this.opts.pivot === 'individual' && this.mode !== 'translate';
        for (let i = 0; i < this.targets.length; i++) {
            const t = this.targets[i];
            const start = this.start[i];
            if (individual) {
                // Rotate / scale each object about its own origin: T(o) · L · T(−o) · M.
                _pos.setFromMatrixPosition(start);
                _m.copy(_delta).setPosition(0, 0, 0);
                _t.makeTranslation(_pos.x, _pos.y, _pos.z).multiply(_m);
                _inv.makeTranslation(-_pos.x, -_pos.y, -_pos.z);
                _t.multiply(_inv).multiply(start);
            }
            else {
                _t.multiplyMatrices(_delta, start);
            }
            _m.multiplyMatrices(this.parentInv[i], _t);
            _m.decompose(t.object.position, _quat, _scale);
            t.object.quaternion.copy(_quat);
            t.object.scale.copy(_scale);
            t.object.updateMatrix();
            t.object.updateMatrixWorld(true);
        }
        this.onLive?.(this.targetIds);
        this.requestRender();
    }
    endDrag() {
        if (!this.onCommit || this.targets.length === 0)
            return;
        const changes = this.targets.map((t) => readLocal(t.id, t.object));
        const commit = this.onCommit;
        // Next drag starts from the new pose.
        this.placePivot();
        commit({ mode: this.mode, changes });
    }
    /** Detach (no gizmo shown). */
    detach() {
        this.onCommit = null;
        this.onLive = null;
        this.targets = [];
        this.targetObjects = [];
        this.targetIds = [];
        if (!this.tc)
            return;
        if (this.tc.object)
            this.tc.detach();
        this.tc.getHelper().visible = false;
        if (this.orbit)
            this.orbit.enabled = true;
        this.requestRender();
    }
    /** Ids currently attached. */
    get ids() {
        return this.targetIds;
    }
    /** True while a handle is hovered or dragged: a click must not change the selection. */
    get busy() {
        return !!this.tc && !!this.tc.object && (this.tc.dragging || this.tc.axis !== null);
    }
    /** True while a handle is being dragged. */
    get dragging() {
        return !!this.tc && this.tc.dragging;
    }
    /** The helper object (hidden during captures), or null before first use. */
    get helper() {
        return this.tc ? this.tc.getHelper() : null;
    }
    /** Release the controls and their GPU resources. */
    dispose() {
        this.disposed = true;
        this.onCommit = null;
        this.onLive = null;
        this.targets = [];
        if (this.tc) {
            this.tc.detach();
            this.tc.getHelper().removeFromParent();
            this.tc.dispose();
            this.tc = null;
        }
        this.pivot.removeFromParent();
    }
}
function positiveOrNull(v) {
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}
/** Default factory: three's TransformControls bound to a camera and canvas. */
export async function createSelectionControls(camera, canvas) {
    const { TransformControls } = await import('three/addons/controls/TransformControls.js');
    return new TransformControls(camera, canvas);
}
