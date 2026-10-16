/**
 * Photo finishes: converts ambientCG PBR materials (CC0) into the
 * renderer's finish texture format, so `material.finish` surfaces (oak
 * floors, brick, marble, tiles…) get photographed detail while keeping each
 * finish's calibrated colour and roughness:
 *
 * - albedo: linear photo colour ÷ its mean (pattern ratio around 1), ÷ the
 *   finish's albedo scale — the renderer multiplies the material colour
 *   back, so tintable finishes still recolour with `material.color`;
 * - ORM: R = ambient occlusion (or 1), G = photo roughness rescaled so its
 *   mean is the finish roughness, B = 0;
 * - normal: the OpenGL tangent-space normal map as is.
 *
 * Maps are 512 px JPEG (the renderer resamples to its texture budget).
 * Conversion runs in the headless browser (image decode + canvas).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FINISHES } from '../../packages/arch/src/finishes';
import { finishAlbedoScale } from '../../packages/procgen/src/finish-pixels';
import { withBrowserPage } from './browser';
import { SOURCE_DIR } from './fetch';
const SIZE = 512;
const PAGE = `
const S = ${SIZE};
async function pixels(b64) {
  if (!b64) return null;
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const c = new OffscreenCanvas(S, S);
  const ctx = c.getContext('2d', { colorSpace: 'srgb' });
  ctx.drawImage(bmp, 0, 0, S, S);
  return ctx.getImageData(0, 0, S, S).data;
}
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const srgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
async function encode(data, type, q) {
  const c = new OffscreenCanvas(S, S);
  c.getContext('2d').putImageData(new ImageData(data, S, S), 0, 0);
  const blob = await c.convertToBlob({ type, quality: q });
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}
window.__convert = async (job) => {
  const color = await pixels(job.color);
  const rough = await pixels(job.rough);
  const ao = await pixels(job.ao);
  const normal = await pixels(job.normal);
  const n = S * S;
  const mean = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) mean[c] += lin(color[i * 4 + c] / 255);
  for (let c = 0; c < 3; c++) mean[c] = Math.max(1e-4, mean[c] / n);
  let rmean = 0;
  if (rough) { for (let i = 0; i < n; i++) rmean += rough[i * 4] / 255; rmean = Math.max(1e-3, rmean / n); }
  const albedo = new Uint8ClampedArray(n * 4), orm = new Uint8ClampedArray(n * 4), nor = new Uint8ClampedArray(n * 4), thumb = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    for (let c = 0; c < 3; c++) {
      const ratio = lin(color[o + c] / 255) / mean[c];
      albedo[o + c] = Math.round(Math.min(1, ratio * job.inv) * 255);
      thumb[o + c] = Math.round(Math.min(1, srgb(Math.min(1, ratio * job.base[c]))) * 255);
    }
    albedo[o + 3] = 255; thumb[o + 3] = 255;
    orm[o] = ao ? ao[o] : 255;
    orm[o + 1] = rough ? Math.round(Math.min(1, (rough[o] / 255) * job.roughness / rmean) * 255) : Math.round(job.roughness * 255);
    orm[o + 2] = 0; orm[o + 3] = 255;
    nor[o] = normal[o]; nor[o + 1] = normal[o + 1]; nor[o + 2] = normal[o + 2]; nor[o + 3] = 255;
  }
  return { albedo: await encode(albedo, 'image/jpeg', 0.88), orm: await encode(orm, 'image/jpeg', 0.9), normal: await encode(nor, 'image/jpeg', 0.92), thumb: await encode(thumb, 'image/webp', 0.86) };
};
window.__ready = true;
`;
function find(dir, suffix) {
    const f = readdirSync(dir).find((n) => n.endsWith(suffix));
    return f ? join(dir, f) : null;
}
function hexLinear(hex) {
    const n = Number.parseInt(hex.slice(1), 16);
    const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return [lin(((n >> 16) & 255) / 255), lin(((n >> 8) & 255) / 255), lin((n & 255) / 255)];
}
/** Convert every configured ambientCG material (empty when none are configured or downloaded). */
export async function buildPhotoFinishes(src) {
    if (!src)
        return [];
    const jobs = src.materials.filter((m) => existsSync(join(SOURCE_DIR, 'ambientcg', m.id)));
    if (jobs.length === 0)
        return [];
    const out = [];
    await withBrowserPage(async (page) => {
        await page.addScriptTag({ content: PAGE });
        await page.waitForFunction(() => window.__ready === true);
        for (const m of jobs) {
            if (!Object.hasOwn(FINISHES, m.finish))
                throw new Error(`unknown finish ${m.finish}`);
            const finish = m.finish;
            const def = FINISHES[finish];
            const dir = join(SOURCE_DIR, 'ambientcg', m.id);
            const color = find(dir, '_Color.jpg');
            const normal = find(dir, '_NormalGL.jpg');
            if (!color || !normal)
                throw new Error(`${m.id}: missing Color / NormalGL maps`);
            const rough = find(dir, '_Roughness.jpg');
            const ao = find(dir, '_AmbientOcclusion.jpg');
            const b64 = (p) => (p ? readFileSync(p).toString('base64') : null);
            const res = await page.evaluate((job) => window.__convert(job), {
                color: b64(color),
                rough: b64(rough),
                ao: b64(ao),
                normal: b64(normal),
                inv: 1 / finishAlbedoScale(def),
                base: hexLinear(def.color),
                roughness: def.roughness,
            });
            out.push({
                finish,
                source: `ambientcg/${m.id}`,
                tile: m.tile ?? def.tile,
                albedo: Buffer.from(res['albedo'] ?? '', 'base64'),
                orm: Buffer.from(res['orm'] ?? '', 'base64'),
                normal: Buffer.from(res['normal'] ?? '', 'base64'),
                thumb: Buffer.from(res['thumb'] ?? '', 'base64'),
            });
            console.log(`photo finish ${finish} ← ${m.id} (${(m.tile ?? def.tile).toFixed(2)} m tile)`);
        }
    });
    return out;
}
