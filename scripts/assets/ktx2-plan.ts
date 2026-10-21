/**
 * Pure planning helpers of the KTX2 pipeline (`ktx2.ts`): which codec a texture gets, the encoder
 * arguments, parsing the encoder's similarity report, GPU-size estimates and the alpha bleed that keeps
 * mip levels of cut-out textures free of dark fringes. No I/O here, so the rules are unit-tested.
 */

/** What a texture holds, from the material slots it fills. */
export type TextureRole = 'color' | 'normal' | 'data';

/** Slots holding sRGB colour (everything else is linear data). */
const COLOR_SLOTS: ReadonlySet<string> = new Set(['baseColorTexture', 'emissiveTexture', 'sheenColorTexture', 'specularColorTexture', 'diffuseTexture', 'specularGlossinessTexture']);
const NORMAL_SLOTS: ReadonlySet<string> = new Set(['normalTexture', 'clearcoatNormalTexture']);

/** The role of a texture filling `slots`, or null when they disagree (one image used as colour and as data). */
export function roleOf(slots: readonly string[]): TextureRole | null {
  const roles = new Set<TextureRole>(slots.map((s) => (COLOR_SLOTS.has(s) ? 'color' : NORMAL_SLOTS.has(s) ? 'normal' : 'data')));
  if (roles.size !== 1) return null;
  return [...roles][0] ?? null;
}

/**
 * Luma-weighted SSIM of ETC1S (see {@link parseLevel0Ssim}) at which an albedo stays ETC1S. Below it (fine detail, hard palette
 * edges, text) the texture is stored as UASTC instead: four times the bits of ETC1S, close to lossless.
 */
export const ETC1S_MIN_SSIM = 0.95;

/** Encoder settings, recorded in the index. */
export const SETTINGS = {
  etc1s: '--encode basis-lz --clevel 4 --qlevel 255',
  uastcColor: '--encode uastc --uastc-quality 2 --uastc-rdo --uastc-rdo-l 0.75 --zstd 18',
  uastcAlpha: '--encode uastc --uastc-quality 2 --zstd 18',
  uastcNormal: '--encode uastc --uastc-quality 2 --uastc-rdo --uastc-rdo-l 0.5 --zstd 18',
  uastcData: '--encode uastc --uastc-quality 2 --uastc-rdo --uastc-rdo-l 1.25 --zstd 18',
  mipmaps: '--generate-mipmap (lanczos4; wrap for repeating samplers, clamp otherwise)',
  colorSpace: 'colour: R8G8B8(A8)_SRGB, normals and data: R8G8B8(A8)_UNORM; primaries BT.709',
  etc1sAcceptance: `ETC1S when the luma-weighted SSIM of level 0 is at least ${ETC1S_MIN_SSIM}, UASTC otherwise`,
} as const;

/** One encoding attempt. */
export interface EncodePlan {
  codec: 'etc1s' | 'uastc';
  args: string[];
}

/**
 * Encoder arguments for a texture (`alpha`: the material uses its alpha, MASK or BLEND). Colour gets ETC1S
 * first (the caller falls back to {@link uastcPlan} when its similarity is too low); cut-out colour,
 * normals and data maps go straight to UASTC.
 */
export function firstPlan(role: TextureRole, alpha: boolean, wrap: boolean): EncodePlan {
  if (role === 'color' && !alpha) return { codec: 'etc1s', args: [...formatArgs(role, alpha), ...SETTINGS.etc1s.split(' '), ...mipArgs(wrap), '--compare-ssim'] };
  return uastcPlan(role, alpha, wrap);
}

/** The UASTC encoding of a texture. */
export function uastcPlan(role: TextureRole, alpha: boolean, wrap: boolean): EncodePlan {
  const s = role === 'normal' ? SETTINGS.uastcNormal : role === 'data' ? SETTINGS.uastcData : alpha ? SETTINGS.uastcAlpha : SETTINGS.uastcColor;
  return { codec: 'uastc', args: [...formatArgs(role, alpha), ...s.split(' '), ...mipArgs(wrap), '--compare-ssim'] };
}

function formatArgs(role: TextureRole, alpha: boolean): string[] {
  const srgb = role === 'color';
  const fmt = `R8G8B8${alpha ? 'A8' : ''}_${srgb ? 'SRGB' : 'UNORM'}`;
  return ['--format', fmt, '--assign-tf', srgb ? 'srgb' : 'linear', '--assign-primaries', 'bt709'];
}

function mipArgs(wrap: boolean): string[] {
  return ['--generate-mipmap', '--mipmap-wrap', wrap ? 'wrap' : 'clamp'];
}

/**
 * Luma-weighted SSIM of mip level 0 (Rec. 709 weights over R, G, B; the lowest channel when only some are
 * reported) from `ktx create --compare-ssim` output (`Level 0:` followed by `SSIM R: +0.97, G: +0.98, B: +0.96[, A: …]`),
 * or null when absent. Blue carries the least visible detail and is often the worst channel of ETC1S, so a
 * plain minimum would reject albedos that look the same.
 */
export function parseLevel0Ssim(out: string): number | null {
  // Level 0 of a plain texture is `Level 0:`; of an array, one `Level 0 Layer <n>:` section per layer (the worst counts).
  const lines = out.split('\n');
  let worst: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*Level 0( Layer \d+)?:/.test(lines[i] ?? '')) continue;
    const line = lines.slice(i + 1, i + 4).find((l) => l.includes('SSIM'));
    if (!line) continue;
    const ch: Partial<Record<'R' | 'G' | 'B' | 'A', number>> = {};
    for (const m of line.matchAll(/([RGBA]):\s*([+-]?\d+(?:\.\d+)?)/g)) {
      const v = Number(m[2]);
      if (Number.isFinite(v)) ch[m[1] as 'R' | 'G' | 'B' | 'A'] = v;
    }
    const any = Object.values(ch);
    const v = ch.R !== undefined && ch.G !== undefined && ch.B !== undefined ? 0.2126 * ch.R + 0.7152 * ch.G + 0.0722 * ch.B : any.length > 0 ? Math.min(...any) : null;
    if (v !== null) worst = worst === null ? v : Math.min(worst, v);
  }
  return worst;
}

/** Bytes of a full mip chain with `bitsPerTexel` (block formats round each level up to 4 × 4 blocks when `block`). */
export function mipChainBytes(width: number, height: number, bitsPerTexel: number, block: boolean): number {
  let w = width;
  let h = height;
  let total = 0;
  for (;;) {
    const bw = block ? Math.ceil(w / 4) * 4 : w;
    const bh = block ? Math.ceil(h / 4) * 4 : h;
    total += (bw * bh * bitsPerTexel) / 8;
    if (w === 1 && h === 1) break;
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
  }
  return Math.round(total);
}

/** GPU bytes of a texture as RGBA8 (the uncompressed path) and as transcoded on a desktop GPU (BC7, 8 bits per texel). */
export function gpuBytes(width: number, height: number, compressed: boolean): number {
  return compressed ? mipChainBytes(width, height, 8, true) : mipChainBytes(width, height, 32, false);
}

/**
 * Fill the colour of fully transparent texels from their nearest visible neighbours (in place), so
 * filtering and mip levels of a cut-out texture blend leaf colour into leaf colour instead of the
 * black the decoder leaves under alpha 0. Visible texels and every alpha value are untouched.
 * `passes` dilation steps grow the colour outwards; texels still unreached take the mean visible colour.
 */
export function bleedAlpha(rgba: Uint8Array, width: number, height: number, passes = 16): void {
  const n = width * height;
  const known = new Uint8Array(n);
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let count = 0;
  for (let i = 0; i < n; i++) {
    if ((rgba[i * 4 + 3] as number) > 0) {
      known[i] = 1;
      sr += rgba[i * 4] as number;
      sg += rgba[i * 4 + 1] as number;
      sb += rgba[i * 4 + 2] as number;
      count++;
    }
  }
  if (count === 0 || count === n) return;
  const next = new Uint8Array(n);
  for (let p = 0; p < passes; p++) {
    next.set(known);
    let grew = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (known[i]) continue;
        let r = 0;
        let g = 0;
        let b = 0;
        let c = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= height) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= width || (dx === 0 && dy === 0)) continue;
            const j = yy * width + xx;
            if (!known[j]) continue;
            r += rgba[j * 4] as number;
            g += rgba[j * 4 + 1] as number;
            b += rgba[j * 4 + 2] as number;
            c++;
          }
        }
        if (c === 0) continue;
        rgba[i * 4] = Math.round(r / c);
        rgba[i * 4 + 1] = Math.round(g / c);
        rgba[i * 4 + 2] = Math.round(b / c);
        next[i] = 1;
        grew++;
      }
    }
    known.set(next);
    if (grew === 0) break;
  }
  const mr = Math.round(sr / count);
  const mg = Math.round(sg / count);
  const mb = Math.round(sb / count);
  for (let i = 0; i < n; i++) {
    if (known[i]) continue;
    rgba[i * 4] = mr;
    rgba[i * 4 + 1] = mg;
    rgba[i * 4 + 2] = mb;
  }
}

/** Name stem of a library file (`m/sofa.0123abcd.glb` → `sofa`, `c/dario.26754f25.glb` → `dario`). */
export function stemOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  return base.replace(/\.[0-9a-f]{8}\.[a-z0-9]+$/, '');
}
