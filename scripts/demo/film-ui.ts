/**
 * Browser UI takes of the studio for the product film, recorded in real time from the built studio with Chrome's
 * screencast (every painted frame with its paint time) at 3840x2160 device pixels (a 1920x1080 page at device scale 2: a 3840x2160 capture the edit crops into).
 *
 *   STATIC_DIR=<dist> GEN_GPU=nvidia npx tsx scripts/demo/film-ui.ts --scene=edit|publish|modes|play [--out=<dir>]
 *   STATIC_DIR=<dist> GEN_GPU=nvidia npx tsx scripts/demo/film-ui.ts --scene=scout --slugs=villa-pool,casa-patio
 *
 * Scenes:
 *   edit     a furnished house in the editor: select a piece, slide it with the move gizmo, swap its material preset,
 *            sweep the time of day, then a chat refine with its one-line diff and Undo
 *   publish  the Publish hub's share link, then that link opened in the same page: the published player's hero tour,
 *            time of day, dollhouse and walking
 *   modes    a city in the player: street-level hero view, then the drone and its districts
 *   play     a character walking in a game world, third person
 *
 * Every wait (loading, baking, the agent working) is wrapped in a cut or ramp mark; the marks are written as
 * `<out>/<scene>.json` (times in ms from the first captured frame) next to `<out>/<scene>.mp4` (constant 30 fps, 4K; a frame
 * is held until the next one was painted). Nothing is drawn over the page except the demo cursor and its click ripple.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type BrowserContext, type CDPSession, type Locator, type Page } from 'playwright';
import { CHROME_ARGS, HEADLESS, SKIP_FIRST_RUN, findChrome, startServer } from '../../tests/e2e/support/env';
import { OVERLAY_SCRIPT, Recorder, centre, click, cursor, dwell, glide, sleep, type } from './lib';

const ARGS = process.argv.slice(2);
const arg = (n: string): string | undefined => ARGS.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const SCENE = arg('scene') ?? 'edit';
const OUT = resolve(arg('out') ?? join(homedir(), '.local/share/aether/demo/film/ui'));
const EDIT_SLUG = arg('slug') ?? 'scandi-living-room';
const W = 1920;
const H = 1080;
const SCALE = Number(arg('scale') ?? 2);
/** The takes' pointer positions were laid out for a 1440 px page. */
const K = W / 1440;
// Chrome's screencast delivers CSS-sized frames when the scale is emulated (Playwright's deviceScaleFactor), physical ones when
// the browser itself runs at the scale: so the window is launched at it (`--force-device-scale-factor`) and the context takes
// the window as it is. The window is 87 px taller than the page it holds.
const T0 = Date.now();
const log = (s: string): void => void process.stdout.write(`[${((Date.now() - T0) / 1000).toFixed(0)}s] ${s}\n`);

type Vec3 = [number, number, number];

// ---------------------------------------------------------------------------------------------------------------
// capture
// ---------------------------------------------------------------------------------------------------------------

/** Screencast capture of one page: JPEG frames with their paint times, restartable across navigations. */
class Capture {
  readonly times: number[] = [];
  private cdp: CDPSession | null = null;
  constructor(
    private readonly ctx: BrowserContext,
    private readonly page: Page,
    readonly dir: string,
  ) {}
  async start(): Promise<void> {
    const cdp = await this.ctx.newCDPSession(this.page);
    this.cdp = cdp;
    cdp.on('Page.screencastFrame', (f: { data: string; sessionId: number; metadata: { timestamp?: number } }) => {
      const t = f.metadata.timestamp ?? Date.now() / 1000;
      // A frame painted before the last one (a restarted screencast) is dropped.
      if (this.times.length && t <= this.times[this.times.length - 1]!) {
        void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => undefined);
        return;
      }
      writeFileSync(join(this.dir, `f${String(this.times.length).padStart(5, '0')}.jpg`), Buffer.from(f.data, 'base64'));
      this.times.push(t);
      void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => undefined);
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 95, maxWidth: W * SCALE, maxHeight: H * SCALE, everyNthFrame: 1 });
  }
  async stop(): Promise<void> {
    if (!this.cdp) return;
    await this.cdp.send('Page.stopScreencast').catch(() => undefined);
    await sleep(300);
    await this.cdp.detach().catch(() => undefined);
    this.cdp = null;
  }
  /** Wall-clock ms of the first frame. */
  get first(): number {
    return (this.times[0] ?? Date.now() / 1000) * 1000;
  }
}

/** Gap stats of a stretch of frames (ms). */
function gapStats(times: number[], from = 0, to = Infinity): { median: number; p95: number; max: number; n: number } {
  const t = times.filter((x) => x * 1000 >= from && x * 1000 <= to);
  const gaps = t.slice(1).map((x, i) => (x - t[i]!) * 1000).sort((a, b) => a - b);
  if (!gaps.length) return { median: 0, p95: 0, max: 0, n: t.length };
  return { median: gaps[gaps.length >> 1]!, p95: gaps[Math.floor(gaps.length * 0.95)]!, max: gaps[gaps.length - 1]!, n: t.length };
}

interface Take {
  ctx: BrowserContext;
  page: Page;
  rec: Recorder;
  cap: Capture;
  /** Key moments (ms on the Recorder clock), written with the marks for the edit. */
  events: Array<{ t: number; what: string }>;
}

/** Note a key moment of the take. */
function mark(t: Take, what: string): void {
  t.events.push({ t: t.rec.now(), what });
  log(`[${(t.rec.now() / 1000).toFixed(1)}] ${what}`);
}

async function newTake(browser: Awaited<ReturnType<typeof chromium.launch>>, scene: string, source: string, device?: 'laptop' | 'phone'): Promise<Take> {
  const ctx = await browser.newContext(
    device === 'phone' ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : device === 'laptop' ? { viewport: { width: 1440, height: 900 } } : { viewport: null },
  );
  await ctx.addInitScript({ content: SKIP_FIRST_RUN });
  await ctx.addInitScript({ content: 'globalThis.__name = (f) => f;' });
  await ctx.addInitScript({ content: "try { const k='aether.studio.settings.v1'; const s=JSON.parse(localStorage.getItem(k)||'{}'); s.renderTier='ultra'; s.showNavHint=false; s.motion='sharp'; localStorage.setItem(k, JSON.stringify(s)); localStorage.setItem('aether.player.mute', '1'); } catch {}" });
  await ctx.addInitScript({ content: OVERLAY_SCRIPT });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log(`pageerror: ${e.message.slice(0, 200)}`));
  page.on('crash', () => log('page crashed'));
  const dir = join(OUT, `.frames-${scene}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return { ctx, page, rec: new Recorder(scene, source), cap: new Capture(ctx, page, dir), events: [] };
}

/** Write the marks (shifted to the first frame), the frame times, the mp4 and six check stills. */
async function finish(t: Take): Promise<void> {
  await t.cap.stop();
  const { rec, cap } = t;
  const times = cap.times;
  if (times.length < 2) throw new Error('no frames');
  const shift = rec.t0 - cap.first;
  rec.endCaption();
  const marks = rec.marks.map((m) => ({ ...m, t0: Math.max(0, Math.round(m.t0 + shift)), t1: Math.max(0, Math.round(m.t1 + shift)) }));
  const total = (times[times.length - 1]! - times[0]!) * 1000;
  let kept = total;
  for (const m of marks) {
    if (m.kind === 'cut') kept -= m.t1 - m.t0;
    if (m.kind === 'ramp') kept -= (m.t1 - m.t0) * (1 - 1 / m.factor);
  }
  // Frame gaps over the kept footage only (cut stretches are dropped by the editor).
  const cuts = marks.filter((m) => m.kind === 'cut');
  const keptTimes = times.filter((x) => {
    const ms = x * 1000 - cap.first;
    return !cuts.some((c) => ms >= c.t0 && ms <= c.t1);
  });
  const allGaps: number[] = [];
  for (let i = 1; i < keptTimes.length; i++) {
    const a = keptTimes[i - 1]! * 1000 - cap.first;
    const b = keptTimes[i]! * 1000 - cap.first;
    if (cuts.some((c) => a <= c.t0 && b >= c.t1)) continue;
    allGaps.push(b - a);
  }
  allGaps.sort((a, b) => a - b);
  const stats = allGaps.length ? { median: allGaps[allGaps.length >> 1]!, p95: allGaps[Math.floor(allGaps.length * 0.95)]!, max: allGaps[allGaps.length - 1]!, over50: allGaps.filter((g) => g > 50).length } : null;
  writeFileSync(join(OUT, `${rec.scene}.json`), JSON.stringify({ scene: rec.scene, source: rec.source, durationMs: Math.round(total), keptMs: Math.round(kept), frameGapsKept: stats, marks, events: t.events.map((e) => ({ t: Math.round(e.t + shift), what: e.what })) }, null, 1));
  writeFileSync(join(OUT, `${rec.scene}.frames.json`), JSON.stringify({ t0: times[0], gapsMs: times.slice(1).map((x, i) => Math.round((x - times[i]!) * 10000) / 10) }));
  const list = times.map((x, i) => `file 'f${String(i).padStart(5, '0')}.jpg'\nduration ${(i + 1 < times.length ? times[i + 1]! - x : 1 / 60).toFixed(6)}`).join('\n');
  writeFileSync(join(cap.dir, 'list.txt'), `${list}\nfile 'f${String(times.length - 1).padStart(5, '0')}.jpg'\n`);
  const mp4 = join(OUT, `${rec.scene}.mp4`);
  execFileSync('nice', ['-n', '10', 'ffmpeg', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', join(cap.dir, 'list.txt'), '-vf', 'fps=30', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '15', '-pix_fmt', 'yuv420p', mp4], { stdio: 'inherit' });
  log(`${rec.scene}: ${times.length} frames over ${(total / 1000).toFixed(1)} s, kept ${(kept / 1000).toFixed(1)} s; kept gaps ${JSON.stringify(stats)}`);
  log(`wrote ${mp4}`);
  await t.ctx.close().catch(() => undefined);
  rmSync(cap.dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------------------------------------------
// page helpers
// ---------------------------------------------------------------------------------------------------------------

async function editorReady(page: Page): Promise<void> {
  await page.waitForFunction(() => { const a = window.__aether; const s = a?.store.getState(); return !!a && a.simulation !== null && s?.loading === null && !s.agentBusy && Object.keys(a.history.current.entities).length > 0; }, null, { timeout: 300_000, polling: 250 });
  await page.evaluate(async () => Promise.race([(window as unknown as { __aether: { simulation: { whenSynced(): Promise<void> } } }).__aether.simulation.whenSynced(), new Promise((r) => setTimeout(r, 60_000))]));
}

const settle = (page: Page, ms = 240_000): Promise<unknown> =>
  page.waitForFunction(() => !/Baking light|Baking/.test(document.body.innerText) && window.__aether?.simulation?.renderer.animating !== true, null, { timeout: ms, polling: 300 }).catch(() => undefined);

const idle = (page: Page, ms = 240_000): Promise<unknown> =>
  page.waitForFunction(() => { const s = window.__aether?.store.getState(); return !!s && !s.agentBusy && s.loading === null; }, null, { timeout: ms, polling: 250 });

/** Screen position (page CSS pixels) of a world point. */
function screenOf(page: Page, p: Vec3): Promise<{ x: number; y: number } | null> {
  return page.evaluate((w) => {
    const sim = window.__aether?.simulation;
    const canvas = document.querySelector('.viewport__host canvas');
    if (!sim || !canvas) return null;
    const cam = sim.renderer.camera;
    cam.updateMatrixWorld();
    const v = cam.matrixWorldInverse.elements;
    const pr = cam.projectionMatrix.elements;
    const e = [0, 0, 0, 0];
    for (let r = 0; r < 4; r++) e[r] = (v[r] as number) * w[0] + (v[4 + r] as number) * w[1] + (v[8 + r] as number) * w[2] + (v[12 + r] as number);
    const c = [0, 0, 0, 0];
    for (let r = 0; r < 4; r++) c[r] = (pr[r] as number) * (e[0] as number) + (pr[4 + r] as number) * (e[1] as number) + (pr[8 + r] as number) * (e[2] as number) + (pr[12 + r] as number) * (e[3] as number);
    const cw = c[3] as number;
    if (cw <= 0) return null;
    const rect = canvas.getBoundingClientRect();
    return { x: rect.left + (((c[0] as number) / cw + 1) / 2) * rect.width, y: rect.top + ((1 - (c[1] as number) / cw) / 2) * rect.height };
  }, p);
}

function boundsOf(page: Page, id: string): Promise<{ min: Vec3; max: Vec3 } | null> {
  return page.evaluate((eid) => (window.__aether?.simulation as unknown as { entityBounds(id: string): { min: Vec3; max: Vec3 } | null } | undefined)?.entityBounds(eid) ?? null, id);
}

/** Frame an entity's bounds from `dir` (target to camera) with the orbit radius `radius`; `duration` 0 jumps. */
async function frameOn(page: Page, id: string, dir: Vec3, radius: number, duration: number): Promise<void> {
  const b = await boundsOf(page, id);
  if (!b) throw new Error(`no bounds for ${id}`);
  const c: Vec3 = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
  await page.evaluate(([cc, r, d, s]) => (window.__aether!.simulation!.renderer as unknown as { frameSphere(c: number[], r: number, d: number[], s: number): void }).frameSphere(cc as number[], r as number, d as number[], s as number), [c, radius, dir, duration] as const);
}

/** Drag the mouse from where it is to (x, y) with the button held, eased, over `ms`. */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, ms: number): Promise<void> {
  await glide(page, from.x, from.y, 700);
  await sleep(250);
  await page.mouse.down();
  await sleep(120);
  // Paced by the clock, not by a step count: a page that is slow to take each move (a live re-light per step) still
  // finishes the drag in `ms`, with fewer, larger steps.
  const t0 = Date.now();
  for (;;) {
    const k = Math.min(1, (Date.now() - t0) / ms);
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    await page.mouse.move(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e);
    if (k >= 1) break;
    await sleep(16);
  }
  await sleep(150);
  await page.mouse.up();
  // The shared pointer helpers track the cursor themselves: bring their idea of it up to date (all within one frame).
  await glide(page, to.x, to.y, 1);
}

/** Drag a range input's thumb from value `a` to value `b` over `ms`. */
async function slide(page: Page, input: Locator, min: number, max: number, a: number, b: number, ms: number): Promise<void> {
  const c = await centre(input);
  // Chromium's range thumb is ~16 px; its centre runs from left+8 to right-8.
  const xOf = (v: number): number => c.left + 8 + ((v - min) / (max - min)) * (c.w - 16);
  await drag(page, { x: xOf(a), y: c.y }, { x: xOf(b), y: c.y }, ms);
}

/** Entities of the world whose name or id matches. */
function findEntities(page: Page, re: string): Promise<Array<{ id: string; name: string; kind: string; pos: Vec3 }>> {
  return page.evaluate((src) => {
    const r = new RegExp(src, 'i');
    const out: Array<{ id: string; name: string; kind: string; pos: Vec3 }> = [];
    for (const [id, e] of Object.entries(window.__aether!.history.current.entities) as Array<[string, { name?: string; shape: { kind: string }; transform: { position: Vec3 } }]>) {
      if (r.test(id) || r.test(e.name ?? '')) out.push({ id, name: e.name ?? '', kind: e.shape.kind, pos: e.transform.position });
    }
    return out;
  }, re);
}

// ---------------------------------------------------------------------------------------------------------------
// scout: editor screenshots of candidate worlds
// ---------------------------------------------------------------------------------------------------------------

async function scout(browser: Awaited<ReturnType<typeof chromium.launch>>, url: string): Promise<void> {
  const dir = join(OUT, 'scout');
  mkdirSync(dir, { recursive: true });
  for (const slug of (arg('slugs') ?? 'villa-pool').split(',')) {
    const t = await newTake(browser, `scout-${slug}`, 'scout');
    try {
      await t.page.goto(`${url}/?debug=1#/new/${slug}`, { waitUntil: 'domcontentloaded' });
      await editorReady(t.page);
      await settle(t.page);
      await sleep(4000);
      await t.page.screenshot({ path: join(dir, `${slug}.jpg`), type: 'jpeg', quality: 80 });
      const ents = await findEntities(t.page, arg('find') ?? 'sofa|couch|chair|armchair|table|bed');
      const kinds = await t.page.evaluate(() => {
        const n: Record<string, number> = {};
        for (const e of Object.values(window.__aether!.history.current.entities) as Array<{ shape: { kind: string } }>) n[e.shape.kind] = (n[e.shape.kind] ?? 0) + 1;
        return n;
      });
      const focus = arg('focus');
      if (focus) {
        await t.page.evaluate(() => window.__aether!.store.getState().setArch({ walls: 'cutaway' }));
        const dirs: Vec3[] = [[1, 0.9, 1], [-1, 0.9, 1], [1, 0.9, -1], [-1, 0.9, -1], [0, 1.4, 1], [1, 1.4, 0]];
        for (let i = 0; i < dirs.length; i++) {
          await frameOn(t.page, focus, dirs[i]!, Number(arg('radius') ?? 3.2), 0);
          await sleep(2500);
          await t.page.screenshot({ path: join(dir, `${slug}-${focus}-${i}.jpg`), type: 'jpeg', quality: 80 });
        }
      }
      const env = await t.page.evaluate(() => window.__aether!.history.current.environment);
      log(`${slug}: kinds ${JSON.stringify(kinds)} env ${JSON.stringify({ sky: env.sky, timeOfDay: env.timeOfDay })}`);
      for (const e of ents.slice(0, 40)) log(`  ${e.id} "${e.name}" ${e.kind} ${e.pos.map((v) => v.toFixed(1)).join(',')}`);
    } catch (e) {
      log(`${slug}: ${String(e).slice(0, 300)}`);
    }
    await t.ctx.close();
  }
}

// ---------------------------------------------------------------------------------------------------------------
// edit: select, gizmo, material, time of day, chat refine
// ---------------------------------------------------------------------------------------------------------------

const EDIT = {
  slug: EDIT_SLUG,
  /** The piece that is selected, moved and re-surfaced (a procedural piece: assets have no material presets). */
  pick: arg('pick') ?? 'home-l0-room-f1',
  /** Camera direction (target to camera) and orbit radius for the opening framing. */
  dir: (arg('dir') ?? '0.5,0.9,-1').split(',').map(Number) as Vec3,
  radius: Number(arg('radius') ?? 3),
  presets: (arg('presets') ?? 'Fabric,Wood,Metal').split(','),
  refine: arg('refine') ?? 'make the sofa dark green',
  hours: [10.5, 18.6] as const,
};

async function edit(browser: Awaited<ReturnType<typeof chromium.launch>>, url: string): Promise<void> {
  const t = await newTake(browser, 'edit', 'editor; chat refine by the offline planner');
  const { page, rec } = t;
  await page.goto(`${url}/?debug=1#/new/${EDIT.slug}`, { waitUntil: 'domcontentloaded' });
  await editorReady(page);
  await settle(page);
  // Morning light before the take (one undoable scene edit), the walls cut away, the camera on the living room.
  await page.evaluate((h) => {
    const a = window.__aether!;
    void a.studio.commitUser([{ op: 'setEnvironment', set: { timeOfDay: h } }], 'Time of day');
    // The roof and ceilings stay pickable when cut away; hidden, the camera looks straight into the room.
    const lids = Object.keys(a.history.current.entities).filter((id) => /roof|-ceil$/.test(id));
    if (lids.length) {
      void a.studio.commitUser(lids.map((id) => ({ op: 'update', id, set: { visible: false } })), 'Hide the roof');
      // Locked: the viewport's pick passes through them.
      (a.studio as unknown as { editor: { setLocked(ids: string[], v: boolean): void } }).editor.setLocked(lids, true);
    }
    a.store.getState().setArch({ walls: 'cutaway' });
    a.store.getState().updateSettings({ showLabels: false, motion: 'sharp' });
    // The bot's walk check after a chat edit (its toast and replay bar) is not part of this take.
    (a.studio as unknown as { playtest: { run(): Promise<void> } }).playtest.run = async () => undefined;
    // Nor the overview flight after the turn: the camera stays on the sofa so the change is seen where it happens.
    (a.studio as unknown as { presentProof(): Promise<void> }).presentProof = async () => undefined;
    (a.simulation as unknown as { frameWorld(): Promise<void> }).frameWorld = async () => undefined;
    (a.simulation as unknown as { openWorld(): Promise<void> }).openWorld = async () => undefined;
    (a.simulation as unknown as { revealEntities(): Promise<void> }).revealEntities = async () => undefined;
  }, EDIT.hours[0]);
  await settle(page);
  await frameOn(page, EDIT.pick, EDIT.dir, EDIT.radius, 0);
  await sleep(3000);
  // Warm the gizmo and the material shaders off camera: select, move tool, each preset, then undo it all.
  const h00 = await page.evaluate(() => window.__aether!.history.head);
  let xArrowPx: number | null = null;
  await page.evaluate((id) => window.__aether!.store.getState().select([id]), EDIT.pick);
  await page.locator('.viewport__host canvas').hover();
  await page.keyboard.press('w');
  await sleep(800);
  // Find the gizmo's X arrow on screen: hover along the projected X axis and read the hovered handle.
  const pos0 = await page.evaluate((id) => window.__aether!.history.current.entities[id]!.transform.position as Vec3, EDIT.pick);
  const s0 = await screenOf(page, pos0);
  const s1 = await screenOf(page, [pos0[0] - 1, pos0[1], pos0[2]]);
  if (!s0 || !s1) throw new Error('gizmo off screen');
  const len = Math.hypot(s1.x - s0.x, s1.y - s0.y);
  for (const sign of [1, -1]) {
    const hits: number[] = [];
    for (let d = 12; d < 260; d += 6) {
      await page.mouse.move(s0.x + ((s1.x - s0.x) / len) * d * sign, s0.y + ((s1.y - s0.y) / len) * d * sign);
      await sleep(50);
      const ax = await page.evaluate(() => {
        const g = (window.__aether!.simulation!.renderer as unknown as Record<string, unknown>)['gizmo'] as Record<string, unknown> | null;
        const find = (o: Record<string, unknown> | null, depth: number): string | null => {
          if (!o || depth > 3) return null;
          if ('axis' in o && 'dragging' in o) return (o['axis'] as string | null) ?? '';
          for (const k of Object.keys(o)) { const v = o[k]; if (v && typeof v === 'object') { const r = find(v as Record<string, unknown>, depth + 1); if (r !== null) return r; } }
          return null;
        };
        return find(g, 0);
      });
      if (ax === 'X') hits.push(d * sign);
    }
    if (hits.length) {
      xArrowPx = hits[Math.floor(hits.length / 2)]!;
      break;
    }
  }
  log(`X arrow at ${xArrowPx} px along -X`);
  const grid0 = page.getByRole('radiogroup', { name: 'Material preset' });
  for (const p of EDIT.presets) {
    await grid0.getByRole('radio', { name: p, exact: true }).click();
    await sleep(1500);
  }
  await page.evaluate(async (h) => {
    const a = window.__aether!;
    while (a.history.head !== h && a.history.canUndo()) {
      a.studio.undo();
      await new Promise((r) => setTimeout(r, 100));
    }
  }, h00);
  await page.evaluate(() => {
    const s = window.__aether!.store.getState();
    s.select([]);
    s.setTool('select');
  });
  await sleep(1500);
  await settle(page);
  await sleep(6000);
  await glide(page, 1050 * K, 300 * K, 10);
  await t.cap.start();
  const boot = rec.now();
  await sleep(1200);
  rec.cut(boot);

  // (a) select the piece in the viewport, then the move tool and a slow drag of its gizmo across the floor.
  await dwell(page, 1500);
  const b = await boundsOf(page, EDIT.pick);
  if (!b) throw new Error('pick has no bounds');
  const top: Vec3 = [(b.min[0] + b.max[0]) / 2, b.max[1], (b.min[2] + b.max[2]) / 2];
  const at = await screenOf(page, top);
  if (!at) throw new Error('pick is off screen');
  await page.screenshot({ path: join(OUT, 'dbg-edit.jpg'), type: 'jpeg', quality: 80 });
  log(`pick at ${JSON.stringify(at)}; roof ${await page.evaluate(() => JSON.stringify(Object.entries(window.__aether!.history.current.entities).filter(([id]) => /roof|ceil/.test(id)).map(([id, e]) => [id, (e as { visible: boolean }).visible])))}`);
  await glide(page, at.x, at.y, 1100);
  await sleep(300);
  await page.mouse.down();
  await sleep(70);
  await page.mouse.up();
  await page.waitForFunction((id) => window.__aether!.store.getState().selection.includes(id), EDIT.pick, { timeout: 5000 }).catch(async (e: unknown) => {
    log(`selection after the click: ${JSON.stringify(await page.evaluate(() => window.__aether!.store.getState().selection))}`);
    throw e;
  });
  mark(t, `selected ${EDIT.pick}`);
  await dwell(page, 1400);
  await click(page, page.getByRole('toolbar', { name: 'Tools' }).getByRole('radio', { name: 'Move' }), 900);
  await dwell(page, 900);
  const origin = await page.evaluate((id) => window.__aether!.history.current.entities[id]!.transform.position as Vec3, EDIT.pick);
  const o = await screenOf(page, origin);
  if (!o) throw new Error('gizmo off screen');
  const h0 = await page.evaluate(() => window.__aether!.history.head);
  mark(t, `gizmo drag`);
  // Grab the X arrow and slide the sofa 0.6 m along the wall (world -X), clear of the table and chairs.
  const o2 = await screenOf(page, [origin[0] - Number(arg('slideM') ?? 0.6), origin[1], origin[2]]);
  const o1 = await screenOf(page, [origin[0] - 1, origin[1], origin[2]]);
  if (!o2 || !o1) throw new Error('slide target off screen');
  const l1 = Math.hypot(o1.x - o.x, o1.y - o.y);
  const grab = xArrowPx === null ? o : { x: o.x + ((o1.x - o.x) / l1) * xArrowPx, y: o.y + ((o1.y - o.y) / l1) * xArrowPx };
  await drag(page, grab, { x: grab.x + (o2.x - o.x), y: grab.y + (o2.y - o.y) }, 2600);
  await page.waitForFunction((h) => window.__aether!.history.head !== h, h0, { timeout: 10_000 }).catch(() => log('gizmo drag made no edit'));
  await dwell(page, 1200);

  // (b) material presets in the inspector.
  const grid = page.getByRole('radiogroup', { name: 'Material preset' });
  await grid.scrollIntoViewIfNeeded();
  await sleep(400);
  for (const p of EDIT.presets) {
    mark(t, `material ${p}`);
    await click(page, grid.getByRole('radio', { name: p, exact: true }), 900);
    await dwell(page, 1700);
  }

  // (c) deselect, then the scene's time of day from morning through golden hour to dusk.
  await glide(page, 1000 * K, 200 * K, 700);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__aether!.store.getState().selection.length === 0, null, { timeout: 5000 }).catch(() => undefined);
  await sleep(600);
  const slider = page.locator('.inspector .slider[aria-label="Time of day"], .inspector input[type="range"][aria-label="Time of day"]').first();
  await slider.waitFor({ timeout: 5000 });
  mark(t, `time sweep start`);
  await slide(page, slider, 0, 24, EDIT.hours[0], EDIT.hours[1], 9000);
  mark(t, `time sweep end`);
  const swept = rec.now();
  await settle(page, 60_000);
  if (rec.now() - swept > 300) rec.cut(swept);
  await dwell(page, 1800);

  // (d) a refine request in the agent chat, its result and its one-line diff with Undo.
  await page.evaluate(() => window.__aether!.store.getState().showLeftView('agent'));
  const prompt = page.getByLabel('Prompt', { exact: true });
  await click(page, prompt, 1000);
  mark(t, 'chat typing');
  await type(page, EDIT.refine, 65);
  await sleep(500);
  const head = await page.evaluate(() => window.__aether!.history.head);
  await page.keyboard.press('Enter');
  mark(t, `chat sent`);
  const think = rec.now();
  await page.waitForFunction((h) => window.__aether!.history.head !== h || window.__aether!.store.getState().agentBusy === true, head, { timeout: 30_000, polling: 100 });
  await idle(page);
  await settle(page, 60_000);
  rec.ramp(think, 1500);
  mark(t, `chat result`);
  const undo = page.getByRole('button', { name: /^Undo/ }).last();
  if (await undo.count()) await glide(page, (await centre(undo)).x + 70, (await centre(undo)).y + 45, 1000);
  await dwell(page, 3500);
  await finish(t);
}

// ---------------------------------------------------------------------------------------------------------------
// describe: the prompt typed on the home page, the planner building the world
// ---------------------------------------------------------------------------------------------------------------

/** The offline planner only understands its fixed themes; the live AI's own recording is a separate, labelled take. */
const DESCRIBE_PROMPT = arg('prompt') ?? 'a two-storey villa with a pool';

async function describe(browser: Awaited<ReturnType<typeof chromium.launch>>, url: string): Promise<void> {
  const t = await newTake(browser, 'describe', 'home prompt and build by the offline planner (no model call)');
  const { page, rec } = t;
  await page.goto(`${url}/?debug=1#/`, { waitUntil: 'domcontentloaded' });
  const box = page.locator('#hero-prompt').first();
  await box.waitFor({ timeout: 90_000 });
  await sleep(2500);
  await glide(page, 900 * K, 520 * K, 10);
  await t.cap.start();
  const boot = rec.now();
  await sleep(1200);
  rec.cut(boot);
  await dwell(page, 1200);
  await click(page, box, 900);
  mark(t, 'typing');
  await type(page, DESCRIBE_PROMPT, 85);
  await dwell(page, 1100);
  mark(t, 'build pressed');
  const opened = /#\/p\/[a-z0-9]+/;
  for (let i = 0; i < 8 && !opened.test(page.url()); i++) {
    await page.keyboard.press('Enter');
    await page.waitForURL(opened, { timeout: 4_000 }).catch(() => undefined);
  }
  await page.waitForURL(opened, { timeout: 30_000 });
  mark(t, 'editor open');
  const started = rec.now();
  await editorReady(page);
  await idle(page, 600_000);
  mark(t, 'built');
  await settle(page, 90_000);
  rec.ramp(started, 1500);
  mark(t, 'settled');
  await dwell(page, 3000);
  await finish(t);
}

// ---------------------------------------------------------------------------------------------------------------
// player helpers
// ---------------------------------------------------------------------------------------------------------------

/** Wait for the player to be up (its simulation attached) and in `phase`. */
async function playerUp(page: Page, phases: string[], ms = 300_000): Promise<void> {
  await page.waitForFunction((ph) => { const p = (window as unknown as { __aetherPlayer?: { phase: string; simulation: unknown } }).__aetherPlayer; return !!p?.simulation && ph.includes(p.phase); }, phases, { timeout: ms, polling: 300 });
}

const phase = (page: Page): Promise<string> => page.evaluate(() => (window as unknown as { __aetherPlayer?: { phase: string } }).__aetherPlayer?.phase ?? 'none');

/** Time of day in the player's explore bar: open the pop-over and drag its slider. */
async function playerTime(t: Take, a: number, b: number, ms: number): Promise<void> {
  const page = t.page;
  await click(page, page.locator('.pl-xbar__time > button'), 900);
  const r = page.locator('.pl-xpop input[type="range"]');
  await r.waitFor({ timeout: 5000 });
  await sleep(500);
  await slide(page, r, 5, 23, a, b, ms);
  // Letting go commits the hour (the live preview ends): the picture goes dark for ~2.5 s while the light is set up again.
  const commit = t.rec.now();
  await sleep(Number(arg('commitMs') ?? 3200));
  t.rec.cut(commit);
  await sleep(400);
  await click(page, page.locator('.pl-xbar__time > button'), 700);
}

// ---------------------------------------------------------------------------------------------------------------
// publish: share link, then the published player
// ---------------------------------------------------------------------------------------------------------------

async function publish(browser: Awaited<ReturnType<typeof chromium.launch>>, url: string): Promise<void> {
  const t = await newTake(browser, 'publish', 'editor publish hub, then the player');
  const { page, rec } = t;
  const slug = arg('slug') ?? 'casa-patio';
  await page.goto(`${url}/?debug=1#/new/${slug}`, { waitUntil: 'domcontentloaded' });
  await editorReady(page);
  await settle(page);
  // The opening's background passes (saving, the world-quality pass) finish before the take.
  await page.waitForFunction(() => !/Saving|World-quality pass/.test(document.body.innerText), null, { timeout: 180_000, polling: 500 }).catch(() => log('still busy'));
  await sleep(4000);
  // The hub's Player address is the hosted studio, so the link on screen is the real site's (set before the link is made).
  await page.evaluate((u) => (window.__aether!.studio as unknown as { publish: { setPlayerBase(u: string): string | null } }).publish.setPlayerBase(u), arg('playerBase') ?? 'https://aether-studio-lyart.vercel.app/play');
  // Off camera, open the hub once and let it make the link (encoding a large world holds the page for ~10-15 s, and
  // the hub renders a cover image); on camera the hub then opens and shows the link at once.
  await page.evaluate(() => (window.__aether!.studio as unknown as { publish: { open(t?: string): void } }).publish.open('share'));
  await page.waitForFunction(() => /#(w|c)=|Too large/.test(document.querySelector<HTMLInputElement>('[data-testid="publish-share-link"]')?.value ?? ''), null, { timeout: 120_000, polling: 300 });
  await page.evaluate(() => (window.__aether!.studio as unknown as { publish: { setTarget(t: string): void } }).publish.setTarget('game'));
  await sleep(6000);
  await page.evaluate(() => (window.__aether!.studio as unknown as { publish: { close(): void } }).publish.close());
  await sleep(3000);
  await settle(page);
  const rendering = (): Promise<unknown> => page.waitForFunction(() => !/Rendering image/.test(document.body.innerText), null, { timeout: 120_000, polling: 200 }).catch(() => log('still rendering an image'));
  await rendering();
  await sleep(2000);
  await glide(page, 900 * K, 400 * K, 10);
  await t.cap.start();
  const boot = rec.now();
  await sleep(1200);
  await rendering();
  await sleep(500);
  rec.cut(boot);
  await dwell(page, 1500);
  await click(page, page.getByTestId('topbar-publish'), 1000);
  await page.getByTestId('publish-target-share').waitFor({ timeout: 60_000 });
  await dwell(page, 1500);
  await click(page, page.getByTestId('publish-target-share'), 900);
  const making = rec.now();
  const input = page.getByTestId('publish-share-link');
  await page.waitForFunction(() => /#(w|c)=/.test(document.querySelector<HTMLInputElement>('[data-testid="publish-share-link"]')?.value ?? '') || /Too large/.test(document.querySelector<HTMLInputElement>('[data-testid="publish-share-link"]')?.value ?? ''), null, { timeout: 60_000, polling: 200 });
  rec.ramp(making, 1200);
  let link = await input.inputValue();
  // The replay seal's checks (the hub's quality check of the world), then the link itself.
  const seal = page.getByTestId('publish-seal-note');
  if (await seal.count()) {
    await seal.scrollIntoViewIfNeeded();
    await sleep(400);
    await glide(page, (await centre(seal)).x + 120 * K, (await centre(seal)).y + 30 * K, 1000);
    mark(t, 'seal checks');
    await dwell(page, 2600);
  }
  mark(t, `link: ${link.slice(0, 120)} (${link.length} chars)`);
  writeFileSync(join(OUT, 'link.txt'), link);
  await input.scrollIntoViewIfNeeded();
  await glide(page, (await centre(input)).x, (await centre(input)).y, 1000);
  await dwell(page, 2000);
  // `--open=link` opens the share link itself (the world in the URL, run live: slow to start, and it opens as its
  // presentation says). The default opens the same world's published, cooked copy, which is what a visitor gets fastest.
  let fromLink = arg('open') === 'link' && /#(w|c)=/.test(link);
  const openBtn = page.locator('.pub-link a').first();
  if (await openBtn.count()) {
    // The take navigates this page itself rather than following the link into a new tab.
    await openBtn.evaluate((a) => a.addEventListener('click', (e) => e.preventDefault(), true));
    await click(page, openBtn, 800).catch(() => undefined);
  }
  if (fromLink) link = `${url}/play.html${link.slice(link.indexOf('#'))}`;
  else link = `${url}/play.html#t=${slug}&cook=use&tier=ultra`;
  const nav = rec.now();
  await t.cap.stop();
  await page.goto(link, { waitUntil: 'domcontentloaded' });
  await t.cap.start();
  try {
    await playerUp(page, ['exploring', 'title', 'story'], 300_000);
  } catch (e) {
    if (!fromLink) throw e;
    log(`link did not open (${String(e).slice(0, 120)}); the published template instead`);
    fromLink = false;
    await page.goto(`${url}/play.html#t=casa-patio&cook=use&tier=ultra`, { waitUntil: 'domcontentloaded' });
    await playerUp(page, ['exploring', 'title', 'story'], 300_000);
  }
  log(`player: ${fromLink ? 'from the share link' : 'casa-patio template'}, phase ${await phase(page)}, exp ${JSON.stringify(await page.evaluate(() => (window as unknown as { __aetherPlayer: { experience: unknown } }).__aetherPlayer.experience))}`);
  if ((await phase(page)) === 'title') await page.evaluate(() => (window as unknown as { __aetherPlayer: { enterExplore(): void } }).__aetherPlayer.enterExplore());
  await page.waitForSelector('[data-testid="pl-xbar"]', { timeout: 60_000 });
  // Hold the tour on its arrival view while the picture settles (fade-in, exposure), then start it on camera.
  await page.evaluate(() => (window as unknown as { __aetherPlayer: { exploreController: { setAutoplay(on: boolean): void; goTo(i: number): void } } }).__aetherPlayer.exploreController.setAutoplay(false));
  await sleep(4000);
  await glide(page, W / 2 + 180, H / 2 - 120, 10);
  rec.cut(nav);
  mark(t, `player up: hero view`);
  await dwell(page, Number(arg('heroMs') ?? 3500));
  mark(t, 'tour plays');
  await click(page, page.getByTestId('pl-autoplay'), 1000);
  await glide(page, W / 2 + 200, H / 2 - 100, 900);
  await dwell(page, 2000);
  // Stop the tour on its courtyard stop (the pool through the bedroom doors) and pause it there.
  const stop = page.locator('.pl-xbar__chips .pl-chip', { hasText: arg('stop') ?? 'Main bedroom' });
  if (await stop.count()) {
    mark(t, 'tour stop');
    await click(page, stop, 1000);
  }
  const auto = page.getByTestId('pl-autoplay');
  if ((await auto.getAttribute('aria-pressed')) === 'true') await click(page, auto, 700);
  await glide(page, W / 2 + 120, H / 2 - 60, 900);
  await dwell(page, 1500);
  mark(t, `time of day`);
  await playerTime(t, 8.5, 17.25, 6500);
  await dwell(page, 1500);
  const doll = page.getByTestId('pl-dollhouse');
  if (await doll.count()) {
    mark(t, `dollhouse`);
    await click(page, doll, 900);
    await glide(page, W / 2 + 200, H / 2 - 150, 900);
    await dwell(page, 3500);
    mark(t, `walk`);
    await click(page, page.locator('.pl-xbar button', { hasText: /^Walk$/ }), 900);
    await sleep(2500);
  }
  // Walking: click the floor to glide there, then look round with the keys.
  mark(t, 'walking');
  for (const [x, y] of [[0.5, 0.8]] as const) {
    await glide(page, W * x, H * y, 1000);
    await sleep(200);
    await page.mouse.down();
    await sleep(70);
    await page.mouse.up();
    await sleep(2600);
  }
  await cursor(page, false);
  await page.keyboard.down('ArrowRight');
  await sleep(800);
  await page.keyboard.up('ArrowRight');
  await sleep(1500);
  await finish(t);
}

// ---------------------------------------------------------------------------------------------------------------
// modes: a city's street-level hero view, then the drone and its districts
// ---------------------------------------------------------------------------------------------------------------

async function modes(browser: Awaited<ReturnType<typeof chromium.launch>>, url: string): Promise<void> {
  const t = await newTake(browser, 'modes', 'player');
  const { page, rec } = t;
  const slug = arg('slug') ?? 'lisbon-hills';
  await glide(page, W / 2, H / 2, 10);
  await t.cap.start();
  const boot = rec.now();
  await page.goto(`${url}/play.html#t=${slug}&cook=use&tier=${arg('tier') ?? 'ultra'}`, { waitUntil: 'domcontentloaded' });
  await playerUp(page, ['exploring', 'title'], 300_000);
  if ((await phase(page)) === 'title') await page.evaluate(() => (window as unknown as { __aetherPlayer: { enterExplore(): void } }).__aetherPlayer.enterExplore());
  await page.waitForSelector('[data-testid="pl-xbar"]', { timeout: 60_000 });
  await sleep(4000);
  rec.cut(boot);
  mark(t, `hero view; exp ${JSON.stringify(await page.evaluate(() => (window as unknown as { __aetherPlayer: { experience: unknown } }).__aetherPlayer.experience))}`);
  await cursor(page, false);
  await sleep(6000);
  await cursor(page, true);
  const chips = page.locator('.pl-xbar__chips .pl-chip');
  const n = await chips.count();
  log(`districts: ${n}`);
  const drone = page.getByTestId('pl-drone');
  if (await drone.count()) {
    // The city's entry starts the drone on its own after the hero view; the button would then stop it.
    const touring = await page.evaluate(() => (window as unknown as { __aetherPlayer: { simulation: { renderer: { touring: boolean } } } }).__aetherPlayer.simulation.renderer.touring);
    mark(t, `drone tour${touring ? ' (already flying)' : ''}`);
    if (touring) await glide(page, (await centre(drone)).x, (await centre(drone)).y, 1000);
    else await click(page, drone, 1000);
    await glide(page, W / 2 + 200, H / 2 - 150, 900);
    await cursor(page, false);
    await sleep(Number(arg('droneMs') ?? 11000));
    await cursor(page, true);
  }
  // Districts by name (the list is built per load; some stops frame badly, e.g. inside a wall or under trees).
  const names = await chips.allInnerTexts();
  const want = new RegExp(arg('districts') ?? 'lookout|square', 'i');
  const picks = names.map((s, i) => (i > 0 && want.test(s) ? i : -1)).filter((i) => i > 0).slice(0, 2);
  for (const i of picks.length ? picks : [1]) {
    mark(t, `district ${i}: ${await chips.nth(i).innerText()}`);
    await click(page, chips.nth(i), 1000);
    await glide(page, W / 2 + 250, H / 2 - 180, 900);
    await cursor(page, false);
    await sleep(5000);
    await cursor(page, true);
  }
  await finish(t);
}

// ---------------------------------------------------------------------------------------------------------------
// play: a person walking in a game world, third person
// ---------------------------------------------------------------------------------------------------------------

async function play(browser: Awaited<ReturnType<typeof chromium.launch>>, url: string): Promise<void> {
  const t = await newTake(browser, 'play', 'player');
  const { page, rec } = t;
  const slug = arg('slug') ?? 'highland-trail';
  const seconds = Number(arg('seconds') ?? 22);
  await page.goto(`${url}/play.html#t=${slug}&cook=use&tier=${arg('tier') ?? 'ultra'}`, { waitUntil: 'domcontentloaded' });
  await playerUp(page, ['title', 'exploring', 'story'], 300_000);
  await sleep(3000);
  const start = page.getByTestId('pl-play');
  if (await start.count()) await start.click();
  else await page.evaluate(() => (window as unknown as { __aetherPlayer: { start(): void } }).__aetherPlayer.start());
  await page.waitForFunction(() => (window as unknown as { __aetherPlayer: { phase: string } }).__aetherPlayer.phase === 'playing', null, { timeout: 60_000 });
  await sleep(Number(arg('settle') ?? 6000));
  const yaw0 = Number(arg('yaw') ?? NaN);
  await t.cap.start();
  const boot = rec.now();
  await page.evaluate('window.__name = (f) => f');
  await sleep(400);
  rec.cut(boot);
  mark(t, `walking`);
  await cursor(page, false);
  await page.evaluate(async ([s, y]) => {
    const sim = (window as unknown as { __aetherPlayer: { simulation: { viewRay: { dir: number[] }; setVirtualStick(f: number, r: number): void; setLook(y: number, p: number): void } } }).__aetherPlayer.simulation;
    const d0 = sim.viewRay.dir;
    const yawStart = Number.isFinite(y) ? (y as number) : (Math.atan2(-d0[0]!, -d0[2]!) * 180) / Math.PI;
    const p0 = Math.max(-10, Math.min(2, (Math.asin(d0[1]!) * 180) / Math.PI));
    const w0 = performance.now();
    await new Promise<void>((done) => {
      const tick = (): void => {
        const tt = (performance.now() - w0) / 1000;
        if (tt > (s as number)) return done();
        const ramp = Math.min(1, tt / 1.5) * Math.min(1, Math.max(0, ((s as number) - tt) / 1.5));
        // Walk with a slow look round; a pause in the middle to take in the view.
        const walk = tt > (s as number) * 0.45 && tt < (s as number) * 0.62 ? 0.15 : 0.75;
        sim.setVirtualStick(walk * ramp, 0);
        sim.setLook(yawStart + Math.sin(tt * 0.3) * 22, p0 + Math.sin(tt * 0.2) * 2.5);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    sim.setVirtualStick(0, 0);
  }, [seconds, yaw0] as const);
  await sleep(600);
  await finish(t);
}

// ---------------------------------------------------------------------------------------------------------------
// devices: one world opened in the player at laptop size and at phone size, for the edit's split screen
// ---------------------------------------------------------------------------------------------------------------

async function devices(browser: Awaited<ReturnType<typeof chromium.launch>>, url: string): Promise<void> {
  for (const dev of ['laptop', 'phone'] as const) {
    const t = await newTake(browser, `dev-${dev}`, 'player', dev);
    const { page, rec } = t;
    await t.cap.start();
    const boot = rec.now();
    await page.goto(arg('link') ? readFileSync(arg('link')!, 'utf8').trim() : `${url}/play.html#t=${arg('slug') ?? 'casa-patio'}&cook=use&tier=ultra`, { waitUntil: 'domcontentloaded' });
    await playerUp(page, ['exploring', 'title', 'story'], 300_000);
    if ((await phase(page)) === 'title') await page.evaluate(() => (window as unknown as { __aetherPlayer: { enterExplore(): void } }).__aetherPlayer.enterExplore());
    await page.waitForSelector('[data-testid="pl-xbar"]', { timeout: 60_000 });
    await page.evaluate(() => (window as unknown as { __aetherPlayer: { exploreController: { setAutoplay(on: boolean): void } } }).__aetherPlayer.exploreController.setAutoplay(false));
    await sleep(4000);
    rec.cut(boot);
    mark(t, `${dev}: hero view`);
    await sleep(2500);
    await page.evaluate(() => (window as unknown as { __aetherPlayer: { exploreController: { setAutoplay(on: boolean): void } } }).__aetherPlayer.exploreController.setAutoplay(true));
    mark(t, `${dev}: tour plays`);
    await sleep(9000);
    await finish(t);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// arch: a two-storey house in the editor: walls up, cutaway, walls down, exploded storeys, one storey, plan, daylight
// ---------------------------------------------------------------------------------------------------------------

async function arch(browser: Awaited<ReturnType<typeof chromium.launch>>, url: string): Promise<void> {
  const t = await newTake(browser, 'arch', 'editor; the architecture bar');
  const { page, rec } = t;
  const slug = arg('slug') ?? 'dusk-lake-house';
  const boot = rec.now();
  await t.cap.start();
  await page.goto(`${url}/?debug=1#/new/${slug}`, { waitUntil: 'domcontentloaded' });
  await editorReady(page);
  await settle(page);
  await page.evaluate((h) => {
    const a = window.__aether!;
    if (h > 0) void a.studio.commitUser([{ op: 'setEnvironment', set: { timeOfDay: h } }], 'Time of day');
    a.store.getState().updateSettings({ showLabels: false, motion: 'sharp' });
    (a.simulation as unknown as { frameWorld(): Promise<void> }).frameWorld = async () => undefined;
  }, Number(arg('hour') ?? 17.4));
  await settle(page);
  // The house's bounds from its wall entities, then a slow orbit round it that runs under every step below.
  const info = await page.evaluate(() => {
    const a = window.__aether!;
    const sim = a.simulation as unknown as { entityBounds(id: string): { min: number[]; max: number[] } | null };
    let lo = [1e9, 1e9, 1e9];
    let hi = [-1e9, -1e9, -1e9];
    for (const [id, e] of Object.entries(a.history.current.entities) as Array<[string, { arch?: { role?: string } }]>) {
      if (e.arch?.role !== 'wall') continue;
      const b = sim.entityBounds(id);
      if (!b) continue;
      for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i]!, b.min[i]!); hi[i] = Math.max(hi[i]!, b.max[i]!); }
    }
    return { c: [0, 1, 2].map((i) => (lo[i]! + hi[i]!) / 2), r: Math.hypot(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!) / 2 };
  });
  log(`house centre ${JSON.stringify(info.c)} radius ${info.r.toFixed(1)}`);
  const R0 = Number(arg('radius') ?? 1.4) * info.r;
  await page.evaluate(([c, R]) => {
    const w = window as unknown as { __orbit: { az: number; rate: number; el: number; k: number; stop: boolean } };
    w.__orbit = { az: Number(new URLSearchParams(location.search).get('az') ?? 215), rate: 7, el: 24, k: 1, stop: false };
    const rend = window.__aether!.simulation!.renderer as unknown as { frameSphere(c: number[], r: number, d: number[], s: number): void };
    let last = performance.now();
    const tick = (): void => {
      const now = performance.now();
      const o = w.__orbit;
      o.az += o.rate * ((now - last) / 1000);
      last = now;
      const az = (o.az * Math.PI) / 180;
      const el = (o.el * Math.PI) / 180;
      rend.frameSphere(c as number[], (R as number) * o.k, [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)], 0);
      if (!o.stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [info.c, R0] as const);
  await sleep(2500);
  await settle(page);
  await glide(page, W * 0.6, H * 0.5, 10);
  rec.cut(boot);
  const set = (patch: string): Promise<void> => page.evaluate((p) => window.__aether!.store.getState().setArch(JSON.parse(p)), patch);
  void set;
  const orbit = (patch: Partial<{ rate: number; el: number; k: number }>): Promise<void> => page.evaluate((p) => void Object.assign((window as unknown as { __orbit: object }).__orbit, p), patch);
  const bar = page.locator('.arch-bar');
  await bar.waitFor({ timeout: 30_000 });
  mark(t, 'walls up: exterior');
  await cursor(page, false);
  await sleep(Number(arg('extMs') ?? 4500));
  await cursor(page, true);
  const pick = async (trigger: RegExp | string, item: string, ms = 900): Promise<void> => {
    await click(page, bar.getByRole('button', { name: trigger }), 900);
    const it = page.getByRole('menuitem', { name: item, exact: true }).or(page.getByRole('menuitemcheckbox', { name: item, exact: true }));
    await it.first().waitFor({ timeout: 5000 });
    await sleep(500);
    await click(page, it.first(), ms);
  };
  mark(t, 'cutaway');
  await pick(/^Walls/, 'Cutaway');
  await glide(page, W * 0.62, H * 0.62, 900);
  await cursor(page, false);
  await sleep(4000);
  await cursor(page, true);
  mark(t, 'walls down');
  await pick(/^Walls/, 'Walls down');
  await glide(page, W * 0.62, H * 0.62, 900);
  await cursor(page, false);
  await sleep(3800);
  await cursor(page, true);
  mark(t, 'walls up again');
  await pick(/^Walls/, 'Walls up');
  await orbit({ el: 30 });
  await sleep(1500);
  mark(t, 'exploded');
  await orbit({ el: 22, k: 1.25 });
  await pick(/^Storeys/, 'Exploded');
  await glide(page, W * 0.62, H * 0.62, 900);
  await cursor(page, false);
  await sleep(4500);
  await cursor(page, true);
  mark(t, 'one floor');
  await orbit({ el: 30, k: 1.0 });
  await pick(/^Storeys|^Exploded/, 'One floor');
  await glide(page, W * 0.62, H * 0.62, 900);
  await cursor(page, false);
  await sleep(2500);
  await cursor(page, true);
  // The level picker: the floor above (the menu lists the top floor first)
  await click(page, bar.getByRole('button', { name: /^Storeys|^Ground|^Upper|^First|^Level/ }), 900);
  const levels = page.getByRole('menuitemcheckbox').filter({ hasText: /m$/ });
  await sleep(500);
  const n = await levels.count();
  log(`level items: ${n}`);
  await click(page, levels.first(), 900);
  await glide(page, W * 0.62, H * 0.62, 900);
  await cursor(page, false);
  await sleep(3000);
  await cursor(page, true);
  mark(t, 'stacked');
  await pick(/^Storeys|^Ground|^Upper|^First|^Level/, 'Stacked');
  await orbit({ k: 1.0 });
  await sleep(1200);
  mark(t, 'plan');
  await click(page, bar.getByRole('radio', { name: 'Plan' }), 900);
  if (!(await page.evaluate(() => window.__aether!.store.getState().arch.plan))) {
    log('plan click did not take: set by the store');
    await page.evaluate(() => window.__aether!.store.getState().setArch({ plan: true }));
  }
  await glide(page, W * 0.62, H * 0.7, 900);
  await cursor(page, false);
  await sleep(4200);
  await cursor(page, true);
  await click(page, bar.getByRole('radio', { name: '3D' }), 900);
  await sleep(1500);
  mark(t, 'daylight');
  await click(page, bar.getByRole('button', { name: 'Daylight study' }), 900);
  const r = page.locator('.arch-pop__range[aria-label="Time of day"]');
  await r.waitFor({ timeout: 5000 });
  await sleep(400);
  await click(page, page.locator('.arch-pop__chips .chip', { hasText: 'Midday' }), 900);
  await sleep(1500);
  await slide(page, r, 5, 23, 13, 21, 5500);
  await sleep(1500);
  await finish(t);
}

// ---------------------------------------------------------------------------------------------------------------
// tour: the editor's range in one session per world: panels, rules, checks, the bot's playability check, the gizmos,
// terrain sculpting, play, and the Publish hub's targets. Events (`mark`) say where each beat starts.
// ---------------------------------------------------------------------------------------------------------------

async function tour(browser: Awaited<ReturnType<typeof chromium.launch>>, url: string): Promise<void> {
  const kind = arg('kind') ?? 'game';
  const t = await newTake(browser, `tour-${kind}`, `editor tour (${kind})`);
  const { page, rec } = t;
  const slug = arg('slug') ?? 'coin-rush';
  await page.goto(`${url}/?debug=1#/new/${slug}`, { waitUntil: 'domcontentloaded' });
  await editorReady(page);
  await settle(page);
  await page.waitForFunction(() => !/Saving|World-quality pass/.test(document.body.innerText), null, { timeout: 120_000, polling: 500 }).catch(() => log('still busy'));
  await page.evaluate(() => {
    const a = window.__aether!;
    a.store.getState().updateSettings({ showLabels: false, motion: 'sharp' });
  });
  await sleep(2500);
  const rail = (name: string): Locator => page.getByRole('tab', { name });
  const tool = (id: string): Locator => page.getByTestId(`tool-${id}`);
  await glide(page, 900 * K, 520 * K, 10);
  await t.cap.start();
  const boot = rec.now();
  await sleep(1200);
  rec.cut(boot);
  await dwell(page, 1400);
  if (kind === 'game') {
    mark(t, 'objects');
    await click(page, rail('Objects'), 900);
    await dwell(page, 1800);
    mark(t, 'logic');
    await click(page, rail('Logic'), 900);
    await dwell(page, 2800);
    mark(t, 'checks');
    await click(page, page.locator('.vp-btn--label', { hasText: /Run checks|Checks/ }).first(), 900);
    const t1 = rec.now();
    await page.waitForFunction(() => /Checks passed|failing|Checks failed/.test(document.body.innerText), null, { timeout: 180_000, polling: 300 });
    rec.ramp(t1, 1500);
    await dwell(page, 2600);
    mark(t, 'playability');
    const pb = page.locator('button', { hasText: /Check playability/ }).first();
    if (await pb.count()) {
      await click(page, pb, 900);
      const t2 = rec.now();
      await page.waitForFunction(() => /Verified playable|Could not verify|Not verified/.test(document.body.innerText), null, { timeout: 280_000, polling: 400 }).catch(() => log('playability did not finish'));
      rec.ramp(t2, 1200);
      await dwell(page, 3200);
    }
    mark(t, 'gizmos');
    const first = await page.evaluate(() => Object.entries(window.__aether!.history.current.entities).find(([, e]) => (e as { kind?: string }).kind !== 'terrain' && !/ground|terrain|sky/.test(e.name ?? ''))?.[0] ?? null);
    if (first) {
      await page.evaluate((id) => window.__aether!.store.getState().select([id]), first);
      await sleep(600);
      for (const id of ['move', 'rotate', 'scale']) {
        await click(page, tool(id), 800);
        await dwell(page, 1500);
      }
    }
    mark(t, 'play');
    await page.evaluate(() => window.__aether!.store.getState().select([]));
    await page.keyboard.press('Control+Enter');
    await sleep(4000);
    await cursor(page, false);
    await page.keyboard.down('w');
    await sleep(3500);
    await page.keyboard.up('w');
    await page.keyboard.press('Escape');
    await cursor(page, true);
    await dwell(page, 800);
  }
  if (kind === 'land') {
    mark(t, 'sculpt');
    await click(page, tool('sculpt'), 900);
    await dwell(page, 900);
    const box = (await page.locator('.viewport__host canvas').boundingBox())!;
    const cx = box.x + box.width * 0.5;
    const cy = box.y + box.height * 0.62;
    await glide(page, cx - 200, cy, 700);
    await page.mouse.down();
    for (let i = 0; i < 40; i++) {
      await page.mouse.move(cx - 200 + i * 10, cy + Math.sin(i / 5) * 24);
      await sleep(60);
    }
    await page.mouse.up();
    await dwell(page, 1500);
    mark(t, 'paint');
    await click(page, tool('paint'), 900);
    await dwell(page, 1600);
    mark(t, 'undo');
    for (let i = 0; i < 2; i++) await page.evaluate(() => window.__aether!.studio.undo());
    await dwell(page, 1500);
  }
  if (kind === 'publish') {
    for (const id of ['video', 'render', 'model', 'plan', 'game']) {
      mark(t, `hub-${id}`);
      await page.evaluate((x) => (window.__aether!.studio as unknown as { publish: { open(t: string): void } }).publish.open(x), id);
      await dwell(page, id === 'render' || id === 'video' ? 3200 : 2600);
    }
    await page.evaluate(() => (window.__aether!.studio as unknown as { publish: { close(): void } }).publish.close());
    await dwell(page, 800);
    mark(t, 'palette');
    await page.keyboard.press('Control+k');
    await dwell(page, 900);
    await type(page, 'export', 90);
    await dwell(page, 2000);
    await page.keyboard.press('Escape');
    await dwell(page, 600);
  }
  await finish(t);
}

// ---------------------------------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------------------------------
// livehome: the live site's home page: the prompt, then the Featured section of published worlds (real site, nothing local)
// ---------------------------------------------------------------------------------------------------------------

async function livehome(browser: Awaited<ReturnType<typeof chromium.launch>>): Promise<void> {
  const live = arg('live') ?? 'https://aether-studio-lyart.vercel.app';
  const t = await newTake(browser, 'livehome', `the live site ${live}`);
  const { page, rec } = t;
  await page.goto(`${live}/#/`, { waitUntil: 'domcontentloaded' });
  await page.locator('.featured__grid').waitFor({ timeout: 90_000 });
  await sleep(4000);
  await page.evaluate(() => window.scrollTo(0, 0));
  await glide(page, 900 * K, 500 * K, 10);
  await t.cap.start();
  const boot = rec.now();
  await sleep(1500);
  rec.cut(boot);
  await dwell(page, 2200);
  mark(t, 'featured');
  const grid = page.locator('.featured__grid');
  const y = await grid.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
  const steps = 40;
  const from = await page.evaluate(() => window.scrollY);
  for (let i = 1; i <= steps; i++) {
    const k = i / steps;
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    await page.evaluate((v) => window.scrollTo(0, v), from + (y - 90 - from) * e);
    await sleep(40);
  }
  await dwell(page, 1800);
  const cards = page.locator('.fcard');
  const n = await cards.count();
  for (let i = 0; i < Math.min(n, 4); i++) {
    await glide(page, (await centre(cards.nth(i))).x, (await centre(cards.nth(i))).y, 700);
    await dwell(page, 700);
  }
  await dwell(page, 1500);
  await finish(t);
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const server = await startServer(() => undefined);
  const browser = await chromium.launch({ executablePath: findChrome(), headless: HEADLESS, args: [...CHROME_ARGS, `--force-device-scale-factor=${SCALE}`, `--window-size=${W},${H + 87}`] });
  try {
    if (SCENE === 'scout') await scout(browser, server.url);
    else if (SCENE === 'edit') await edit(browser, server.url);
    else if (SCENE === 'describe') await describe(browser, server.url);
    else if (SCENE === 'publish') await publish(browser, server.url);
    else if (SCENE === 'modes') await modes(browser, server.url);
    else if (SCENE === 'play') await play(browser, server.url);
    else if (SCENE === 'devices') await devices(browser, server.url);
    else if (SCENE === 'arch') await arch(browser, server.url);
    else if (SCENE === 'tour') await tour(browser, server.url);
    else if (SCENE === 'livehome') await livehome(browser);
    else throw new Error(`unknown scene ${SCENE}`);
  } finally {
    await browser.close().catch(() => undefined);
    await server.stop();
  }
}

void gapStats;
main().then(() => process.exit(0), (e: unknown) => {
  process.stderr.write(`${String(e).slice(0, 800)}\n`);
  process.exit(1);
});
