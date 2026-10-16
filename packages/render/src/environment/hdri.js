/**
 * HDR environment maps (`environment.hdri`): image-based lighting and an
 * optional photographic background from a library HDRI or a user import.
 * Loading is lazy (the HDR loader is only imported when a world uses one);
 * the analytic sky stays in place until the map arrives or when the id is
 * unknown, so a world never renders without a sky.
 */
import { DataUtils, EquirectangularReflectionMapping } from 'three';
import { assetInfo, loadCatalog } from '@aether/assets';
/** Browser loader (three's `HDRLoader`, imported on first use). Same-origin paths and `blob:` URLs only. */
export function createHdriSource() {
    return {
        async load(url) {
            if (!(url.startsWith('blob:') || (url.startsWith('/') && !url.startsWith('//'))))
                throw new Error('HDRI url rejected');
            const { HDRLoader } = await import('three/addons/loaders/HDRLoader.js');
            return new HDRLoader().loadAsync(url);
        },
    };
}
/** The pixel data of an equirectangular HDR texture, or null for anything else (a blank texture, an image, bad sizes). */
function rawOf(tex) {
    const img = tex.image;
    const data = img?.data;
    const width = img?.width;
    const height = img?.height;
    if (!(data instanceof Uint16Array || data instanceof Float32Array) || typeof width !== 'number' || typeof height !== 'number')
        return null;
    if (width < 4 || height < 2 || data.length < width * height * 4)
        return null;
    return { width, height, data, half: data instanceof Uint16Array };
}
/**
 * The sun of an HDRI: its brightest texel. Rows are stored top first (the loader sets `flipY`), so the
 * elevation is `(0.5 − row/height)·π`; `u = atan2(z, x)/2π + 0.5` gives the azimuth. Null when the texture
 * holds no pixel data.
 */
export function hdriSun(tex) {
    const raw = rawOf(tex);
    if (!raw)
        return null;
    const { width, height, data, half } = raw;
    let best = -1;
    let bi = 0;
    const px = width * height;
    for (let i = 0; i < px; i++) {
        const o = i * 4;
        const l = half ? DataUtils.fromHalfFloat(data[o]) + DataUtils.fromHalfFloat(data[o + 1]) + DataUtils.fromHalfFloat(data[o + 2]) : data[o] + data[o + 1] + data[o + 2];
        if (l > best) {
            best = l;
            bi = i;
        }
    }
    if (!(best > 0))
        return null;
    const x = bi % width;
    const y = Math.floor(bi / width);
    const azimuth = ((x + 0.5) / width - 0.5) * Math.PI * 2;
    const elevation = (0.5 - (y + 0.5) / height) * Math.PI;
    const c = Math.cos(elevation);
    return { direction: [c * Math.cos(azimuth), Math.sin(elevation), c * Math.sin(azimuth)], azimuth, elevation, peak: best / 3 };
}
/**
 * Cap the radiance of every texel at `max` (keeping its colour), in place. The sun disc of a photographed sky is
 * thousands of times brighter than the sky around it: left in, it would light every surface through the
 * diffuse image-based light a second time and without shadows, next to the shadow-casting sun light.
 * Returns the number of texels changed (0 for a texture without pixel data).
 */
export function clampRadiance(tex, max) {
    const raw = rawOf(tex);
    if (!raw || !(max > 0))
        return 0;
    const { width, height, data, half } = raw;
    let changed = 0;
    const px = width * height;
    for (let i = 0; i < px; i++) {
        const o = i * 4;
        let r, g, b;
        if (half) {
            r = DataUtils.fromHalfFloat(data[o]);
            g = DataUtils.fromHalfFloat(data[o + 1]);
            b = DataUtils.fromHalfFloat(data[o + 2]);
        }
        else {
            r = data[o];
            g = data[o + 1];
            b = data[o + 2];
        }
        const m = Math.max(r, g, b);
        if (m <= max)
            continue;
        const k = max / m;
        changed++;
        if (half) {
            data[o] = DataUtils.toHalfFloat(r * k);
            data[o + 1] = DataUtils.toHalfFloat(g * k);
            data[o + 2] = DataUtils.toHalfFloat(b * k);
        }
        else {
            data[o] = r * k;
            data[o + 1] = g * k;
            data[o + 2] = b * k;
        }
    }
    if (changed > 0)
        tex.needsUpdate = true;
    return changed;
}
/**
 * Rotation about the vertical axis (radians, for `scene.environmentRotation.y`) that moves an HDRI's sun from
 * azimuth `hdriAzimuth` to the direction (`lx`, `lz`) of the sun light. Zero for a vertical light. The
 * rotation turns the image like an object: a right-handed turn by `a` about +y moves azimuth `atan2(z, x)`
 * by −a, so the turn needed is `hdriAzimuth − lightAzimuth`.
 */
export function hdriRotationFor(hdriAzimuth, lx, lz) {
    if (!Number.isFinite(hdriAzimuth) || Math.hypot(lx, lz) < 1e-6)
        return 0;
    const turn = hdriAzimuth - Math.atan2(lz, lx);
    // Wrap into (−π, π].
    return Math.atan2(Math.sin(turn), Math.cos(turn));
}
/** Radiance cap applied to an HDRI used only for image-based light (sun removed; the sun light casts the shadows). */
export const HDRI_SUN_CLAMP = 12;
/** The current HDRI binding of a scene. */
export class HdriController {
    source;
    onChange;
    id = null;
    tex = null;
    token = 0;
    background = true;
    intensity = 1;
    scene = null;
    clampSun = false;
    sunInfo = null;
    /** The loaded map was requested light-only (its sun is clamped away). */
    texAuto = false;
    /**
     * The last automatic (light-only) map, kept after it is unbound. Switching quality tiers turns automatic
     * HDRIs off and on again; re-creating a map means loading it again and prefiltering it again (a burst
     * of GPU objects each time). One map is kept; it is disposed when another map takes its place, when a
     * world HDRI is requested, and with the controller.
     */
    parked = null;
    /** The loaded map's sun (azimuth, elevation), when its pixels were readable. */
    get sun() {
        return this.sunInfo;
    }
    constructor(source, 
    /** Called when a map finished loading or was removed (request a redraw, refresh the sky). */
    onChange) {
        this.source = source;
        this.onChange = onChange;
    }
    /** The loaded map, or null (none requested, still loading, or failed). */
    get texture() {
        return this.tex;
    }
    /** True when the loaded map is also the background (the analytic sky dome hides). */
    get showsBackground() {
        return this.tex !== null && this.background;
    }
    /** Last load error (for diagnostics), or null. */
    error = null;
    /** Load the current id again (a user HDRI registered after the world loaded). */
    reload() {
        const id = this.id;
        if (id === null || this.tex)
            return;
        this.id = null;
        this.set(id, { intensity: this.intensity, background: this.background });
    }
    /**
     * Request `id` (or none). Re-requesting the same id only updates intensity / background. With
     * `lightOnly` the map is used for image-based light alone: its sun is cut down to the sky's level
     * after the sun's direction has been read (see {@link clampRadiance}).
     */
    set(id, opts) {
        this.intensity = opts.intensity ?? 1;
        this.background = opts.background !== false;
        const lightOnly = opts.lightOnly === true;
        this.clampSun = lightOnly;
        const next = id ?? null;
        if (next === this.id)
            return;
        const previous = this.id;
        this.id = next;
        const token = ++this.token;
        this.drop(previous);
        this.error = null;
        if (next === null) {
            this.onChange();
            return;
        }
        if (this.parked) {
            if (lightOnly && this.parked.id === next) {
                // The automatic map of this tier comes straight back: no load, no new prefiltering.
                this.tex = this.parked.tex;
                this.sunInfo = this.parked.sun;
                this.texAuto = true;
                this.parked = null;
                this.onChange();
                return;
            }
            this.releaseParked();
        }
        void loadCatalog()
            .then(() => {
            const info = assetInfo(next);
            if (!info || info.kind !== 'hdri' || !info.url)
                throw new Error(`"${next}" is not an HDR environment`);
            return this.source.load(info.url);
        })
            .then((tex) => {
            if (token !== this.token) {
                tex.dispose();
                return;
            }
            tex.mapping = EquirectangularReflectionMapping;
            this.sunInfo = hdriSun(tex);
            if (this.clampSun)
                clampRadiance(tex, HDRI_SUN_CLAMP);
            this.tex = tex;
            this.texAuto = this.clampSun;
            this.onChange();
        }, (e) => {
            if (token !== this.token)
                return;
            this.error = e instanceof Error ? e.message.slice(0, 160) : 'HDRI failed to load';
            this.onChange();
        });
    }
    /**
     * Bind to `scene` when loaded: environment lighting (scaled by the world's
     * `hdriIntensity`) and, unless disabled, the background. Returns true when
     * the HDRI owns `scene.environment`.
     */
    bind(scene, baseIntensity) {
        this.scene = scene;
        if (!this.tex)
            return false;
        scene.environment = this.tex;
        scene.environmentIntensity = baseIntensity * this.intensity;
        scene.background = this.background ? this.tex : null;
        return true;
    }
    /** Unbind from `scene` (when the world drops its HDRI). */
    unbind(scene) {
        if (scene.background && scene.background === this.tex)
            scene.background = null;
        if (scene.environment && scene.environment === this.tex)
            scene.environment = null;
    }
    releaseParked() {
        this.parked?.tex.dispose();
        this.parked = null;
    }
    /** Unbind and release the current map; an automatic one (`previous` is its id) is parked for reuse instead of disposed. */
    drop(previous) {
        if (this.scene)
            this.unbind(this.scene);
        if (this.tex) {
            if (this.texAuto && previous !== null) {
                this.releaseParked();
                this.parked = { id: previous, tex: this.tex, sun: this.sunInfo };
            }
            else
                this.tex.dispose();
        }
        this.tex = null;
        this.sunInfo = null;
        this.texAuto = false;
    }
    dispose() {
        this.token++;
        this.drop(null);
        this.releaseParked();
    }
}
