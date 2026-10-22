/**
 * The first texture pass of a room built from a photograph: the surfaces and large soft pieces the photograph shows clearly are
 * sampled from it (rectified through the solved camera, made seamless, de-lit) and applied, before the first comparison, so the
 * renders the assistant judges already show the real surfaces. What the photograph cannot show keeps its procedural finish; the
 * assistant can change either with `make_texture` (a prompt for an AI image model, another region of the photo, or the library).
 *
 * Needs the host to decode and encode pictures and to keep texture sets; without them the pass is skipped and the room is exactly
 * what it was.
 */
import { deriveTextures } from '@aether/procgen/photo-texture';
import type { RoomDescription } from '@aether/arch/photo';
import type { ExecutorContext } from '../executor';
import { makeTextureTool, type PhotoSource } from '../textures';
import type { AgentEvent } from '../types';

/** The photograph decoded sharp enough for textures (up to 1280 px), with what the tool needs to sample it. */
export async function textureSource(ctx: ExecutorContext, image: string, desc: RoomDescription): Promise<PhotoSource | null> {
  const host = ctx.host;
  if (typeof host.decodeImage !== 'function' || typeof host.storeTexture !== 'function' || typeof host.encodeTextureMap !== 'function') return null;
  const raster = await host.decodeImage(image, 1280).catch(() => null);
  if (!raster || raster.width < 160 || raster.height < 120) return null;
  return { raster, description: desc, dataUrl: image, name: 'your photo' };
}

/** What a pass did, for the final message. */
export interface TexturePassResult {
  applied: string[];
  skipped: Array<{ id: string; reason: string }>;
}

/** Sample the room's surfaces and pieces from the photograph and apply what reads well. */
export async function* texturePass(ctx: ExecutorContext, source: PhotoSource): AsyncGenerator<AgentEvent, TexturePassResult> {
  const result: TexturePassResult = { applied: [], skipped: [] };
  const found = deriveTextures(source.raster, source.description);
  for (const s of found.skipped) result.skipped.push({ id: s.target.id, reason: s.reason });
  const worth = found.textures.filter((t) => t.quality !== 'weak');
  for (const t of found.textures) if (t.quality === 'weak') result.skipped.push({ id: t.target.id, reason: `a weak sample (${t.notes.slice(-1)[0] ?? 'small clean area'})` });
  // Surfaces first, then the pieces.
  const order = [...worth].sort((a, b) => (a.target.kind === 'piece' ? 1 : 0) - (b.target.kind === 'piece' ? 1 : 0));
  yield { type: 'photo', phase: 'textures', text: `Sampling the real surfaces from your photo: ${order.map((t) => t.target.label).join(', ') || 'nothing clear enough'}.` };
  for (const t of order) {
    const out = await makeTextureTool(ctx, { target: t.target.id, source: 'photo', from_photo_region: true, message: `Texture ${t.target.label} from the photo` });
    for (const ev of out.events) yield ev;
    if (out.edited && /photographed/.test(out.content)) result.applied.push(t.target.id);
    else result.skipped.push({ id: t.target.id, reason: out.content.split('\n')[0]?.slice(0, 160) ?? 'not applied' });
  }
  return result;
}

/** One sentence for the user about what the pass did (the sources are named, never blurred). */
export function texturePassLine(r: TexturePassResult): string {
  if (r.applied.length === 0 && r.skipped.length === 0) return '';
  const why = (x: { id: string; reason: string }): string => `${x.id} (${x.reason.replace(/\.$/, '').slice(0, 90)})`;
  const kept = r.skipped.length > 0 ? ` Procedural finish kept for ${r.skipped.slice(0, 5).map(why).join('; ')}${r.skipped.length > 5 ? `; and ${r.skipped.length - 5} more` : ''}.` : '';
  // A surface the camera barely sees stays procedural; the assistant (not a rule) picks what suits the slice that shows.
  const bare = r.skipped.filter((x) => (x.id === 'floor' || x.id.startsWith('wall-')) && /visible|clear square|obliq/.test(x.reason)).map((x) => x.id);
  const next = bare.length > 0 ? ` Not sampled because the camera barely sees ${bare.join(', ')}: look at the slice that shows and choose the library finish and colour that match it, or make_texture {target, prompt} for an image-model surface, then compare.` : '';
  return r.applied.length > 0 ? `Textures photographed from your photo: ${r.applied.join(', ')}.${kept}${next}` : `No surface was clear enough in the photo to texture.${kept}${next}`;
}
