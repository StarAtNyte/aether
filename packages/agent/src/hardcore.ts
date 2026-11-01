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
import type { Entity, Vec3, WorldDoc } from '@aether/core';
import type { ReviewViewRequest } from './types';

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
  return { name, label, kind: 'exterior', pose: { position, target, up: [0, 1, 0], fov }, hideTops: false, aspect: 1.5, marks: [] };
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
 * The hero shots of a world: an establishing view from outside and above, the place at eye height from the spawn toward the
 * landmark, the landmark itself from part way up, and a low view across the rooftops. Deterministic, so the same shots are judged
 * in every pass.
 */
export function heroShots(world: WorldDoc): ReviewViewRequest[] {
  const b = contentBounds(world);
  if (!b) return [];
  const c: Vec3 = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
  const r = Math.max(20, Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]) / 2);
  const spawn = world.player.spawn;
  const mark = landmark(world) ?? c;
  // The establishing view comes from the side the spawn is on, so the place is seen the way a visitor first meets it.
  const sx = spawn[0] - c[0];
  const sz = spawn[2] - c[2];
  const sl = Math.hypot(sx, sz) || 1;
  const dir: Vec3 = [sx / sl, 0, sz / sl];
  const side: Vec3 = [-dir[2], 0, dir[0]];
  return [
    view('hero-establishing', 'establishing view: the whole place from outside and above, the way a postcard frames it', [c[0] + dir[0] * r * 1.35 + side[0] * r * 0.35, c[1] + r * 0.55, c[2] + dir[2] * r * 1.35 + side[2] * r * 0.35], [c[0], c[1], c[2]], 45),
    view('hero-street', 'eye height from where the visitor arrives, looking toward the landmark', [spawn[0], spawn[1] + 1.7, spawn[2]], [mark[0], Math.max(spawn[1] + 1.7, mark[1] * 0.6 + spawn[1] * 0.4), mark[2]], 60),
    view('hero-landmark', 'the landmark from part way up, with the place falling away below it', [mark[0] + side[0] * r * 0.45 + dir[0] * r * 0.3, mark[1] + r * 0.12, mark[2] + side[2] * r * 0.45 + dir[2] * r * 0.3], [mark[0], mark[1], mark[2]], 50),
    view('hero-rooftops', 'low across the rooftops toward the far side, the light raking across them', [c[0] - side[0] * r * 0.9, c[1] + r * 0.18, c[2] - side[2] * r * 0.9], [c[0] + side[0] * r * 0.5, c[1], c[2] + side[2] * r * 0.5], 55),
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

/** The specialist passes, in order: what each one owns and must leave alone. */
export const HARDCORE_PASSES: ReadonlyArray<{ id: string; title: string; brief: string }> = [
  { id: 'massing', title: 'Layout and massing', brief: 'Match the composition of the references: the layout of the place, the heights and grouping of buildings, the landmark, the shape of the land and the skyline. Fix proportions and gaps that make the place read as a grid of boxes. Do not detail yet.' },
  { id: 'architecture', title: 'Architecture', brief: 'Make the buildings read as the references do: varied widths and heights, real facades (window rhythm, sills, lintels, shutters, balconies, cornices, doors with surrounds, eaves, chimneys), roofs with tiles and overhangs, bevelled edges, each part in its own finish and tint. Rewrite the house generators with write_generator where they are bare.' },
  { id: 'ground', title: 'Ground and streets', brief: 'Make the ground read as the references: streets, stairs, plazas and quays with real surfaces (setts, limestone, asphalt), kerbs and gutters, retaining walls on the terraces, the river edge and the land beyond. Keep every street, stair and plaza reachable on foot.' },
  { id: 'planting', title: 'Planting and dressing', brief: 'Bring the life of the references: trees and shrubs where they stand in the pictures (street trees, gardens, cypress and pines on the slopes), flowers and climbers, street lamps, benches, signs, awnings, laundry, parked vehicles, boats, people. Library models first; vary every repeated piece.' },
  { id: 'light', title: 'Light, water and atmosphere', brief: 'Match the light of the references with tune_look and the environment: sun height and colour, shadow colour, ambient, fog and aerial perspective, sky, exposure and grade, water colour and reflections, warm windows and lamps. Use the luminance targets: bring each hero shot near them.' },
  { id: 'detail', title: 'Detail and weathering', brief: 'Close the remaining gaps with the references, shot by shot: grime and wear, small props, repeated pieces varied, empty corners filled, anything that still reads as a toy fixed. Change only what the comparison shows is wrong.' },
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
