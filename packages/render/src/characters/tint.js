/**
 * Outfit and hair recolouring for the cast.
 *
 * Each body ships a small mask image (built offline from the mesh and the
 * colour texture): left half = body map (R top: jacket, shirt, dress;
 * G bottom: trousers, skirt), right half = head map (R hair); zero on skin,
 * shoes and hands. A variant ("the same man in a red jacket") is baked on the
 * CPU once, when it is first needed: masked texels move to the target colour
 * while keeping their own shading (the target is scaled by the texel's
 * luminance over the region's mean luminance, in linear light), so a green
 * coat still shows its folds and seams. The result is an ordinary base
 * colour texture, so every backend and every material path renders it the same.
 *
 * Variants share textures and materials by key (`bodyId|top|bottom|hair`):
 * a crowd of red guards uploads one set.
 */
import { CanvasTexture, Color, SRGBColorSpace } from 'three';
/** Fallback region luminances when the build recorded none. */
export const DEFAULT_REFS = { top: 0.12, bottom: 0.1, hair: 0.06 };
/** Stable key of a tint (for caches). */
export function tintKey(t) {
    if (!t)
        return '';
    return `${(t.top ?? '').toLowerCase()}|${(t.bottom ?? '').toLowerCase()}|${(t.hair ?? '').toLowerCase()}`;
}
/** True when a tint changes anything. */
export function hasTint(t) {
    return Boolean(t && (t.top || t.bottom || t.hair));
}
const HEX = /^#[0-9a-fA-F]{6}$/;
/** sRGB byte to linear (256 entries) and linear to sRGB byte (4096 entries). */
const TO_LINEAR = new Float32Array(256);
const TO_SRGB = new Uint8Array(4096);
for (let i = 0; i < 256; i++) {
    const c = i / 255;
    TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
for (let i = 0; i < 4096; i++) {
    const l = i / 4095;
    const c = l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055;
    TO_SRGB[i] = Math.max(0, Math.min(255, Math.round(c * 255)));
}
function linearColor(hex) {
    if (!hex || !HEX.test(hex))
        return null;
    const c = new Color(hex);
    return [c.r, c.g, c.b];
}
const LUM_CLAMP_LO = 0.3;
const LUM_CLAMP_HI = 2.4;
/**
 * Recolour RGBA pixels in place toward `target` (linear RGB), keeping each
 * texel's own shading: `ref` is the region's mean luminance and `weight(x, y)`
 * the 0..1 strength of the recolour at that texel.
 */
export function recolorPixels(rgba, width, height, target, ref, weight) {
    const inv = 1 / Math.max(1e-4, ref);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const w = weight(x, y);
            if (w <= 0.004)
                continue;
            const i = (y * width + x) * 4;
            const r = TO_LINEAR[rgba[i]];
            const g = TO_LINEAR[rgba[i + 1]];
            const b = TO_LINEAR[rgba[i + 2]];
            const lum = r * 0.2126 + g * 0.7152 + b * 0.0722;
            const k = Math.max(LUM_CLAMP_LO, Math.min(LUM_CLAMP_HI, lum * inv));
            const nr = r + (target[0] * k - r) * w;
            const ng = g + (target[1] * k - g) * w;
            const nb = b + (target[2] * k - b) * w;
            rgba[i] = TO_SRGB[Math.min(4095, Math.max(0, Math.round(nr * 4095)))];
            rgba[i + 1] = TO_SRGB[Math.min(4095, Math.max(0, Math.round(ng * 4095)))];
            rgba[i + 2] = TO_SRGB[Math.min(4095, Math.max(0, Math.round(nb * 4095)))];
        }
    }
}
/** Weight function reading one mask channel of one half (0 = body, 1 = head) of the mask image. */
export function maskWeight(masks, half, channel, width, height) {
    const halfW = masks.width >> 1;
    const sx = halfW / width;
    const sy = masks.height / height;
    return (x, y) => {
        const mx = Math.min(halfW - 1, Math.floor(x * sx)) + half * halfW;
        const my = Math.min(masks.height - 1, Math.floor(y * sy));
        return masks.data[(my * masks.width + mx) * 4 + channel] / 255;
    };
}
/** Recolour a body base-colour image in place (top and bottom regions). */
export function recolorBody(rgba, width, height, masks, tint, refs) {
    const top = linearColor(tint.top);
    const bottom = linearColor(tint.bottom);
    if (top)
        recolorPixels(rgba, width, height, top, refs.top, maskWeight(masks, 0, 0, width, height));
    if (bottom)
        recolorPixels(rgba, width, height, bottom, refs.bottom, maskWeight(masks, 0, 1, width, height));
}
/** Recolour a head base-colour image in place (the painted hair). */
export function recolorHead(rgba, width, height, masks, tint, refs) {
    const hair = linearColor(tint.hair);
    if (hair)
        recolorPixels(rgba, width, height, hair, refs.hair, maskWeight(masks, 1, 0, width, height));
}
/** Recolour the hair cards (the whole image is hair; alpha is kept). */
export function recolorHairCards(rgba, width, height, tint, refs) {
    const hair = linearColor(tint.hair);
    if (hair)
        recolorPixels(rgba, width, height, hair, refs.hair, () => 1);
}
/** Decode a mask image file (webp, opaque) into pixels. Browser only. */
export async function decodeMasks(blob) {
    const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    try {
        const canvas = new OffscreenCanvas(bmp.width, bmp.height);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx)
            throw new Error('no 2d context for the character masks');
        ctx.drawImage(bmp, 0, 0);
        const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
        return { width: img.width, height: img.height, data: img.data };
    }
    finally {
        bmp.close();
    }
}
/**
 * A recoloured copy of a texture: its image is drawn to a canvas, `apply`
 * edits the pixels, and the result is a new sRGB texture with the source's
 * sampling settings. Browser only. Returns null when the source has no
 * drawable image.
 */
export function bakeTexture(source, apply) {
    const image = source.image;
    if (!image || !image.width || !image.height)
        return null;
    const canvas = new OffscreenCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx)
        return null;
    ctx.drawImage(image, 0, 0);
    const img = ctx.getImageData(0, 0, image.width, image.height);
    apply(img.data, img.width, img.height);
    ctx.putImageData(img, 0, 0);
    const t = new CanvasTexture(canvas);
    t.colorSpace = SRGBColorSpace;
    t.flipY = source.flipY;
    t.wrapS = source.wrapS;
    t.wrapT = source.wrapT;
    t.anisotropy = source.anisotropy;
    t.channel = source.channel;
    t.needsUpdate = true;
    return t;
}
/** The part a material belongs to. */
export function partOf(material) {
    return /hair/i.test(material.name) ? 'hair' : /head/i.test(material.name) ? 'head' : 'body';
}
/**
 * Clone `source` with a recoloured base colour map for its part. The baked
 * texture is returned too so the owner can dispose it. The source is untouched.
 */
export function tintedMaterial(source, part, tint, refs, masks) {
    const m = source.clone();
    m.name = `${source.name}-tint`;
    if (!source.map)
        return { material: m, texture: null };
    let apply = null;
    if (part === 'hair' && tint.hair)
        apply = (px, w, h) => recolorHairCards(px, w, h, tint, refs);
    else if (part === 'head' && tint.hair && masks)
        apply = (px, w, h) => recolorHead(px, w, h, masks, tint, refs);
    else if (part === 'body' && (tint.top || tint.bottom) && masks)
        apply = (px, w, h) => recolorBody(px, w, h, masks, tint, refs);
    if (!apply)
        return { material: m, texture: null };
    const texture = bakeTexture(source.map, apply);
    if (texture)
        m.map = texture;
    return { material: m, texture };
}
/** Collect the distinct materials of a model. */
export function materialsOf(root) {
    const set = new Set();
    root.traverse((o) => {
        const mesh = o;
        if (!mesh.isMesh || !mesh.material)
            return;
        if (Array.isArray(mesh.material))
            for (const m of mesh.material)
                set.add(m);
        else
            set.add(mesh.material);
    });
    return [...set];
}
