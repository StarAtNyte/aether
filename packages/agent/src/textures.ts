/**
 * `make_texture`: give a surface or a piece a real texture, from the best source available, and say honestly which one it was.
 *
 *   1. an AI image model (Codex's image tool, an OpenAI-compatible Images API) when one is connected and the model asked for it
 *      with a `prompt`: the picture is turned into a seamless, de-lit PBR set;
 *   2. the user's own photograph: the surface or piece is sampled from the photo (floors and walls rectified through the solved
 *      camera), made seamless and de-lit;
 *   3. the procedural library: the nearest finish, no texture set.
 *
 * Nothing here is required: without an image model or a photo the tool still works (the third source) and says so. The model that
 * calls it decides whether the result is good by looking at the render next to the photo; the numbers it returns are advisory.
 */
import { z } from 'zod';
import { applyArchOps, buildFurniture, finishFromWords, furnitureById, planOf, FINISHES, type PlanRoom } from '@aether/arch';
import { type RoomDescription } from '@aether/arch/photo';
import { type Entity, type MaterialFinish, type MaterialSpec, type Patch, type TextureSetDef, type TextureTier, type WorldDoc } from '@aether/core';
import { buildTextureSet, deriveFromSwatch, textureReader, textureTargets, MASTER_SIZE, surfaceClassOf, type DerivedTexture, type SkippedTexture, type TextureTarget, type TextureSetBuild } from '@aether/procgen/photo-texture';
import { TEXTURE_PROVENANCE_LABEL } from '@aether/assets';
import { imageChain, texturePrompt, type ImageGenerator } from './images';
import type { ToolOutcome, ExecutorContext } from './executor';
import type { AgentEvent, ToolDef } from './types';

/** The user's photograph as the texture tool reads it. */
export interface PhotoSource {
  /** Decoded at up to 1280 px on the long side. */
  raster: { width: number; height: number; data: Uint8ClampedArray | Uint8Array };
  /** The room as described from it (boxes, camera, finishes). */
  description: RoomDescription;
  /** The photo itself (a data URL), for AI refinement from a crop. */
  dataUrl?: string;
  /** Label for the credits ("your photo"). */
  name?: string;
}

/** What the tool may use besides the world (set by the host and the photo flow). */
export interface TextureContext {
  photo?: PhotoSource | null;
  images?: ImageGenerator | null;
}

export const MakeTextureInput = z
  .object({
    target: z.string().min(1).max(80),
    prompt: z.string().max(300).optional(),
    from_photo_region: z.union([z.boolean(), z.tuple([z.number(), z.number(), z.number(), z.number()])]).optional(),
    tileable: z.boolean().optional(),
    tile: z.number().min(0.1).max(8).optional(),
    finish: z.string().max(30).optional(),
    source: z.enum(['auto', 'photo', 'ai', 'procedural']).optional(),
    room: z.string().max(40).optional(),
    message: z.string().max(200).optional(),
  })
  .strict();
export type MakeTextureInput = z.infer<typeof MakeTextureInput>;

export const MAKE_TEXTURE_TOOL: ToolDef = {
  name: 'make_texture',
  description:
    'Give a surface or piece a real texture and see whether it reads right. target: "floor", "wall:north" (a compass side of the room) or "walls" (all four), or a piece id or kind ("bed", "sofa", "curtains-1"; pieces take the texture on their main cover). Sources, tried in this order: prompt given and an image model connected -> generates a seamless PBR set from the prompt (a crop of the photo guides it when from_photo_region is set); else the user\'s photograph when there is one -> samples the real surface (from_photo_region true uses the described box, or [x0,y0,x1,y1] in 0..1 of the photo; floors and walls are flattened through the solved camera, occluded parts filled, the light taken out); else the procedural library finish nearest the words. source forces one ("photo", "ai", "procedural" = remove any texture and use the library finish). tileable (default true) makes the tile seamless; tile sets the real size of one tile in metres; finish names the material class ("oak", "wallpaper", "velvet", "plaster"). The result states WHICH source was used and why not the others: say so to the user. It is a tool, not a verdict: look at the next render beside the photo and keep it only if it looks like the real surface (scale of the grain or weave, colour, sheen); otherwise try another prompt or region, or source "procedural". Textures are the user\'s project files; the credits list each as photographed, AI-generated or procedural.',
  inputSchema: {
    type: 'object',
    properties: {
      target: { type: 'string' },
      prompt: { type: 'string' },
      from_photo_region: { oneOf: [{ type: 'boolean' }, { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 }] },
      tileable: { type: 'boolean' },
      tile: { type: 'number' },
      finish: { type: 'string' },
      source: { type: 'string', enum: ['auto', 'photo', 'ai', 'procedural'] },
      room: { type: 'string' },
      message: { type: 'string' },
    },
    required: ['target'],
    additionalProperties: false,
  },
};

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

type Compass = 'north' | 'east' | 'south' | 'west';

type Resolved =
  | { kind: 'floor'; building: string; room: PlanRoom; label: string; id: string }
  | { kind: 'wall'; building: string; room: PlanRoom; compass: Compass; label: string; id: string }
  | { kind: 'piece'; entity: Entity; label: string; id: string };

const COMPASS: readonly Compass[] = ['north', 'east', 'south', 'west'];

function buildings(world: WorldDoc): string[] {
  return Object.values(world.entities).filter((e) => e.arch?.role === 'building').map((e) => e.id);
}

/** Resolve the text of a target (never throws; a string explains what is wrong). */
export function resolveTarget(world: WorldDoc, text: string, roomHint?: string): Resolved[] | string {
  const t = text.trim().toLowerCase();
  const rooms: Array<{ building: string; room: PlanRoom }> = [];
  for (const b of buildings(world)) {
    try {
      for (const lvl of planOf(world, b).levels) for (const room of lvl.rooms) rooms.push({ building: b, room });
    } catch {
      /* a building without a stored plan has no surfaces to retexture here */
    }
  }
  const pick = (): { building: string; room: PlanRoom } | string => {
    const candidates = roomHint ? rooms.filter((r) => r.room.id === roomHint || r.room.name?.toLowerCase() === roomHint.toLowerCase()) : rooms;
    if (candidates.length === 1) return candidates[0] as { building: string; room: PlanRoom };
    if (candidates.length === 0) return roomHint ? `no room "${roomHint}" (rooms: ${rooms.map((r) => r.room.id).join(', ') || 'none'})` : 'the world has no room to texture';
    return `several rooms: name one with room (${candidates.map((r) => r.room.id).join(', ')})`;
  };
  if (/^(the )?floor$/.test(t)) {
    const r = pick();
    return typeof r === 'string' ? r : [{ kind: 'floor', ...r, label: `the floor of ${r.room.name ?? r.room.id}`, id: 'floor' }];
  }
  const wall = /^(?:the )?(?:wall[:\s-]*)?(north|east|south|west)(?: wall)?$/.exec(t) ?? /^wall[:\s-]+(north|east|south|west)$/.exec(t);
  if (wall) {
    const r = pick();
    const c = wall[1] as Compass;
    return typeof r === 'string' ? r : [{ kind: 'wall', ...r, compass: c, label: `the ${c} wall of ${r.room.name ?? r.room.id}`, id: `wall-${c}` }];
  }
  if (/^(all )?walls$/.test(t)) {
    const r = pick();
    return typeof r === 'string' ? r : COMPASS.map((c) => ({ kind: 'wall' as const, ...r, compass: c, label: `the ${c} wall of ${r.room.name ?? r.room.id}`, id: `wall-${c}` }));
  }
  const pieces = Object.values(world.entities).filter((e) => e.arch?.role === 'furniture' || e.arch?.role === 'fixture');
  const exact = pieces.find((e) => e.id === text.trim());
  const named = exact ?? pieces.find((e) => e.id.endsWith(`-${t}`)) ?? pieces.find((e) => e.arch?.kind === t) ?? pieces.find((e) => e.id.includes(t));
  if (named) {
    // A curtain is built as a left and a right panel (ids end -l and -r): a cover given to one dresses both.
    const twin = /-[lr]$/.test(named.id) ? pieces.find((e) => e.id === `${named.id.slice(0, -1)}${named.id.endsWith('l') ? 'r' : 'l'}` && e.arch?.kind === named.arch?.kind) : undefined;
    return [named, ...(twin ? [twin] : [])].map((e) => ({ kind: 'piece' as const, entity: e, label: e.name || e.id, id: e.id }));
  }
  return `no surface or piece "${text.slice(0, 40)}": use floor, wall:<north|east|south|west>, walls, or a piece id (${pieces.slice(0, 8).map((e) => e.id).join(', ') || 'none placed'})`;
}

/** Soft finishes whose pieces can wear a texture, and what the piece's cover is called. */
const SOFT: ReadonlySet<string> = new Set(['fabric', 'velvet', 'leather', 'carpet']);

/** The part of a piece that carries its cover: the largest part (by area) with a soft finish, else the largest overall. */
export function dominantPart(entity: Entity): { finish: MaterialFinish; color?: string } | null {
  if (entity.shape.kind !== 'procedural') return null;
  const def = furnitureById(entity.shape.generator);
  if (!def) return null;
  let out;
  try {
    out = buildFurniture(def, entity.shape.params as Record<string, never>, entity.shape.seed ?? 0);
  } catch {
    return null;
  }
  let best: { spec: MaterialSpec; area: number; soft: boolean } | null = null;
  for (const part of out.parts) {
    const spec = part.material;
    if (!spec.finish || spec.texture) continue;
    let area = 0;
    const p = part.positions;
    const ix = part.indices;
    for (let k = 0; k + 2 < ix.length; k += 3) {
      const a = (ix[k] as number) * 3;
      const b = (ix[k + 1] as number) * 3;
      const c = (ix[k + 2] as number) * 3;
      const ux = (p[b] as number) - (p[a] as number);
      const uy = (p[b + 1] as number) - (p[a + 1] as number);
      const uz = (p[b + 2] as number) - (p[a + 2] as number);
      const vx = (p[c] as number) - (p[a] as number);
      const vy = (p[c + 1] as number) - (p[a + 1] as number);
      const vz = (p[c + 2] as number) - (p[a + 2] as number);
      area += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    }
    const soft = SOFT.has(spec.finish);
    if (!best || (soft && !best.soft) || (soft === best.soft && area > best.area)) best = { spec, area, soft };
  }
  if (!best?.spec.finish) return null;
  return { finish: best.spec.finish, ...(best.spec.color ? { color: best.spec.color.toLowerCase() } : {}) };
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

/** A texture ready to install: the stored set and where it came from. */
interface Made {
  build: TextureSetBuild;
  mean: string;
  provenance: TextureSetDef['provenance'];
  /** Short account for the model: what was used and any caution. */
  report: string;
}

/** Class words by what a target is. */
function targetWord(r: Resolved, world: WorldDoc, finish?: string): string {
  if (finish) return finish;
  if (r.kind === 'piece') return dominantPart(r.entity)?.finish ?? 'fabric';
  const spec = currentSpec(world, r);
  return `${spec?.finish ?? ''} ${r.kind === 'floor' ? 'floor' : 'wall'}`.trim();
}

/** The material a floor or wall has now (from the stored plan). */
function currentSpec(world: WorldDoc, r: Resolved): MaterialSpec | undefined {
  if (r.kind === 'piece') return undefined;
  const room = r.room;
  if (r.kind === 'floor') return room.floor;
  const own = room.walls?.[r.compass];
  if (own) return own;
  if (room.finish) return room.wallColor && !room.finish.color ? { ...room.finish, color: room.wallColor } : room.finish;
  const c = room.wallColors?.[r.compass] ?? room.wallColor;
  return c ? { finish: 'paint', color: c } : undefined;
}

/** Default size of one tile in metres by class, when the source gives no better. */
function defaultTile(word: string): number {
  const cls = surfaceClassOf(word).finish;
  return cls === 'fabric' || cls === 'velvet' || cls === 'leather' || cls === 'carpet' ? 0.6 : cls === 'tile' ? 0.6 : cls === 'oak' ? 1.2 : cls === 'brick' ? 1 : 1.5;
}

type Encoder = NonNullable<ExecutorContext['host']['encodeTextureMap']>;

async function storeBuild(ctx: ExecutorContext, build: TextureSetBuild): Promise<string | null> {
  const store = ctx.host.storeTexture;
  if (!store) return 'this host has no project texture store';
  const r = await store.call(ctx.host, { id: build.id, def: build.def, files: build.files });
  return r.ok ? null : r.error;
}

// ---------------------------------------------------------------------------
// The tool
// ---------------------------------------------------------------------------

function patchesFor(world: WorldDoc, r: Resolved, made: { id: string; def: TextureSetDef } | null, opts: { tile?: number; finish?: string; color?: string }): { patches: Patch[]; ops: unknown[]; note: string } {
  const patches: Patch[] = [];
  const ops: unknown[] = [];
  const ref = made ? { id: made.id, ...(opts.tile !== undefined ? { tile: opts.tile } : {}) } : undefined;
  if (made) patches.push({ op: 'setMeta', textures: { [made.id]: made.def } });
  if (r.kind === 'piece') {
    const e = r.entity;
    const part = dominantPart(e);
    if (!part) return { patches, ops, note: `${r.label} has no texturable cover` };
    const params = e.shape.kind === 'procedural' ? (e.shape.params as Record<string, unknown>) : {};
    const colour = part.color;
    const set: Record<string, unknown> = {};
    // The piece keeps the colour it has (the description's, already matched to the photo's pixels); the texture adds the pattern.
    void params;
    const key = colour ? `${part.finish}#${colour.slice(1)}` : part.finish;
    const skins: Record<string, unknown> = {};
    if (ref) skins[key] = ref;
    // Every older skin of this cover (the finish key and any colour key of it) goes.
    for (const k of Object.keys(e.arch?.skins ?? {})) if ((k === part.finish || k.startsWith(`${part.finish}#`)) && k !== key) skins[k] = null;
    if (!ref && skins[key] === undefined) skins[key] = null;
    set['arch'] = { skins };
    patches.push({ op: 'update', id: e.id, set } as unknown as Patch);
    return { patches, ops, note: `${r.label}: ${part.finish}${colour ? ` ${colour}` : ''} cover` };
  }
  const cur = currentSpec(world, r);
  const base: MaterialSpec = { ...(cur ?? {}) };
  delete base.texture;
  const finish = (opts.finish && Object.hasOwn(FINISHES, opts.finish) ? (opts.finish as MaterialFinish) : undefined) ?? base.finish ?? (r.kind === 'floor' ? 'oak' : 'paint');
  // A surface that has a colour keeps it (the description's, matched to the photo's pixels); one without takes the source's mean.
  const material: MaterialSpec = { ...base, finish, ...(ref ? { texture: ref } : {}), ...(made && opts.color && !base.color ? { color: opts.color } : {}) };
  if (r.kind === 'floor') ops.push({ op: 'set_material', building: r.building, target: 'floor', room: r.room.id, material });
  else ops.push({ op: 'set_wall', building: r.building, room: r.room.id, wall: r.compass, material });
  return { patches, ops, note: r.label };
}

/** Run `make_texture`. Never throws except when the run is aborted. */
export async function makeTextureTool(ctx: ExecutorContext, rawInput: unknown): Promise<ToolOutcome> {
  const fail = (content: string): ToolOutcome => ({ content, isError: true, events: [], edited: false });
  const parsed = MakeTextureInput.safeParse(rawInput ?? {});
  if (!parsed.success) return fail(`Invalid make_texture input: ${parsed.error.issues.slice(0, 4).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
  const input = parsed.data;
  const world = ctx.host.getWorld();
  const targets = resolveTarget(world, input.target, input.room);
  if (typeof targets === 'string') return fail(`make_texture: ${targets}.`);
  const tex = ctx.textures ?? {};
  const photo = tex.photo ?? null;
  const images = tex.images ?? null;
  const want = input.source ?? 'auto';
  const lines: string[] = [];
  const events: AgentEvent[] = [];
  const allPatches: Patch[] = [];
  const allOps: unknown[] = [];
  const credit: string[] = [];
  const encoder = ctx.host.encodeTextureMap as Encoder | undefined;
  const reader = photo ? textureReader(photo.raster, photo.description) : null;
  const known = photo ? textureTargets(photo.description) : [];
  const box = Array.isArray(input.from_photo_region) ? (input.from_photo_region as [number, number, number, number]) : undefined;
  const wantPhoto = want === 'photo' || (want === 'auto' && (input.from_photo_region !== undefined || !input.prompt));
  let aiNote = '';
  // One generated picture serves all four walls of "walls": ask once.
  let generated: { dataUrl: string; model: string; via: string } | null = null;
  for (const r of targets) {
    const word = targetWord(r, world, input.finish ?? input.prompt);
    let made: Made | null = null;
    const why: string[] = [];
    // 1. An AI image model.
    if (want === 'ai' || (want === 'auto' && input.prompt)) {
      if (!images) why.push('no image model is connected (Codex image tool or an OpenAI-compatible Images API), so the prompt was not drawn');
      else if (!input.prompt) why.push('source "ai" needs a prompt');
      else if (!encoder || !ctx.host.decodeImage) why.push('this host cannot decode or encode pictures');
      else {
        try {
          if (!generated) {
            const crop = photo?.dataUrl && input.from_photo_region !== undefined ? await cropOf(ctx, photo, r, box, known) : undefined;
            generated = await images.generate({ prompt: texturePrompt(input.prompt, { tileable: input.tileable !== false, refine: crop !== undefined }), size: 1024, ...(crop ? { reference: crop } : {}), ...(ctx.signal ? { signal: ctx.signal } : {}) });
          }
          const px = await ctx.host.decodeImage(generated.dataUrl, 1024);
          if (!px) throw new Error('the picture could not be decoded');
          const tileM = input.tile ?? defaultTile(word);
          const d = deriveFromSwatch(px, { word, tileMetres: tileM, tileable: input.tileable !== false, keepShading: surfaceClassOf(word).finish === 'fabric' ? 0.2 : 0 });
          const set = await buildTextureSet(d.tile, { name: `${(input.prompt ?? word).slice(0, 48)}`, provenance: 'ai-generated', tileMetres: tileM, mean: d.mean, cls: d.cls, source: { prompt: input.prompt.slice(0, 300), model: `${generated.via}:${generated.model}`.slice(0, 64) }, ...(Object.hasOwn(FINISHES, d.cls.finish) ? { finish: d.cls.finish } : {}) }, encoder);
          if (!set) throw new Error('the maps would not fit the project store caps');
          made = { build: set, mean: d.mean, provenance: 'ai-generated', report: `AI-generated by ${generated.via} (${generated.model}) from your prompt; ${d.seam > 1.6 ? 'seam blended' : 'already seamless'}, tile ${tileM} m, mean ${d.mean}` };
        } catch (e) {
          if (ctx.signal?.aborted) throw e;
          why.push(`the image model failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
        }
      }
    }
    // 2. The user's photograph.
    if (!made && want !== 'procedural' && (wantPhoto || want === 'auto' || want === 'ai')) {
      if (!reader || !photo) why.push('there is no photograph of this room to sample');
      else if (!encoder) why.push('this host cannot encode pictures');
      else {
        const t = known.find((k) => k.id === r.id) ?? (r.kind === 'piece' ? pieceTarget(photo.description, r) : undefined);
        if (!t) why.push(`${r.label} is not described in the photo (no box to sample)`);
        else {
          const { box: _b, ...target } = t;
          const got = reader.read({ ...target, word: input.finish ?? target.word }, box);
          if (!('tile' in got)) why.push(`the photo does not show ${r.label} clearly enough: ${got.reason}`);
          else {
            const tileM = input.tile ?? got.tileMetres;
            const set = await buildTextureSet(got.tile, { name: `${r.label} from your photo`.slice(0, 64), provenance: 'photographed', tileMetres: tileM, mean: got.mean, cls: got.cls, source: { photo: photo.name ?? 'your photo', region: `${r.label}${box ? ` (box ${box.map((v) => v.toFixed(2)).join(',')})` : ''}`.slice(0, 80) }, finish: got.cls.finish }, encoder);
            if (!set) why.push('the maps would not fit the project store caps');
            else made = { build: set, mean: got.mean, provenance: 'photographed', report: `photographed: ${got.notes.join('; ')}; ${got.quality} (clean square ${Math.round(got.sourceMetres * 100)} cm, ${Math.round(got.coverage * 100)} % clean, pattern contrast ${got.contrast.toFixed(2)}); tile ${tileM} m, mean ${got.mean}; colour and pattern are the photo's, fine grain and relief are added by the app` };
          }
        }
      }
    }
    // Install (or fall back to the library finish).
    let provenance: Made['provenance'] = 'procedural';
    let report = '';
    if (made) {
      const err = await storeBuild(ctx, made.build);
      if (err) {
        why.push(`the project store refused it: ${err}`);
        made = null;
      }
    }
    if (made) {
      provenance = made.provenance;
      const part = patchesFor(world, r, { id: made.build.id, def: made.build.def }, { color: made.mean, ...(input.tile !== undefined ? { tile: input.tile } : {}), ...(input.finish ? { finish: input.finish } : {}) });
      allPatches.push(...part.patches);
      allOps.push(...part.ops);
      report = made.report;
      credit.push(`${r.label}: ${TEXTURE_PROVENANCE_LABEL[provenance]}`);
    } else {
      const fin = finishFromWords(`${input.finish ?? ''} ${input.prompt ?? ''} ${word}`) ?? (input.finish && Object.hasOwn(FINISHES, input.finish) ? (input.finish as MaterialFinish) : undefined);
      const part = patchesFor(world, r, null, fin ? { finish: fin } : {});
      allPatches.push(...part.patches);
      allOps.push(...part.ops);
      report = `procedural library finish${fin ? ` "${fin}"` : ' (unchanged)'}; no texture set (${want === 'procedural' ? 'asked for' : 'fallback'})`;
      credit.push(`${r.label}: ${TEXTURE_PROVENANCE_LABEL.procedural}`);
    }
    lines.push(`- ${r.label}: ${report}${why.length > 0 ? ` | not used: ${why.join('; ')}` : ''}`);
    if (why.length > 0 && !aiNote && why.some((w) => w.includes('image model'))) aiNote = ' An image model is optional; the photo and library paths work without one.';
  }
  const message = (input.message ?? 'Texture').slice(0, 200);
  let edited = false;
  if (allOps.length > 0) {
    const res = applyArchOps(ctx.host.getWorld(), allOps);
    allPatches.push(...res.patches);
    for (const e of res.errors) lines.push(`refused: ${e.op} ${e.code}: ${e.message.slice(0, 200)}`);
  }
  if (allPatches.length > 0) {
    // Entity updates computed against the earlier world must not clobber the plan-driven recompile: setMeta first, entity skins last.
    const applied = ctx.host.applyPatches(allPatches, message);
    events.push({ type: 'patches', patches: applied.applied, message, result: { applied: applied.applied.length, errors: applied.errors } });
    edited = applied.applied.length > 0;
    for (const e of applied.errors.slice(0, 4)) lines.push(`patch refused: ${e.message.slice(0, 200)}`);
  }
  return { content: `${lines.join('\n')}\nProvenance: ${credit.join('; ')}.${aiNote}\nLook at the next render beside the photo before you keep it: the scale of the grain or weave, the colour and the sheen must read like the real surface.`, isError: !edited && lines.every((l) => l.startsWith('refused')), events, edited };
}

function pieceTarget(d: RoomDescription, r: Resolved): (TextureTarget & { box?: readonly [number, number, number, number] }) | undefined {
  if (r.kind !== 'piece') return undefined;
  const item = d.items.find((i) => r.entity.id === `room-photo-${i.id}` || r.entity.id.startsWith(`room-photo-${i.id}-`) || r.entity.id.endsWith(`-${i.id}`));
  if (!item || !item.box) return undefined;
  return { id: item.id, kind: 'piece', label: item.label || item.kind, word: 'fabric', item, box: item.box };
}

/** A crop of the photo as a data URL for the image model (the described box of the target, or the box given). */
async function cropOf(ctx: ExecutorContext, photo: PhotoSource, r: Resolved, box: [number, number, number, number] | undefined, known: Array<TextureTarget & { box?: readonly [number, number, number, number] }>): Promise<string | undefined> {
  const region = box ?? known.find((k) => k.id === r.id)?.box ?? (r.kind === 'piece' ? pieceTarget(photo.description, r)?.box : undefined);
  if (!region || !photo.dataUrl || !ctx.host.composeImages) return undefined;
  return (await ctx.host.composeImages([{ dataUrl: photo.dataUrl, box: region }], { maxSide: 768 })) ?? undefined;
}

export { imageChain, MASTER_SIZE };
export type { DerivedTexture, SkippedTexture, TextureTier };
