/**
 * Hardcore mode: a world built to match reference images, the way a look-development team works, instead of from words alone.
 *
 *   1. Hero shots: a few fixed cameras that frame what the place is about (an establishing view, the street at eye height, a
 *      landmark, the rooftops). Every review round renders exactly these, so progress is judged on the pictures that matter.
 *   2. References: one picture per hero shot, drawn by an image model (or given by the user), showing what that view should look like.
 *   3. Art bible: what the references share, in words, plus numeric targets measured from them (luminance percentiles), so "too
 *      flat", "too dark" or "washed out" is a number as well as an impression.
 *   4. Passes: the world is refined in specialist passes (layout and massing, architecture, ground and streets, planting and
 *      dressing, water and light, detail and weathering), each one a reviewed run that compares its hero shots with the references
 *      side by side.
 *
 * This module holds the pieces that do not need a host: the shot list, the reference prompts, the luminance targets, the pass plan
 * and the texts. The run itself is `WorldAgent.run` with `hardcore` set; scripts/hardcore.ts drives the passes in Node.
 */
import { VOXEL_SEA_LEVEL, type Entity, type Vec3, type VoxelEdit, type WorldDoc } from '@aether/core';
import type { Provider, ReviewViewRequest } from './types';

/** Luminance percentiles (sRGB display values, 0..255) of a picture or a set of pictures. */
export interface LumaTargets {
  p02: number;
  p10: number;
  p50: number;
  p90: number;
  p98: number;
}

/** What a hardcore run carries into the review loop. */
export interface HardcoreRun {
  /** The art bible: the look the references share, in words, with the targets. */
  bible: string;
  /** The hero shots the review renders, in the order of the references. */
  shots: ReviewViewRequest[];
  /** Luminance targets measured from the references. */
  targets?: LumaTargets;
}

/** Luminance percentiles of RGBA pixels. */
export function lumaPercentiles(data: ArrayLike<number>): LumaTargets | null {
  const n = Math.floor(data.length / 4);
  if (n === 0) return null;
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) {
    const l = Math.round(0.2126 * (data[i * 4] as number) + 0.7152 * (data[i * 4 + 1] as number) + 0.0722 * (data[i * 4 + 2] as number));
    hist[Math.max(0, Math.min(255, l))]! += 1;
  }
  const at = (q: number): number => {
    const want = q * n;
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[v] as number;
      if (acc >= want) return v;
    }
    return 255;
  };
  return { p02: at(0.02), p10: at(0.1), p50: at(0.5), p90: at(0.9), p98: at(0.98) };
}

/** The mean of several pictures' percentiles: the target the art bible states. */
export function meanTargets(list: readonly LumaTargets[]): LumaTargets | null {
  if (list.length === 0) return null;
  const avg = (k: keyof LumaTargets): number => Math.round(list.reduce((s, t) => s + t[k], 0) / list.length);
  return { p02: avg('p02'), p10: avg('p10'), p50: avg('p50'), p90: avg('p90'), p98: avg('p98') };
}

const fmt = (t: LumaTargets): string => `p02 ${t.p02}, p10 ${t.p10}, p50 ${t.p50}, p90 ${t.p90}, p98 ${t.p98}`;

/** One line per render against the reference targets, with what to change when a percentile is well off. */
export function targetEvidenceText(rows: ReadonlyArray<{ name: string; luma: LumaTargets }>, target: LumaTargets): string {
  if (rows.length === 0) return '';
  const lines = rows.map((r) => {
    const d50 = r.luma.p50 - target.p50;
    const spread = r.luma.p90 - r.luma.p10 - (target.p90 - target.p10);
    const notes: string[] = [];
    if (d50 > 18) notes.push('brighter overall than the references');
    if (d50 < -18) notes.push('darker overall than the references');
    if (spread < -30) notes.push('flatter (less contrast): deepen the shadows or brighten the lit faces');
    if (spread > 30) notes.push('harsher (more contrast) than the references');
    if (r.luma.p02 - target.p02 > 15) notes.push('no real darks: the shadows are milky (fog, ambient or exposure too high)');
    return `${r.name}: ${fmt(r.luma)}${notes.length ? ` (${notes.join('; ')})` : ' (close to the references)'}`;
  });
  return `Reference luminance targets (measured from the reference pictures): ${fmt(target)}. This round:\n${lines.join('\n')}\nMove the look toward the targets with the light (sun, ambient, fog, exposure, grade) and the surfaces, not by eye alone.`;
}

/** A camera at `position` looking at `target`. */
function view(name: string, label: string, position: Vec3, target: Vec3, fov: number): ReviewViewRequest {
  return { name, label, kind: 'exterior', pose: { position, target, up: [0, 1, 0], fov, clear: true }, hideTops: false, aspect: 1.5, marks: [] };
}

/** Bounds of the built content: solid pieces that are not terrain, sky or backdrop. */
function contentBounds(world: WorldDoc): { min: Vec3; max: Vec3 } | null {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  let n = 0;
  for (const id in world.entities) {
    const e = world.entities[id] as Entity;
    if (e.template || e.shape.kind === 'none' || e.tags.some((t) => ['terrain', 'land', 'hill', 'backdrop', 'water', 'sky'].includes(t))) continue;
    const p = e.transform.position;
    if (!Number.isFinite(p[0] + p[1] + p[2]) || Math.abs(p[0]) > 2000 || Math.abs(p[2]) > 2000) continue;
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k] as number, p[k] as number);
      max[k] = Math.max(max[k] as number, p[k] as number);
    }
    n++;
  }
  return n === 0 ? null : { min, max };
}

/** The landmark: an entity tagged focus or landmark, else the highest built piece. */
function landmark(world: WorldDoc): Vec3 | null {
  let best: { p: Vec3; score: number } | null = null;
  for (const id in world.entities) {
    const e = world.entities[id] as Entity;
    if (e.template || e.shape.kind === 'none' || e.tags.some((t) => ['terrain', 'land', 'hill', 'backdrop'].includes(t))) continue;
    const p = e.transform.position;
    const tagged = e.tags.some((t) => t === 'focus' || t === 'landmark');
    const score = (tagged ? 1000 : 0) + p[1];
    if (!best || score > best.score) best = { p: [p[0], p[1], p[2]], score };
  }
  return best?.p ?? null;
}

/**
 * The street at eye height: from the end of the longest street piece that is farther from the landmark, looking along the street
 * (not across it into a wall), raised toward the landmark when it is uphill.
 */
function streetShot(world: WorldDoc, mark: Vec3): ReviewViewRequest | null {
  let best: { a: Vec3; b: Vec3; len: number } | null = null;
  for (const id in world.entities) {
    const e = world.entities[id] as Entity;
    if (e.template || !e.tags.some((t) => ['roads', 'road', 'street'].includes(t))) continue;
    const p = e.transform.position;
    const sz = e.shape.kind === 'primitive' ? e.shape.size : null;
    // A street piece runs along its longer side; a generated street with no size runs along x by convention of its yaw.
    const yaw = (e.transform.rotation[1] * Math.PI) / 180;
    const along = sz && sz[2] > sz[0] ? [Math.sin(yaw), 0, Math.cos(yaw)] : [Math.cos(yaw), 0, -Math.sin(yaw)];
    const half = sz ? Math.max(sz[0], sz[2]) / 2 : 12;
    const a: Vec3 = [p[0] - (along[0] as number) * half * 0.8, p[1], p[2] - (along[2] as number) * half * 0.8];
    const b: Vec3 = [p[0] + (along[0] as number) * half * 0.8, p[1], p[2] + (along[2] as number) * half * 0.8];
    if (!best || half * 2 > best.len) best = { a, b, len: half * 2 };
  }
  if (!best) return null;
  const da = Math.hypot(best.a[0] - mark[0], best.a[2] - mark[2]);
  const db = Math.hypot(best.b[0] - mark[0], best.b[2] - mark[2]);
  const [from, to] = da > db ? [best.a, best.b] : [best.b, best.a];
  return view('hero-street', 'eye height in the street, looking along it toward the landmark', [from[0], from[1] + 1.7, from[2]], [to[0], to[1] + 1.7 + Math.max(0, mark[1] - from[1]) * 0.15, to[2]], 60);
}

/**
 * The hero shots of a world: an establishing view from outside and above, the place at eye height from the spawn toward the
 * landmark, the landmark itself from part way up, and a low view across the rooftops. Deterministic, so the same shots are judged
 * in every pass.
 */
export function heroShots(world: WorldDoc, opts: HeroShotOptions = {}): ReviewViewRequest[] {
  const block = contentBounds(world) ? null : voxelFrame(world, opts.groundAt ?? (() => VOXEL_SEA_LEVEL + 4));
  const b = block ?? contentBounds(world);
  if (!b) return [];
  const c: Vec3 = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
  const r = Math.max(20, Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]) / 2);
  const spawn = block?.spawn ?? world.player.spawn;
  const mark = block?.mark ?? landmark(world) ?? c;
  const shots = framedShots(world, c, r, spawn, mark);
  // On generated block land the cameras would otherwise sit inside a hill: keep each one, and what it looks at, above the ground.
  if (block) {
    const ground = opts.groundAt ?? (() => VOXEL_SEA_LEVEL + 4);
    for (const s of shots) {
      const p = s.pose.position as Vec3;
      const t = s.pose.target as Vec3;
      p[1] = Math.max(p[1], ground(p[0], p[2]) + 1.7);
      t[1] = Math.max(t[1], ground(t[0], t[2]) + 1);
    }
  }
  return shots;
}

/** How the hero shots of a world are framed. */
export interface HeroShotOptions {
  /**
   * The first free height above the generated land at (x, z), for block worlds whose terrain is not in the document but grown from
   * a seed (the voxel terrain generator's ground level). Without it the land is taken to lie a few blocks above the sea.
   */
  groundAt?: (x: number, z: number) => number;
}

/** Where a block edit stands, in plan: its anchor corner or centre and, for boxes and lines, the far corner. */
function editPoints(e: VoxelEdit): Vec3[] {
  switch (e.shape) {
    case 'box': case 'line': case 'replace': case 'clear': return [e.from, e.to];
    case 'sphere': return [e.center];
    case 'cylinder': return [e.base];
    case 'stairs': return [e.from];
    default: return [e.at];
  }
}

/** How much a structure counts as the landmark of a block world. */
const STRUCTURE_RANK: Record<string, number> = { castle: 6, tower: 5, pyramid: 5, arch: 3, house: 2 };

/**
 * The frame of a block world: its land is generated, not entities, so the bounds come from the spawn and the block edits (the
 * buildings, bridges and lettering placed on the land), the land height from `groundAt`, and the landmark is the grandest structure.
 * Null for a world without voxel terrain.
 */
function voxelFrame(world: WorldDoc, groundAt: (x: number, z: number) => number): { min: Vec3; max: Vec3; spawn: Vec3; mark: Vec3 | null } | null {
  const v = world.voxel;
  if (!v) return null;
  const s = world.player.spawn;
  const spawn: Vec3 = [s[0], Math.max(s[1], groundAt(s[0], s[2])), s[2]];
  const min: Vec3 = [spawn[0], spawn[1], spawn[2]];
  const max: Vec3 = [spawn[0], spawn[1], spawn[2]];
  let mark: { p: Vec3; score: number } | null = null;
  for (const e of v.edits) {
    const surface = e.anchor === 'surface';
    for (const q of editPoints(e)) {
      const p: Vec3 = [q[0], surface ? groundAt(q[0], q[2]) + q[1] : q[1], q[2]];
      if (!Number.isFinite(p[0] + p[1] + p[2]) || Math.hypot(p[0] - spawn[0], p[2] - spawn[2]) > 160) continue;
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k] as number, p[k] as number);
        max[k] = Math.max(max[k] as number, p[k] as number);
      }
      if (e.shape === 'structure') {
        const score = (STRUCTURE_RANK[e.structure] ?? 1) * 10 + (e.size === 'large' ? 3 : e.size === 'medium' ? 2 : 1);
        // Aim at the body of the structure, not its foot.
        if (!mark || score > mark.score) mark = { p: [p[0], p[1] + (e.size === 'large' ? 8 : 5), p[2]], score };
      }
    }
  }
  // A world of bare land round the spawn: frame the land a short walk round it.
  const pad = max[0] - min[0] < 24 && max[2] - min[2] < 24 ? 24 : 0;
  min[0] -= pad; min[2] -= pad; max[0] += pad; max[2] += pad;
  return { min, max, spawn, mark: mark?.p ?? (pad ? [spawn[0], spawn[1] + 3, spawn[2]] : null) };
}

/** The four hero shots round the centre `c` of a place of radius `r`, seen from the side of `spawn`, looking at `mark`. */
function framedShots(world: WorldDoc, c: Vec3, r: number, spawn: Vec3, mark: Vec3): ReviewViewRequest[] {
  // The establishing view comes from the side the spawn is on, so the place is seen the way a visitor first meets it.
  const sx = spawn[0] - c[0];
  const sz = spawn[2] - c[2];
  const sl = Math.hypot(sx, sz) || 1;
  const dir: Vec3 = [sx / sl, 0, sz / sl];
  const side: Vec3 = [-dir[2], 0, dir[0]];
  return [
    view('hero-establishing', 'establishing view: the whole place from outside and above, the way a postcard frames it', [c[0] + dir[0] * r * 1.35 + side[0] * r * 0.35, c[1] + r * 0.55, c[2] + dir[2] * r * 1.35 + side[2] * r * 0.35], [c[0], c[1], c[2]], 45),
    streetShot(world, mark) ?? view('hero-street', 'eye height from where the visitor arrives, looking toward the landmark', [spawn[0], spawn[1] + 1.7, spawn[2]], [mark[0], Math.max(spawn[1] + 1.7, mark[1] * 0.6 + spawn[1] * 0.4), mark[2]], 60),
    view('hero-landmark', 'the landmark from part way up, with the place falling away below it', [mark[0] + side[0] * r * 0.45 + dir[0] * r * 0.3, mark[1] + r * 0.12, mark[2] + side[2] * r * 0.45 + dir[2] * r * 0.3], [mark[0], mark[1], mark[2]], 50),
    // Across the rooftops toward the landmark from the side opposite the landmark shot: aimed at the place, never out past its edge.
    view('hero-rooftops', 'low across the rooftops toward the landmark, the light raking across them', [mark[0] - side[0] * r * 0.85 + dir[0] * r * 0.25, Math.max(mark[1], c[1]) + r * 0.12, mark[2] - side[2] * r * 0.85 + dir[2] * r * 0.25], [mark[0], mark[1], mark[2]], 55),
  ];
}

/** The picture an image model is asked for, for one hero shot of the place `subject` describes. */
export function referencePrompt(subject: string, shot: ReviewViewRequest): string {
  return [
    `A photorealistic cinematic photograph of ${subject.replace(/\s+/g, ' ').trim().slice(0, 400)}.`,
    `View: ${shot.label}.`,
    'Late golden-hour sun, warm light on the lit faces, cool blue-grey shadows that are never black, clear air with gentle aerial perspective toward the horizon, a few soft clouds.',
    'Real materials with visible texture and weathering, rich but natural colour, high detail and variety, nothing repeated or toy-like, no people in the foreground, no text, no watermark, 16:9 framing, 35-50 mm lens.',
  ].join(' ');
}

/** Set on the world hardcore mode refines: the full shaded-material cap of the render tier (see `environment.look.shaderBudget`). */
export const HARDCORE_SHADER_BUDGET_PATCH = Object.freeze({ op: 'setEnvironment', set: { look: { shaderBudget: 'hero' } } } as const);

/** The specialist passes, in order: what each one owns and must leave alone. */
export const HARDCORE_PASSES: ReadonlyArray<{ id: string; title: string; brief: string }> = [
  { id: 'massing', title: 'Layout and massing', brief: 'Match the composition of the references: the layout of the place, the heights and grouping of buildings, the landmark, the shape of the land and the skyline. Fix proportions and gaps that make the place read as a grid of boxes. Where the references show buildings covering ground the world leaves empty (a hillside up to the landmark, a ridge, a shore), extend the built area there with new rows, terraces and winding lanes that follow the contours, and break straight rows with steps, bends and small squares. Keep one dominant landmark, framed, at the size the subject states (a statue or tower as tall as asked). Shape cliffs and slopes as stepped, eroded terraces and broken rock, not boxy walls with flat green tops, and give the place real surroundings (mountains, hills, haze), not an empty horizon. Do not detail yet.' },
  { id: 'architecture', title: 'Architecture', brief: 'Make the buildings read as the references do: varied widths and heights, real facades (window rhythm, sills, lintels, shutters, balconies, cornices, doors with surrounds, eaves, chimneys), roofs with tiles and overhangs, bevelled edges, each part in its own finish and tint, in the building style of the region. Rewrite the house generators with write_generator where they are bare.' },
  { id: 'ground', title: 'Ground and streets', brief: 'Make the ground read as the references: streets, stairs, plazas and quays with real surfaces (setts, limestone, asphalt), kerbs and gutters, retaining walls on the terraces, the river edge and the land beyond. A stair or bridge that climbs a cliff or spans a drop is a slab about 1.4 m thick on piers or arches with the ground showing between, never filled solid to the ground. Keep every street, stair and plaza reachable on foot.' },
  { id: 'planting', title: 'Planting and dressing', brief: 'Bring the life of the references: trees and shrubs where they stand in the pictures (street trees, gardens, the slopes), of the species of the region, never generic round-canopy trees, flowers and climbers, street lamps, benches, signs, awnings, laundry, parked vehicles, boats, people. Library models first; vary every repeated piece.' },
  { id: 'light', title: 'Light, water and atmosphere', brief: 'Match the light of the references with tune_look and the environment, on the analytic sky (golden hour: sky "day" at timeOfDay 16.5-17.3) rather than a photo sky: sun height and colour, shadow colour, ambient, fog and aerial perspective, sky, exposure and grade, water colour and reflections (each waterfall clear in front of the face it pours from, its whole drop showing), warm windows and lamps; glowing things (lanterns, signs, magic, lava) get shader emissive or surface pulse/rim layers. Use the luminance targets: bring each hero shot near them.' },
  { id: 'detail', title: 'Detail and weathering', brief: 'Close the remaining gaps with the references, shot by shot: grime and wear, small props, repeated pieces varied, empty corners filled, anything that still reads as a toy fixed. Weather every flat surface with material.surface layers (grime at the base, streaks down walls, moss and lichen on stone, edgeWear on trim, rust on iron, wet near water); this world has the hero shader budget, so give each material its own. Give the hero pieces (the landmark, statues, fountains, steps, doorways, rocks near the camera) a sculpt pass: worn and chipped edges, steps hollowed by feet, eroded stone, hand-made irregularity, so nothing reads machine-perfect. Change only what the comparison shows is wrong.' },
];

/** The art bible text a pass carries: the subject, the shots, the targets and what the references share. */
export function bibleText(subject: string, shots: readonly ReviewViewRequest[], targets: LumaTargets | null, notes = ''): string {
  return [
    `HARDCORE MODE. The world is built to match ${shots.length} reference pictures, one per hero shot. Subject: ${subject.slice(0, 400)}.`,
    `Hero shots (rendered every review round, in the order of the references): ${shots.map((s, i) => `${i + 1}. ${s.name}: ${s.label}`).join('; ')}.`,
    targets ? `Luminance targets from the references: ${fmt(targets)} (sRGB 0..255).` : '',
    notes ? `What the references share: ${notes.slice(0, 1500)}` : '',
    'Judge every change against the references, not against the last render. Close the largest visible differences first. Keep what already matches.',
  ].filter(Boolean).join('\n');
}

/** The prompt of one pass. */
export function passPrompt(pass: (typeof HARDCORE_PASSES)[number], index: number, bible: string): string {
  return `${bible}\n\nPASS ${index + 1} of ${HARDCORE_PASSES.length}: ${pass.title}. ${pass.brief}`;
}

/** Colour statistics of a picture: luminance percentiles and the mean colour of its top third (the sky in most shots) and the rest. */
export interface PictureColour {
  luma: LumaTargets;
  top: [number, number, number];
  rest: [number, number, number];
}

/** Colour statistics of RGBA pixels laid out `width` x `height`. */
export function pictureColour(data: ArrayLike<number>, width: number, height: number): PictureColour | null {
  const luma = lumaPercentiles(data);
  if (!luma || width <= 0 || height <= 0) return null;
  const top = [0, 0, 0];
  const rest = [0, 0, 0];
  let nt = 0;
  let nr = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const acc = y < height / 3 ? top : rest;
      for (let c = 0; c < 3; c++) acc[c] = (acc[c] as number) + (data[i + c] as number);
      if (y < height / 3) nt++;
      else nr++;
    }
  }
  return { luma, top: top.map((v) => v / Math.max(1, nt)) as [number, number, number], rest: rest.map((v) => v / Math.max(1, nr)) as [number, number, number] };
}

/** How far a set of renders is from the references (lower is closer): luminance spread and the colour of sky and ground. */
export function lookDistance(renders: readonly PictureColour[], refs: readonly PictureColour[]): number {
  if (renders.length === 0 || refs.length === 0) return Infinity;
  const mean = (list: readonly PictureColour[], f: (p: PictureColour) => number): number => list.reduce((s, p) => s + f(p), 0) / list.length;
  let d = 0;
  for (const k of ['p02', 'p10', 'p50', 'p90', 'p98'] as const) d += Math.abs(mean(renders, (p) => p.luma[k]) - mean(refs, (p) => p.luma[k]));
  for (let c = 0; c < 3; c++) {
    d += 0.8 * Math.abs(mean(renders, (p) => p.top[c] as number) - mean(refs, (p) => p.top[c] as number));
    d += 0.6 * Math.abs(mean(renders, (p) => p.rest[c] as number) - mean(refs, (p) => p.rest[c] as number));
  }
  return d;
}

/**
 * Environment candidates the look sweep renders before the light pass: sun heights and exposures on the analytic sky first
 * (`hdri` cleared: a clear "day" sky at 16.6-17.2 is golden hour, "sunset" the last orange light), then sky pictures. The
 * caller should keep an analytic candidate unless a picture is clearly closer to the references.
 */
export function lookCandidates(): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const [sky, timeOfDay] of [['day', 16.6], ['day', 17.2], ['sunset', 17.4]] as const) {
    for (const exposure of [1.1, 1.4, 1.7]) out.push({ hdri: null, hdriBackground: null, sky, timeOfDay, exposure });
  }
  for (const hdri of ['sky-partly-cloudy', 'sky-golden-sunset', 'sky-industrial-sunset']) {
    for (const timeOfDay of [16.6, 17.4, 18.1]) {
      for (const exposure of [1.1, 1.4, 1.7]) out.push({ hdri, hdriBackground: true, hdriIntensity: 0.9, sky: hdri === 'sky-partly-cloudy' ? 'day' : 'sunset', timeOfDay, exposure });
    }
  }
  return out;
}

/**
 * The pass gate: which of two builds (the hero shots before and after a pass, each one picture) is closer to the references,
 * judged by the model looking at all three. A pass the judge does not prefer is undone by the caller.
 */
export async function judgeCloser(provider: Provider, refs: string, a: string, b: string, signal?: AbortSignal): Promise<{ better: 'A' | 'B'; why: string }> {
  const res = await provider.complete({
    role: 'critic',
    system: 'You are an art director comparing two builds of a 3D place against reference pictures. Be decisive.',
    messages: [{ role: 'user', content: [
      { type: 'text', text: 'Image 1: the REFERENCES (the hero views).' }, { type: 'image', dataUrl: refs },
      { type: 'text', text: 'Image 2: build A (the same views, same order).' }, { type: 'image', dataUrl: a },
      { type: 'text', text: 'Image 3: build B (the same views, same order).' }, { type: 'image', dataUrl: b },
      { type: 'text', text: 'Which build, A or B, is closer to the references overall: composition and density of the place, architecture, light and colour, sky, water, planting, and the absence of broken or toy-like things (floating objects, wrong colours, blown-out or murky light)? Answer with JSON only: {"better":"A"|"B","why":"one sentence"}.' },
    ] }],
    maxTokens: 300,
  }, signal);
  const text = res.content.map((c) => (c.type === 'text' ? c.text : '')).join(' ');
  const m = /\{[^{}]*"better"\s*:\s*"([AB])"[^{}]*\}/.exec(text);
  const why = /"why"\s*:\s*"([^"]*)"/.exec(text)?.[1] ?? text.slice(0, 200);
  return { better: m?.[1] === 'B' ? 'B' : 'A', why };
}
