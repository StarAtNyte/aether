const RAD = 180 / Math.PI;
const round = (v, step) => Math.round(v / step) * step;
/** Local transform of an object as document values (rounded to keep documents tidy). */
export function readTransform(o, mode) {
    return {
        position: [round(o.position.x, 0.001), round(o.position.y, 0.001), round(o.position.z, 0.001)],
        rotation: [round(o.rotation.x * RAD, 0.01), round(o.rotation.y * RAD, 0.01), round(o.rotation.z * RAD, 0.01)],
        scale: [Math.max(0.001, round(o.scale.x, 0.001)), Math.max(0.001, round(o.scale.y, 0.001)), Math.max(0.001, round(o.scale.z, 0.001))],
        mode,
    };
}
/** Editor transform gizmo. See module docs. */
export class TransformGizmo {
    create;
    addHelper;
    orbit;
    requestRender;
    tc = null;
    loading = null;
    onCommit = null;
    mode = 'translate';
    disposed = false;
    /**
     * @param create factory for the controls (dynamic import of TransformControls in the renderer)
     * @param addHelper adds the gizmo's helper object to the scene
     * @param orbit the camera controls disabled while dragging
     * @param requestRender marks the next on-demand frame dirty
     */
    constructor(create, addHelper, orbit, requestRender) {
        this.create = create;
        this.addHelper = addHelper;
        this.orbit = orbit;
        this.requestRender = requestRender;
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
            });
            tc.addEventListener('mouseUp', () => {
                const o = tc.object;
                if (o && this.onCommit)
                    this.onCommit(readTransform(o, this.mode));
            });
            this.addHelper(tc.getHelper());
            this.tc = tc;
            return tc;
        }, () => null);
        return this.loading;
    }
    /** Attach to an object in a mode; `onCommit` receives the transform after each drag. */
    async attach(object, mode, onCommit) {
        const tc = await this.ensure();
        if (!tc || this.disposed)
            return;
        this.mode = mode;
        this.onCommit = onCommit;
        tc.setMode(mode);
        if (tc.object !== object)
            tc.attach(object);
        tc.getHelper().visible = true;
        this.requestRender();
    }
    /** Detach (no gizmo shown). */
    detach() {
        this.onCommit = null;
        if (!this.tc)
            return;
        if (this.tc.object)
            this.tc.detach();
        this.tc.getHelper().visible = false;
        if (this.orbit)
            this.orbit.enabled = true;
        this.requestRender();
    }
    /** The attached object (undefined when detached). */
    get object() {
        return this.tc?.object;
    }
    /** True while a handle is hovered or dragged: a click must not change the selection. */
    get busy() {
        return !!this.tc && !!this.tc.object && (this.tc.dragging || this.tc.axis !== null);
    }
    /** The helper object (hidden during captures), or null before first use. */
    get helper() {
        return this.tc ? this.tc.getHelper() : null;
    }
    /** Release the controls and their GPU resources. */
    dispose() {
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
export async function createTransformControls(camera, canvas) {
    const { TransformControls } = await import('three/addons/controls/TransformControls.js');
    return new TransformControls(camera, canvas);
}
