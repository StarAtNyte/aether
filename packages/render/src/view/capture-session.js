/**
 * Exclusive capture sessions: the renderer stops drawing the viewport,
 * resizes its drawing buffer to the capture size once (no per-frame
 * reallocation), hides editor decorations, and renders posed frames on
 * demand — for video export (one frame per call, advancing animations by
 * the frame time) and for high-resolution stills (tiles of a larger image
 * through camera view offsets, several frames per tile so temporal
 * anti-aliasing and ambient occlusion converge).
 *
 * The session owns one output buffer; every {@link CaptureSession.frame}
 * resolves to that same buffer (tight, top-down RGBA8, opaque), so a video
 * export allocates nothing per frame on this side.
 */
import { Vector3 } from 'three';
import { MAX_DRAW_SIZE, MAX_STILL_SIZE, MAX_TILE_SIZE, applyVignette, blitTile, downsample, normalizePixels, stillSize, tileLayout } from './still';
const _target = new Vector3();
/** Start a session on `host` (the renderer guarantees exclusivity). */
export function openCaptureSession(host, width, height, opts = {}) {
    const w = Math.max(16, Math.min(MAX_DRAW_SIZE, Math.floor(width)));
    const h = Math.max(16, Math.min(MAX_DRAW_SIZE, Math.floor(height)));
    const out = new Uint8Array(w * h * 4);
    const cam = host.camera;
    const saved = {
        pos: cam.position.clone(),
        quat: cam.quaternion.clone(),
        up: cam.up.clone(),
        fov: cam.fov,
        aspect: cam.aspect,
        zoom: cam.zoom,
        view: cam.view ? { ...cam.view } : null,
    };
    // Camera view offsets are owned by the session while it runs: temporal AA jitters through
    // setViewOffset / clearViewOffset, so both are wrapped to add the tile offset.
    const origSet = cam.setViewOffset;
    const origClear = cam.clearViewOffset;
    let region = null;
    const setOffset = function (fw, fh, ox, oy, vw, vh) {
        if (region)
            origSet.call(cam, region.fullWidth, region.fullHeight, region.x + ox, region.y + oy, vw, vh);
        else
            origSet.call(cam, fw, fh, ox, oy, vw, vh);
    };
    const clearOffset = function () {
        if (region)
            origSet.call(cam, region.fullWidth, region.fullHeight, region.x, region.y, w, h);
        else
            origClear.call(cam);
    };
    cam.setViewOffset = setOffset;
    cam.clearViewOffset = clearOffset;
    host.begin(w, h, opts.vignette !== false);
    let ended = false;
    let busy = false;
    const end = () => {
        if (ended)
            return;
        ended = true;
        cam.setViewOffset = origSet;
        cam.clearViewOffset = origClear;
        if (saved.view && saved.view.enabled)
            origSet.call(cam, saved.view.fullWidth, saved.view.fullHeight, saved.view.offsetX, saved.view.offsetY, saved.view.width, saved.view.height);
        else
            origClear.call(cam);
        cam.position.copy(saved.pos);
        cam.quaternion.copy(saved.quat);
        cam.up.copy(saved.up);
        cam.fov = saved.fov;
        cam.aspect = saved.aspect;
        cam.zoom = saved.zoom;
        cam.updateProjectionMatrix();
        cam.updateMatrixWorld();
        host.finish();
    };
    return {
        width: w,
        height: h,
        get ended() {
            return ended || !host.alive();
        },
        end,
        async frame(pose, o = {}) {
            if (ended || !host.alive())
                throw new Error('capture session ended');
            if (busy)
                throw new Error('capture frames must be awaited one at a time');
            busy = true;
            try {
                const v = o.view;
                region = v && Number.isFinite(v.fullWidth) && Number.isFinite(v.fullHeight) ? { fullWidth: Math.max(1, v.fullWidth), fullHeight: Math.max(1, v.fullHeight), x: v.x, y: v.y } : null;
                if (pose.pos.every(Number.isFinite) && pose.target.every(Number.isFinite)) {
                    cam.position.set(pose.pos[0], pose.pos[1], pose.pos[2]);
                    cam.up.set(0, 1, 0);
                    // A look straight up/down has no defined up: nudge the target sideways.
                    _target.set(pose.target[0], pose.target[1], pose.target[2]);
                    const dx = _target.x - cam.position.x;
                    const dz = _target.z - cam.position.z;
                    if (dx * dx + dz * dz < 1e-8)
                        _target.z += 1e-3;
                    cam.lookAt(_target);
                }
                if (pose.fov !== undefined && Number.isFinite(pose.fov))
                    cam.fov = Math.min(120, Math.max(5, pose.fov));
                cam.zoom = 1;
                cam.aspect = region ? region.fullWidth / region.fullHeight : w / h;
                if (region)
                    cam.setViewOffset(w, h, 0, 0, w, h);
                else
                    cam.clearViewOffset();
                cam.updateProjectionMatrix();
                cam.updateMatrixWorld();
                const frames = Math.max(1, Math.min(64, Math.floor(o.frames ?? 1)));
                const dt = Number.isFinite(o.dt) ? Math.max(0, Math.min(1, o.dt)) : 0;
                host.advance(dt);
                for (let i = 0; i < frames - 1; i++) {
                    host.drawToTarget(w, h);
                    // Let the browser breathe between accumulation frames (a long still never freezes the page).
                    if (i % 4 === 3)
                        await new Promise((r) => setTimeout(r, 0));
                    if (ended || !host.alive())
                        throw new Error('capture session ended');
                }
                const raw = await host.readback(w, h);
                if (ended)
                    throw new Error('capture session ended');
                return normalizePixels(raw, w, h, host.flipY, out);
            }
            finally {
                busy = false;
            }
        },
    };
}
/**
 * Render a still of any size up to {@link MAX_STILL_SIZE}: one draw when it
 * fits the tile size, otherwise overlapping tiles assembled on the CPU (the
 * vignette is then applied once to the whole image).
 */
export function stillLayout(opts) {
    const { width: OW, height: OH } = stillSize(opts.width, opts.height);
    if (Math.max(OW, OH) > MAX_STILL_SIZE)
        throw new Error('still too large');
    const wanted = Number.isFinite(opts.supersample) ? Math.max(1, Math.min(3, Math.floor(opts.supersample))) : 1;
    let ss = wanted;
    while (ss > 1 && Math.max(OW, OH) * ss > MAX_STILL_SIZE)
        ss--;
    const W = OW * ss;
    const H = OH * ss;
    const cap = Math.max(256, Math.min(MAX_DRAW_SIZE, Math.floor(opts.tileSize ?? MAX_TILE_SIZE)));
    const single = W <= cap && H <= cap;
    const tw = single ? W : Math.min(cap, W);
    const th = single ? H : Math.min(cap, H);
    return { OW, OH, ss, W, H, single, tw, th };
}
export async function captureStill(open, opts) {
    const { OW, OH, ss, W, H, single, tw, th } = stillLayout(opts);
    const tiles = tileLayout(W, H, tw, th);
    const session = open(tw, th, single);
    const image = single ? null : new Uint8Array(W * H * 4);
    try {
        let done = 0;
        for (const tile of tiles) {
            if (opts.signal?.aborted)
                throw new DOMException('cancelled', 'AbortError');
            const px = await session.frame(opts.pose, { frames: opts.frames ?? 1, ...(single ? {} : { view: { fullWidth: W, fullHeight: H, x: tile.rx, y: tile.ry } }) });
            if (single)
                return finish(px.slice(0, W * H * 4));
            blitTile(px, session.width, tile, image, W);
            opts.onProgress?.(++done, tiles.length);
        }
    }
    finally {
        session.end();
    }
    return finish(image);
    /** Filter the oversampled image down and, for an assembled image, apply the vignette once. */
    function finish(px) {
        const data = ss > 1 ? downsample(px, W, H, ss) : px;
        if (!single)
            applyVignette(data, OW, OH);
        return { width: OW, height: OH, data };
    }
}
