/**
 * Deterministic 3D quality heuristics (no model needed): scores a world on the
 * seven rubric criteria from its document, entity bounds and, when available,
 * pixel statistics of rendered views. Pure and fast (O(n²) only over ≤ 300
 * content entities for the overlap check).
 */
import type { Entity, Json, WorldDoc } from '@aether/core';
import { paletteStats } from './color';
import { contentExtent, mayFloat, overlapVolume, placedContent, volume, type Placed } from './geometry';
import { clamp10, QUALITY_CRITERIA, weightedScore, type CriterionScore, type QualityCriterion, type QualityInput, type QualityIssue, type QualityReport, type ViewStats } from './types';

const MAX_PAIR_ENTITIES = 300;
const FLOAT_GAP = 0.35;
const PERSON_HEIGHT = 1.7;

const STOPWORDS = new Set(
  'a an and the of on in with at to for from into onto over under near by some few many lots lot make build create add put place show give me my i want need please world scene little big small tiny huge giant large very really nice cool beautiful pretty cute that this these those there where which who where it its is are be can could should would will just like also around inside outside full lots where while each every one two three four five six seven eight nine ten game level simple'.split(' '),
);

/** Prompt words that are satisfied by something other than an entity with that name. */
const MOOD_WORDS: Readonly<Record<string, (w: WorldDoc) => boolean>> = {
  night: (w) => w.environment.sky === 'night' || w.environment.sky === 'space',
  midnight: (w) => w.environment.sky === 'night',
  moonlit: (w) => w.environment.sky === 'night',
  sunset: (w) => w.environment.sky === 'sunset' || w.environment.sky === 'dawn',
  dusk: (w) => w.environment.sky === 'sunset' || w.environment.sky === 'night',
  dawn: (w) => w.environment.sky === 'dawn' || w.environment.sky === 'sunset',
  sunrise: (w) => w.environment.sky === 'dawn' || w.environment.sky === 'sunset',
  rain: (w) => w.environment.weather === 'rain',
  rainy: (w) => w.environment.weather === 'rain',
  stormy: (w) => w.environment.weather === 'rain' || w.environment.sky === 'overcast',
  snow: (w) => w.environment.weather === 'snow' || hasPreset(w, 'snow'),
  snowy: (w) => w.environment.weather === 'snow' || hasPreset(w, 'snow'),
  winter: (w) => w.environment.weather === 'snow' || hasPreset(w, 'snow') || hasPreset(w, 'ice'),
  foggy: (w) => w.environment.fog !== null,
  fog: (w) => w.environment.fog !== null,
  misty: (w) => w.environment.fog !== null,
  space: (w) => w.environment.sky === 'space',
  gravity: (w) => w.environment.gravity[1] !== -9.81,
  fireflies: (w) => w.environment.weather === 'fireflies',
  water: (w) => hasPreset(w, 'water'),
  lake: (w) => hasPreset(w, 'water'),
  ocean: (w) => hasPreset(w, 'water'),
  sea: (w) => hasPreset(w, 'water'),
  river: (w) => hasPreset(w, 'water'),
  pond: (w) => hasPreset(w, 'water'),
  lava: (w) => hasPreset(w, 'lava'),
  desert: (w) => hasPreset(w, 'sand'),
  beach: (w) => hasPreset(w, 'sand') || hasPreset(w, 'water'),
  collect: (w) => hasBehavior(w, 'collectible'),
  coins: (w) => hasBehavior(w, 'collectible'),
  race: (w) => hasBehavior(w, 'checkpoint') || hasBehavior(w, 'goal') || hasBehavior(w, 'vehicle'),
  bowling: (w) => Object.keys(w.entities).some((id) => /pin|bowl/.test(id)),
};

/** Nouns that are satisfied by related ids/generators. */
const SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  forest: ['tree', 'pine', 'oak'],
  woods: ['tree', 'pine', 'oak'],
  jungle: ['palm', 'tree', 'bush'],
  village: ['house', 'hut', 'cottage'],
  town: ['house', 'building', 'street'],
  city: ['building', 'skyscraper', 'house', 'road'],
  castle: ['tower', 'wall', 'castle', 'keep'],
  garden: ['flower', 'bush', 'tree'],
  park: ['tree', 'bench', 'path', 'lamp'],
  farm: ['barn', 'fence', 'windmill', 'field'],
  camp: ['tent', 'campfire'],
  campsite: ['tent', 'campfire'],
  island: ['island', 'palm', 'sand'],
  mountains: ['mountain'],
  hills: ['terrain', 'hill', 'mountain'],
  rocks: ['rock'],
  stones: ['rock', 'stone'],
  ruins: ['ruin', 'pillar', 'arch', 'column', 'wall'],
  temple: ['temple', 'pillar', 'column', 'statue', 'arch'],
  harbor: ['dock', 'boat', 'pier'],
  harbour: ['dock', 'boat', 'pier'],
  playground: ['slide', 'swing', 'sandbox'],
  lights: ['lamp', 'light', 'lantern'],
  dominoes: ['domino'],
  vehicles: ['car', 'truck', 'boat'],
};

function hasPreset(w: WorldDoc, preset: string): boolean {
  if (w.environment.ground?.material.preset === preset) return true;
  return Object.values(w.entities).some((e) => e.material?.preset === preset);
}

function hasBehavior(w: WorldDoc, type: string): boolean {
  return Object.values(w.entities).some((e) => e.behaviors.some((b) => b.type === type));
}

function singular(w: string): string {
  if (w.endsWith('ies') && w.length > 4) return `${w.slice(0, -3)}y`;
  if (/(ches|shes|xes|sses)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) return w.slice(0, -1);
  return w;
}

/** Content words of a prompt (deduplicated, ≤ 10). */
export function promptKeywords(prompt: string): string[] {
  const words = prompt.toLowerCase().match(/[a-z][a-z-]{2,}/g) ?? [];
  const out: string[] = [];
  for (const w of words) {
    if (STOPWORDS.has(w) || out.includes(w)) continue;
    out.push(w);
    if (out.length >= 10) break;
  }
  return out;
}

function entityText(e: Entity): string {
  const shape = e.shape.kind === 'procedural' ? e.shape.generator : e.shape.kind === 'scatter' ? (e.shape.of.kind === 'procedural' ? e.shape.of.generator : e.shape.of.primitive) : e.shape.kind === 'primitive' ? e.shape.primitive : '';
  return `${e.id} ${e.name} ${e.tags.join(' ')} ${shape} ${e.description ?? ''} ${e.behaviors.map((b) => b.type).join(' ')}`.toLowerCase();
}

function colorParams(params: Record<string, Json>, into: string[]): void {
  for (const [k, v] of Object.entries(params)) if (/color$/i.test(k) && typeof v === 'string') into.push(v);
}

function worldColors(world: WorldDoc): { colors: string[]; presets: Set<string> } {
  const colors: string[] = [];
  const presets = new Set<string>();
  for (const e of Object.values(world.entities)) {
    if (!e.visible || e.template) continue;
    if (e.material?.color) colors.push(e.material.color);
    if (e.material?.preset) presets.add(e.material.preset);
    if (e.shape.kind === 'procedural') colorParams(e.shape.params, colors);
    if (e.shape.kind === 'scatter' && e.shape.of.kind === 'procedural') colorParams(e.shape.of.params, colors);
  }
  const ground = world.environment.ground;
  if (ground?.material.color) colors.push(ground.material.color);
  if (ground?.material.preset) presets.add(ground.material.preset);
  return { colors, presets };
}

function avg(views: readonly ViewStats[], key: keyof ViewStats): number {
  return views.reduce((s, v) => s + v[key], 0) / views.length;
}

/** Peak score at [lo, hi], falling linearly to 0 at [lo - fall, hi + fall]. */
function band(v: number, lo: number, hi: number, fall: number): number {
  if (v >= lo && v <= hi) return 10;
  const d = v < lo ? lo - v : v - hi;
  return Math.max(0, 10 * (1 - d / fall));
}

interface Ctx {
  input: QualityInput;
  world: WorldDoc;
  content: Placed[];
  issues: QualityIssue[];
}

function composition(c: Ctx): CriterionScore {
  const notes: string[] = [];
  const n = c.content.length;
  let s = n === 0 ? 1 : n < 3 ? 4 : 7;
  const focus = c.content.some((p) => p.entity.tags.includes('focus')) || c.content.some((p) => volume(p.bounds) > 30);
  if (focus) s += 1.5;
  else if (n > 0) notes.push('no clear focal object');
  const views = c.input.views;
  if (views && views.length > 0) {
    const cov = avg(views, 'coverage');
    const covScore = band(cov, 0.18, 0.62, 0.3);
    s = s * 0.5 + covScore * 0.5;
    if (cov < 0.12) {
      notes.push('content looks small or sparse in the rendered views');
      c.issues.push({ criterion: 'composition', severity: 'major', message: 'The content fills too little of the frame; group objects around a focal point.', fix: 'densify' });
    } else if (cov > 0.8) notes.push('views are crowded or cropped');
  }
  const ext = contentExtent(c.content);
  if (n > 2 && ext.radius > 150) {
    s -= 2;
    notes.push('content is spread very wide');
  }
  if (notes.length === 0) notes.push(n === 0 ? 'nothing to compose' : 'readable layout with a focal point');
  return { score: clamp10(s), notes };
}

function materials(c: Ctx): CriterionScore {
  const notes: string[] = [];
  const { colors, presets } = worldColors(c.world);
  const p = paletteStats(colors);
  let s = 5;
  if (presets.size >= 3) s += 1.5;
  else if (presets.size >= 2) s += 0.8;
  if (p.colors >= 3) s += 1;
  s += (p.harmony - 0.5) * 4;
  if (p.greyShare > 0.85 && p.colors >= 3) {
    s -= 2;
    notes.push('palette is almost entirely grey');
    c.issues.push({ criterion: 'materials', severity: 'minor', message: 'Almost every surface is grey; add a few coloured accents.', fix: 'palette' });
  }
  if (p.hueFamilies >= 7) {
    s -= 1.5;
    notes.push('many unrelated hues compete');
  }
  if (p.meanSaturation > 0.85) {
    s -= 1;
    notes.push('colours are uniformly oversaturated');
  }
  if (notes.length === 0) notes.push(`${presets.size} material presets, ${p.hueFamilies} hue families`);
  return { score: clamp10(s), notes };
}

function lighting(c: Ctx, words: readonly string[]): CriterionScore {
  const notes: string[] = [];
  const env = c.world.environment;
  let s = 6;
  const night = env.sky === 'night' || env.sky === 'space';
  const lights = Object.values(c.world.entities).filter((e) => e.visible && (e.light || (e.material?.emissiveIntensity ?? 0) > 0.2 || (e.material?.emissive !== undefined && e.material.emissive !== '#000000')));
  if (night) {
    if (lights.length === 0) {
      s -= 3;
      notes.push('night scene without light sources');
      c.issues.push({ criterion: 'lighting', severity: 'major', message: 'A night scene needs light sources (lamps, fires, glowing accents).', fix: 'light-night' });
    } else s += Math.min(3, lights.length * 0.6);
  } else {
    if (env.sky !== 'day' || env.timeOfDay !== undefined) s += 1.5;
    else if (!words.some((w) => w in MOOD_WORDS)) {
      notes.push('flat default midday light');
      c.issues.push({ criterion: 'lighting', severity: 'minor', message: 'Default noon light is flat; a lower sun gives depth.', fix: 'golden-hour' });
    }
    if (lights.length > 0) s += 0.8;
  }
  if (env.fog) s += 0.6;
  if (env.ambientIntensity > 1.5) {
    s -= 1.5;
    notes.push('ambient light washes out shadows');
  }
  const views = c.input.views;
  if (views && views.length > 0) {
    const lum = avg(views, 'luminance');
    const con = avg(views, 'contrast');
    s = s * 0.6 + (band(lum, 0.18, 0.78, 0.25) * 0.5 + band(con, 0.1, 0.35, 0.12) * 0.5) * 0.4;
    if (lum < 0.08) notes.push('rendered views are very dark');
    if (con < 0.05) notes.push('low contrast in the rendered views');
  }
  if (notes.length === 0) notes.push(night ? `${lights.length} light sources` : `${env.sky} sky${env.fog ? ' with fog' : ''}`);
  return { score: clamp10(s), notes };
}

function scale(c: Ctx): CriterionScore {
  const notes: string[] = [];
  let s = 9;
  const odd: string[] = [];
  for (const p of c.content) {
    const h = p.bounds.max[1] - p.bounds.min[1];
    const w = Math.max(p.bounds.max[0] - p.bounds.min[0], p.bounds.max[2] - p.bounds.min[2]);
    if (!p.root) continue;
    if (h > 80 || w > 50 || (Math.max(h, w) < 0.04 && !p.entity.light)) odd.push(p.id);
  }
  if (odd.length > 0) {
    s -= Math.min(5, odd.length * 1.5);
    notes.push(`${odd.length} object(s) with implausible size`);
    c.issues.push({ criterion: 'scale', severity: odd.length > 2 ? 'major' : 'minor', message: 'Some objects are implausibly huge or tiny for the scene.', entities: odd.slice(0, 8) });
  }
  const ground = c.world.environment.ground;
  const ext = contentExtent(c.content);
  if (ground && ext.radius > ground.size / 2) {
    s -= 2;
    notes.push('content extends beyond the ground');
  }
  // Human reference: if a player exists, doors/furniture should be on that scale; we only flag absurd extremes.
  const tallest = c.content.reduce((m, p) => Math.max(m, p.bounds.max[1] - p.bounds.min[1]), 0);
  if (c.content.length > 3 && tallest < PERSON_HEIGHT * 0.5) notes.push('everything is smaller than knee height');
  if (notes.length === 0) notes.push('sizes are plausible');
  return { score: clamp10(s), notes };
}

function detail(c: Ctx): CriterionScore {
  const notes: string[] = [];
  const n = c.content.length;
  let scatter = 0;
  for (const e of Object.values(c.world.entities)) if (e.visible && !e.template && e.shape.kind === 'scatter') scatter += e.shape.count;
  const effective = n + Math.min(60, scatter / 8);
  let s = effective >= 25 ? 9 : effective >= 12 ? 7.5 : effective >= 6 ? 6 : effective >= 3 ? 4 : 2;
  const variety = new Set(c.content.map((p) => (p.entity.shape.kind === 'procedural' ? p.entity.shape.generator : p.entity.shape.kind === 'primitive' ? p.entity.shape.primitive : p.entity.shape.kind))).size;
  if (variety >= 5) s += 1;
  else if (variety <= 1 && n > 2) {
    s -= 1;
    notes.push('one kind of object repeated');
  }
  if (effective < 6) {
    notes.push('the scene feels empty');
    c.issues.push({ criterion: 'detail', severity: effective < 3 ? 'major' : 'minor', message: 'The scene is sparse; add props, vegetation or set dressing.', fix: 'densify' });
  }
  if (n > 400) {
    s -= 1.5;
    notes.push('very cluttered');
  }
  const views = c.input.views;
  if (views && views.length > 0) {
    const edges = avg(views, 'edgeDensity');
    s = s * 0.7 + band(edges, 0.05, 0.3, 0.1) * 0.3;
  }
  if (notes.length === 0) notes.push(`${n} objects${scatter > 0 ? ` + ${scatter} scattered` : ''}, ${variety} kinds`);
  return { score: clamp10(s), notes };
}

function coherence(c: Ctx, words: readonly string[]): CriterionScore {
  if (words.length === 0) return { score: 8, notes: ['no specific nouns to match'] };
  const texts = Object.values(c.world.entities).map(entityText);
  const meta = `${c.world.name} ${c.world.description ?? ''}`.toLowerCase();
  const missing: string[] = [];
  let hit = 0;
  for (const w of words) {
    const mood = MOOD_WORDS[w];
    const sing = singular(w);
    const syn = SYNONYMS[w] ?? SYNONYMS[sing] ?? [];
    const found = (mood ? mood(c.world) : false) || [sing, w, ...syn].some((k) => texts.some((t) => t.includes(k))) || meta.includes(sing);
    if (found) hit++;
    else missing.push(w);
  }
  const ratio = hit / words.length;
  const s = 2 + ratio * 8;
  const notes = missing.length === 0 ? ['every key word of the prompt is represented'] : [`not visibly present: ${missing.slice(0, 5).join(', ')}`];
  if (ratio < 0.6) c.issues.push({ criterion: 'coherence', severity: ratio < 0.35 ? 'major' : 'minor', message: `The world does not show: ${missing.slice(0, 5).join(', ')}.` });
  return { score: clamp10(s), notes };
}

function physical(c: Ctx): CriterionScore {
  const notes: string[] = [];
  let s = 10;
  if (c.input.verifyPassed === false) {
    s = 4;
    notes.push('verification failed');
  }
  const diags = c.input.diagnostics ?? [];
  const diagOverlaps = diags.filter((d) => d.code === 'overlap').length;
  const diagFloating = diags.filter((d) => d.code === 'floating').length;
  s -= Math.min(4, (diagOverlaps + diagFloating) * 1);

  // Own checks on static, top-level content.
  const solid = c.content.filter((p) => p.root && p.entity.physics?.body !== 'dynamic' && !p.entity.physics?.sensor).slice(0, MAX_PAIR_ENTITIES);
  const floating: string[] = [];
  for (const p of solid) {
    if (mayFloat(p.entity)) continue;
    const bottom = p.bounds.min[1];
    if (bottom <= FLOAT_GAP) continue;
    const supported = solid.some((q) => q !== p && q.bounds.max[1] <= bottom + FLOAT_GAP && q.bounds.max[1] >= bottom - 1.5 && overlapsXZ(p, q));
    if (!supported) floating.push(p.id);
  }
  const overlaps: string[] = [];
  for (let i = 0; i < solid.length; i++) {
    const a = solid[i] as Placed;
    for (let j = i + 1; j < solid.length; j++) {
      const b = solid[j] as Placed;
      const v = overlapVolume(a.bounds, b.bounds);
      if (v <= 0) continue;
      const small = Math.min(volume(a.bounds), volume(b.bounds));
      // Flat things (paths, rugs, water) legitimately sit inside others' boxes.
      const flat = Math.min(a.bounds.max[1] - a.bounds.min[1], b.bounds.max[1] - b.bounds.min[1]) < 0.3;
      if (!flat && v > small * 0.35) overlaps.push(volume(a.bounds) < volume(b.bounds) ? a.id : b.id);
    }
  }
  if (floating.length > 0) {
    s -= Math.min(3, floating.length);
    notes.push(`${floating.length} object(s) float above the ground`);
    c.issues.push({ criterion: 'physical', severity: floating.length > 2 ? 'major' : 'minor', message: 'Some objects hover without support.', entities: floating.slice(0, 12), fix: 'ground' });
  }
  const uniqueOverlaps = [...new Set(overlaps)];
  if (uniqueOverlaps.length > 0) {
    s -= Math.min(3, uniqueOverlaps.length * 0.75);
    notes.push(`${uniqueOverlaps.length} object(s) interpenetrate others`);
    c.issues.push({ criterion: 'physical', severity: uniqueOverlaps.length > 2 ? 'major' : 'minor', message: 'Some objects intersect each other.', entities: uniqueOverlaps.slice(0, 12), fix: 'separate' });
  }
  if (notes.length === 0) notes.push(c.input.verifyPassed ? 'verification passed; everything rests on a surface' : 'no floating or intersecting objects found');
  return { score: clamp10(s), notes };
}

function overlapsXZ(a: Placed, b: Placed): boolean {
  return a.bounds.min[0] < b.bounds.max[0] && a.bounds.max[0] > b.bounds.min[0] && a.bounds.min[2] < b.bounds.max[2] && a.bounds.max[2] > b.bounds.min[2];
}

/** Score a world against the rubric with deterministic heuristics. */
export function assessWorld(input: QualityInput): QualityReport {
  const content = placedContent(input.world, input.bounds);
  const ctx: Ctx = { input, world: input.world, content, issues: [] };
  const words = promptKeywords(input.prompt);
  const criteria: Record<QualityCriterion, CriterionScore> = {
    composition: composition(ctx),
    materials: materials(ctx),
    lighting: lighting(ctx, words),
    scale: scale(ctx),
    detail: detail(ctx),
    coherence: coherence(ctx, words),
    physical: physical(ctx),
  };
  const score = weightedScore(criteria);
  const worst = [...QUALITY_CRITERIA].sort((a, b) => criteria[a].score - criteria[b].score)[0] as QualityCriterion;
  const summary = score >= 85 ? 'Strong result.' : score >= 72 ? `Good; weakest area: ${worst}.` : `Needs work, mostly ${worst}.`;
  return { score, criteria, issues: ctx.issues, source: 'heuristic', summary };
}
