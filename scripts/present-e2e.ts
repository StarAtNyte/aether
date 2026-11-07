/**
 * The publish presentation flow end to end, live: build a world from a prompt in the studio, then in the publish dialog
 * read the suggested kind and start mode, write the short film (a scene) or keep the tour (a building), run the shot
 * review (render, judge, fix), and play the result in the real player (story frames, the end card, the spawn).
 *
 *   STATIC_DIR=<dist> GEN_GPU=nvidia npx tsx scripts/present-e2e.ts --out=<dir> [--only=scene|building] [--provider=anthropic|claude-code|codex] [--world-scene=<built.json>] [--world-building=<built.json>] [--build-minutes=50] [--templates=a,b,c (with --only=none: templates only)] [--prompt-scene=…] [--prompt-building=…]
 *
 * The Anthropic API key is read from ~/.config/aether/anthropic.key (mode 600) by this script and handed only to the local
 * server it starts (bound to 127.0.0.1); it is never printed. Writes PNGs and `report.json` into --out.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright';
import { CHROME_ARGS, HEADLESS, REPO_ROOT, SKIP_FIRST_RUN, SKIP_TOUR, findChrome } from '../tests/e2e/support/env';

const args = process.argv.slice(2);
const arg = (k: string): string | undefined => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const out = resolve(arg('out') ?? 'probe-out/present');
const only = arg('only');
/** The server's provider: anthropic (the key file), or claude-code / codex (the local CLI login) when the API has no credit. */
const provider = arg('provider') ?? 'anthropic';
const PROMPTS: Record<string, string> = {
  scene: arg('prompt-scene') ?? 'A quiet alpine lake at late afternoon: a wooden boathouse and a jetty on the near shore, pine forest on the slopes, a stone footbridge over the inflow stream, wildflowers along the bank and snowy peaks behind. A fisherman stands at the end of the jetty.',
  building: arg('prompt-building') ?? 'A two-storey modern timber house on a gentle slope: an open-plan living room and kitchen with a big glazed wall onto a deck, a study, two bedrooms and a bathroom upstairs, a stair in the middle, furnished, warm interior light.',
};
mkdirSync(out, { recursive: true });
const T0 = Date.now();
const log = (s: string): void => void process.stdout.write(`[${((Date.now() - T0) / 1000).toFixed(0)}s] ${s}\n`);

function readKey(): string {
  const f = join(homedir(), '.config', 'aether', 'anthropic.key');
  if (!existsSync(f)) throw new Error(`no key file at ${f}`);
  if ((statSync(f).mode & 0o077) !== 0) throw new Error(`${f} is readable by others: chmod 600`);
  return readFileSync(f, 'utf8').trim();
}

async function freePort(): Promise<number> {
  return new Promise((ok, bad) => {
    const s = createServer();
    s.once('error', bad);
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => ok(p));
    });
  });
}

async function startServer(): Promise<{ url: string; stop: () => void }> {
  const dist = process.env['STATIC_DIR'];
  if (!dist || !existsSync(join(dist, 'index.html'))) throw new Error('set STATIC_DIR to a built studio');
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const key = provider === 'anthropic' ? readKey() : '';
  // The server (and the model CLI it runs) in a memory scope of its own, apart from the browser's.
  const cmd = process.env['PRESENT_NO_SCOPE'] === '1' ? [process.execPath, '--import', 'tsx', 'apps/server/src/main.ts'] : ['systemd-run', '--user', '--scope', '-q', '-p', 'MemoryMax=8000M', process.execPath, '--import', 'tsx', 'apps/server/src/main.ts'];
  const child: ChildProcess = spawn(cmd[0] as string, cmd.slice(1), {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      NODE_ENV: 'production',
      SERVE_STATIC: 'true',
      STATIC_DIR: dist,
      AETHER_PROVIDER: provider,
      AETHER_LOCAL_AI: 'off',
      ANTHROPIC_API_KEY: key,
      OPENAI_API_KEY: '',
      ALLOWED_ORIGINS: url,
      DATA_DIR: mkdtempSync(join(tmpdir(), 'aether-present-')),
      AETHER_DAILY_TOKEN_BUDGET: '60000000',
      RATE_LIMIT_LLM_PER_MIN: '600',
      RATE_LIMIT_LLM_BURST: '120',
      RATE_LIMIT_API_PER_MIN: '6000',
      RATE_LIMIT_API_BURST: '600',
      LOG_LEVEL: 'warn',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const scrub = (d: Buffer): string => (key ? d.toString().replaceAll(key, '[key]') : d.toString()).trim().slice(0, 400);
  child.stdout?.on('data', (d: Buffer) => log(`[server] ${scrub(d)}`));
  child.stderr?.on('data', (d: Buffer) => log(`[server] ${scrub(d)}`));
  for (let i = 0; i < 120; i++) {
    const ok = await fetch(`${url}/api/health`).then((r) => r.ok).catch(() => false);
    if (ok) return { url, stop: () => child.kill('SIGTERM') };
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill('SIGKILL');
  throw new Error('server did not start');
}

type Any = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type W = { __aether: any; __aetherPlayer: any };

async function saveDataUrl(file: string, dataUrl: string | null | undefined): Promise<string | null> {
  const m = dataUrl ? /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(dataUrl) : null;
  if (!m) return null;
  const path = `${file}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
  writeFileSync(path, Buffer.from(m[2] as string, 'base64'));
  return path;
}

async function waitIdle(page: Page, what: string, timeout: number): Promise<void> {
  // Idle and staying idle (the dialog starts the quality pass on its own once the suggestion is stored).
  const t0 = Date.now();
  for (;;) {
    await page.waitForFunction(() => ((window as unknown as W).__aether.studio as { presentation: { state: { getState(): { busy: unknown } } } }).presentation.state.getState().busy === null, null, { timeout: Math.max(1000, timeout - (Date.now() - t0)), polling: 1000 });
    await page.waitForTimeout(4000);
    const busy = await page.evaluate(() => (((window as unknown as W).__aether.studio as { presentation: { state: { getState(): { busy: unknown } } } }).presentation.state.getState().busy));
    if (busy === null) break;
  }
  log(`${what}: done`);
}

/** Save the last quality pass (findings, fixes, what is left) and its frames, before and after. */
async function saveQuality(page: Page, which: string, rep: Any): Promise<void> {
  const q = await page.evaluate(() => {
    const st = ((window as unknown as W).__aether.studio as { presentation: { state: { getState(): { quality: unknown; review: unknown } } } }).presentation.state.getState();
    return { quality: st.quality as { findings: unknown[]; fixed: string[]; remaining: unknown[]; review: { frames: Array<{ name: string; image: string | null; before: string | null; issues: unknown[]; fixed: string[] }>; summary: string; calls: number; rounds: number; judgedBy: string } | null } | null };
  });
  const quality = q.quality;
  if (!quality) return;
  const frames: Any[] = [];
  for (const f of quality.review?.frames ?? []) {
    const img = await saveDataUrl(join(out, `${which}-review-${f.name}`), f.image);
    const before = await saveDataUrl(join(out, `${which}-review-${f.name}-before`), f.before);
    frames.push({ name: f.name, issues: f.issues, fixed: f.fixed, image: img, before });
  }
  rep['quality'] = { findings: quality.findings, fixed: quality.fixed, remaining: quality.remaining, review: quality.review ? { summary: quality.review.summary, calls: quality.review.calls, rounds: quality.review.rounds, judgedBy: quality.review.judgedBy } : null, frames };
  log(`${which}: quality fixed ${JSON.stringify(quality.fixed)}; ${quality.remaining.length} left`);
}

async function runWorld(server: { url: string }, which: 'scene' | 'building', report: Any): Promise<void> {
  const browser = await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS], headless: HEADLESS });
  const rep: Any = { prompt: PROMPTS[which] };
  report[which] = rep;
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 810 } });
    await ctx.addInitScript(SKIP_FIRST_RUN);
    await ctx.addInitScript(SKIP_TOUR);
    await ctx.addInitScript({ content: 'globalThis.__name = (f) => f;' });
    await ctx.addInitScript({ content: 'globalThis.__aetherWatchdog = { firstFrameMs: 900000, stepFrameMs: 900000, giveUpMs: 900000 };' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => log(`  pageerror: ${e.message.slice(0, 200)}`));
    await page.goto(`${server.url}/?debug=1#/new`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!(window as unknown as W).__aether?.simulation, null, { timeout: 300_000, polling: 500 });
    // The live assistant must be connected (the server's Anthropic provider).
    await page.waitForFunction(() => ((window as unknown as W).__aether?.store as { getState(): { provider?: { status?: string } } }).getState().provider?.status === 'live', null, { timeout: 60_000, polling: 500 }).catch(() => log('  (provider chip not live yet)'));
    const saved = arg(`world-${which}`);
    const t0 = Date.now();
    if (saved) {
      // A world built earlier by this script (its -built.json): loaded instead of built again.
      log(`${which}: loading the world built earlier from ${saved}`);
      await page.evaluate((json) => ((window as unknown as W).__aether.studio as { replaceWorld(w: unknown, m: string): void }).replaceWorld(JSON.parse(json), 'Load the built world'), readFileSync(saved, 'utf8'));
      await page.waitForTimeout(8000);
    } else {
      log(`${which}: building from the prompt (live AI)…`);
      // Progress every minute; past --build-minutes (default 50) the run is stopped and the world as built so far is used.
      const cap = Number(arg('build-minutes') ?? 50) * 60_000;
      const tick = setInterval(() => {
        void page.evaluate(() => ((window as unknown as W).__aether.store.getState() as { agentRun: { step: string; steps: number } | null }).agentRun).then((r) => log(`  ${which}: ${r ? `step ${r.steps}: ${r.step}` : 'idle'}`)).catch(() => undefined);
        if (Date.now() - t0 > cap) void page.evaluate(() => ((window as unknown as W).__aether.studio as { stopAgent(): void }).stopAgent()).catch(() => undefined);
      }, 60_000);
      try {
        await page.evaluate((p) => ((window as unknown as W).__aether.studio as { send(t: string): Promise<void> }).send(p), PROMPTS[which] as string);
      } finally {
        clearInterval(tick);
      }
      // Kept, so a later run can review the same world without building it again.
      writeFileSync(join(out, `${which}-built.json`), await page.evaluate(() => JSON.stringify(((window as unknown as W).__aether.history as { current: unknown }).current)));
      // The presentation suggestion runs right after the turn.
      await page.waitForTimeout(5000);
    }
    rep['buildSeconds'] = Math.round((Date.now() - t0) / 1000);
    const after = await page.evaluate(() => {
      const st = (window as unknown as W).__aether.store as { getState(): { chat: Array<{ events?: Array<{ type: string; text?: string }> }> } };
      const w = ((window as unknown as W).__aether.history as { current: { profile?: string; startMode?: string; story?: unknown; entities: object; name: string } }).current;
      const lines = st.getState().chat.flatMap((m) => (m.events ?? []).filter((e) => e.type === 'status' && /Publishes as|Opening view/.test(e.text ?? '')).map((e) => e.text));
      return { name: w.name, entities: Object.keys(w.entities).length, profile: w.profile ?? null, startMode: w.startMode ?? null, lines };
    });
    rep['afterBuild'] = after;
    log(`${which}: built "${after.name}" (${after.entities} entities) in ${rep['buildSeconds']} s; presentation ${after.profile}/${after.startMode}`);
    await page.evaluate(() => {
      const st = ((window as unknown as W).__aether.store as { getState(): { setPanel(s: string, v: boolean): void } }).getState();
      st.setPanel('left', false);
    });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: join(out, `${which}-editor.png`) });
    // The publish dialog.
    await page.evaluate(() => ((window as unknown as W).__aether.studio as { publish: { open(t: string): void } }).publish.open('share'));
    await page.waitForSelector('[data-testid="present-section"]', { timeout: 30_000 });
    await waitIdle(page, `${which}: suggestion`, 3_600_000);
    rep['suggestion'] = await page.evaluate(() => ((window as unknown as W).__aether.studio as { presentation: { state: { getState(): { suggestion: unknown } } } }).presentation.state.getState().suggestion);
    log(`${which}: suggested ${JSON.stringify(rep['suggestion'])}`);
    await page.locator('[data-testid="present-section"]').screenshot({ path: join(out, `${which}-dialog-suggest.png`) });
    const startMode = await page.evaluate(() => ((window as unknown as W).__aether.history as { current: { startMode?: string } }).current.startMode ?? null);
    // A scene gets its film even when it was suggested another start (writing one starts the world on it).
    if (startMode === 'story' || which === 'scene') {
      log(`${which}: writing the short film…`);
      await page.click('[data-testid="present-story"]');
      await page.waitForTimeout(500);
      await waitIdle(page, `${which}: film`, 900_000);
      rep['story'] = await page.evaluate(() => {
        const s = ((window as unknown as W).__aether.studio as { presentation: { state: { getState(): { story: unknown } } } }).presentation.state.getState().story;
        const w = ((window as unknown as W).__aether.history as { current: { story?: unknown } }).current;
        return { result: s, story: w.story };
      });
      writeFileSync(join(out, `${which}-story.json`), JSON.stringify((rep['story'] as Any)['story'], null, 2));
    }
    log(`${which}: quality pass…`);
    await page.click('[data-testid="present-review"]');
    await page.waitForTimeout(500);
    await waitIdle(page, `${which}: quality pass`, 3_600_000);
    await saveQuality(page, which, rep);
    const review = await page.evaluate(() => ((window as unknown as W).__aether.studio as { presentation: { state: { getState(): { review: { frames: Array<{ name: string; image: string | null; before: string | null; issues: unknown[]; fixed: string[] }>; fixed: string[]; remaining: unknown[]; summary: string; calls: number; rounds: number; judgedBy: string } | null } } } }).presentation.state.getState().review);
    if (review) {
      const frames: Any[] = [];
      for (const f of review.frames) {
        const img = await saveDataUrl(join(out, `${which}-review-${f.name}`), f.image);
        const before = await saveDataUrl(join(out, `${which}-review-${f.name}-before`), f.before);
        frames.push({ name: f.name, issues: f.issues, fixed: f.fixed, image: img, before });
      }
      rep['review'] = { summary: review.summary, fixed: review.fixed, remaining: review.remaining, calls: review.calls, rounds: review.rounds, judgedBy: review.judgedBy, frames };
      log(`${which}: review fixed ${JSON.stringify(review.fixed)}; ${review.remaining.length} left; ${review.summary.slice(0, 200)}`);
    }
    await page.locator('[data-testid="present-section"]').screenshot({ path: join(out, `${which}-dialog-review.png`) });
    // The world as published: save it and play it in the real player.
    const worldJson = await page.evaluate(() => JSON.stringify(((window as unknown as W).__aether.history as { current: unknown }).current));
    writeFileSync(join(out, `${which}-world.json`), worldJson);
    await page.evaluate(() => ((window as unknown as W).__aether.studio as { publish: { makeShareLink(): Promise<void> } }).publish.makeShareLink());
    const link = await page.evaluate(() => ((window as unknown as W).__aether.studio as { publish: { shareLink(): string | null } }).publish.shareLink());
    rep['shareChars'] = link?.length ?? 0;
    if (link) await playIt(browser, link.replace(/^https?:\/\/[^/]+/, server.url), which, rep);
    else log(`${which}: no share link (too large); player frames skipped`);
  } catch (e) {
    rep['error'] = String(e).slice(0, 500);
    log(`${which}: FAILED ${rep['error']}`);
  } finally {
    await browser.close();
  }
}

/** Open the published world in the player: the film's frames (or the tour's), the end card, then P and the spawn. */
async function playIt(browser: import('playwright').Browser, link: string, which: string, rep: Any): Promise<void> {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', (e) => log(`  player pageerror: ${e.message.slice(0, 200)}`));
  await page.goto(link, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const p = (window as unknown as W).__aetherPlayer as { phase?: string } | undefined;
    return !!p && p.phase !== 'booting';
  }, null, { timeout: 300_000, polling: 500 });
  await page.waitForTimeout(4000);
  const phase = await page.evaluate(() => ((window as unknown as W).__aetherPlayer as { phase: string }).phase);
  rep['playerPhase'] = phase;
  log(`${which}: player opened in phase ${phase}`);
  await page.screenshot({ path: join(out, `${which}-player-open.png`) });
  const shots = await page.evaluate(() => (((window as unknown as W).__aetherPlayer as { world: { story?: { shots: Array<{ duration: number; name?: string }> } } }).world.story?.shots ?? []).map((s) => ({ d: s.duration, n: s.name ?? '' })));
  if (phase === 'story' && shots.length > 0) {
    let t = 0;
    const files: string[] = [];
    for (const [i, s] of shots.entries()) {
      const at = t + s.d * 0.55;
      t += s.d;
      await page.evaluate((x) => ((window as unknown as W).__aetherPlayer as { playStory(t: number): void }).playStory(Math.max(0, x - 1.2)), at);
      await page.waitForTimeout(1300);
      const f = join(out, `${which}-film-s${String(i).padStart(2, '0')}.png`);
      await page.screenshot({ path: f });
      files.push(f);
    }
    await page.evaluate((x) => ((window as unknown as W).__aetherPlayer as { playStory(t: number): void }).playStory(x), t - 0.3);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: join(out, `${which}-film-end.png`) });
    rep['filmFrames'] = files;
  }
  // P plays as the character.
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(5000);
  const play = await page.evaluate(() => {
    const p = (window as unknown as W).__aetherPlayer as { phase: string; simulation?: { playerPosition?: number[] | null } };
    return { phase: p.phase, pos: p.simulation?.playerPosition ?? null };
  });
  rep['play'] = play;
  await page.screenshot({ path: join(out, `${which}-player-play.png`) });
  log(`${which}: P -> ${JSON.stringify(play)}`);
  await page.close();
}

/** A bundled template through the world-quality pass, as the studio opens it (`#/new/<slug>`). */
async function runTemplate(server: { url: string }, slug: string, report: Any): Promise<void> {
  const browser = await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS], headless: HEADLESS });
  const rep: Any = { template: slug };
  report[slug] = rep;
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 810 } });
    await ctx.addInitScript(SKIP_FIRST_RUN);
    await ctx.addInitScript(SKIP_TOUR);
    await ctx.addInitScript({ content: 'globalThis.__name = (f) => f;' });
    await ctx.addInitScript({ content: 'globalThis.__aetherWatchdog = { firstFrameMs: 900000, stepFrameMs: 900000, giveUpMs: 900000 };' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => log(`  pageerror: ${e.message.slice(0, 200)}`));
    await page.goto(`${server.url}/?debug=1#/new/${slug}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
      const a = (window as unknown as W).__aether;
      return !!a && a.simulation !== null && a.store.getState().loading === null && Object.keys(a.studio.history.current.entities).length > 0;
    }, null, { timeout: 600_000, polling: 500 });
    await page.evaluate(async () => {
      await ((window as unknown as W).__aether.simulation as { whenFullyLoaded(): Promise<void> }).whenFullyLoaded();
    });
    if (await page.evaluate(() => (window as unknown as W).__aether.store.getState().mode === 'play')) await page.getByRole('button', { name: 'Back to editor' }).click({ timeout: 20_000 }).catch(() => undefined);
    await page.waitForTimeout(4000);
    log(`${slug}: quality pass…`);
    const t0 = Date.now();
    await page.evaluate(() => ((window as unknown as W).__aether.studio as { publish: { open(t: string): void } }).publish.open('share'));
    await page.waitForSelector('[data-testid="present-section"]', { timeout: 60_000 });
    await page.waitForTimeout(1500);
    await page.click('[data-testid="present-review"]').catch(() => undefined);
    await page.waitForTimeout(500);
    await waitIdle(page, `${slug}: quality pass`, 3_600_000);
    rep['seconds'] = Math.round((Date.now() - t0) / 1000);
    await saveQuality(page, slug, rep);
    await page.locator('[data-testid="present-section"]').screenshot({ path: join(out, `${slug}-dialog.png`) }).catch(() => undefined);
  } catch (e) {
    rep['error'] = String(e).slice(0, 500);
    log(`${slug}: FAILED ${rep['error']}`);
  } finally {
    await browser.close();
  }
}

const report: Any = {};
const server = await startServer();
log(`server at ${server.url} (${provider})`);
try {
  for (const slug of (arg('templates') ?? '').split(',').filter(Boolean)) {
    await runTemplate(server, slug, report);
    writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  }
  for (const which of ['scene', 'building'] as const) {
    if (only === 'none' || (only && only !== which)) continue;
    await runWorld(server, which, report);
    writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  }
} finally {
  server.stop();
}
log(`report: ${join(out, 'report.json')}`);
