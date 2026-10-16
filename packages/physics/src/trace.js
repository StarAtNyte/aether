/** Hard caps of {@link TraceOptions}. */
export const TRACE_LIMITS = Object.freeze({
    MAX_HZ: 30,
    MAX_BODIES: 64,
    MAX_TRACKED: 512,
    MAX_SECONDS: 20,
    /** Floats per body per frame: position xyz + quaternion xyzw. */
    STRIDE: 7,
});
function clampInt(v, def, lo, hi) {
    return typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : def;
}
function clampNum(v, def, lo, hi) {
    return typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : def;
}
/** Records poses of bodies that can move (dynamic, kinematic, logic-driven) during a run. */
export class TraceRecorder {
    /** Seconds between samples. */
    dt;
    minSeconds;
    maxBodies;
    minPath;
    maxFrames;
    ids;
    buf;
    path;
    frames = 0;
    nextAt = 0;
    p = [0, 0, 0];
    q = [0, 0, 0, 1];
    constructor(pw, opts = {}) {
        const hz = clampInt(opts.hz, 12, 1, TRACE_LIMITS.MAX_HZ);
        this.dt = 1 / hz;
        this.maxBodies = clampInt(opts.maxBodies, 16, 1, TRACE_LIMITS.MAX_BODIES);
        this.minPath = clampNum(opts.minPath, 0.2, 0, 1000);
        const seconds = clampNum(opts.maxSeconds, 10, 1, TRACE_LIMITS.MAX_SECONDS);
        this.minSeconds = clampNum(opts.minSeconds, 3, 0, seconds);
        this.maxFrames = Math.floor(seconds * hz) + 1;
        const maxTracked = clampInt(opts.maxTracked, 128, 1, TRACE_LIMITS.MAX_TRACKED);
        const ids = [];
        for (const [id, rec] of pw._records()) {
            if (ids.length >= maxTracked)
                break;
            // Static bodies with behaviours may be driven by logic (moving platforms become kinematic on first move).
            if (rec.type !== 'static' || rec.entity.behaviors.length > 0)
                ids.push(id);
        }
        this.ids = ids;
        this.buf = new Float32Array(ids.length * this.maxFrames * TRACE_LIMITS.STRIDE);
        this.path = new Float64Array(ids.length);
    }
    /** Bodies being recorded. */
    get tracked() {
        return this.ids.length;
    }
    /** Frames recorded so far. */
    get frameCount() {
        return this.frames;
    }
    /** Record a frame when `time` reached the next sample time (call after every step and once at t = 0). */
    sample(pw, time) {
        if (this.ids.length === 0 || this.frames >= this.maxFrames || time + 1e-9 < this.nextAt)
            return;
        const S = TRACE_LIMITS.STRIDE;
        const n = this.ids.length;
        const base = this.frames * n * S;
        const prev = base - n * S;
        for (let i = 0; i < n; i++) {
            const o = base + i * S;
            if (!pw.readPose(this.ids[i], this.p, this.q)) {
                // Body gone (despawned): hold its last pose.
                if (this.frames > 0)
                    for (let k = 0; k < S; k++)
                        this.buf[o + k] = this.buf[prev + i * S + k];
                continue;
            }
            this.buf[o] = this.p[0];
            this.buf[o + 1] = this.p[1];
            this.buf[o + 2] = this.p[2];
            this.buf[o + 3] = this.q[0];
            this.buf[o + 4] = this.q[1];
            this.buf[o + 5] = this.q[2];
            this.buf[o + 6] = this.q[3];
            if (this.frames > 0) {
                const po = prev + i * S;
                const dx = this.p[0] - this.buf[po];
                const dy = this.p[1] - this.buf[po + 1];
                const dz = this.p[2] - this.buf[po + 2];
                this.path[i] = this.path[i] + Math.sqrt(dx * dx + dy * dy + dz * dz);
            }
        }
        this.frames++;
        this.nextAt = this.frames * this.dt;
    }
    /** True while more frames are wanted for the replay. */
    wantsMore(time) {
        return this.ids.length > 0 && this.frames < this.maxFrames && time + 1e-9 < this.minSeconds;
    }
    /** The trace of the bodies that moved most, or undefined when nothing moved. */
    finish() {
        const n = this.ids.length;
        if (n === 0 || this.frames < 2)
            return undefined;
        const order = [];
        for (let i = 0; i < n; i++)
            if (this.path[i] >= this.minPath)
                order.push(i);
        if (order.length === 0)
            return undefined;
        order.sort((a, b) => this.path[b] - this.path[a] || a - b);
        const keep = order.slice(0, this.maxBodies).sort((a, b) => a - b);
        const S = TRACE_LIMITS.STRIDE;
        const k = keep.length;
        const out = new Float32Array(this.frames * k * S);
        for (let f = 0; f < this.frames; f++) {
            for (let j = 0; j < k; j++) {
                const src = (f * n + keep[j]) * S;
                out.set(this.buf.subarray(src, src + S), (f * k + j) * S);
            }
        }
        return { ids: keep.map((i) => this.ids[i]), dt: this.dt, frames: this.frames, poses: out };
    }
}
