/**
 * Florence-2 base (MIT) on the CPU: open-vocabulary detection and phrase grounding with boxes. A small, self-contained
 * runner: byte-level BPE tokenizer (from the model's tokenizer.json), the four ONNX parts (vision tower, token embedding,
 * encoder, merged decoder with key/value cache) and greedy decoding. Boxes come out as <loc_N> tokens (1000 bins); the
 * confidence of a box is the mean probability of its four coordinate tokens (the model gives no score of its own).
 */
import type { DepthRaster } from '../depth-model';
import { preprocess } from '../depth-model';
import { createSession, FLORENCE_SET, loadWeights } from './weights';

export interface RawBox {
  label: string;
  /** [x0, y0, x1, y1] in 0..1 of the picture, origin top-left. */
  box: [number, number, number, number];
  confidence: number;
}

const LOC0 = 50269;
const LOC_N = 1000;
const EOS = 2;
const PAD = 1;

// ---- tokenizer ----
interface TokenizerJson {
  model: { vocab: Record<string, number>; merges: (string | [string, string])[] };
}
function bytesToUnicode(): { enc: string[]; dec: Map<string, number> } {
  const bs: number[] = [];
  for (let i = 33; i <= 126; i++) bs.push(i);
  for (let i = 161; i <= 172; i++) bs.push(i);
  for (let i = 174; i <= 255; i++) bs.push(i);
  const cs = bs.slice();
  let n = 0;
  for (let b = 0; b < 256; b++) if (!bs.includes(b)) { bs.push(b); cs.push(256 + n++); }
  const enc: string[] = new Array(256);
  const dec = new Map<string, number>();
  bs.forEach((b, i) => { enc[b] = String.fromCodePoint(cs[i] as number); dec.set(String.fromCodePoint(cs[i] as number), b); });
  return { enc, dec };
}
const PRE = /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu;

export class BpeTokenizer {
  private ranks = new Map<string, number>();
  private vocab: Map<string, number>;
  private inv = new Map<number, string>();
  private u = bytesToUnicode();
  private cache = new Map<string, number[]>();
  constructor(json: TokenizerJson) {
    this.vocab = new Map(Object.entries(json.model.vocab));
    for (const [k, v] of this.vocab) this.inv.set(v, k);
    json.model.merges.forEach((m, i) => this.ranks.set(typeof m === 'string' ? m : `${m[0]} ${m[1]}`, i));
  }
  private bpe(word: string): number[] {
    const hit = this.cache.get(word);
    if (hit) return hit;
    let parts = [...word];
    while (parts.length > 1) {
      let best = -1;
      let bi = -1;
      for (let i = 0; i < parts.length - 1; i++) {
        const r = this.ranks.get(`${parts[i]} ${parts[i + 1]}`);
        if (r !== undefined && (best < 0 || r < best)) { best = r; bi = i; }
      }
      if (bi < 0) break;
      parts = [...parts.slice(0, bi), (parts[bi] as string) + (parts[bi + 1] as string), ...parts.slice(bi + 2)];
    }
    const ids = parts.map((p) => this.vocab.get(p) ?? 3);
    this.cache.set(word, ids);
    return ids;
  }
  /** `<s> text </s>`. */
  encode(text: string): number[] {
    const out = [0];
    for (const m of text.match(PRE) ?? []) {
      const mapped = [...new TextEncoder().encode(m)].map((b) => this.u.enc[b] as string).join('');
      out.push(...this.bpe(mapped));
    }
    out.push(EOS);
    return out;
  }
  decode(ids: number[]): string {
    const chars = ids.map((i) => this.inv.get(i) ?? '').join('');
    const bytes = [...chars].map((c) => this.u.dec.get(c) ?? 63);
    return new TextDecoder().decode(new Uint8Array(bytes));
  }
}

// ---- runner ----
type Tensor = { data: any; dims: readonly number[] };
export interface Florence {
  /** Run the vision tower once for a picture; later calls reuse it. */
  setImage(raster: DepthRaster): Promise<void>;
  /** Boxes for a task prompt (`<OD>`, `<OPEN_VOCABULARY_DETECTION>` with `input`, `<CAPTION_TO_PHRASE_GROUNDING>` with `input`). */
  detect(task: '<OD>' | '<OPEN_VOCABULARY_DETECTION>' | '<CAPTION_TO_PHRASE_GROUNDING>' | '<DENSE_REGION_CAPTION>' | '<REGION_PROPOSAL>', input?: string, maxTokens?: number): Promise<RawBox[]>;
  /** A caption (`<CAPTION>`, `<DETAILED_CAPTION>`, `<MORE_DETAILED_CAPTION>`). */
  caption(task: '<CAPTION>' | '<DETAILED_CAPTION>' | '<MORE_DETAILED_CAPTION>'): Promise<string>;
  /** Free the sessions (the weights are large). */
  dispose(): Promise<void>;
}

const PROMPTS: Record<string, string> = {
  '<OD>': 'Locate the objects with category name in the image.',
  '<DENSE_REGION_CAPTION>': 'Locate the objects in the image, with their descriptions.',
  '<REGION_PROPOSAL>': 'Locate the region proposals in the image.',
  '<CAPTION>': 'What does the image describe?',
  '<DETAILED_CAPTION>': 'Describe in detail what is shown in the image.',
  '<MORE_DETAILED_CAPTION>': 'Describe with a paragraph what is shown in the image.',
  '<OPEN_VOCABULARY_DETECTION>': 'Locate {input} in the image.',
  '<CAPTION_TO_PHRASE_GROUNDING>': 'Locate the phrases in the caption: {input}',
};

/** Split generated ids into labelled boxes. Exported for tests. */
export function parseBoxes(ids: number[], probs: number[], decode: (ids: number[]) => string): RawBox[] {
  const out: RawBox[] = [];
  let text: number[] = [];
  let label = '';
  let locs: number[] = [];
  let lp: number[] = [];
  const flushText = (): void => {
    if (text.length > 0) { label = decode(text).trim(); text = []; }
  };
  ids.forEach((id, i) => {
    if (id >= LOC0 && id < LOC0 + LOC_N) {
      flushText();
      locs.push(id - LOC0);
      lp.push(probs[i] ?? 0);
      if (locs.length === 4) {
        const [a, b, c, d] = locs.map((v) => (v + 0.5) / LOC_N) as [number, number, number, number];
        out.push({ label, box: [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)], confidence: lp.reduce((s, v) => s + v, 0) / 4 });
        locs = [];
        lp = [];
      }
    } else if (id > EOS && id < 50265) {
      if (locs.length > 0) { locs = []; lp = []; }
      text.push(id);
    }
  });
  return out;
}

export async function loadFlorence(): Promise<{ ok: true; model: Florence; bytes: number } | { ok: false; reason: string }> {
  const w = await loadWeights(FLORENCE_SET);
  if (!w.ok) return w;
  try {
    const f = w.files;
    const tok = new BpeTokenizer(JSON.parse(new TextDecoder().decode(f['tokenizer.json'])));
    const vision = await createSession(f['vision_encoder_uint8.onnx'] as Uint8Array);
    const ort = vision.ort;
    const embed = (await createSession(f['embed_tokens_uint8.onnx'] as Uint8Array)).session;
    const encoder = (await createSession(f['encoder_model_uint8.onnx'] as Uint8Array)).session;
    const decoder = (await createSession(f['decoder_model_merged_uint8.onnx'] as Uint8Array)).session;
    let imageFeatures: Tensor | null = null;
    const i64 = (a: number[], dims: number[]): any => new ort.Tensor('int64', BigInt64Array.from(a.map(BigInt)), dims);
    const embedIds = async (ids: number[]): Promise<Tensor> => (await embed.run({ input_ids: i64(ids, [1, ids.length]) })).inputs_embeds as Tensor;

    const generate = async (prompt: string, maxTokens: number): Promise<{ ids: number[]; probs: number[] }> => {
      if (!imageFeatures) throw new Error('no image set');
      const pids = tok.encode(prompt);
      const pe = await embedIds(pids);
      const nImg = imageFeatures.dims[1] as number;
      const hid = imageFeatures.dims[2] as number;
      const merged = new Float32Array((nImg + pids.length) * hid);
      merged.set(imageFeatures.data as Float32Array, 0);
      merged.set(pe.data as Float32Array, nImg * hid);
      const L = nImg + pids.length;
      const attn = i64(new Array(L).fill(1), [1, L]);
      const enc = (await encoder.run({ attention_mask: attn, inputs_embeds: new ort.Tensor('float32', merged, [1, L, hid]) })).last_hidden_state as Tensor;
      const kv: Record<string, any> = {};
      const heads = 12;
      const hd = 64;
      for (let l = 0; l < 6; l++) for (const a of ['decoder', 'encoder']) for (const k of ['key', 'value']) kv[`past_key_values.${l}.${a}.${k}`] = new ort.Tensor('float32', new Float32Array(0), [1, heads, 0, hd]);
      const out: number[] = [];
      const probs: number[] = [];
      let cur = [EOS];
      let first = true;
      for (let step = 0; step < maxTokens + 1; step++) {
        const e = await embedIds(cur);
        const feeds: Record<string, any> = { encoder_attention_mask: attn, encoder_hidden_states: enc, inputs_embeds: e, use_cache_branch: new ort.Tensor('bool', [!first], [1]), ...kv };
        const r = await decoder.run(feeds);
        const logits = r.logits as Tensor;
        const V = logits.dims[2] as number;
        const base = ((logits.dims[1] as number) - 1) * V;
        const d = logits.data as Float32Array;
        let best = 0;
        let bv = -Infinity;
        for (let i = 0; i < V; i++) { const v = d[base + i] as number; if (v > bv) { bv = v; best = i; } }
        if (step === 0) best = 0; // forced beginning of sentence
        let z = 0;
        for (let i = 0; i < V; i++) z += Math.exp((d[base + i] as number) - bv);
        // A coordinate bin is only 1/1000 of the picture, so the mass of the chosen bin and its 3 neighbours each way is the confidence.
        let p = 1 / z;
        if (best >= LOC0 && best < LOC0 + LOC_N) {
          p = 0;
          for (let i = Math.max(LOC0, best - 3); i <= Math.min(LOC0 + LOC_N - 1, best + 3); i++) p += Math.exp((d[base + i] as number) - bv) / z;
        }
        for (const key of Object.keys(r)) {
          if (!key.startsWith('present.')) continue;
          const name = key.replace('present.', 'past_key_values.');
          if (first || key.includes('.decoder.')) kv[name] = r[key];
        }
        first = false;
        if (step > 0) {
          if (best === EOS) break;
          out.push(best);
          probs.push(p);
        }
        cur = [best];
      }
      return { ids: out, probs };
    };

    const model: Florence = {
      async setImage(raster) {
        const input = new ort.Tensor('float32', preprocess(raster, 768, 768), [1, 3, 768, 768]);
        imageFeatures = (await vision.session.run({ pixel_values: input })).image_features as Tensor;
      },
      async detect(task, input, maxTokens = 320) {
        const prompt = (PROMPTS[task] as string).replace('{input}', input ?? '');
        const g = await generate(prompt, maxTokens);
        return parseBoxes(g.ids, g.probs, (ids) => tok.decode(ids));
      },
      async dispose() {
        for (const x of [vision.session, embed, encoder, decoder]) await x.release?.().catch?.(() => undefined);
        imageFeatures = null;
      },
      async caption(task) {
        const g = await generate(PROMPTS[task] as string, 160);
        return tok.decode(g.ids.filter((i) => i > EOS && i < 50265)).trim();
      },
    };
    return { ok: true, model, bytes: FLORENCE_SET.files.reduce((s, x) => s + x.bytes, 0) };
  } catch (err) {
    return { ok: false, reason: `Florence-2 could not start (${err instanceof Error ? err.message : String(err)})` };
  }
}
