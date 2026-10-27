/**
 * CLIP image embeddings (OpenAI CLIP ViT-B/32, MIT; uint8 ONNX vision tower) of crops of the photo. Two uses:
 *   - a second-pass LABEL for each mask: the embedding is compared with the pre-embedded vocabulary (`clip-vocab.json`, built with
 *     scripts/build-clip-vocab.py), softmax over cosine similarities, so each label has a probability;
 *   - APPEARANCE RETRIEVAL: the same embedding against the pre-embedded library thumbnails (`assets/clip-index.json`, built with
 *     scripts/build-clip-index.ts), so a cane chair crop finds the cane chair kind.
 * Only the vision tower runs at run time (89 MB); the text side is a small table. Downloaded weights are data, never code.
 */
import type { DepthRaster } from '../depth-model';
import { createSession, loadWeights, type WeightSet } from './weights';

const CLIP_REV = 'https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/d15189d7028b43f1d3e65039190477f6af591c2a';
/** OpenAI CLIP ViT-B/32 (MIT licence, github.com/openai/CLIP), Xenova ONNX export, uint8 vision tower. */
export const CLIP_SET: WeightSet = {
  id: 'clip-vit-b32',
  name: 'CLIP ViT-B/32 vision tower (uint8 ONNX)',
  files: [{ file: 'vision_model_uint8.onnx', url: `${CLIP_REV}/onnx/vision_model_uint8.onnx`, sha256: 'b95448754a6ae56964ec80c570c80bb9863787ee85f51b664abed8c0e5f22a7a', bytes: 88_648_915 }],
};

const MEAN = [0.48145466, 0.4578275, 0.40821073];
const STD = [0.26862954, 0.26130258, 0.27577711];
const GREY = [123, 117, 104];

export interface Crop {
  /** [x0, y0, x1, y1] in 0..1 of the photo. */
  box: readonly [number, number, number, number];
  /** Optional 0/1 mask at any size; pixels outside it are painted neutral grey (so the neighbours do not vote). */
  mask?: { width: number; height: number; data: ArrayLike<number> } | undefined;
}

/** CLIP input (1 x 3 x 224 x 224) of a crop: padded box, letterboxed to a square, area-averaged down. */
export function clipInput(r: DepthRaster, c: Crop): Float32Array {
  const [bx0, by0, bx1, by1] = c.box;
  const padX = (bx1 - bx0) * 0.08;
  const padY = (by1 - by0) * 0.08;
  const x0 = Math.max(0, bx0 - padX) * r.width;
  const x1 = Math.min(1, bx1 + padX) * r.width;
  const y0 = Math.max(0, by0 - padY) * r.height;
  const y1 = Math.min(1, by1 + padY) * r.height;
  const side = Math.max(x1 - x0, y1 - y0, 8);
  const ox = (x0 + x1) / 2 - side / 2;
  const oy = (y0 + y1) / 2 - side / 2;
  const out = new Float32Array(3 * 224 * 224);
  const cell = side / 224;
  const m = c.mask;
  for (let j = 0; j < 224; j++) {
    for (let i = 0; i < 224; i++) {
      const sx0 = ox + i * cell;
      const sy0 = oy + j * cell;
      let acc0 = 0, acc1 = 0, acc2 = 0, n = 0;
      const steps = cell > 2 ? 3 : 1;
      for (let a = 0; a < steps; a++) for (let b = 0; b < steps; b++) {
        const sx = sx0 + ((a + 0.5) / steps) * cell;
        const sy = sy0 + ((b + 0.5) / steps) * cell;
        let R = GREY[0] as number, G = GREY[1] as number, B = GREY[2] as number;
        if (sx >= 0 && sy >= 0 && sx < r.width && sy < r.height) {
          const px = Math.floor(sx), py = Math.floor(sy);
          const inside = !m || !!m.data[Math.min(m.height - 1, Math.floor((py / r.height) * m.height)) * m.width + Math.min(m.width - 1, Math.floor((px / r.width) * m.width))];
          if (inside) { const o = (py * r.width + px) * 4; R = r.data[o] as number; G = r.data[o + 1] as number; B = r.data[o + 2] as number; }
        }
        acc0 += R; acc1 += G; acc2 += B; n++;
      }
      const k = j * 224 + i;
      out[k] = (acc0 / n / 255 - (MEAN[0] as number)) / (STD[0] as number);
      out[224 * 224 + k] = (acc1 / n / 255 - (MEAN[1] as number)) / (STD[1] as number);
      out[2 * 224 * 224 + k] = (acc2 / n / 255 - (MEAN[2] as number)) / (STD[2] as number);
    }
  }
  return out;
}

export interface Clip {
  /** Unit-length embedding (512) of each crop. */
  embed(r: DepthRaster, crops: Crop[]): Promise<Float32Array[]>;
  dispose(): Promise<void>;
}

export async function loadClip(): Promise<{ ok: true; model: Clip } | { ok: false; reason: string }> {
  const w = await loadWeights(CLIP_SET);
  if (!w.ok) return w;
  try {
    const { ort, session } = await createSession(w.files['vision_model_uint8.onnx'] as Uint8Array);
    return {
      ok: true,
      model: {
        async embed(r, crops) {
          const out: Float32Array[] = [];
          for (const c of crops) {
            const t = new ort.Tensor('float32', clipInput(r, c), [1, 3, 224, 224]);
            const res = await session.run({ pixel_values: t });
            const e = Float32Array.from((res.image_embeds as { data: Float32Array }).data);
            let n = 0;
            for (const v of e) n += v * v;
            n = Math.sqrt(n) || 1;
            out.push(e.map((v) => v / n));
          }
          return out;
        },
        async dispose() { await session.release?.(); },
      },
    };
  } catch (err) {
    return { ok: false, reason: `CLIP vision tower failed (${err instanceof Error ? err.message : String(err)})` };
  }
}

// ---- vocabulary classification ----

const b64ToInt8 = (s: string): Int8Array => {
  const bin = typeof atob === 'function' ? atob(s) : Buffer.from(s, 'base64').toString('binary');
  const a = new Int8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = (bin.charCodeAt(i) << 24) >> 24;
  return a;
};
export interface VocabEntry {
  label: string;
  variant: string;
  emb: Float32Array;
}
let vocab: VocabEntry[] | null = null;
/** The pre-embedded vocabulary (a lazy chunk: 88 KB the studio's first load does not carry). */
export async function clipVocabulary(): Promise<VocabEntry[]> {
  if (vocab) return vocab;
  const m = (await import('./clip-vocab.json')) as { default?: unknown };
  const j = (m.default ?? m) as { labels: { label: string; variant: string; emb: string }[] };
  vocab = j.labels.map((l) => ({ label: l.label, variant: l.variant, emb: Float32Array.from(b64ToInt8(l.emb), (v) => v / 127) }));
  return vocab;
}

export const dotv = (a: ArrayLike<number>, b: ArrayLike<number>): number => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] as number) * (b[i] as number);
  return s;
};

export interface LabelGuess {
  label: string;
  /** Probability: softmax over the vocabulary (temperature 100, CLIP's own), summed over the synonyms of the label. */
  p: number;
}
/**
 * Probabilities over the vocabulary labels for one or more embeddings of the same object (a box crop with its surroundings and a
 * masked crop: their similarities are averaged), best first. `prefer` adds a log-odds boost to a label (the detector's own name).
 */
export function classifyEmbedding(v: readonly VocabEntry[], e: ArrayLike<number> | ArrayLike<number>[], prefer: { label: string; boost: number }[] = []): LabelGuess[] {
  const es: ArrayLike<number>[] = typeof (e as ArrayLike<number>)[0] === 'number' ? [e as ArrayLike<number>] : (e as ArrayLike<number>[]);
  const logit = v.map((x) => (100 * es.reduce((s, q) => s + dotv(q, x.emb), 0)) / es.length + (prefer.find((q) => q.label === x.label)?.boost ?? 0));
  const mx = Math.max(...logit);
  const ex = logit.map((l) => Math.exp(l - mx));
  const s = ex.reduce((a, b) => a + b, 0);
  const by = new Map<string, number>();
  v.forEach((x, i) => by.set(x.label, (by.get(x.label) ?? 0) + (ex[i] as number) / s));
  return [...by.entries()].map(([label, p]) => ({ label, p })).sort((a, b) => b.p - a.p);
}
