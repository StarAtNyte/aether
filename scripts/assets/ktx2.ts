/**
 * GPU-compressed (KTX2 / Basis Universal) twins of the library's textured files and of the block
 * material sheets:
 *
 *   npm run assets:ktx2            # encode what is missing or stale, write the indexes
 *   npm run assets:ktx2 -- --check # verify the indexes against the files (no encoding)
 *   npm run assets:ktx2 -- --only=models|blocks
 *
 * Run it after `assets:build`, `characters:build` or the block-texture script. Outputs (all tracked):
 *
 * - `assets/lib/k/<stem>.<hash>.glb`: each textured model with its images re-encoded as KTX2
 *   (`KHR_texture_basisu`, required): albedo as ETC1S when it holds up (luma-weighted SSIM ≥ 0.95),
 *   UASTC otherwise; normal and ORM / metal-rough / occlusion maps as UASTC (RDO + Zstandard); cut-out
 *   colour as UASTC with its alpha bled outwards; full mip chains; sRGB colour, linear data. Outfit
 *   and hair tints of the cast are baked from the original file's images (render characters/tint.ts).
 * - `assets/ktx2.json`: the index (variant and source SHA-256, bytes, per-texture codec and SSIM,
 *   estimated GPU bytes before and after) the renderer reads (see @aether/assets `TextureVariants`).
 * - `apps/studio/public/blocks/block-{albedo,normal,orm}.ktx2` (+ `block-ktx2.json`): the block
 *   sheets as KTX2 array textures, one layer per material.
 *
 * The encoder is KTX-Software's `ktx` CLI (Apache-2.0), pinned to v4.4.2: `AETHER_KTX=/path/to/ktx`,
 * else `ktx` on PATH (version checked), else the official Linux x86_64 release is downloaded once into
 * `~/.cache/aether-tools` and verified by SHA-256. Images are decoded in one headless Chromium (exact
 * unpremultiplied bytes through a WebGL2 read-back). Encodings are cached by input hash and settings
 * in `<asset source dir>/ktx2-cache`, so a rerun only encodes what changed.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { NodeIO, TextureInfo, type Document, type Texture } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRTextureBasisu } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import type { Page } from 'playwright';
import { TextureVariants, type TextureVariant, type VariantTexture } from '../../packages/assets/src/texture-variants';
import { encodePng } from '../../tests/e2e/support/png-encode';
import { withBrowserPage } from './browser';
import { SOURCE_DIR } from './fetch';
import { ETC1S_MIN_SSIM, SETTINGS, bleedAlpha, firstPlan, gpuBytes, parseLevel0Ssim, roleOf, stemOf, uastcPlan, type EncodePlan, type TextureRole } from './ktx2-plan';

const ROOT = resolve(import.meta.dirname, '../..');
const LIB = join(ROOT, 'assets', 'lib');
const OUT_DIR = join(LIB, 'k');
const INDEX = join(ROOT, 'assets', 'ktx2.json');
const BLOCKS = join(ROOT, 'apps', 'studio', 'public', 'blocks');
const BLOCK_INDEX = join(BLOCKS, 'block-ktx2.json');
const CACHE = join(SOURCE_DIR, 'ktx2-cache');

/** The pinned encoder. */
export const KTX_VERSION = '4.4.2';
const KTX_RELEASE = {
  url: `https://github.com/KhronosGroup/KTX-Software/releases/download/v${KTX_VERSION}/KTX-Software-${KTX_VERSION}-Linux-x86_64.tar.bz2`,
  sha256: 'a8781bad05f9624edbf910b7f258cd0a4ba7d3e63b49ecc0a0ab440bf6a0a245',
  dir: `KTX-Software-${KTX_VERSION}-Linux-x86_64`,
};
const TOOLS = join(homedir(), '.cache', 'aether-tools');

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex');

// ---------------------------------------------------------------------------
// The encoder
// ---------------------------------------------------------------------------

interface Ktx {
  bin: string;
  env: NodeJS.ProcessEnv;
}

function versionOf(k: Ktx): string | null {
  const r = spawnSync(k.bin, ['--version'], { env: k.env, encoding: 'utf8' });
  return r.status === 0 ? (/v(\d+\.\d+\.\d+)/.exec(r.stdout)?.[1] ?? null) : null;
}

async function ktxTool(): Promise<Ktx> {
  const fromEnv = process.env['AETHER_KTX'];
  if (fromEnv) {
    const k = { bin: fromEnv, env: process.env };
    const v = versionOf(k);
    if (!v) throw new Error(`AETHER_KTX=${fromEnv} does not run`);
    if (v !== KTX_VERSION) console.warn(`ktx ${v} (pinned ${KTX_VERSION}): outputs may differ from the committed ones`);
    return k;
  }
  const onPath = { bin: 'ktx', env: process.env };
  if (versionOf(onPath) === KTX_VERSION) return onPath;
  const home = join(TOOLS, `ktx-${KTX_VERSION}`, KTX_RELEASE.dir);
  const local: Ktx = { bin: join(home, 'bin', 'ktx'), env: { ...process.env, LD_LIBRARY_PATH: [join(home, 'lib'), process.env['LD_LIBRARY_PATH'] ?? ''].filter(Boolean).join(':') } };
  if (existsSync(local.bin) && versionOf(local) === KTX_VERSION) return local;
  if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error(`install KTX-Software ${KTX_VERSION} (https://github.com/KhronosGroup/KTX-Software/releases) and set AETHER_KTX to its ktx binary`);
  console.log(`downloading KTX-Software ${KTX_VERSION} (Apache-2.0) into ${TOOLS}`);
  const res = await fetch(KTX_RELEASE.url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`KTX-Software download: HTTP ${res.status}`);
  const data = new Uint8Array(await res.arrayBuffer());
  if (sha256(data) !== KTX_RELEASE.sha256) throw new Error('KTX-Software download: SHA-256 mismatch');
  mkdirSync(join(TOOLS, `ktx-${KTX_VERSION}`), { recursive: true });
  const archive = join(TOOLS, `ktx-${KTX_VERSION}.tar.bz2`);
  writeFileSync(archive, data);
  const tar = spawnSync('tar', ['-xjf', archive, '-C', join(TOOLS, `ktx-${KTX_VERSION}`)], { stdio: 'inherit' });
  rmSync(archive, { force: true });
  if (tar.status !== 0 || versionOf(local) !== KTX_VERSION) throw new Error('KTX-Software: extraction failed');
  return local;
}

/** Encode one PNG with `plan`; returns the KTX2 bytes and the level-0 SSIM. */
function encode(k: Ktx, inputs: readonly string[], plan: EncodePlan, extra: readonly string[], work: string): { data: Uint8Array; ssim: number | null } {
  const out = join(work, `out-${process.pid}-${Math.random().toString(36).slice(2)}.ktx2`);
  const r = spawnSync(k.bin, ['create', ...plan.args, ...extra, '--threads', '16', ...inputs, out], { env: k.env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`ktx create failed (${r.status}): ${r.stderr.slice(0, 400)}`);
  const data = new Uint8Array(readFileSync(out));
  rmSync(out, { force: true });
  return { data, ssim: parseLevel0Ssim(r.stdout) };
}

interface Encoded {
  data: Uint8Array;
  codec: 'etc1s' | 'uastc';
  ssim: number | null;
}

/** Encode (or take from the cache) a decoded RGBA image for `role`. */
function encodeImage(k: Ktx, rgba: Uint8Array, width: number, height: number, role: TextureRole, alpha: boolean, wrap: boolean, work: string): Encoded {
  const key = sha256(new Uint8Array(Buffer.concat([Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), Buffer.from(JSON.stringify({ width, height, role, alpha, wrap, SETTINGS, v: KTX_VERSION }))])));
  const cached = join(CACHE, `${key}.ktx2`);
  const meta = join(CACHE, `${key}.json`);
  if (existsSync(cached) && existsSync(meta)) {
    const m = JSON.parse(readFileSync(meta, 'utf8')) as { codec: 'etc1s' | 'uastc'; ssim: number | null };
    return { data: new Uint8Array(readFileSync(cached)), codec: m.codec, ssim: m.ssim };
  }
  const png = join(work, `in-${key.slice(0, 16)}.png`);
  writeFileSync(png, encodePng({ width, height, data: rgba }));
  let plan = firstPlan(role, alpha, wrap);
  let r = encode(k, [png], plan, [], work);
  if (plan.codec === 'etc1s' && (r.ssim === null || r.ssim < ETC1S_MIN_SSIM)) {
    plan = uastcPlan(role, alpha, wrap);
    r = encode(k, [png], plan, [], work);
  }
  rmSync(png, { force: true });
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(cached, r.data);
  writeFileSync(meta, JSON.stringify({ codec: plan.codec, ssim: r.ssim }));
  return { data: r.data, codec: plan.codec, ssim: r.ssim };
}

// ---------------------------------------------------------------------------
// Decoding (headless Chromium, exact bytes)
// ---------------------------------------------------------------------------

interface Decoded {
  width: number;
  height: number;
  data: Uint8Array;
}

async function decodeImage(page: Page, bytes: Uint8Array, mime: string): Promise<Decoded> {
  const r = await page.evaluate(
    async ({ b64, mime }) => {
      const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([raw], { type: mime }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      const w = bmp.width;
      const h = bmp.height;
      const canvas = new OffscreenCanvas(1, 1);
      const gl = canvas.getContext('webgl2', { premultipliedAlpha: false });
      if (!gl) throw new Error('no WebGL2 for image read-back');
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
      bmp.close();
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      gl.deleteFramebuffer(fb);
      gl.deleteTexture(tex);
      let bin = '';
      for (let i = 0; i < px.length; i += 0x8000) bin += String.fromCharCode(...px.subarray(i, i + 0x8000));
      return { w, h, b64: btoa(bin) };
    },
    { b64: Buffer.from(bytes).toString('base64'), mime },
  );
  return { width: r.w, height: r.h, data: new Uint8Array(Buffer.from(r.b64, 'base64')) };
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

/** Material slots (glTF property names) a texture fills. */
function slotsOf(doc: Document, tex: Texture): string[] {
  const out = new Set<string>();
  for (const edge of doc.getGraph().listParentEdges(tex)) {
    const name = edge.getName();
    if (edge.getParent() !== doc.getRoot()) out.add(name);
  }
  return [...out];
}

/** True when any material uses the texture's alpha (MASK or BLEND, base colour slot). */
function usesAlpha(doc: Document, tex: Texture): boolean {
  return doc
    .getRoot()
    .listMaterials()
    .some((m) => m.getBaseColorTexture() === tex && m.getAlphaMode() !== 'OPAQUE');
}

/** True when a sampler of the texture repeats (mip generation then wraps at the edges). */
function wraps(doc: Document, tex: Texture): boolean {
  for (const m of doc.getRoot().listMaterials()) {
    const pairs: Array<[Texture | null, TextureInfo | null]> = [
      [m.getBaseColorTexture(), m.getBaseColorTextureInfo()],
      [m.getNormalTexture(), m.getNormalTextureInfo()],
      [m.getOcclusionTexture(), m.getOcclusionTextureInfo()],
      [m.getMetallicRoughnessTexture(), m.getMetallicRoughnessTextureInfo()],
      [m.getEmissiveTexture(), m.getEmissiveTextureInfo()],
    ];
    for (const [t, info] of pairs) if (t === tex && info && (info.getWrapS() !== TextureInfo.WrapMode.CLAMP_TO_EDGE || info.getWrapT() !== TextureInfo.WrapMode.CLAMP_TO_EDGE)) return true;
  }
  return false;
}

/** Why a texture stays in its source format (null: encode it). */
function keepReason(doc: Document, tex: Texture, role: TextureRole | null): string | null {
  if (role === null) return 'used as colour and as data';
  const mime = tex.getMimeType();
  if (mime !== 'image/png' && mime !== 'image/jpeg' && mime !== 'image/webp') return `unsupported source ${mime}`;
  const size = tex.getSize();
  if (!size) return 'unknown size';
  if (size[0] < 4 || size[1] < 4) return 'smaller than one block';
  void doc;
  return null;
}

interface ModelResult {
  variant: TextureVariant;
  data: Uint8Array;
}

async function variantOf(k: Ktx, io: NodeIO, page: Page, path: string, work: string): Promise<ModelResult | null> {
  const src = new Uint8Array(readFileSync(join(LIB, path)));
  const doc = await io.readBinary(src);
  const textures = doc.getRoot().listTextures();
  if (textures.length === 0) return null;
  const report: VariantTexture[] = [];
  let before = 0;
  let after = 0;
  let encoded = 0;
  for (const tex of textures) {
    const slots = slotsOf(doc, tex);
    if (slots.length === 0) continue;
    const role = roleOf(slots);
    const size = tex.getSize() ?? [0, 0];
    const reason = keepReason(doc, tex, role);
    before += gpuBytes(size[0], size[1], false);
    if (reason || role === null) {
      after += gpuBytes(size[0], size[1], false);
      report.push({ slots, codec: 'kept', width: Math.max(1, size[0]), height: Math.max(1, size[1]), reason: reason ?? 'kept' });
      continue;
    }
    const image = tex.getImage();
    if (!image) continue;
    const decoded = await decodeImage(page, image, tex.getMimeType());
    const alpha = usesAlpha(doc, tex);
    if (alpha) bleedAlpha(decoded.data, decoded.width, decoded.height);
    const enc = encodeImage(k, decoded.data, decoded.width, decoded.height, role, alpha, wraps(doc, tex), work);
    const uri = tex.getURI();
    tex.setImage(enc.data).setMimeType('image/ktx2');
    if (uri) tex.setURI(uri.replace(/\.(png|jpe?g|webp)$/i, '.ktx2'));
    after += gpuBytes(decoded.width, decoded.height, true);
    encoded++;
    report.push({ slots, codec: enc.codec, width: decoded.width, height: decoded.height, ...(enc.ssim !== null ? { ssim: Math.round(enc.ssim * 10000) / 10000 } : {}) });
  }
  if (encoded === 0) return null;
  doc.createExtension(KHRTextureBasisu).setRequired(true);
  const data = await io.writeBinary(doc);
  const hash = sha256(data);
  const file = `k/${stemOf(path)}.${hash.slice(0, 8)}.glb`;
  return {
    data,
    variant: { file, sha256: hash, bytes: data.byteLength, source: { sha256: sha256(src), bytes: src.byteLength }, textures: report, gpu: { before, after } },
  };
}

/** Library model files that may carry textures (LOD 0 of models and the cast; LOD files reuse LOD 0's materials). */
function modelFiles(): string[] {
  const out: string[] = [];
  for (const dir of ['m', 'c', 's']) {
    const d = join(LIB, dir);
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d).sort()) if (f.endsWith('.glb') && !/\.(lod[12]|lite)\./.test(f)) out.push(`${dir}/${f}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Block sheets (array textures)
// ---------------------------------------------------------------------------

/** `block-ktx2.json`: the KTX2 block sheets and the WebP sheets they were made from. */
export interface BlockKtx2Index {
  version: 1;
  size: number;
  layers: number;
  files: Record<'albedo' | 'normal' | 'orm', { file: string; sha256: string; bytes: number; codec: 'etc1s' | 'uastc'; source: string; sourceSha256: string }>;
}

async function encodeBlocks(k: Ktx, page: Page, work: string): Promise<BlockKtx2Index | null> {
  const indexPath = join(BLOCKS, 'block-materials.json');
  if (!existsSync(indexPath)) return null;
  const index = JSON.parse(readFileSync(indexPath, 'utf8')) as { size: number; columns: number; rows: number };
  const { size, columns, rows } = index;
  const layers = columns * rows;
  const files = {} as BlockKtx2Index['files'];
  for (const kind of ['albedo', 'normal', 'orm'] as const) {
    const source = `block-${kind}.webp`;
    const bytes = new Uint8Array(readFileSync(join(BLOCKS, source)));
    const sheet = await decodeImage(page, bytes, 'image/webp');
    if (sheet.width !== size * columns || sheet.height !== size * rows) throw new Error(`${source}: unexpected size ${sheet.width}×${sheet.height}`);
    const inputs: string[] = [];
    for (let slot = 0; slot < layers; slot++) {
      const x0 = (slot % columns) * size;
      const y0 = Math.floor(slot / columns) * size;
      const tile = new Uint8Array(size * size * 4);
      for (let y = 0; y < size; y++) tile.set(sheet.data.subarray(((y0 + y) * sheet.width + x0) * 4, ((y0 + y) * sheet.width + x0 + size) * 4), y * size * 4);
      const png = join(work, `block-${kind}-${slot}.png`);
      writeFileSync(png, encodePng({ width: size, height: size, data: tile }));
      inputs.push(png);
    }
    const role: TextureRole = kind === 'albedo' ? 'color' : kind === 'normal' ? 'normal' : 'data';
    // Tiles repeat across block faces: mip levels wrap.
    let plan = firstPlan(role, false, true);
    let r = encode(k, inputs, plan, ['--layers', String(layers)], work);
    if (plan.codec === 'etc1s' && (r.ssim === null || r.ssim < ETC1S_MIN_SSIM)) {
      plan = uastcPlan(role, false, true);
      r = encode(k, inputs, plan, ['--layers', String(layers)], work);
    }
    for (const f of inputs) rmSync(f, { force: true });
    const file = `block-${kind}.ktx2`;
    writeFileSync(join(BLOCKS, file), r.data);
    files[kind] = { file, sha256: sha256(r.data), bytes: r.data.byteLength, codec: plan.codec, source, sourceSha256: sha256(bytes) };
    console.log(`blocks ${kind}: ${plan.codec}, ${(r.data.byteLength / 1024).toFixed(0)} KB (webp ${(bytes.byteLength / 1024).toFixed(0)} KB), ssim ${r.ssim?.toFixed(4) ?? '?'}`);
  }
  return { version: 1, size, layers, files };
}

// ---------------------------------------------------------------------------
// Check mode
// ---------------------------------------------------------------------------

function check(): number {
  const problems: string[] = [];
  const index = TextureVariants.parse(JSON.parse(readFileSync(INDEX, 'utf8')));
  for (const [path, v] of Object.entries(index.entries)) {
    const src = join(LIB, path);
    if (!existsSync(src)) problems.push(`${path}: source missing`);
    else if (sha256(new Uint8Array(readFileSync(src))) !== v.source.sha256) problems.push(`${path}: source changed (rerun assets:ktx2)`);
    const out = join(LIB, v.file);
    if (!existsSync(out)) problems.push(`${v.file}: missing`);
    else if (sha256(new Uint8Array(readFileSync(out))) !== v.sha256) problems.push(`${v.file}: checksum mismatch`);
  }
  for (const p of problems) console.error(p);
  console.log(problems.length === 0 ? `ok: ${Object.keys(index.entries).length} variants` : `${problems.length} problems`);
  return problems.length === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (process.argv.includes('--check')) process.exit(check());
  const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
  // `--match=sofa,dario`: encode only matching files and print the result; nothing is written (trials).
  const match = process.argv.find((a) => a.startsWith('--match='))?.slice(8).split(',').filter(Boolean) ?? null;
  const k = await ktxTool();
  console.log(`encoder: ktx v${versionOf(k) ?? '?'}`);
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  const work = mkdtempSync(join(tmpdir(), 'aether-ktx2-'));
  const entries: Record<string, TextureVariant> = {};
  const outputs = new Map<string, Uint8Array>();
  let blocks: BlockKtx2Index | null = null;
  try {
    await withBrowserPage(async (page) => {
      const files = only === 'blocks' ? [] : modelFiles().filter((f) => !match || match.some((m) => f.includes(m)));
      let n = 0;
      for (const path of files) {
        n++;
        const r = await variantOf(k, io, page, path, work);
        if (!r) continue;
        entries[path] = r.variant;
        outputs.set(r.variant.file, r.data);
        const codecs = r.variant.textures.map((t) => t.codec[0]).join('');
        console.log(`[${n}/${files.length}] ${path} → ${r.variant.file} ${(r.variant.source.bytes / 1024).toFixed(0)} → ${(r.variant.bytes / 1024).toFixed(0)} KB, GPU ${(r.variant.gpu.before / 1048576).toFixed(1)} → ${(r.variant.gpu.after / 1048576).toFixed(1)} MB [${codecs}]`);
      }
      if (only !== 'models' && !match) blocks = await encodeBlocks(k, page, work);
    });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  if (match) {
    for (const [path, e] of Object.entries(entries)) console.log(path, JSON.stringify(e.textures));
    return;
  }
  if (only === 'blocks') {
    if (blocks) writeFileSync(BLOCK_INDEX, `${JSON.stringify(blocks, null, 1)}\n`);
    return;
  }
  mkdirSync(OUT_DIR, { recursive: true });
  const keep = new Set([...outputs.keys()].map((f) => f.slice(2)));
  for (const f of readdirSync(OUT_DIR)) if (!keep.has(f)) rmSync(join(OUT_DIR, f));
  for (const [file, data] of outputs) writeFileSync(join(LIB, file), data);
  const index = TextureVariants.parse({
    version: 1,
    encoder: { name: 'KTX-Software ktx', version: KTX_VERSION, licence: 'Apache-2.0', settings: { ...SETTINGS } },
    entries: Object.fromEntries(Object.entries(entries).sort(([a], [b]) => (a < b ? -1 : 1))),
  });
  writeFileSync(INDEX, `${JSON.stringify({ $comment: 'GPU-compressed (KTX2) twins of textured library files. Generated by scripts/assets/ktx2.ts — do not edit.', ...index }, null, 1)}\n`);
  if (blocks) writeFileSync(BLOCK_INDEX, `${JSON.stringify(blocks, null, 1)}\n`);
  const v = Object.values(entries);
  const sum = (f: (x: TextureVariant) => number): number => v.reduce((a, x) => a + f(x), 0);
  console.log(
    `${v.length} variants: ${(sum((x) => x.source.bytes) / 1048576).toFixed(1)} MB sources → ${(sum((x) => x.bytes) / 1048576).toFixed(1)} MB variants; GPU ${(sum((x) => x.gpu.before) / 1048576).toFixed(0)} → ${(sum((x) => x.gpu.after) / 1048576).toFixed(0)} MB if every file were loaded`,
  );
}

await main();
