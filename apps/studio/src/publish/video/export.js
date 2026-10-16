import { CompiledPath, newPose } from '../cameraPath';
import { Mp4Muxer } from './mp4';
import { playMusic, renderMusic, musicSeed, MUSIC_SAMPLE_RATE } from './music';
import { drawOverlay } from './titles';
import { WebmMuxer } from './webm';
/** Limits. */
export const VIDEO_LIMITS = Object.freeze({ maxSeconds: 120, maxSide: 1920, fps: [24, 30, 60] });
/** Bitrate for a resolution and frame rate (bits per second). */
export function videoBitrate(width, height, fps) {
    const bpp = 0.12; // bits per pixel per frame: crisp for synthetic imagery
    return Math.round(Math.min(40_000_000, Math.max(1_500_000, width * height * fps * bpp)));
}
/** Even dimensions (most encoders require them). */
export function evenSize(n) {
    const v = Math.max(16, Math.min(VIDEO_LIMITS.maxSide, Math.round(Number.isFinite(n) ? n : 1280)));
    return v - (v % 2);
}
/** H.264 codec strings to try (profile/level fitting the frame size). */
export function h264Candidates(width, height) {
    const mb = Math.ceil(width / 16) * Math.ceil(height / 16);
    // Level 3.1 ≤ 3600 MBs, 4.0 ≤ 8192, 4.2 for 60 fps at 1080p.
    const level = mb <= 3600 ? '1f' : '2a';
    return [`avc1.6400${level}`, `avc1.4d00${level}`, `avc1.4200${level}`];
}
/** WebM codecs to try, best first. */
export const WEBM_CANDIDATES = [
    { codec: 'vp09.00.41.08', id: 'V_VP9' },
    { codec: 'vp09.00.31.08', id: 'V_VP9' },
    { codec: 'vp8', id: 'V_VP8' },
];
/** True when this browser can play `type` (a `video/…; codecs=…` string) back. */
export function canPlayHere(type) {
    if (typeof document === 'undefined')
        return true;
    try {
        return document.createElement('video').canPlayType(type) !== '';
    }
    catch {
        return false;
    }
}
/**
 * Pick the encoder configuration (null when WebCodecs cannot encode here).
 * `auto` prefers MP4 (H.264) — the most widely accepted file — but only
 * when this browser can also play it back (a browser may ship an H.264
 * encoder without a decoder); otherwise WebM.
 */
export async function chooseVideoCodec(width, height, fps, format, canPlay = canPlayHere) {
    if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined')
        return null;
    const bitrate = videoBitrate(width, height, fps);
    const tryConfig = async (config) => {
        try {
            const r = await VideoEncoder.isConfigSupported(config);
            return r.supported === true;
        }
        catch {
            return false;
        }
    };
    const mp4 = async () => {
        for (const codec of h264Candidates(width, height)) {
            if (await tryConfig({ codec, width, height, bitrate, framerate: fps, avc: { format: 'avc' } }))
                return { container: 'mp4', codec };
        }
        return null;
    };
    const webm = async () => {
        for (const c of WEBM_CANDIDATES) {
            if (await tryConfig({ codec: c.codec, width, height, bitrate, framerate: fps }))
                return { container: 'webm', codec: c.codec, id: c.id };
        }
        return null;
    };
    if (format === 'webm')
        return (await webm()) ?? (await mp4());
    if (format === 'mp4')
        return (await mp4()) ?? (await webm());
    const m = await mp4();
    if (m && canPlay(`video/mp4; codecs="${m.codec}, opus"`))
        return m;
    return (await webm()) ?? m;
}
function abortError() {
    return new DOMException('cancelled', 'AbortError');
}
/** Opus pre-skip from an encoder's OpusHead description (default 312). */
function preSkipOf(description) {
    if (!description)
        return 312;
    const b = description instanceof ArrayBuffer ? new Uint8Array(description) : new Uint8Array(description.buffer, description.byteOffset, description.byteLength);
    if (b.byteLength >= 12 && String.fromCharCode(...b.subarray(0, 8)) === 'OpusHead')
        return b[10] | (b[11] << 8);
    return 312;
}
/** Encode `buffer` as Opus packets (null when AudioEncoder/Opus is unavailable). */
async function encodeOpus(buffer, signal) {
    if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined')
        return null;
    const config = { codec: 'opus', sampleRate: MUSIC_SAMPLE_RATE, numberOfChannels: 2, bitrate: 128_000 };
    try {
        if (!(await AudioEncoder.isConfigSupported(config)).supported)
            return null;
    }
    catch {
        return null;
    }
    const chunks = [];
    let preSkip = 312;
    let failure = null;
    const enc = new AudioEncoder({
        output: (chunk, meta) => {
            const data = new Uint8Array(chunk.byteLength);
            chunk.copyTo(data);
            chunks.push({ timestampUs: chunk.timestamp, durationUs: chunk.duration ?? 20_000, data });
            if (meta?.decoderConfig?.description)
                preSkip = preSkipOf(meta.decoderConfig.description);
        },
        error: (e) => {
            failure = e;
        },
    });
    enc.configure(config);
    const frames = buffer.length;
    const block = 4800;
    const left = buffer.getChannelData(0);
    const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
    const planar = new Float32Array(block * 2);
    for (let at = 0; at < frames; at += block) {
        if (signal?.aborted) {
            enc.close();
            throw abortError();
        }
        const n = Math.min(block, frames - at);
        const data = n === block ? planar : new Float32Array(n * 2);
        data.set(left.subarray(at, at + n), 0);
        data.set(right.subarray(at, at + n), n);
        const ad = new AudioData({ format: 'f32-planar', sampleRate: MUSIC_SAMPLE_RATE, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((at * 1e6) / MUSIC_SAMPLE_RATE), data });
        enc.encode(ad);
        ad.close();
    }
    await enc.flush();
    enc.close();
    if (failure)
        return null;
    return { chunks, preSkip };
}
/** Wait until the encoder's queue drains below `max` (back-pressure). */
async function drain(enc, max, signal) {
    while (enc.encodeQueueSize > max) {
        if (signal?.aborted)
            throw abortError();
        await new Promise((resolve) => {
            const done = () => {
                enc.removeEventListener('dequeue', done);
                resolve();
            };
            enc.addEventListener('dequeue', done);
            setTimeout(done, 50);
        });
    }
}
/** Export a video (see module docs). */
export async function exportVideo(source, opts) {
    const width = evenSize(opts.width);
    const height = evenSize(opts.height);
    const fps = VIDEO_LIMITS.fps.includes(opts.fps) ? opts.fps : 30;
    const seconds = Math.min(VIDEO_LIMITS.maxSeconds, Math.max(0.5, opts.path.duration));
    const frames = Math.max(1, Math.round(seconds * fps));
    const signal = opts.signal;
    const report = (phase, frame) => opts.onProgress?.({ phase, frame, frames });
    report('preparing', 0);
    if (signal?.aborted)
        throw abortError();
    const choice = await chooseVideoCodec(width, height, fps, opts.format);
    if (!choice)
        return recordRealtime(source, { ...opts, width, height, fps }, seconds);
    // Soundtrack first (fast, offline), so a missing audio encoder is known before rendering.
    let audio = null;
    if (opts.music) {
        try {
            const buf = await renderMusic(opts.music.mood, seconds, { seed: musicSeed(opts.seed ?? 'aether'), volume: opts.music.volume });
            audio = await encodeOpus(buf, signal);
        }
        catch (e) {
            if (e instanceof DOMException && e.name === 'AbortError')
                throw e;
            audio = null;
        }
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: false });
    if (!ctx)
        throw new Error('2D canvas unavailable');
    opts.onCanvas?.(canvas);
    const image = ctx.createImageData(width, height);
    const bitrate = videoBitrate(width, height, fps);
    let failure = null;
    let avcC = null;
    const encoded = [];
    const encoder = new VideoEncoder({
        output: (chunk, meta) => {
            const data = new Uint8Array(chunk.byteLength);
            chunk.copyTo(data);
            encoded.push({ timestampUs: chunk.timestamp, durationUs: chunk.duration ?? Math.round(1e6 / fps), key: chunk.type === 'key', data });
            const desc = meta?.decoderConfig?.description;
            if (desc && !avcC)
                avcC = desc instanceof ArrayBuffer ? new Uint8Array(desc.slice(0)) : new Uint8Array(desc.buffer.slice(desc.byteOffset, desc.byteOffset + desc.byteLength));
        },
        error: (e) => {
            failure = e;
        },
    });
    encoder.configure({
        codec: choice.codec,
        width,
        height,
        bitrate,
        framerate: fps,
        latencyMode: 'quality',
        ...(choice.container === 'mp4' ? { avc: { format: 'avc' } } : {}),
    });
    await source.preparePost?.();
    const session = source.beginCapture(width, height, { vignette: true });
    const path = new CompiledPath(opts.path);
    const pose = newPose();
    const camPose = { pos: pose.pos, target: pose.target, fov: pose.fov };
    const accumulate = Math.max(1, Math.min(4, Math.floor(opts.quality ?? 1)));
    const frameOpts = { dt: 0, frames: accumulate };
    const keyEvery = fps * 2;
    try {
        for (let i = 0; i < frames; i++) {
            if (signal?.aborted)
                throw abortError();
            if (failure)
                throw failure instanceof Error ? failure : new Error('the video encoder failed');
            const t = i / fps;
            path.sample(t, pose);
            camPose.fov = pose.fov;
            frameOpts.dt = i === 0 ? 0 : 1 / fps;
            const px = await session.frame(camPose, frameOpts);
            image.data.set(px);
            ctx.putImageData(image, 0, 0);
            drawOverlay(ctx, width, height, t, seconds, opts.titles);
            const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
            try {
                encoder.encode(frame, { keyFrame: i % keyEvery === 0 });
            }
            finally {
                frame.close();
            }
            report('rendering', i + 1);
            await drain(encoder, 6, signal);
        }
    }
    catch (e) {
        try {
            encoder.close();
        }
        catch {
            /* already closed */
        }
        throw e;
    }
    finally {
        session.end();
    }
    report('encoding', frames);
    await encoder.flush();
    encoder.close();
    if (failure)
        throw failure instanceof Error ? failure : new Error('the video encoder failed');
    if (signal?.aborted)
        throw abortError();
    report('muxing', frames);
    let bytes;
    if (choice.container === 'mp4') {
        if (!avcC)
            throw new Error('the H.264 encoder did not describe its stream');
        const mux = new Mp4Muxer({ width, height, avcC, frameRate: fps }, audio ? { sampleRate: MUSIC_SAMPLE_RATE, channels: 2, preSkip: audio.preSkip } : null);
        for (const c of encoded)
            mux.addVideo(c);
        for (const c of audio?.chunks ?? [])
            mux.addAudio({ ...c, key: true });
        bytes = mux.finalize();
    }
    else {
        const mux = new WebmMuxer({ codec: choice.id, width, height, frameRate: fps }, audio ? { sampleRate: MUSIC_SAMPLE_RATE, channels: 2, preSkip: audio.preSkip } : null);
        for (const c of encoded)
            mux.addVideo(c);
        for (const c of audio?.chunks ?? [])
            mux.addAudio({ ...c, key: true });
        bytes = mux.finalize(Math.round(seconds * 1e6));
    }
    const mime = choice.container === 'mp4' ? 'video/mp4' : 'video/webm';
    return {
        blob: new Blob([bytes], { type: mime }),
        mime,
        ext: choice.container,
        codec: choice.codec,
        width,
        height,
        fps,
        seconds,
        frames,
        audio: audio !== null,
        method: 'webcodecs',
    };
}
/** MediaRecorder mime types to try, best first. */
const RECORDER_TYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
/** Real-time fallback (see module docs). */
async function recordRealtime(source, opts, seconds) {
    if (typeof MediaRecorder === 'undefined')
        throw new Error('This browser cannot encode video (no WebCodecs and no MediaRecorder).');
    const mime = RECORDER_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
    const { width, height, fps } = opts;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx || typeof canvas.captureStream !== 'function')
        throw new Error('This browser cannot record a canvas.');
    opts.onCanvas?.(canvas);
    const image = ctx.createImageData(width, height);
    const stream = canvas.captureStream(fps);
    const music = opts.music ? playMusic(opts.music.mood, seconds, { seed: musicSeed(opts.seed ?? 'aether'), volume: opts.music.volume, record: true }) : null;
    for (const track of music?.stream?.getAudioTracks() ?? [])
        stream.addTrack(track);
    const recorder = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: videoBitrate(width, height, fps) });
    const parts = [];
    recorder.ondataavailable = (e) => {
        if (e.data.size > 0)
            parts.push(e.data);
    };
    const stopped = new Promise((resolve) => {
        recorder.onstop = () => resolve();
    });
    await source.preparePost?.();
    const session = source.beginCapture(width, height, { vignette: true });
    const path = new CompiledPath(opts.path);
    const pose = newPose();
    const camPose = { pos: pose.pos, target: pose.target, fov: pose.fov };
    const frames = Math.round(seconds * fps);
    recorder.start(1000);
    const start = performance.now();
    let last = 0;
    let drawn = 0;
    try {
        for (;;) {
            if (opts.signal?.aborted)
                throw abortError();
            const t = (performance.now() - start) / 1000;
            if (t >= seconds)
                break;
            path.sample(t, pose);
            camPose.fov = pose.fov;
            const px = await session.frame(camPose, { dt: Math.max(0, t - last) });
            last = t;
            image.data.set(px);
            ctx.putImageData(image, 0, 0);
            drawOverlay(ctx, width, height, t, seconds, opts.titles);
            drawn++;
            opts.onProgress?.({ phase: 'rendering', frame: Math.min(frames, Math.round(t * fps)), frames });
            // Pace to the frame rate (the recorder samples the canvas in real time).
            const next = start + ((Math.floor(t * fps) + 1) * 1000) / fps;
            const wait = next - performance.now();
            if (wait > 1)
                await new Promise((r) => setTimeout(r, wait));
        }
    }
    finally {
        session.end();
        if (recorder.state !== 'inactive')
            recorder.stop();
        music?.stop();
        for (const track of stream.getTracks())
            track.stop();
    }
    await stopped;
    if (opts.signal?.aborted)
        throw abortError();
    const type = recorder.mimeType || mime || 'video/webm';
    const blob = new Blob(parts, { type });
    const ext = type.includes('mp4') ? 'mp4' : 'webm';
    return { blob, mime: type, ext, codec: type, width, height, fps, seconds, frames: drawn, audio: music !== null, method: 'mediarecorder' };
}
