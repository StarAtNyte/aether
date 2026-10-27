/**
 * Pinned weight sets for the perception models (open-vocabulary detection, segmentation, metric depth). Same rules as the
 * depth network (`../depth-model.ts`): nothing is in git; each file is fetched on first use from a pinned Hugging Face
 * revision, checked against a pinned SHA-256 and cached (Node: `$AETHER_HOME/models/perception/<set>` or
 * `~/.local/share/aether/models/perception/<set>`; browser: the Cache API). Downloaded files are untrusted data: they are only
 * ever handed to the ONNX runtime (or parsed as JSON), never executed. Every failure returns `{ ok: false, reason }`.
 * `AETHER_PERCEPTION=off` turns the whole layer off. Licence, source and checksums are recorded in docs/THIRD_PARTY.md.
 */

export interface WeightFile {
  file: string;
  url: string;
  sha256: string;
  bytes: number;
}
export interface WeightSet {
  id: string;
  name: string;
  files: readonly WeightFile[];
}

const FLORENCE = 'https://huggingface.co/onnx-community/Florence-2-base/resolve/d59e079711c57174f29265539fb4cc9f0f335916';
const SAM = 'https://huggingface.co/onnx-community/sam2.1-hiera-tiny-ONNX/resolve/814a066640debee5a91e70aa401fb8e17e030503';
const METRIC = 'https://huggingface.co/77ukhtar/depth-anything-v2-metric-onnx/resolve/a4259a3c45137b6eb32c84fcd95b86cd54c255b9';

/** Florence-2 base (MIT), unsigned 8-bit ONNX: vision tower, embedding, encoder, merged decoder, tokenizer. */
export const FLORENCE_SET: WeightSet = {
  id: 'florence2-base',
  name: 'Florence-2 base (uint8 ONNX)',
  files: [
    { file: 'vision_encoder_uint8.onnx', url: `${FLORENCE}/onnx/vision_encoder_uint8.onnx`, sha256: '56351a93ecfb61a0384dc63c130cc5bdeea8de1a85f172e109821c7cc956be5a', bytes: 93_800_000 },
    { file: 'embed_tokens_uint8.onnx', url: `${FLORENCE}/onnx/embed_tokens_uint8.onnx`, sha256: '7e2c5422b6b89e46a274408a349b38f162fdd59a69097cc2f6e62be62f41ad6f', bytes: 39_400_000 },
    { file: 'encoder_model_uint8.onnx', url: `${FLORENCE}/onnx/encoder_model_uint8.onnx`, sha256: 'ebfba7f27081770cad3c94ec7b9eab1d7d829fa2ff00198eae6c4bf10b601368', bytes: 43_700_000 },
    { file: 'decoder_model_merged_uint8.onnx', url: `${FLORENCE}/onnx/decoder_model_merged_uint8.onnx`, sha256: 'c8c29f0bd7af256fd52a29237fc31bbcc525d570415d3a7d601e21b09aa1e4d0', bytes: 98_200_000 },
    { file: 'tokenizer.json', url: `${FLORENCE}/tokenizer.json`, sha256: 'd69dcdb2323e124ac4f800cb9863ddccea0d7bb11e16125e8df3bd60f2f8aeac', bytes: 2_300_000 },
  ],
};

/** SAM 2.1 Hiera tiny (Apache-2.0 upstream), unsigned 8-bit ONNX: image encoder and prompt-encoder + mask decoder with their external data. */
export const SAM_SET: WeightSet = {
  id: 'sam2.1-tiny',
  name: 'SAM 2.1 Hiera tiny (uint8 ONNX)',
  files: [
    { file: 'vision_encoder_uint8.onnx', url: `${SAM}/onnx/vision_encoder_uint8.onnx`, sha256: '5317895c0ac4bafbf34b5e1544eecd0b7bdda878f9b21578f474c85da57ee733', bytes: 400_000 },
    { file: 'vision_encoder_uint8.onnx_data', url: `${SAM}/onnx/vision_encoder_uint8.onnx_data`, sha256: 'ea1f677596dc82cef0dc317d78135d892f4b26e20a4439f899aa58d84965b324', bytes: 52_600_000 },
    { file: 'prompt_encoder_mask_decoder_uint8.onnx', url: `${SAM}/onnx/prompt_encoder_mask_decoder_uint8.onnx`, sha256: 'bfa29b39f515785588ae99d10defed9343a9267373be5286c3a8da8e7a19e3e8', bytes: 300_000 },
    { file: 'prompt_encoder_mask_decoder_uint8.onnx_data', url: `${SAM}/onnx/prompt_encoder_mask_decoder_uint8.onnx_data`, sha256: '4d661fe0aa3a77b4ae4461dfc02b3c5e37ebf52d8cb036293f8aa99786d841f8', bytes: 8_700_000 },
  ],
};

/** Depth Anything V2 metric indoor small (Hypersim, Apache-2.0 upstream), fp32 ONNX export, fixed 518 x 518 input, output in metres. */
export const METRIC_SET: WeightSet = {
  id: 'dav2-metric-indoor-small',
  name: 'Depth Anything V2 metric indoor small (ONNX)',
  files: [{ file: 'model.onnx', url: `${METRIC}/model.onnx`, sha256: 'badcaa28c923da4b0bfaa370ed709acfa00e9f743d295d5443e2149a383413c9', bytes: 98_941_181 }],
};

export type Loaded = { ok: true; files: Record<string, Uint8Array> } | { ok: false; reason: string };

const isNode = typeof process !== 'undefined' && !!process.versions?.node && typeof (globalThis as { window?: unknown }).window === 'undefined';
const nodeImport = (name: string): Promise<any> => import(/* @vite-ignore */ name);
const env = (k: string): string | undefined => (typeof process !== 'undefined' ? process.env?.[k] : undefined);

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function download(set: WeightSet, f: WeightFile): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; reason: string }> {
  try {
    const res = await fetch(f.url, { signal: AbortSignal.timeout(300_000) });
    if (!res.ok) return { ok: false, reason: `${set.name}: ${f.file} is not cached and could not be fetched (HTTP ${res.status})` };
    const bytes = new Uint8Array(await res.arrayBuffer());
    if ((await sha256Hex(bytes)) !== f.sha256) return { ok: false, reason: `${set.name}: the downloaded ${f.file} does not match its pinned SHA-256 and was discarded` };
    return { ok: true, bytes };
  } catch (err) {
    return { ok: false, reason: `${set.name}: ${f.file} is not cached and could not be fetched (${err instanceof Error ? err.message : String(err)}); offline, so this model is skipped` };
  }
}

/** Where a set is cached in Node (for the CLI and the docs). */
export async function weightsDir(set: WeightSet): Promise<string | null> {
  if (!isNode) return null;
  const path = await nodeImport('node:path');
  const os = await nodeImport('node:os');
  return path.join(env('AETHER_HOME') ?? path.join(os.homedir(), '.local', 'share', 'aether'), 'models', 'perception', set.id);
}

/** All files of a set, checked, or the reason one is missing. `AETHER_PERCEPTION_NO_FETCH=1` never touches the network. */
export async function loadWeights(set: WeightSet): Promise<Loaded> {
  if (env('AETHER_PERCEPTION') === 'off') return { ok: false, reason: 'perception models are turned off (AETHER_PERCEPTION=off)' };
  const files: Record<string, Uint8Array> = {};
  try {
    if (isNode) {
      const fs = await nodeImport('node:fs/promises');
      const path = await nodeImport('node:path');
      const dir = (await weightsDir(set)) as string;
      for (const f of set.files) {
        const file = path.join(dir, f.file);
        const cached = await fs.readFile(file).then((b: Buffer) => new Uint8Array(b.buffer, b.byteOffset, b.byteLength), () => null);
        if (cached && (await sha256Hex(cached)) === f.sha256) {
          files[f.file] = cached;
          continue;
        }
        if (env('AETHER_PERCEPTION_NO_FETCH') === '1') return { ok: false, reason: `${set.name}: ${f.file} is not cached (fetching is turned off)` };
        const got = await download(set, f);
        if (!got.ok) return got;
        await fs.mkdir(dir, { recursive: true });
        const tmp = `${file}.${process.pid}.part`;
        await fs.writeFile(tmp, got.bytes);
        await fs.rename(tmp, file);
        files[f.file] = got.bytes;
      }
      return { ok: true, files };
    }
    const cache = typeof caches !== 'undefined' ? await caches.open('aether-models') : null;
    for (const f of set.files) {
      const hit = cache ? await cache.match(f.url) : null;
      if (hit) {
        const bytes = new Uint8Array(await hit.arrayBuffer());
        if ((await sha256Hex(bytes)) === f.sha256) {
          files[f.file] = bytes;
          continue;
        }
      }
      const got = await download(set, f);
      if (!got.ok) return got;
      if (cache) await cache.put(f.url, new Response(got.bytes as unknown as BodyInit)).catch(() => undefined);
      files[f.file] = got.bytes;
    }
    return { ok: true, files };
  } catch (err) {
    return { ok: false, reason: `${set.name} could not be loaded (${err instanceof Error ? err.message : String(err)})` };
  }
}

/** Start an ONNX runtime session on the CPU (WebAssembly). `external` maps a data file name to its bytes. */
export async function createSession(bytes: Uint8Array, external: { path: string; data: Uint8Array }[] = []): Promise<{ ort: any; session: any }> {
  const ort: any = await import('onnxruntime-web');
  const cores = isNode ? ((await nodeImport('node:os')).availableParallelism?.() ?? 2) : (navigator.hardwareConcurrency ?? 2);
  ort.env.wasm.numThreads = Math.max(1, Math.min(8, Math.floor(cores / 2)));
  ort.env.logLevel = 'error';
  const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all', ...(external.length > 0 ? { externalData: external } : {}) });
  return { ort, session };
}
