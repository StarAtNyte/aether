/**
 * Frames of a world's short film (`world.story`, start mode `story`) in the real player, plus a play check:
 *
 *   STATIC_DIR=<dist> GEN_GPU=intel npx tsx scripts/story-shots.ts --out=<dir> [--slug=cloudwatch-harbour] [--cook=0|local|use]
 *       [--at=0.5,0.9] [--shots=0,3,7] [--play] [--frames] [--mute] [--size=1600x900]
 *
 * For each shot (or the ones named) it seeks the film to `at` fractions of the shot, lets it run 1.2 s (overlay fades), and
 * writes `<slug>-s<NN>-<at>.png`; then the end card, and the hand-over to the live world after it: the picture must not be
 * black, both when the film runs to its end and after a skip (`end-live.png`, `skip-live.png`). `--play` presses P from the story and walks: it records where the
 * character is each second (it must stand on the ground and move) and shoots the follow view. `--frames` reports
 * frame times over the whole film (p50 / p95 / worst, and programs linked during it). Writes `report.json`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright';
import * as env from '../tests/e2e/support/env';

const args = process.argv.slice(2);
const arg = (k: string): string | undefined => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const out = resolve(arg('out') ?? 'probe-out/story');
const slug = arg('slug') ?? 'cloudwatch-harbour';
const cook = arg('cook') ?? '0';
const ats = (arg('at') ?? '0.55').split(',').map(Number);
const only = arg('shots')?.split(',').map(Number) ?? null;
const [W, H] = (arg('size') ?? '1600x900').split('x').map(Number) as [number, number];
mkdirSync(out, { recursive: true });
const T0 = Date.now();
const log = (s: string): void => void process.stdout.write(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${s}\n`);

type Win = {
  __aetherCook?: { ready: boolean; path: string; reason: string | null };
  __aetherPlayer?: {
    phase: string;
    world: { story?: { shots: Array<{ name?: string; duration: number }> } };
    story: { time: number; duration: number; overlay: unknown } | null;
    playStory(at?: number): void;
    start(): void;
    simulation: { playerPosition: number[] | null; renderer: { processingStage: unknown; info?: unknown } } | null;
  };
};

async function open(page: Page): Promise<void> {
  await page.goto(`${server.url}/play.html#t=${slug}&cook=${cook}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as unknown as Win).__aetherCook?.ready === true, null, { timeout: 150_000, polling: 250 });
  await page.waitForFunction(() => (window as unknown as Win).__aetherPlayer?.phase === 'story', null, { timeout: 60_000, polling: 250 });
}

/** Programs linked so far (WebGL2: `linkProgram` calls, counted by an init script; WebGPU: three's program count). */
const programs = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const links = (window as unknown as { __links?: number }).__links;
    if (typeof links === 'number' && links > 0) return links;
    const r = (window as unknown as { __aetherPlayer?: { simulation?: { renderer?: { renderer?: { info?: { memory?: { programs?: number } } } } } } }).__aetherPlayer?.simulation?.renderer?.renderer;
    return r?.info?.memory?.programs ?? -1;
  });

const report: Record<string, unknown> = { slug, cook };

/** Mean brightness (0..255) of a screenshot, decoded in the page (no image library in Node). */
async function brightness(page: Page, png: Buffer): Promise<number> {
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 160;
    c.height = 90;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0, 160, 90);
    const d = g.getImageData(0, 0, 160, 90).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += (d[i]! + d[i + 1]! + d[i + 2]!) / 3;
    return Math.round((sum / (d.length / 4)) * 10) / 10;
  }, png.toString('base64'));
}
const server = await env.startServer(() => undefined);
const browser = await chromium.launch({ executablePath: env.findChrome(), args: [...env.CHROME_ARGS], headless: env.HEADLESS });
try {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  if (process.env['GEN_GPU'] === 'intel') await page.addInitScript({ content: 'delete Navigator.prototype.gpu; try { delete navigator.gpu; } catch {}' });
  await page.addInitScript({ content: 'window.__links = 0; window.__linkAt = []; { const l = WebGL2RenderingContext.prototype.linkProgram; WebGL2RenderingContext.prototype.linkProgram = function (p) { window.__links++; const s = window.__aetherPlayer && window.__aetherPlayer.story; window.__linkAt.push(s ? Math.round(s.time * 10) / 10 : -1); return l.call(this, p); }; }' });
  // `--mute`: the film's sound starts muted (its audio graph suspended), for frame times without it.
  if (args.includes('--mute')) await page.addInitScript({ content: "try { localStorage.setItem('aether.player.mute', '1'); } catch {}" });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 300)));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text().slice(0, 300)}`);
  });
  log(`${slug}: opening (cook=${cook})`);
  try {
    await open(page);
  } catch (e) {
    await page.screenshot({ path: join(out, `${slug}-failed.png`) }).catch(() => undefined);
    const where = await page.evaluate(() => ({ phase: (window as unknown as Win).__aetherPlayer?.phase ?? null, text: document.body.innerText.slice(0, 300) })).catch(() => null);
    writeFileSync(join(out, 'report.json'), JSON.stringify({ failed: String(e).slice(0, 300), where, errors: errors.slice(0, 40) }, null, 2));
    throw e;
  }
  report['load'] = await page.evaluate(() => ({ path: (window as unknown as Win).__aetherCook?.path, reason: (window as unknown as Win).__aetherCook?.reason }));
  const shots = await page.evaluate(() => (window as unknown as Win).__aetherPlayer!.world.story!.shots.map((s) => ({ name: s.name ?? '', duration: s.duration })));
  report['programsAtStart'] = await programs(page);
  // Interpenetration check of the people's paths against the solid pieces' walls.
  const clear = (await page.evaluate(`(() => { const s = window.__aetherPlayer.story; return s && s.clearance ? s.clearance() : []; })()`)) as Array<{ shot: number; min: number }>;
  report['clearance'] = { paths: clear, tight: clear.filter((c) => c.min < 0.18) };
  log(`clearance: ${JSON.stringify(clear.map((c) => [c.shot, c.min]))}`);
  if (args.includes('--frames')) {
    // The whole film from the start, frame times from rAF.
    const p0 = await programs(page);
    // A string: tsx's helpers (`__name`) do not exist in the page.
    const run = (await page.evaluate(`new Promise((done) => {
      const p = window.__aetherPlayer;
      p.playStory(0);
      const dts = [];
      const slow = [];
      let last = performance.now();
      const tick = () => {
        const now = performance.now();
        const s = p.story;
        if (now - last > 50 && s) slow.push([Math.round(s.time * 10) / 10, Math.round(now - last)]);
        dts.push(now - last);
        last = now;
        if (!s || s.time > s.duration) done({ dts: dts.slice(5), slow });
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    })`)) as { dts: number[]; slow: Array<[number, number]> };
    const times = run.dts;
    const sorted = [...times].sort((a, b) => a - b);
    const q = (f: number): number => Math.round((sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * f))] ?? 0) * 10) / 10;
    report['frames'] = { n: times.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), worst: q(1), over50ms: times.filter((t) => t > 50).length, slow: run.slow.slice(0, 60), programsBefore: p0, programsAfter: await programs(page), linkedAt: await page.evaluate((n) => ((window as unknown as { __linkAt?: number[] }).__linkAt ?? []).slice(Math.max(0, n)), p0) };
    log(`frames: ${JSON.stringify(report['frames'])}`);
  }
  let start = 0;
  const shotTimes = shots.map((s) => {
    const t = start;
    start += s.duration;
    return t;
  });
  const frames: Array<Record<string, unknown>> = [];
  for (let i = 0; i < shots.length; i++) {
    if (only && !only.includes(i)) continue;
    for (const a of ats) {
      const at = (shotTimes[i] as number) + (shots[i]!.duration * a);
      await page.evaluate((t) => (window as unknown as Win).__aetherPlayer!.playStory(Math.max(0, t - 1.2)), at);
      await page.waitForTimeout(1200);
      const file = join(out, `${slug}-s${String(i).padStart(2, '0')}-${a}.png`);
      await page.screenshot({ path: file });
      const st = await page.evaluate(() => (window as unknown as Win).__aetherPlayer!.story);
      frames.push({ shot: i, name: shots[i]!.name, at: a, file, story: st });
      log(`shot ${i} (${shots[i]!.name}) at ${a}: ${file}`);
    }
  }
  report['shots'] = frames;
  // The end card.
  await page.evaluate((t) => (window as unknown as Win).__aetherPlayer!.playStory(t), start - 0.3);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: join(out, `${slug}-end.png`) });
  // The hand-over: the end card's black lifts onto the live world (the last shot's view), never a black screen.
  await page.waitForTimeout(3500);
  const endLive = await page.screenshot({ path: join(out, `${slug}-end-live.png`) });
  await page.evaluate(() => (window as unknown as Win).__aetherPlayer!.playStory(4));
  await page.waitForTimeout(1500);
  await page.keyboard.press('Space');
  await page.waitForTimeout(4500);
  const skipLive = await page.screenshot({ path: join(out, `${slug}-skip-live.png`) });
  const live = { end: await brightness(page, endLive), skip: await brightness(page, skipLive), phase: await page.evaluate(() => (window as unknown as Win).__aetherPlayer!.phase) };
  report['handover'] = { ...live, ok: live.end > 25 && live.skip > 25 };
  log(`hand-over: ${JSON.stringify(report['handover'])}`);
  if (args.includes('--play')) {
    await page.keyboard.press('KeyP');
    await page.waitForFunction(() => (window as unknown as Win).__aetherPlayer?.phase === 'playing', null, { timeout: 60_000, polling: 250 });
    await page.waitForTimeout(1500);
    const track: Array<number[] | null> = [];
    const pos = (): Promise<number[] | null> => page.evaluate(() => (window as unknown as Win).__aetherPlayer!.simulation!.playerPosition?.map((v) => Math.round(v * 100) / 100) ?? null);
    track.push(await pos());
    await page.screenshot({ path: join(out, `${slug}-play-0.png`) });
    // Walk: forward (toward the sea from the lookout), then turn and walk back.
    await page.keyboard.down('KeyW');
    for (let k = 0; k < 4; k++) {
      await page.waitForTimeout(1000);
      track.push(await pos());
    }
    await page.screenshot({ path: join(out, `${slug}-play-walk.png`) });
    await page.keyboard.up('KeyW');
    await page.keyboard.down('KeyS');
    for (let k = 0; k < 4; k++) {
      await page.waitForTimeout(1000);
      track.push(await pos());
    }
    await page.keyboard.up('KeyS');
    await page.screenshot({ path: join(out, `${slug}-play-back.png`) });
    report['play'] = { track, phase: await page.evaluate(() => (window as unknown as Win).__aetherPlayer!.phase) };
    log(`play track: ${JSON.stringify(track)}`);
  }
  report['programsAtEnd'] = await programs(page);
  report['errors'] = errors.slice(0, 40);
} finally {
  await browser.close();
  await server.stop();
}
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
log(`report: ${join(out, 'report.json')}`);
