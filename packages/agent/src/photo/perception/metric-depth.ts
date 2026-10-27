/**
 * Depth Anything V2 metric indoor small (Hypersim fine-tune, Apache-2.0) on the CPU: depth in METRES (0..20), the same
 * network family as the relative depth in `../depth-model.ts` but trained to give absolute distances in rooms. Fixed
 * 518 x 518 input (the photo is squashed; the output is resampled back to the photo's grid by the caller).
 */
import type { DepthRaster } from '../depth-model';
import { preprocess } from '../depth-model';
import { createSession, loadWeights, METRIC_SET } from './weights';

export interface MetricDepth {
  /** Metres, row-major at the network's 518 x 518 grid. */
  width: number;
  height: number;
  data: Float32Array;
}

export async function estimateMetricDepth(raster: DepthRaster): Promise<{ ok: true; depth: MetricDepth } | { ok: false; reason: string }> {
  const w = await loadWeights(METRIC_SET);
  if (!w.ok) return w;
  try {
    const { ort, session } = await createSession(w.files['model.onnx'] as Uint8Array);
    const input = new ort.Tensor('float32', preprocess(raster, 518, 518), [1, 3, 518, 518]);
    const out = await session.run({ [session.inputNames[0] as string]: input });
    const t = out[session.outputNames[0] as string] as { data: Float32Array; dims: readonly number[] };
    return { ok: true, depth: { width: t.dims[t.dims.length - 1] as number, height: t.dims[t.dims.length - 2] as number, data: Float32Array.from(t.data) } };
  } catch (err) {
    return { ok: false, reason: `the metric depth network failed (${err instanceof Error ? err.message : String(err)})` };
  }
}
