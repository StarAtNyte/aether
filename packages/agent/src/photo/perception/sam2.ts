/**
 * SAM 2.1 Hiera tiny (Apache-2.0 upstream) on the CPU: a box prompt to a pixel mask. The image encoder runs once per
 * photo (1024 x 1024 squashed input); each box then costs one small decoder call. Masks come back as 0/1 rasters at the
 * photo's size.
 */
import type { DepthRaster } from '../depth-model';
import { preprocess } from '../depth-model';
import { createSession, loadWeights, SAM_SET } from './weights';

export interface Mask {
  width: number;
  height: number;
  /** 1 = inside; row-major. */
  data: Uint8Array;
}

export interface Segmenter {
  setImage(raster: DepthRaster): Promise<void>;
  /** Mask for a box [x0,y0,x1,y1] in 0..1 of the photo; `score` is the model's own quality estimate (0..1). */
  segment(box: readonly [number, number, number, number]): Promise<{ mask: Mask; score: number }>;
  dispose(): Promise<void>;
}

export async function loadSam(): Promise<{ ok: true; model: Segmenter } | { ok: false; reason: string }> {
  const w = await loadWeights(SAM_SET);
  if (!w.ok) return w;
  try {
    const f = w.files;
    const enc = await createSession(f['vision_encoder_uint8.onnx'] as Uint8Array, [{ path: 'vision_encoder_uint8.onnx_data', data: f['vision_encoder_uint8.onnx_data'] as Uint8Array }]);
    const dec = (await createSession(f['prompt_encoder_mask_decoder_uint8.onnx'] as Uint8Array, [{ path: 'prompt_encoder_mask_decoder_uint8.onnx_data', data: f['prompt_encoder_mask_decoder_uint8.onnx_data'] as Uint8Array }])).session;
    const ort = enc.ort;
    let embeds: Record<string, unknown> = {};
    let size = { width: 1, height: 1 };
    const model: Segmenter = {
      async setImage(raster) {
        size = { width: raster.width, height: raster.height };
        const input = new ort.Tensor('float32', preprocess(raster, 1024, 1024), [1, 3, 1024, 1024]);
        const out = await enc.session.run({ pixel_values: input });
        embeds = { 'image_embeddings.0': out['image_embeddings.0'], 'image_embeddings.1': out['image_embeddings.1'], 'image_embeddings.2': out['image_embeddings.2'] };
      },
      async dispose() {
        for (const x of [enc.session, dec]) await x.release?.().catch?.(() => undefined);
        embeds = {};
      },
      async segment(box) {
        const [x0, y0, x1, y1] = box;
        const pts = new ort.Tensor('float32', new Float32Array([((x0 + x1) / 2) * 1024, ((y0 + y1) / 2) * 1024]), [1, 1, 1, 2]);
        const lab = new ort.Tensor('int64', BigInt64Array.from([1n]), [1, 1, 1]);
        const bx = new ort.Tensor('float32', new Float32Array([x0 * 1024, y0 * 1024, x1 * 1024, y1 * 1024]), [1, 1, 4]);
        const out = await dec.run({ input_points: pts, input_labels: lab, input_boxes: bx, ...embeds });
        const m = out.pred_masks as { data: Float32Array; dims: readonly number[] };
        const iou = out.iou_scores as { data: Float32Array };
        const nm = m.dims[m.dims.length - 3] as number;
        const mh = m.dims[m.dims.length - 2] as number;
        const mw = m.dims[m.dims.length - 1] as number;
        let bi = 0;
        for (let i = 1; i < nm; i++) if ((iou.data[i] as number) > (iou.data[bi] as number)) bi = i;
        const { width, height } = size;
        const data = new Uint8Array(width * height);
        const off = bi * mh * mw;
        for (let y = 0; y < height; y++) {
          const fy = Math.max(0, Math.min(mh - 1, ((y + 0.5) * mh) / height - 0.5));
          const ya = Math.floor(fy);
          const yb = Math.min(mh - 1, ya + 1);
          const ty = fy - ya;
          for (let x = 0; x < width; x++) {
            const fx = Math.max(0, Math.min(mw - 1, ((x + 0.5) * mw) / width - 0.5));
            const xa = Math.floor(fx);
            const xb = Math.min(mw - 1, xa + 1);
            const tx = fx - xa;
            const g = (yy: number, xx: number): number => m.data[off + yy * mw + xx] as number;
            const v = (g(ya, xa) * (1 - tx) + g(ya, xb) * tx) * (1 - ty) + (g(yb, xa) * (1 - tx) + g(yb, xb) * tx) * ty;
            if (v > 0) data[y * width + x] = 1;
          }
        }
        return { mask: { width, height, data }, score: Math.max(0, Math.min(1, iou.data[bi] as number)) };
      },
    };
    return { ok: true, model };
  } catch (err) {
    return { ok: false, reason: `SAM 2 could not start (${err instanceof Error ? err.message : String(err)})` };
  }
}
