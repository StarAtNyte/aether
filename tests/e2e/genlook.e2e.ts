/**
 * Generated-world look shots: builds worlds from prompts the way a person does (the home prompt box, the offline
 * planner by default) and captures fixed views of the result, for art-direction rounds on what the generators
 * produce (not a pass/fail suite).
 *
 *   npx tsx tests/e2e/genlook.e2e.ts <outDir> [name=prompt]…
 *
 * Without prompts it runs the four benchmark prompts (forest, house, village, canyon). Views: `editor` (the studio's
 * own framing after the build), `eye` (behind and above the spawn, looking at the focus), `aerial` (three-quarter
 * view of the content) and `play` (Play pressed, a few steps forward) for outdoor worlds; `exterior`, `aerial`,
 * `living` and `bedroom` for buildings. The world document is saved next to the stills (`<name>.world.json`).
 * `GEN_GPU=intel` uses the integrated GPU (WebGL2), `AETHER_E2E_GPU=1` the discrete one; `SHOT_BROWSER=firefox` runs
 * Firefox on WebGL2; `GEN_BACKEND=claude-code` uses the Claude Code CLI through the local server instead of the
 * offline planner (needs a signed-in CLI). Everything started here is stopped in a `finally`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, firefox, type Browser, type Page } from 'playwright';
import { CHROME_ARGS, FIREFOX_PREFS, SKIP_TOUR, findChrome, findFirefox, startServer } from './support/env';

const [outDir, ...rest] = process.argv.slice(2);
if (!outDir) throw new Error('usage: genlook <outDir> [name=prompt]…');

/** The benchmark prompts of the generated-look rounds. */
const BENCHMARK: ReadonlyArray<readonly [string, string]> = [
  ['forest', 'a night forest adventure: collect 5 lanterns, avoid the wolves, cross the river and reach the shrine to win'],
  ['house', 'a two-storey modern house with a pool, an open-plan living room and kitchen, 2 bedrooms and residents'],
  ['village', 'a medieval village with a market'],
  ['canyon', 'a desert canyon racing game'],
];
const prompts: Array<readonly [string, string]> = rest.length > 0 ? rest.map((r) => { const i = r.indexOf('='); return [r.slice(0, i), r.slice(i + 1)] as const; }) : [...BENCHMARK];
const W = Number(process.env['SHOT_W'] ?? 1600);
const H = Number(process.env['SHOT_H'] ?? 900);
const BACKEND = process.env['GEN_BACKEND'] ?? 'offline';
/** `GEN_GPU=intel`: WebGL2 over ANGLE/GL-EGL on the integrated GPU (holds its context headless; WebGPU is not offered). */
const INTEL_ARGS: readonly string[] = ['--enable-unsafe-webgpu', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu'];
const t0 = performance.now();
const log = (l: string): void => void process.stdout.write(`[${((performance.now() - t0) / 1000).toFixed(0).padStart(4)}s] ${l}\n`);

type V3 = [number, number, number];
interface Cam { name: string; pos: V3; target: V3 }

async function build(page: Page, url: string, prompt: string): Promise<void> {
  await page.goto(`${url}/?debug=1#/`, { waitUntil: 'domcontentloaded' });
  await page.locator('#hero-prompt').waitFor({ timeout: 60_000 });
  await page.locator('#hero-prompt').fill(prompt);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => (window.__aether?.store.getState().chat.length ?? 0) > 0, null, { timeout: 90_000 });
  await page.waitForFunction(
    () => {
      const a = window.__aether;
      if (!a || a.simulation === null) return false;
      const st = a.store.getState();
      const last = st.chat[st.chat.length - 1];
      return st.loading === null && !st.agentBusy && Object.keys(a.history.current.entities).length > 0 && (last === undefined || last.role === 'assistant');
    },
    null,
    { timeout: 570_000, polling: 500 },
  );
  await page.evaluate(async () => {
    await window.__aether?.simulation?.whenSynced();
  });
  await page.waitForFunction(() => window.__aether?.simulation?.renderer.animating === false, null, { timeout: 60_000, polling: 500 }).catch(() => log('  (still animating)'));
  await page.waitForTimeout(2500);
}

async function capture(page: Page, file: string): Promise<void> {
  await page.waitForTimeout(1800);
  await page.waitForFunction(() => (window.__aether?.simulation?.renderer.refineProgress ?? 1) >= 0.98, null, { timeout: 40_000, polling: 500 }).catch(() => undefined);
  const data = await page.evaluate(async ([w, h]) => (await window.__aether?.simulation?.renderer.screenshot({ width: w as number, height: h as number, mime: 'image/png' })) ?? null, [W, H]);
  if (!data) throw new Error('capture failed');
  writeFileSync(file, Buffer.from(data.slice('data:image/png;base64,'.length), 'base64'));
  log(`  wrote ${file}`);
}

function setCam(page: Page, cam: Cam): Promise<void> {
  return page.evaluate(
    ([p, t]) => {
      const dx = t[0] - p[0];
      const dy = t[1] - p[1];
      const dz = t[2] - p[2];
      window.__aether?.simulation?.renderer.setCameraPose(p[0], p[1], p[2], Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
    },
    [cam.pos, cam.target] as const,
  );
}

/** Cameras derived from the built world (run in the page). */
function cameras(page: Page): Promise<{ arch: boolean; cams: Cam[] }> {
  return page.evaluate(() => {
    type Ent = { id: string; parent: string | null; tags: string[]; transform: { position: [number, number, number]; rotation: [number, number, number] }; shape: { kind: string; params?: Record<string, unknown> }; arch?: { role: string; kind?: string } };
    const w = window.__aether!.history.current as unknown as { entities: Record<string, Ent>; player: { spawn: [number, number, number] } };
    const ents = Object.values(w.entities);
    // World transform of a point given in an entity's local frame (position + yaw only; buildings are not tilted).
    const toWorld = (id: string | null, p: [number, number, number]): [number, number, number] => {
      let out: [number, number, number] = [...p];
      for (let e = id ? w.entities[id] : undefined; e; e = e.parent ? w.entities[e.parent] : undefined) {
        const yaw = ((e.transform.rotation?.[1] ?? 0) * Math.PI) / 180;
        const c = Math.cos(yaw);
        const s = Math.sin(yaw);
        out = [e.transform.position[0] + out[0] * c + out[2] * s, e.transform.position[1] + out[1], e.transform.position[2] - out[0] * s + out[2] * c];
      }
      return out;
    };
    const building = ents.find((e) => e.arch?.role === 'building');
    if (building) {
      const rooms = ents.filter((e) => e.arch?.role === 'room');
      let lo = [Infinity, Infinity];
      let hi = [-Infinity, -Infinity];
      const centre = (r: Ent): [number, number, number] => {
        const poly = (r.shape.params?.['polygon'] as Array<[number, number]> | undefined) ?? [[0, 0]];
        const cx = poly.reduce((s, q) => s + q[0], 0) / poly.length;
        const cz = poly.reduce((s, q) => s + q[1], 0) / poly.length;
        return toWorld(r.id, [cx, 0, cz]);
      };
      for (const r of rooms) {
        const poly = (r.shape.params?.['polygon'] as Array<[number, number]> | undefined) ?? [];
        for (const q of poly) {
          const p = toWorld(r.id, [q[0], 0, q[1]]);
          lo = [Math.min(lo[0]!, p[0]), Math.min(lo[1]!, p[2])];
          hi = [Math.max(hi[0]!, p[0]), Math.max(hi[1]!, p[2])];
        }
      }
      const cx = (lo[0]! + hi[0]!) / 2;
      const cz = (lo[1]! + hi[1]!) / 2;
      const diag = Math.hypot(hi[0]! - lo[0]!, hi[1]! - lo[1]!);
      const by = building.transform.position[1];
      const cams: Array<{ name: string; pos: [number, number, number]; target: [number, number, number] }> = [
        { name: 'exterior', pos: [cx + diag * 0.95, by + 1.7, cz + diag * 1.25], target: [cx, by + 2.6, cz] },
        { name: 'aerial', pos: [cx - diag * 1.1, by + diag * 0.9, cz + diag * 1.2], target: [cx, by + 1.5, cz] },
      ];
      for (const kind of ['living', 'bedroom', 'kitchen']) {
        const r = rooms.find((e) => e.arch?.kind === kind);
        if (!r) continue;
        const c = centre(r);
        const poly = (r.shape.params?.['polygon'] as Array<[number, number]> | undefined) ?? [];
        // Stand in a corner (40 % of the way from the centre) looking across the room.
        const corner = poly.length > 0 ? toWorld(r.id, [poly[0]![0], 0, poly[0]![1]]) : c;
        const pos: [number, number, number] = [c[0] + (corner[0] - c[0]) * 0.5, c[1] + 1.5, c[2] + (corner[2] - c[2]) * 0.5];
        cams.push({ name: kind, pos, target: [c[0] - (corner[0] - c[0]) * 0.5, c[1] + 1.0, c[2] - (corner[2] - c[2]) * 0.5] });
      }
      return { arch: true, cams };
    }
    const focus = ents.find((e) => e.tags.includes('focus') && !e.parent) ?? ents.find((e) => e.tags.includes('goal'));
    const sp = w.player?.spawn ?? [0, 1, 10];
    const ft: [number, number, number] = focus ? [focus.transform.position[0], focus.transform.position[1] + 1.2, focus.transform.position[2]] : [0, 1, 0];
    let dx = ft[0] - sp[0];
    let dz = ft[2] - sp[2];
    const d = Math.hypot(dx, dz) || 1;
    dx /= d;
    dz /= d;
    // Content extent: the median distance of root entities from the origin (terrains and backdrops would dominate a max).
    const dists = ents.filter((e) => !e.parent && !e.tags.includes('backdrop') && !e.tags.includes('sky') && !e.tags.includes('terrain')).map((e) => Math.hypot(e.transform.position[0], e.transform.position[2])).sort((a, b) => a - b);
    const ext = Math.max(18, Math.min(80, dists[Math.floor(dists.length * 0.7)] ?? 30));
    return {
      arch: false,
      cams: [
        { name: 'eye', pos: [sp[0] - dx * 4.5, sp[1] + 2.2, sp[2] - dz * 4.5], target: [sp[0] + dx * 12, sp[1] + 0.6, sp[2] + dz * 12] },
        { name: 'aerial', pos: [ext * 0.75, ext * 0.55, ext * 1.05], target: [0, 0, 0] },
      ],
    };
  });
}

async function main(): Promise<void> {
  mkdirSync(outDir!, { recursive: true });
  const server = await startServer(log);
  const browser: Browser =
    process.env['SHOT_BROWSER'] === 'firefox'
      ? await firefox.launch({ executablePath: findFirefox(), firefoxUserPrefs: { ...FIREFOX_PREFS } })
      : await chromium.launch({ executablePath: findChrome(), args: process.env['GEN_GPU'] === 'intel' ? [...INTEL_ARGS] : [...CHROME_ARGS] });
  try {
    for (const [name, prompt] of prompts) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const choice = BACKEND === 'offline' ? 'offline' : BACKEND;
      const prefs = BACKEND === 'offline' ? { mode: 'offline' } : { mode: 'local', backend: BACKEND };
      await ctx.addInitScript(`${SKIP_TOUR}; try { localStorage.setItem('aether.onboarding.v1', JSON.stringify({ choice: '${choice}', at: 1 })); localStorage.setItem('aether.ai.prefs.v1', JSON.stringify(${JSON.stringify(prefs)})); } catch {}`);
      if (process.env['SHOT_BACKEND']) await ctx.addInitScript(`try { localStorage.setItem('aether.studio.settings.v1', JSON.stringify({ backend: ${JSON.stringify(process.env['SHOT_BACKEND'])} })); } catch {}`);
      await ctx.addInitScript({ content: 'globalThis.__name = (f) => f;' });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => log(`  pageerror: ${e.message.slice(0, 200)}`));
      page.on('console', (m) => {
        if (m.type() === 'error' && !/GPU stall|GL Driver|ReadPixels/.test(m.text())) log(`  console.error: ${m.text().slice(0, 200)}`);
      });
      log(`${name}: "${prompt}"`);
      const started = performance.now();
      await build(page, server.url, prompt);
      const info = await page.evaluate(() => {
        const a = window.__aether!;
        const st = a.store.getState();
        const last = st.chat[st.chat.length - 1] as unknown as { events?: Array<{ text?: string; message?: string }> } | undefined;
        return { name: a.history.current.name, entities: Object.keys(a.history.current.entities).length, backend: document.body.innerText.match(/WebGPU|WebGL2/)?.[0] ?? '?', reply: (last?.events ?? []).map((e) => e.text ?? e.message ?? '').join(' ').slice(0, 400) };
      });
      log(`  built "${info.name}" (${info.entities} entities, ${((performance.now() - started) / 1000).toFixed(0)} s, ${info.backend}): ${info.reply}`);
      writeFileSync(join(outDir!, `${name}.world.json`), await page.evaluate(() => JSON.stringify(window.__aether!.history.current)));
      await page.evaluate(() => {
        window.__aether?.studio.playtest.cancel();
        window.__aether?.studio.playtest.stopReplay();
      });
      await page.waitForTimeout(1000);
      if (process.env['GEN_EDITOR'] !== '0') await capture(page, join(outDir!, `${name}-editor.png`));
      const { arch, cams } = await cameras(page);
      // `GEN_CAMS='[{"name":"close","pos":[x,y,z],"target":[x,y,z]}]'` adds explicit views (every prompt).
      if (process.env['GEN_CAMS']) cams.push(...(JSON.parse(process.env['GEN_CAMS']) as Cam[]));
      if (process.env['GEN_ONLY']) cams.splice(0, cams.length, ...cams.filter((c) => (process.env['GEN_ONLY'] ?? '').split(',').includes(c.name)));
      if (arch) {
        // Storeys stacked, walls up, before the first building view (the doll's-house view after a build has them apart).
        await page.evaluate(() => window.__aether?.store.getState().setArch({ walls: 'up', levelMode: 'stacked', xray: false, section: null, plan: false } as never));
        await page.waitForTimeout(3500);
      }
      for (const cam of cams) {
        if (arch) await page.evaluate(() => window.__aether?.store.getState().setArch({ walls: 'up', levelMode: 'stacked', xray: false, section: null, plan: false } as never));
        await setCam(page, cam);
        await capture(page, join(outDir!, `${name}-${cam.name}.png`));
      }
      if (!arch && process.env['GEN_PLAY'] !== '0') {
        await page.evaluate(() => void window.__aether?.studio.togglePlay());
        await page.waitForFunction(() => window.__aether?.store.getState().mode === 'play', null, { timeout: 60_000 }).catch(() => undefined);
        const card = page.locator('.title-card');
        if (await card.count()) await card.locator('.title-card__start').dispatchEvent('click').catch(() => undefined);
        await page.waitForTimeout(1500);
        await page.keyboard.down('w');
        await page.waitForTimeout(1800);
        await page.keyboard.up('w');
        await page.waitForTimeout(700);
        await capture(page, join(outDir!, `${name}-play.png`));
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
    await server.stop();
  }
}

main().catch((e: unknown) => {
  log(`GENLOOK FAILED: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  process.exitCode = 1;
});
