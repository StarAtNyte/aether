/**
 * One real publish through the LIVE deployment (its own `/api/cook-upload`, its own write token): editor -> bake -> upload ->
 * short link -> the player loads the published world cooked. No local write token, no local copy of the function.
 *
 *   GEN_GPU=intel npx tsx scripts/cook-publish-live.ts [--origin=https://aether-studio-lyart.vercel.app] [--template=asteroid-field]
 *
 * Prints the anon id and world id. Take the world down afterwards (the local write token, never printed):
 *   npx tsx scripts/cook-takedown.ts users/<anon>/<world>; npx tsx scripts/cook-takedown.ts --dry-run users/<anon>
 * Each run counts against the live function's rate limits on the dataset: run it once.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import * as env from '../tests/e2e/support/env';

const args = process.argv.slice(2);
const flag = (k: string): string | undefined => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const ORIGIN = (flag('origin') ?? 'https://aether-studio-lyart.vercel.app').replace(/\/+$/, '');
const TEMPLATE = flag('template') ?? 'asteroid-field';
const T0 = Date.now();
const log = (s: string): void => void process.stdout.write(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${s}\n`);

type Cooked = { status: string; label: string | null; ref: string | null; startMode: string };
type Win = {
  __aether?: { simulation: { whenSynced(): Promise<void> } | null; store: { getState(): { loading: unknown; agentBusy: boolean } }; studio: { publish: { publishCooked(): Promise<void>; state: { getState(): { cooked: Cooked } } } } };
  __aetherCook?: { path: string; reason: string | null; ready: boolean };
  __csp?: string[];
};

async function main(): Promise<void> {
  mkdirSync(join(homedir(), '.cache/aether-e2e-tmp'), { recursive: true });
  const profiles: string[] = [];
  const profile = (): string => {
    const p = mkdtempSync(join(homedir(), '.cache/aether-e2e-tmp/live-'));
    profiles.push(p);
    return p;
  };
  try {
    const ed = await chromium.launchPersistentContext(profile(), { executablePath: env.findChrome(), args: [...env.CHROME_ARGS], headless: env.HEADLESS, viewport: { width: 1440, height: 900 } });
    let ref: string;
    let startMode: string;
    try {
      await ed.addInitScript({ content: env.SKIP_FIRST_RUN });
      await ed.addInitScript({ content: "window.__long = []; window.__labels = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true }); } catch {}" });
      const page: Page = ed.pages()[0] ?? (await ed.newPage());
      page.on('pageerror', (e) => log(`editor pageerror ${e.message.slice(0, 160)}`));
      page.on('response', (r) => {
        if (r.url().includes('/api/cook-upload')) void r.text().then((t) => log(`upload ${r.request().method()} ${r.status()} ${t.slice(0, 300)}`)).catch(() => undefined);
      });
      page.on('requestfailed', (r) => {
        if (r.url().includes('/api/cook-upload') || r.url().includes('huggingface.co')) log(`request failed ${r.url().slice(0, 120)}: ${r.failure()?.errorText}`);
      });
      await page.goto(`${ORIGIN}/?debug=1#/new/${TEMPLATE}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => {
        const a = (window as unknown as Win).__aether;
        const st = a?.store.getState();
        return !!a && a.simulation !== null && st?.loading === null && !st.agentBusy;
      }, null, { timeout: 180_000, polling: 250 });
      await page.evaluate(async () => (window as unknown as Win).__aether!.simulation!.whenSynced());
      log(`editor: ${TEMPLATE} open on ${ORIGIN}`);
      const t1 = Date.now();
      await page.evaluate(() => {
        const st = (window as unknown as Win).__aether!.studio.publish.state as unknown as { subscribe(f: (s: { cooked: { label: string | null } }) => void): void };
        st.subscribe((s) => void (window as unknown as { __labels: Array<[number, string]> }).__labels.push([performance.now(), s.cooked.label ?? '']));
        void (window as unknown as Win).__aether!.studio.publish.publishCooked();
      });
      const done = await page.waitForFunction(() => {
        const c = (window as unknown as Win).__aether!.studio.publish.state.getState().cooked;
        return c.status === 'done' || c.status === 'failed' ? c : false;
      }, null, { timeout: 600_000, polling: 500 });
      const c = (await done.jsonValue()) as Cooked;
      log(`editor: ${c.status} in ${((Date.now() - t1) / 1000).toFixed(1)} s: ${c.label ?? ''}`);
      const m = await page.evaluate(() => {
        const g = window as unknown as { __long: Array<[number, number]>; __labels: Array<[number, string]> };
        const from = g.__labels.find(([, l]) => /^Baking light|^Waiting for the light volume/.test(l))?.[0] ?? null;
        const to = g.__labels.find(([, l]) => /^Light baked|^No baked light/.test(l))?.[0] ?? null;
        const during = from !== null ? g.__long.filter(([t]) => t >= from && t <= (to ?? Infinity)) : [];
        return { from, to, during: during.length, worst: Math.max(0, ...during.map(([, d]) => d)), over100: during.filter(([, d]) => d > 100).length, labels: g.__labels.map(([, l]) => l).filter((l, i, a) => l !== a[i - 1]).slice(-12) };
      });
      log(`editor: bake ${m.from !== null && m.to !== null ? ((m.to - m.from) / 1000).toFixed(1) + ' s' : 'n/a'}; long tasks during it ${m.during} (worst ${m.worst.toFixed(0)} ms, over 100 ms: ${m.over100}); labels: ${m.labels.join(' > ')}`);
      if (c.status !== 'done' || !c.ref) throw new Error(`publish failed: ${c.label}`);
      ref = c.ref;
      startMode = c.startMode;
    } finally {
      await ed.close().catch(() => undefined);
    }
    const [anon, world] = ref.split('.') as [string, string];
    log(`published: anon ${anon} world ${world} (take down: npx tsx scripts/cook-takedown.ts users/${anon}/${world})`);
    try {
      const tree = (await (await fetch(`https://huggingface.co/api/datasets/StarAtNyte1/aether-cooked/tree/main/users/${anon}/${world}?recursive=true`)).json()) as Array<{ type: string; size: number; lfs?: { size: number } }>;
      const files = tree.filter((f) => f.type === 'file');
      log(`dataset: ${files.length} files, ${(files.reduce((n, f) => n + (f.lfs?.size ?? f.size), 0) / 1e6).toFixed(2)} MB`);
    } catch (e) {
      log(`dataset listing failed: ${String(e).slice(0, 120)}`);
    }

    const pl = await chromium.launchPersistentContext(profile(), { executablePath: env.findChrome(), args: [...env.CHROME_ARGS], headless: env.HEADLESS, viewport: { width: 1280, height: 720 } });
    try {
      await pl.addInitScript({ content: "window.__csp = []; addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));" });
      const page = pl.pages()[0] ?? (await pl.newPage());
      const consoleCsp: string[] = [];
      page.on('console', (m) => {
        if (/Content Security Policy/i.test(m.text())) consoleCsp.push(m.text().slice(0, 200));
      });
      page.on('pageerror', (e) => log(`player pageerror ${e.message.slice(0, 160)}`));
      const link = `${ORIGIN}/play#c=${ref}&m=${startMode}`;
      log(`player: ${link.replace(ORIGIN, '')}`);
      const t2 = Date.now();
      await page.goto(link, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => (window as unknown as Win).__aetherCook?.ready === true, null, { timeout: 300_000, polling: 250 });
      const out = await page.evaluate(() => ({ cook: (window as unknown as Win).__aetherCook!, csp: (window as unknown as Win).__csp ?? [] }));
      log(`player: first picture in ${((Date.now() - t2) / 1000).toFixed(1)} s, path ${out.cook.path}${out.cook.reason ? ` (${out.cook.reason})` : ''}`);
      const v = [...out.csp, ...consoleCsp];
      log(`player: ${v.length} policy violations${v.length ? `: ${v.slice(0, 5).join(' | ')}` : ''}`);
      if (out.cook.path !== 'cooked') throw new Error(`the short link did not load cooked: ${out.cook.reason}`);
      if (v.length > 0) throw new Error('policy violations');
    } finally {
      await pl.close().catch(() => undefined);
    }
    log('ok');
  } finally {
    for (const p of profiles) rmSync(p, { recursive: true, force: true });
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
