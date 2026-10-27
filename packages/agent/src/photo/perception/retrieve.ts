/**
 * Appearance retrieval: rank the model library by image similarity to a crop of the photo (CLIP embeddings of the library
 * thumbnails, `assets/clip-index.json`, 0.5 MB, built by scripts/build-clip-index.ts). Advisory: the top few go to the model as
 * suggestions next to the text search; a thumbnail is a render of the model, so a similar look is evidence, not proof.
 */
import { describeModel, loadCatalog, type ModelHit } from '@aether/assets';
import { dotv } from './clip';

interface Index {
  ids: string[];
  emb: Float32Array;
}
let loading: Promise<Index | null> | null = null;

function loadIndex(): Promise<Index | null> {
  loading ??= import('../../../../../assets/clip-index.json')
    .then((m) => {
      const j = (m as { default?: unknown }).default ?? m;
      const d = j as { ids: string[]; emb: string; dim: number };
      const bin = typeof atob === 'function' ? atob(d.emb) : Buffer.from(d.emb, 'base64').toString('binary');
      const emb = new Float32Array(bin.length);
      for (let i = 0; i < bin.length; i++) emb[i] = ((bin.charCodeAt(i) << 24) >> 24) / 127;
      return { ids: d.ids, emb };
    })
    .catch(() => null);
  return loading;
}

export interface Similar {
  id: string;
  score: number;
}
/** The library entries most like an embedding, best first. */
export async function rankLike(e: ArrayLike<number>, limit = 3, only?: (id: string) => boolean): Promise<Similar[]> {
  const idx = await loadIndex();
  if (!idx) return [];
  const out: Similar[] = [];
  for (let i = 0; i < idx.ids.length; i++) {
    const id = idx.ids[i] as string;
    if (only && !only(id)) continue;
    out.push({ id, score: dotv(e, idx.emb.subarray(i * 512, (i + 1) * 512)) });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** The model-facing lines for the top matches (the same facts as find_model). */
export async function similarModelsText(e: ArrayLike<number>, limit = 3, notes = ''): Promise<{ text: string; ids: string[] }> {
  const top = await rankLike(e, limit);
  if (top.length === 0) return { text: 'Appearance retrieval is not available (no library index).', ids: [] };
  const cat = await loadCatalog();
  const byId = new Map(cat.entries.map((x) => [x.id, x]));
  const lines: string[] = [];
  const ids: string[] = [];
  for (const t of top) {
    const entry = byId.get(t.id);
    if (!entry) continue;
    const hit: ModelHit = { entry, score: t.score * 100, notes: [`looks like the crop (image similarity ${t.score.toFixed(2)})`] };
    lines.push(describeModel(hit));
    ids.push(t.id);
  }
  return { text: `Library models that LOOK like the crop${notes ? ` (${notes})` : ''}:\n${lines.join('\n')}\nPlace with place_items {"kind":"model:<id>","room":...,"fit":[w,h,d]}; check the kind and size against the photo before using one.`, ids };
}
