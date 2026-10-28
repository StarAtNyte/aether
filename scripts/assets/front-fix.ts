/**
 * Dev-time front check of the converted SimReady models by a vision model (docs/ASSETS.md "Front fix").
 *
 *   npm run assets:simready -- front-fix [--ids=a,b] [--source=all|bulk|lib] [--scope=all|unsure] [--limit=N] [--refresh]
 *       [--budget-usd=15] [--concurrency=2] [--min-confidence=0.7] [--model=claude-sonnet-5-5] [--render-only] [--no-write]
 *
 * The library's convention is that a model's front faces +Z. For every non-symmetric model the script renders four turns
 * about Y (0/90/180/270 degrees, in a shuffled order) as ONE labelled 2x2 contact image with a floor arrow showing +Z, and
 * asks the model (one call, Anthropic API key from ~/.config/aether/anthropic.key, low effort) which tile shows the front as
 * a person would name it, and what the piece is mounted on. The answer is the decision: it is written, with the model's
 * reason, to `scripts/assets/simready-fronts.json` when its confidence reaches `--min-confidence`; otherwise the model is
 * left as it is and 'front unsure (model)' is logged. The geometry rules (front.ts) are advice only, in the prompt.
 *
 * Reads the bulk output (`out/` and `state.json` of the bulk folder) and the library; writes only to its own folder
 * (`~/.local/share/aether/frontfix/`: cache.json, images/, results.jsonl) and to simready-fronts.json. Answers are cached by
 * model + source hash, so a second run costs nothing. The spend is estimated from the reported token counts and the run
 * stops at `--budget-usd`. The API key is never printed or logged.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { BridgeBackendId } from '@aether/agent';
import { FRONTS_FILE, loadFrontOverrides, type FrontOverride, type Mounting } from './front-overrides';

const ROOT = resolve(import.meta.dirname, '../..');
const BULK_DIR = process.env['AETHER_BULK_DIR'] ?? join(homedir(), '.local', 'share', 'aether', 'simready-bulk');
const WORK = process.env['AETHER_FRONTFIX_DIR'] ?? join(homedir(), '.local', 'share', 'aether', 'frontfix');
process.env['AETHER_BROWSER_EXTRA_DIR'] = join(BULK_DIR, 'out');

const arg = (name: string): string | undefined => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = (name: string): boolean => process.argv.includes(`--${name}`);
const log = (m: string): void => void console.log(`${new Date().toISOString().slice(11, 19)} ${m}`);
const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
const PROMPT_REV = 3;
const ANGLES = [0, 90, 180, 270] as const;
const LABELS = ['A', 'B', 'C', 'D'] as const;

export interface Cand {
  id: string;
  name: string;
  type: string;
  category: string;
  size: [number, number, number];
  /** Rotation about Y the current file was built with. */
  builtRot: number;
  /** Cache key part: changes when the source changes. */
  src: string;
  url: string;
  source: 'bulk' | 'lib';
  symmetric: boolean;
  unsure: boolean;
  /** Mounting the file was built with. */
  mounting: Mounting;
  /** Geometry rule's opinion (advice for the model). */
  hint: string;
}

export interface Answer {
  front: 'A' | 'B' | 'C' | 'D' | 'none';
  mounting: Mounting;
  /** How sure the model is of the mounting (the front's `confidence` is separate). */
  mountingConfidence: number;
  confidence: number;
  reason: string;
}

/** Tile order of one model: a fixed shuffle of the four turns, so the model cannot lean on "A is the file as it stands". */
export function tileAngles(id: string): number[] {
  const h = createHash('sha256').update(id).digest();
  const a: number[] = [...ANGLES];
  for (let i = 3; i > 0; i--) {
    const j = (h[i] as number) % (i + 1);
    const t = a[i] as number;
    a[i] = a[j] as number;
    a[j] = t;
  }
  return a;
}

/** Absolute build rotation from the chosen tile. */
export function absRot(builtRot: number, angles: readonly number[], tile: string): number {
  const i = LABELS.indexOf(tile as (typeof LABELS)[number]);
  return (((builtRot + (angles[i] as number)) % 360) + 360) % 360;
}

export function parseAnswer(text: string): Answer | null {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return null;
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(m[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
  const front = String(j['front'] ?? '').trim().toUpperCase();
  const f = front === 'NONE' ? 'none' : front;
  if (!['A', 'B', 'C', 'D', 'none'].includes(f)) return null;
  const mount = String(j['mounting'] ?? 'floor').toLowerCase();
  const mounting: Mounting = mount === 'wall' || mount === 'ceiling' || mount === 'table' ? mount : 'floor';
  const confidence = Math.max(0, Math.min(1, Number(j['confidence'])));
  if (!Number.isFinite(confidence)) return null;
  const mc = Number(j['mounting_confidence']);
  return { front: f as Answer['front'], mounting, mountingConfidence: Number.isFinite(mc) ? Math.max(0, Math.min(1, mc)) : confidence, confidence, reason: String(j['reason'] ?? '').replace(/\s+/g, ' ').slice(0, 240) };
}

const SYSTEM = `You judge the orientation of 3D models for a furniture and props library. You get one picture with four tiles (A, B, C, D): the same model turned by 0, 90, 180 and 270 degrees about the vertical axis, in the order shown by the letters. A red arrow on the floor in every tile points toward the viewer (the library's +Z). Decide which tile shows the model with its FRONT facing the viewer, the way a person would name the front: the seat of a chair faces front (the backrest is behind), cabinet doors and drawers face front, a sofa's seating side, a monitor's or TV's screen side, a sink's basin side, a forklift's forks and the side it drives toward, an oven's door, a washing machine's door, a keyboard's keys toward the user, a sign's printed face, a vehicle's bonnet end, a bed's foot end (headboard behind). If the model is symmetrical with no meaningful front, answer front "none". Also say what the model is normally mounted on: "floor" (stands on the floor), "wall" (hangs on a wall: wall sink, shelf bracket, sign, TV, mirror, wall lamp), "ceiling" (hangs from the ceiling), or "table" (small item that stands on a table or desk: mug, keyboard, desk lamp). Answer with JSON only: {"front":"A|B|C|D|none","mounting":"floor|wall|ceiling|table","confidence":0..1,"mounting_confidence":0..1,"reason":"one short sentence naming what you saw"}. Pick the most plausible tile whenever the model has a front at all; keep "none" for models that are really the same from every side, and for flat hand tools with no meaningful front. "confidence" is how sure you are of the front tile (under 0.7 when two tiles are plausible); "mounting_confidence" is how sure you are of the mounting.`;

// ---------------------------------------------------------------- candidates

interface BulkRec {
  id: string;
  type: string;
  category: string;
  status: string;
  place?: string;
  symmetric: boolean;
  usdSha256?: string;
  front?: { rot: number | null; sure: boolean; why: string };
  size?: [number, number, number];
}

export function loadBulkCands(): Cand[] {
  const stateFile = join(BULK_DIR, 'state.json');
  if (!existsSync(stateFile)) return [];
  const state = JSON.parse(readFileSync(stateFile, 'utf8')) as { records: Record<string, BulkRec> };
  const out: Cand[] = [];
  for (const r of Object.values(state.records)) {
    if (r.status !== 'converted' && r.status !== 'published') continue;
    const ef = join(BULK_DIR, 'out', r.id, 'entry.json');
    if (!existsSync(ef)) continue;
    const e = JSON.parse(readFileSync(ef, 'utf8')) as { file: string; name: string; size: [number, number, number] };
    out.push({
      id: r.id,
      name: e.name,
      type: r.type,
      category: r.category,
      size: e.size,
      builtRot: r.front?.rot ?? 0,
      src: r.usdSha256 ?? sha(e.file).slice(0, 16),
      url: `/extra/${r.id}/lib/${e.file}`,
      source: 'bulk',
      mounting: r.place === 'surface' ? 'table' : 'floor',
      symmetric: r.symmetric === true || r.front?.why === 'symmetric',
      unsure: r.front?.sure === false,
      hint: r.front ? `geometry rule: ${r.front.sure ? 'sure' : 'unsure'} (${r.front.why})` : '',
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export async function loadLibCands(): Promise<Cand[]> {
  const cat = JSON.parse(readFileSync(join(ROOT, 'assets', 'catalog.json'), 'utf8')) as { entries: Array<{ id: string; name: string; category: string; placement?: string; size: [number, number, number]; file: string; pack: string; interior?: { type: string } }> };
  const { SIMREADY } = await import('./selection-simready');
  const rows = new Map(SIMREADY.map((s) => [s.row[1], s]));
  // A model the check already turned was rebuilt with that rotation (build.ts applies simready-fronts.json to the rows).
  const seen = loadFrontOverrides();
  const out: Cand[] = [];
  for (const e of cat.entries) {
    const item = rows.get(e.id);
    if (!item) continue;
    out.push({
      id: e.id,
      name: e.name,
      type: e.interior?.type ?? item.row[2],
      category: e.category,
      size: e.size,
      builtRot: seen[e.id]?.rot ?? item.row[6]?.rot ?? 0,
      src: item.source,
      url: `/lib/${e.file}`,
      source: 'lib',
      mounting: e.placement === 'surface' ? 'table' : e.placement === 'wall' || e.placement === 'ceiling' ? e.placement : 'floor',
      symmetric: false,
      unsure: false,
      hint: '',
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------- the run

interface CacheEntry extends Answer {
  /** Absolute build rotation, or null when the model said there is no front. */
  rot: number | null;
  /** The rotation the file was asked about was built with (kept when the front is unsure). */
  kept: number;
  model: string;
  tokens: [number, number];
}

const readJson = <T>(f: string, d: T): T => (existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as T) : d);
const writeAtomic = (f: string, s: string): void => {
  writeFileSync(`${f}.tmp`, s);
  renameSync(`${f}.tmp`, f);
};

/** Write the confident answers into simready-fronts.json (kept sorted; existing entries of other ids stay). */
export function writeFronts(cache: Record<string, CacheEntry>, cands: Cand[], minConf: number, file = FRONTS_FILE): number {
  const fronts = loadFrontOverrides(file);
  let n = 0;
  for (const c of cands) {
    const a = cache[cacheKey(c, arg('model') ?? MODEL)];
    if (!a) continue;
    const sure = a.rot !== null && a.confidence >= minConf;
    // The mounting is its own judgement: it changes only at the same confidence, and an unsure front keeps the file's rotation.
    const mounting = a.mountingConfidence >= minConf ? a.mounting : c.mounting;
    if (!sure && mounting === c.mounting) continue;
    const next: FrontOverride = { rot: sure ? (a.rot as number) : a.kept, mounting, confidence: Math.round(a.confidence * 100) / 100, reason: sure ? a.reason : `front unsure; ${a.reason}`.slice(0, 240), model: a.model };
    if (JSON.stringify(fronts[c.id]) !== JSON.stringify(next)) n++;
    fronts[c.id] = next;
  }
  const sorted = Object.fromEntries(Object.entries(fronts).sort(([x], [y]) => x.localeCompare(y)));
  writeAtomic(file, `${JSON.stringify({ about: 'Front (rot about Y, degrees) and mounting per model, decided by a vision model from four turned views. Written by scripts/assets/front-fix.ts; read by the bulk converter and the library build.', fronts: sorted }, null, 1)}\n`);
  return n;
}

const MODEL = process.env['AETHER_LIVE_MODEL'] ?? 'claude-sonnet-5-5';
const cacheKey = (c: Cand, model: string): string => `${c.id}|${c.src}|${model}|p${PROMPT_REV}`;

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await fn(items[i++] as T); }));
}

export async function frontFix(): Promise<void> {
  const model = arg('model') ?? MODEL;
  const budget = Number(arg('budget-usd') ?? 15);
  const conc = Math.max(1, Math.min(2, Number(arg('concurrency') ?? 2)));
  const minConf = Number(arg('min-confidence') ?? 0.7);
  const priceIn = Number(arg('price-in') ?? 3) / 1e6;
  const priceOut = Number(arg('price-out') ?? 15) / 1e6;
  const source = arg('source') ?? 'all';
  const ids = arg('ids')?.split(',');
  mkdirSync(join(WORK, 'images'), { recursive: true });
  const cacheFile = join(WORK, 'cache.json');
  const cache = readJson<Record<string, CacheEntry>>(cacheFile, {});

  let cands = [...(source !== 'lib' ? loadBulkCands() : []), ...(source !== 'bulk' ? await loadLibCands() : [])];
  if (ids) cands = cands.filter((c) => ids.includes(c.id));
  const skipped = cands.filter((c) => c.symmetric);
  for (const c of skipped) log(`skip symmetric: ${c.id}`);
  cands = cands.filter((c) => !c.symmetric);
  if (arg('scope') === 'unsure') cands = cands.filter((c) => c.unsure);
  if (arg('limit')) cands = cands.slice(0, Number(arg('limit')));
  const todo = cands.filter((c) => flag('refresh') || !cache[cacheKey(c, model)]);
  log(`front-fix: ${cands.length} non-symmetric models (${skipped.length} skipped as symmetric), ${cands.length - todo.length} cached, ${todo.length} to ask, budget $${budget}, model ${model}`);

  let spent = 0;
  let tokIn = 0;
  let tokOut = 0;
  let asked = 0;
  let stopped = false;
  if (todo.length > 0) {
    const { withBrowserPage } = await import('./browser');
    const { VIEWS_SETUP } = await import('./front-view');
    const provider = flag('render-only') ? null : (await import('../lib/live-provider')).createHeadlessProvider('claude-code' as BridgeBackendId, { model, effort: 'low' });
    await withBrowserPage(async (page) => {
      await page.addScriptTag({ type: 'module', content: VIEWS_SETUP });
      await page.waitForFunction(() => (window as unknown as { __viewsReady?: boolean }).__viewsReady === true, undefined, { timeout: 30_000 });
      // The page renders one model at a time.
      let chain: Promise<unknown> = Promise.resolve();
      const render = (c: Cand, angles: number[]): Promise<string> => {
        const p = chain.then(() => page.evaluate(([u, a, l]) => (window as unknown as { __views: { contact(u: string, a: number[], l: string[]): Promise<string> } }).__views.contact(u as string, a as number[], l as string[]), [c.url, angles, [...LABELS]] as [string, number[], string[]]));
        chain = p.catch(() => undefined);
        return p;
      };
      let last = 0;
      await pool(todo, conc, async (c) => {
        if (spent >= budget) {
          if (!stopped) log(`budget $${budget} reached: stopping (the rest stay for the next run)`);
          stopped = true;
          return;
        }
        const angles = tileAngles(c.id);
        try {
          const png = await render(c, angles);
          writeFileSync(join(WORK, 'images', `${c.id}.png`), Buffer.from(png, 'base64'));
          if (!provider) return;
          // A small gap between calls keeps the request rate polite.
          const wait = Math.max(0, last + 400 - Date.now());
          last = Date.now() + wait;
          if (wait) await new Promise((r) => setTimeout(r, wait));
          const msg = `Model: "${c.name}" (type ${c.type}, category ${c.category}). Size as shown: ${c.size[0]} m wide (x), ${c.size[1]} m tall, ${c.size[2]} m deep (z). ${c.hint ? `Advice only, from a shape rule: ${c.hint}. ` : ''}Which tile shows the front?`;
          const res = await provider.complete({ role: 'critic', model, system: SYSTEM, maxTokens: 600, messages: [{ role: 'user', content: [{ type: 'image', dataUrl: `data:image/png;base64,${png}` }, { type: 'text', text: msg }] }] });
          const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
          const u = res.usage ?? { inputTokens: 0, outputTokens: 0 };
          tokIn += u.inputTokens;
          tokOut += u.outputTokens;
          spent = tokIn * priceIn + tokOut * priceOut;
          asked++;
          const a = parseAnswer(text);
          if (!a) {
            log(`  ${c.id}: unreadable answer, left as is`);
            return;
          }
          const entry: CacheEntry = { ...a, rot: a.front === 'none' ? null : absRot(c.builtRot, angles, a.front), kept: c.builtRot, model, tokens: [u.inputTokens, u.outputTokens] };
          cache[cacheKey(c, model)] = entry;
          writeAtomic(cacheFile, JSON.stringify(cache));
          appendFileSync(join(WORK, 'results.jsonl'), `${JSON.stringify({ id: c.id, builtRot: c.builtRot, angles, ...entry })}\n`);
          const verdict = entry.rot === null || a.confidence < minConf ? `front unsure (model): ${c.id}` : `${c.id}: rot ${entry.rot} (was ${c.builtRot}) ${a.mounting}`;
          log(`  [${asked}/${todo.length}] ${verdict} conf ${a.confidence.toFixed(2)} "${a.reason.slice(0, 90)}" | ${tokIn + tokOut} tok, ~$${spent.toFixed(3)}`);
        } catch (e) {
          log(`  ${c.id}: failed (${(e instanceof Error ? e.message : String(e)).replace(/sk-[A-Za-z0-9_-]+/g, '[key]').slice(0, 160)})`);
        }
      });
    });
  }
  log(`asked ${asked} | tokens in ${tokIn}, out ${tokOut} | estimated cost $${spent.toFixed(3)}${asked ? ` ($${(spent / asked).toFixed(4)} per model)` : ''}`);
  if (flag('render-only') || flag('no-write')) return;
  const changed = writeFronts(cache, cands, minConf);
  const answers = cands.map((c) => cache[cacheKey(c, model)]).filter((x): x is CacheEntry => !!x);
  const low = answers.filter((a) => a.rot === null || a.confidence < minConf).length;
  const turned = cands.filter((c) => { const a = cache[cacheKey(c, model)]; return a && a.rot !== null && a.confidence >= minConf && a.rot !== c.builtRot; }).length;
  log(`simready-fronts.json: ${changed} entries written or changed | ${turned} models need another rotation | ${low} low confidence or no front | ${skipped.length} skipped as symmetric`);
}
