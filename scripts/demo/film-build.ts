/**
 * Build replay for the product film: a real build by the offline planner (no model call) is run once in the editor, then
 * its history is replayed entry by entry (back to the empty world, forward one commit at a time) and every frame is
 * rendered with the renderer's exclusive capture session at a fixed time step, so the generation plays smoothly at 30 fps.
 *
 *   STATIC_DIR=<dist> GEN_GPU=nvidia npx tsx scripts/demo/film-build.ts --prompt="a lodge by a lake" --out=<dir> [--probe=1]
 *
 * Writes <out>/f%05d.jpg and <out>/steps.json (the commit messages and the frame each one lands on).
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright';
import { CHROME_ARGS, HEADLESS, SKIP_FIRST_RUN, findChrome, startServer } from '../../tests/e2e/support/env';

const ARGS = process.argv.slice(2);
const arg = (n: string): string | undefined => ARGS.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const OUT = resolve(arg('out') ?? join(homedir(), '.local/share/aether/demo/film6/build'));
const PROMPT = arg('prompt') ?? 'a two-storey villa with a pool';
const T0 = Date.now();
const log = (s: string): void => void process.stdout.write(`[${((Date.now() - T0) / 1000).toFixed(0)}s] ${s}\n`);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function editorReady(page: Page): Promise<void> {
  await page.waitForFunction(() => { const a = window.__aether; const s = a?.store.getState(); return !!a && a.simulation !== null && s?.loading === null && !s.agentBusy && Object.keys(a.history.current.entities).length > 0; }, null, { timeout: 300_000, polling: 250 });
}

async function main(): Promise<void> {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const server = await startServer(() => undefined);
  const browser = await chromium.launch({ executablePath: findChrome(), headless: HEADLESS, args: [...CHROME_ARGS] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    await ctx.addInitScript({ content: SKIP_FIRST_RUN });
    await ctx.addInitScript({ content: 'globalThis.__name = (f) => f;' });
    await ctx.addInitScript({ content: "try { const k='aether.studio.settings.v1'; const s=JSON.parse(localStorage.getItem(k)||'{}'); s.renderTier='ultra'; s.showNavHint=false; s.motion='sharp'; localStorage.setItem(k, JSON.stringify(s)); } catch {}" });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => log(`pageerror: ${e.message.slice(0, 200)}`));
    let commits: Array<{ m: string; patches: unknown[] }>;
    if (arg('patches')) {
      commits = JSON.parse(readFileSync(resolve(arg('patches')!), 'utf8')) as typeof commits;
      await page.goto(`${server.url}/?debug=1#/new/${arg('base') ?? 'scandi-living-room'}`, { waitUntil: 'domcontentloaded' });
      await editorReady(page);
      await sleep(3000);
    } else {
      await page.goto(`${server.url}/?debug=1#/`, { waitUntil: 'domcontentloaded' });
      const box = page.locator('#hero-prompt').first();
      await box.waitFor({ timeout: 90_000 });
      await box.fill(PROMPT);
      const opened = /#\/p\/[a-z0-9]+/;
      for (let i = 0; i < 8 && !opened.test(page.url()); i++) {
        await page.keyboard.press('Enter');
        await page.waitForURL(opened, { timeout: 4_000 }).catch(() => undefined);
      }
      await page.waitForURL(opened, { timeout: 30_000 });
      await editorReady(page);
      await page.waitForFunction(() => { const s = window.__aether?.store.getState(); return !!s && !s.agentBusy && s.loading === null; }, null, { timeout: 600_000, polling: 250 });
      await sleep(5000);
      // The agent's commits, oldest first, with their patches.
      commits = await page.evaluate(() => window.__aether!.history.recentCommits(100).slice().reverse().map((c) => ({ m: c.message, patches: c.patches as unknown[] })));
      writeFileSync(join(OUT, 'patches.json'), JSON.stringify(commits));
    }
    const all = commits.flatMap((c) => c.patches);
    // The shot is lit at golden hour with the haze thinned (the build's own environment patch, only its hour and fog changed).
    for (const p of all as Array<{ op?: string; set?: { timeOfDay?: number; fog?: { density: number } | null } }>) {
      if (p.op === 'setEnvironment' && p.set) {
        p.set.timeOfDay = Number(arg('hour') ?? 17.2);
        if (p.set.fog) p.set.fog = { ...p.set.fog, density: p.set.fog.density * 0.4 };
      }
    }
    // The land first (right after the root entity it hangs under): the replay reads as land, then the building, then the garden.
    const isLand = (p: unknown): boolean => { const e = (p as { op?: string; entity?: { tags?: string[]; shape?: { generator?: string } } }); return e.op === 'add' && ((e.entity?.tags ?? []).includes('terrain') || e.entity?.shape?.generator === 'terrain'); };
    const li = all.findIndex(isLand);
    const first = all.findIndex((p) => (p as { op?: string }).op === 'add');
    if (li > first + 1) all.splice(first + 1, 0, ...all.splice(li, 1));
    log(`${all.length} patches in ${commits.length} commits; ops: ${all.slice(0, 400).map((p) => (p as { op?: string }).op).join(' ').slice(0, 1500)}`);
    if (arg('probe')) return;
    const steps = Number(arg('steps') ?? 14);
    const per = Math.max(1, Math.ceil(all.length / steps));
    const hold = Number(arg('frames') ?? 12);
    if (arg('patches')) {
      await page.evaluate(async (all) => { const a = window.__aether!; a.history.commit(all, 'replay all', 'agent'); await Promise.race([(a.simulation as unknown as { whenSynced(): Promise<void> }).whenSynced(), new Promise((r) => setTimeout(r, 60_000))]); }, all);
      await sleep(5000);
    }
    // Bounds of the finished world, for the camera.
    const info = await page.evaluate(() => {
      const a = window.__aether!;
      const sim = a.simulation as unknown as { entityBounds(id: string): { min: number[]; max: number[] } | null };
      const lo = [1e9, 1e9, 1e9];
      const hi = [-1e9, -1e9, -1e9];
      for (const id of Object.keys(a.history.current.entities)) {
        const b = sim.entityBounds(id);
        if (!b || Math.hypot(b.max[0]! - b.min[0]!, b.max[2]! - b.min[2]!) > 70) continue;
        for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i]!, b.min[i]!); hi[i] = Math.max(hi[i]!, b.max[i]!); }
      }
      return { c: [0, 1, 2].map((i) => (lo[i]! + hi[i]!) / 2), r: Math.hypot(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!) / 2 };
    });
    log(`bounds ${JSON.stringify(info)}`);
    await page.evaluate(() => { const a = window.__aether!; a.history.checkout(a.history.entries()[0]!.id); });
    await sleep(1500);
    const ok = await page.evaluate(async ({ all, per, hold, c, r, instant, rscale }) => {
      const a = window.__aether!;
      const sim = a.simulation as unknown as { renderer: unknown; whenSynced(): Promise<void> };
      const rend = sim.renderer as {
        setRenderTier(t: string): void; stopTour(): void; preparePost(): Promise<void>; setFixedClock(t: number, dt: number): void;
        beginCapture(w: number, h: number, o: object): { frame(p: object, o: { dt: number }): Promise<Uint8ClampedArray> };
      };
      rend.setRenderTier('ultra');
      rend.stopTour();
      await rend.preparePost();
      rend.setFixedClock(0, 0);
      const W = 1920, H = 1080;
      let session: ReturnType<typeof rend.beginCapture> | null = null;
      for (let tries = 0; !session && tries < 600; tries++) {
        try { session = rend.beginCapture(W, H, { vignette: true }); } catch { await new Promise((r) => setTimeout(r, 500)); }
      }
      if (!session) throw new Error('no capture session');
      const cap = session;
      const cv = new OffscreenCanvas(W, H);
      const ctx = cv.getContext('2d')!;
      const img = ctx.createImageData(W, H);
      const out: string[] = [];
      let n = 0, t = 0;
      const total = (Math.ceil(all.length / per) + 3) * hold;
      const shoot = async (k: number, save = true): Promise<void> => {
        const u = k / total;
        const az = ((190 + 70 * u) * Math.PI) / 180;
        const el = ((20 - 4 * u) * Math.PI) / 180;
        const dist = r * rscale * (1.25 - 0.3 * u);
        const pos = [c[0]! + dist * Math.cos(el) * Math.sin(az), c[1]! + dist * Math.sin(el), c[2]! + dist * Math.cos(el) * Math.cos(az)];
        rend.setFixedClock(t, 1 / 30);
        let px = await cap.frame({ pos, target: c, fov: 38, roll: 0 }, { dt: 1 / 30 });
        // A frame right after a scene change can come out flat (the post pass rebuilding, a cleared exposure): render on.
        for (let tries = 0; tries < 10; tries++) {
          let sum = 0, sq = 0;
          const m = 997;
          for (let i = 0; i < px.length; i += 4 * m) { const v = px[i + 1]!; sum += v; sq += v * v; }
          const cnt = Math.ceil(px.length / (4 * m));
          if (Math.sqrt(Math.max(0, sq / cnt - (sum / cnt) ** 2)) > 2.5) break;
          t += 1 / 30;
          rend.setFixedClock(t, 1 / 30);
          px = await cap.frame({ pos, target: c, fov: 38, roll: 0 }, { dt: 1 / 30 });
        }
        if (!save) { t += 1 / 30; return; }
        img.data.set(px);
        ctx.putImageData(img, 0, 0);
        const blob = await cv.convertToBlob({ type: 'image/jpeg', quality: 0.94 });
        const buf = new Uint8Array(await blob.arrayBuffer());
        let bin = '';
        for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        out.push(btoa(bin));
        t += 1 / 30;
        n++;
      };
      const marks: Array<{ frame: number; step: number }> = [];
      let k = 0;
      a.history.commit(all.slice(0, 3), 'replay start', 'agent');
      await Promise.race([sim.whenSynced(), new Promise((r) => setTimeout(r, 25_000))]);
      for (let f = 0; f < 5; f++) await shoot(k, false);
      for (let f = 0; f < hold; f++) await shoot(k++);
      for (let i = 3; i < all.length; i += per) {
        a.history.commit(all.slice(i, i + per), `replay ${i}`, 'agent');
        await Promise.race([sim.whenSynced(), new Promise((r) => setTimeout(r, 25_000))]);
        if (instant) (rend as unknown as { grow?: { finishAll(): void } }).grow?.finishAll();
        for (let f = 0; f < 5; f++) await shoot(k, false);
        marks.push({ frame: n, step: i });
        for (let f = 0; f < hold; f++) await shoot(k++);
      }
      for (let f = 0; f < hold * 2; f++) await shoot(k++);
      (window as unknown as { __frames: string[] }).__frames = out;
      (window as unknown as { __marks: unknown }).__marks = marks;
      return n;
    }, { all, per, hold, c: info.c, r: info.r, instant: arg('instant') !== '0', rscale: Number(arg('rscale') ?? 1) });
    log(`rendered ${ok} frames`);
    await page.screenshot({ path: join(OUT, 'dbg.png') });
    const marks = await page.evaluate(() => (window as unknown as { __marks: unknown }).__marks);
    writeFileSync(join(OUT, 'steps.json'), JSON.stringify({ messages: commits.map((c) => c.m), marks }, null, 1));
    for (let i = 0; i < ok; i++) {
      const b64 = await page.evaluate((j) => (window as unknown as { __frames: string[] }).__frames[j]!, i);
      writeFileSync(join(OUT, `f${String(i).padStart(5, '0')}.jpg`), Buffer.from(b64, 'base64'));
    }
  } finally {
    await browser.close().catch(() => undefined);
    await server.stop();
  }
}

main().then(() => process.exit(0), (e: unknown) => {
  process.stderr.write(`${String(e).slice(0, 800)}\n`);
  process.exit(1);
});
