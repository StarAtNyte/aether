/**
 * Ghost run: the playtest bot's winning run replayed over the real, rendered
 * world as a translucent figure that walks (and jumps) along the recorded
 * path, with the whole route drawn as a line (the part already walked is
 * brighter) and a small marker where each pickup, door and goal happened.
 *
 * The replay is driven by a recorded trace (`@aether/playtest`
 * `PlaytestTrace`), so nothing is simulated again. Time is controlled from
 * outside: `seek`, `play`, `pause`, `setSpeed`; the renderer calls
 * {@link GhostRun.update} every frame while the run is active.
 *
 * Per-frame work is allocation-free (scratch vectors, in-place attribute
 * updates). The route geometry is built once per run and disposed when it
 * ends.
 */
import { BufferAttribute, BufferGeometry, Color, ConeGeometry, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, RingGeometry, SphereGeometry, } from 'three';
import { resolveLook } from '@aether/assets';
/** Floats per trace frame: x, y, z (feet), yaw in degrees. */
const STRIDE = 4;
/** Player capsule of the studio (metres). */
const RADIUS = 0.35;
/** Id of the ghost person inside the character system. */
const GHOST_ID = 'aether:ghost-run';
const FIGURE = new Color('#7fd6ff');
const ROUTE_AHEAD = new Color('#6b72ff');
const ROUTE_DONE = new Color('#c2ecff');
const MARKER = new Color('#ffd166');
/** Validate a trace's shape (lengths and finite values). Pure. */
export function validGhostTrace(t) {
    if (!t || !(t.poses instanceof Float32Array))
        return false;
    if (!Number.isInteger(t.frames) || t.frames < 2 || !(t.dt > 0) || !Number.isFinite(t.dt))
        return false;
    return t.poses.length === t.frames * STRIDE;
}
/** Pose of a trace at time `t` (seconds, clamped), written into `out` = [x, y, z, yawDeg]. Pure. */
export function ghostPoseAt(trace, t, out = [0, 0, 0, 0]) {
    const last = trace.frames - 1;
    const f = Math.max(0, Math.min(last, t / trace.dt));
    const i = Math.min(last - 1, Math.floor(f));
    const k = f - i;
    const a = i * STRIDE;
    const b = a + STRIDE;
    const p = trace.poses;
    out[0] = p[a] + (p[b] - p[a]) * k;
    out[1] = p[a + 1] + (p[b + 1] - p[a + 1]) * k;
    out[2] = p[a + 2] + (p[b + 2] - p[a + 2]) * k;
    // Shortest way round for the facing.
    const ya = p[a + 3];
    let d = ((p[b + 3] - ya + 540) % 360) - 180;
    if (!Number.isFinite(d))
        d = 0;
    out[3] = ya + d * k;
    return out;
}
/** Plays a recorded playtest run as a ghost player in the scene. */
export class GhostRun {
    /** Everything of the ghost (add to the scene once). */
    group = new Group();
    figure = new Group();
    system = null;
    person = null;
    personMats = [];
    mounting = false;
    nose;
    ring;
    noseMat = new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8, depthWrite: false });
    ringMat = new MeshBasicMaterial({ color: FIGURE, transparent: true, opacity: 0.45, depthWrite: false });
    routeMat = new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false });
    markerMat = new MeshBasicMaterial({ color: MARKER, transparent: true, opacity: 0.85, depthWrite: false });
    route = null;
    colors = null;
    markers = [];
    markerTimes = [];
    trace = null;
    clock = 0;
    duration = 0;
    speed = 1;
    isPlaying = false;
    shownUpTo = -1;
    scratch = [0, 0, 0, 0];
    onEnd = null;
    /** Live mode: the figure follows positions reported while the bot is still playing (no recording yet). */
    liveTarget = null;
    liveYaw = 0;
    constructor() {
        this.group.name = 'aether:ghost-run';
        this.group.renderOrder = 11;
        this.nose = new Mesh(new ConeGeometry(0.12, 0.3, 10), this.noseMat);
        // The cone points to the figure's front (−Z): lay it on its side.
        this.nose.rotation.x = -Math.PI / 2;
        this.nose.position.set(0, 0.06, -(RADIUS * 1.9));
        this.ring = new Mesh(new RingGeometry(RADIUS * 1.1, RADIUS * 1.5, 28), this.ringMat);
        this.ring.rotation.x = -Math.PI / 2;
        this.ring.position.y = 0.03;
        // The figure is a real person (see setSystem); until it is mounted only the
        // heading cone and the ground ring mark where the bot is: no capsule stand-in.
        this.figure.add(this.nose, this.ring);
        this.figure.visible = false;
        this.group.add(this.figure);
        this.group.visible = false;
    }
    /** Give the ghost the scene's character system: the figure is then a translucent person, not a shape. */
    setSystem(system) {
        this.system = system;
    }
    /** Mount the person (once, on first use); the cone and ring stay as the position marker. */
    mountPerson() {
        const system = this.system;
        if (!system || this.person || this.mounting)
            return;
        this.mounting = true;
        const look = resolveLook({ wardrobe: 'traveller' }, 'ghost-run');
        void system
            .add(GHOST_ID, look, this.figure, { footOffset: 0, track: this.figure, castShadow: false, autoMotion: true })
            .then((rig) => {
            this.mounting = false;
            if (!rig)
                return;
            if (this.system !== system || !this.figure.parent) {
                system.remove(GHOST_ID);
                return;
            }
            this.person = rig;
            rig.root.traverse((o) => {
                const m = o;
                if (!m.isMesh)
                    return;
                m.castShadow = false;
                m.receiveShadow = false;
                const make = (src) => {
                    const c = new MeshBasicMaterial({ color: FIGURE, transparent: true, opacity: 0.55, depthWrite: false });
                    const map = src.map;
                    if (map)
                        c.map = map;
                    this.personMats.push(c);
                    return c;
                };
                m.material = Array.isArray(m.material) ? m.material.map(make) : make(m.material);
                m.renderOrder = 11;
            });
        })
            .catch(() => {
            this.mounting = false;
        });
    }
    unmountPerson() {
        if (this.person)
            this.system?.remove(GHOST_ID);
        this.person = null;
        for (const m of this.personMats)
            m.dispose();
        this.personMats = [];
    }
    /** True while a run is loaded (the renderer keeps drawing while it plays). */
    get active() {
        return this.trace !== null || this.liveTarget !== null;
    }
    /** True while time advances on its own. */
    get playing() {
        return this.isPlaying;
    }
    /** Current time in seconds. */
    get time() {
        return this.clock;
    }
    /** Length of the run in seconds. */
    get length() {
        return this.duration;
    }
    /** Playback speed multiplier. */
    get rate() {
        return this.speed;
    }
    /**
     * Load a run and start at its beginning. Returns false for a malformed
     * trace. `onEnd` is called once when playback reaches the end.
     */
    start(trace, opts = {}) {
        this.stop();
        if (!validGhostTrace(trace))
            return false;
        this.liveTarget = null;
        this.trace = trace;
        this.duration = (trace.frames - 1) * trace.dt;
        this.clock = 0;
        this.speed = Number.isFinite(opts.speed) && opts.speed > 0 ? Math.min(16, opts.speed) : 1;
        this.isPlaying = opts.autoplay !== false;
        this.onEnd = opts.onEnd ?? null;
        this.buildRoute(trace);
        this.buildMarkers(trace);
        this.group.visible = true;
        this.figure.visible = true;
        this.mountPerson();
        this.shownUpTo = -1;
        this.apply();
        return true;
    }
    /** Where the figure stands now (feet), or null. */
    position() {
        if (!this.trace)
            return null;
        return [this.figure.position.x, this.figure.position.y, this.figure.position.z];
    }
    /** Jump to a time (clamped) and show that moment. */
    seek(t) {
        if (!this.trace)
            return;
        this.clock = Math.max(0, Math.min(this.duration, Number.isFinite(t) ? t : 0));
        this.apply();
    }
    /** Resume (restarts from the beginning when the run had ended). */
    play() {
        if (!this.trace)
            return;
        if (this.clock >= this.duration - 1e-6)
            this.clock = 0;
        this.isPlaying = true;
    }
    /** Pause on the current moment. */
    pause() {
        this.isPlaying = false;
    }
    /** Playback speed (clamped to 0.1–16). */
    setSpeed(v) {
        if (Number.isFinite(v) && v > 0)
            this.speed = Math.max(0.1, Math.min(16, v));
    }
    /**
     * Show the figure at a position reported while the bot is still playing
     * (before there is a recording). The figure glides to each new position and
     * turns toward where it is heading. Ignored while a recorded run is loaded.
     */
    live(x, y, z) {
        if (this.trace || ![x, y, z].every(Number.isFinite))
            return;
        if (this.liveTarget === null) {
            this.figure.position.set(x, y, z);
            this.figure.visible = true;
            this.group.visible = true;
            this.mountPerson();
        }
        else {
            const dx = x - this.liveTarget[0];
            const dz = z - this.liveTarget[2];
            if (dx * dx + dz * dz > 0.0004)
                this.liveYaw = (Math.atan2(-dx, -dz) * 180) / Math.PI;
        }
        this.liveTarget = [x, y, z];
    }
    /** Remove the live figure. */
    stopLive() {
        if (this.liveTarget === null)
            return;
        this.liveTarget = null;
        if (!this.trace) {
            this.figure.visible = false;
            this.group.visible = false;
        }
    }
    /** Advance by `dt` real seconds. Returns true while the picture changed. */
    update(dt) {
        if (!this.trace && this.liveTarget) {
            const k = 1 - Math.exp(-12 * Math.max(0, dt));
            const t = this.liveTarget;
            const f = this.figure;
            const moved = Math.abs(t[0] - f.position.x) + Math.abs(t[1] - f.position.y) + Math.abs(t[2] - f.position.z);
            f.position.x += (t[0] - f.position.x) * k;
            f.position.y += (t[1] - f.position.y) * k;
            f.position.z += (t[2] - f.position.z) * k;
            const want = (this.liveYaw * Math.PI) / 180;
            let d = ((want - f.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
            if (!Number.isFinite(d))
                d = 0;
            f.rotation.y += d * k;
            return moved > 1e-3;
        }
        if (!this.trace || !this.isPlaying)
            return false;
        this.clock = Math.min(this.duration, this.clock + Math.max(0, dt) * this.speed);
        this.apply();
        if (this.clock >= this.duration - 1e-6) {
            this.isPlaying = false;
            const cb = this.onEnd;
            this.onEnd = null;
            cb?.();
        }
        return true;
    }
    /** Remove the ghost and free its geometry. */
    stop() {
        this.liveTarget = null;
        this.isPlaying = false;
        this.trace = null;
        this.onEnd = null;
        this.clock = 0;
        this.duration = 0;
        this.figure.visible = false;
        this.group.visible = false;
        this.unmountPerson();
        this.disposeRoute();
    }
    /** Free everything (the renderer is going away). */
    dispose() {
        this.stop();
        this.unmountPerson();
        this.nose.geometry.dispose();
        this.ring.geometry.dispose();
        this.noseMat.dispose();
        this.ringMat.dispose();
        this.routeMat.dispose();
        this.markerMat.dispose();
    }
    apply() {
        const trace = this.trace;
        if (!trace)
            return;
        const p = ghostPoseAt(trace, this.clock, this.scratch);
        this.figure.position.set(p[0], p[1], p[2]);
        this.figure.rotation.y = ((p[3] * Math.PI) / 180);
        // A jump shows as the ring staying on the ground while the body rises: nothing more to do.
        this.updateRoute();
        for (let i = 0; i < this.markers.length; i++) {
            const m = this.markers[i];
            const reached = this.clock + 1e-6 >= this.markerTimes[i];
            m.scale.setScalar(reached ? 1 : 0.55);
            m.material.opacity = reached ? 0.95 : 0.4;
        }
    }
    buildRoute(trace) {
        this.disposeRoute();
        const segs = trace.frames - 1;
        const positions = new Float32Array(segs * 6);
        const colors = new Float32Array(segs * 6);
        for (let f = 0; f < segs; f++) {
            const a = f * STRIDE;
            const b = (f + 1) * STRIDE;
            const o = f * 6;
            positions[o] = trace.poses[a];
            positions[o + 1] = trace.poses[a + 1] + 0.05;
            positions[o + 2] = trace.poses[a + 2];
            positions[o + 3] = trace.poses[b];
            positions[o + 4] = trace.poses[b + 1] + 0.05;
            positions[o + 5] = trace.poses[b + 2];
            for (let k = 0; k < 6; k += 3) {
                colors[o + k] = ROUTE_AHEAD.r;
                colors[o + k + 1] = ROUTE_AHEAD.g;
                colors[o + k + 2] = ROUTE_AHEAD.b;
            }
        }
        const geo = new BufferGeometry();
        geo.setAttribute('position', new BufferAttribute(positions, 3));
        geo.setAttribute('color', new BufferAttribute(colors, 3));
        geo.computeBoundingSphere();
        this.colors = colors;
        this.route = new LineSegments(geo, this.routeMat);
        this.route.frustumCulled = false;
        this.group.add(this.route);
    }
    /** Brighten the part of the route already walked (only the segments that changed). */
    updateRoute() {
        const trace = this.trace;
        const route = this.route;
        const colors = this.colors;
        if (!trace || !route || !colors)
            return;
        const upTo = Math.min(trace.frames - 1, Math.floor(this.clock / trace.dt));
        if (upTo === this.shownUpTo)
            return;
        const lo = Math.min(upTo, this.shownUpTo < 0 ? 0 : this.shownUpTo);
        const hi = Math.max(upTo, this.shownUpTo < 0 ? upTo : this.shownUpTo);
        for (let f = Math.max(0, lo - 1); f <= Math.min(trace.frames - 2, hi); f++) {
            const c = f < upTo ? ROUTE_DONE : ROUTE_AHEAD;
            const o = f * 6;
            for (let k = 0; k < 6; k += 3) {
                colors[o + k] = c.r;
                colors[o + k + 1] = c.g;
                colors[o + k + 2] = c.b;
            }
        }
        this.shownUpTo = upTo;
        route.geometry.getAttribute('color').needsUpdate = true;
    }
    buildMarkers(trace) {
        const geo = new SphereGeometry(0.16, 10, 8);
        for (const e of trace.events.slice(0, 200)) {
            if (e.kind === 'start' || e.kind === 'stuck' || e.kind === 'fall')
                continue;
            const m = new Mesh(geo, this.markerMat.clone());
            m.position.set(e.position[0], e.position[1] + 1.0, e.position[2]);
            this.markers.push(m);
            this.markerTimes.push(e.t);
            this.group.add(m);
        }
        if (this.markers.length === 0)
            geo.dispose();
    }
    disposeRoute() {
        if (this.route) {
            this.group.remove(this.route);
            this.route.geometry.dispose();
            this.route = null;
            this.colors = null;
        }
        if (this.markers.length > 0) {
            this.markers[0].geometry.dispose();
            for (const m of this.markers) {
                this.group.remove(m);
                m.material.dispose();
            }
            this.markers = [];
            this.markerTimes = [];
        }
    }
}
