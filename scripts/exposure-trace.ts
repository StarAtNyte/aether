/**
 * Eye exposure over a camera path, in a real browser: for each world, the exposure (stops) the renderer settles on at a
 * set of cameras (the spawn and its reverse, steps around the spawn inside the room, a view from outside through the cutaway,
 * the cover camera) and the light volume's reading at each, plus optional stills.
 *
 *   npx tsx scripts/exposure-trace.ts <outDir> <slug>…
 *
 * Environment: `GEN_GPU=intel` (ANGLE on the integrated GPU), `EXP_SHOTS=1` (a small still per camera), `SHOT_W` / `SHOT_H`,
 * `EXP_WALLS=up,cutaway,down` (architectural wall states each camera is read in), `EXP_PRE=<walls>:<camera>` (before the
 * readings: set the walls and put the camera at a named view, then ask for a fresh light bake, as an edit made there would). Writes `<outDir>/trace.json`, prints one JSON line per world.
 * The server, the browser and every page are closed in a `finally`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { CHROME_ARGS, SKIP_FIRST_RUN, findChrome, startServer } from '../tests/e2e/support/env';
import { COVER_CAMERAS } from '../tests/e2e/support/showcase-cameras';

const [outDir, ...slugs] = process.argv.slice(2);
if (!outDir || slugs.length === 0) throw new Error('usage: exposure-trace <outDir> <slug>…');
const log = (l: string): void => void process.stdout.write(`${l}\n`);
const W = Number(process.env['SHOT_W'] ?? 640);
const H = Number(process.env['SHOT_H'] ?? 360);
const SHOTS = process.env['EXP_SHOTS'] === '1';
const SHOT_CAMS = (process.env['EXP_SHOT_CAMS'] ?? '').split(',').filter(Boolean);
const PATH = process.env['EXP_PATH'] === '1';
const WALLS = (process.env['EXP_WALLS'] ?? 'up,cutaway,down').split(',').filter(Boolean);
const INTEL_ARGS: readonly string[] = ['--enable-unsafe-webgpu', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu', '--disable-gpu-vsync', '--disable-frame-rate-limit'];

interface Cam { name: string; pos: [number, number, number]; target: [number, number, number] }

async function open(page: Page, url: string, slug: string): Promise<void> {
  await page.goto(`${url}/?debug=1#/new/${slug}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => {
      const a = window.__aether;
      if (!a || a.simulation === null) return false;
      const st = a.store.getState();
      return st.loading === null && !st.agentBusy && (Object.keys(a.history.current.entities).length > 0 || a.history.current.voxel !== undefined);
    },
    null,
    { timeout: 180_000, polling: 250 },
  );
  await page.evaluate(async () => {
    await window.__aether?.simulation?.whenSynced();
  });
  await page.waitForFunction(() => window.__aether?.simulation?.renderer.animating === false, null, { timeout: 120_000, polling: 500 }).catch(() => log('  (still animating)'));
  await page.evaluate(() => {
    const st = window.__aether?.store.getState();
    st?.setPanel('left', false);
    st?.setPanel('right', false);
    st?.updateSettings({ showNavHint: false });
  });
  await page.waitForTimeout(800);
}

async function waitVolume(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const r = window.__aether?.simulation?.renderer;
    return !!r && !r.lightVolumeBaking && r.lightVolumeReady;
  }, null, { timeout: 300_000, polling: 500 }).catch(() => log('  (no volume)'));
  await page.waitForFunction(() => {
    const r = window.__aether?.simulation?.renderer;
    const st = r?.lightmapStatus.state;
    return !!r && !r.lightVolumeBaking && (st === 'applied' || st === 'failed' || st === 'idle' || st === 'cancelled');
  }, null, { timeout: 300_000, polling: 500 }).catch(() => undefined);
}

async function cameras(page: Page, slug: string): Promise<Cam[]> {
  const spawn = await page.evaluate(() => {
    const p = window.__aether?.history.current.player;
    return p ? { spawn: p.spawn as [number, number, number], yaw: (p.yaw as number | undefined) ?? 0 } : null;
  });
  const out: Cam[] = [];
  if (spawn) {
    const look = (pos: [number, number, number], deg: number): [number, number, number] => {
      const a = (deg * Math.PI) / 180;
      return [pos[0] - Math.sin(a) * 4, pos[1] - 0.25, pos[2] - Math.cos(a) * 4];
    };
    const base: [number, number, number] = [spawn.spawn[0], spawn.spawn[1] + 1.6, spawn.spawn[2]];
    out.push({ name: 'spawn', pos: base, target: look(base, spawn.yaw) });
    out.push({ name: 'back', pos: base, target: look(base, spawn.yaw + 180) });
    for (const [n, dx, dz] of [['east', 1.2, 0], ['west', -1.2, 0], ['north', 0, -1.2], ['south', 0, 1.2]] as const) {
      const pos: [number, number, number] = [base[0] + dx, base[1], base[2] + dz];
      out.push({ name: n, pos, target: look(pos, spawn.yaw) });
    }
    // Outside the room, above it, looking at the spawn through the cut walls.
    const a = (spawn.yaw * Math.PI) / 180;
    const far: [number, number, number] = [base[0] + Math.sin(a) * 9, base[1] + 3, base[2] + Math.cos(a) * 9];
    out.push({ name: 'outside', pos: far, target: base });
    const far2: [number, number, number] = [base[0] - Math.sin(a) * 9, base[1] + 3, base[2] - Math.cos(a) * 9];
    out.push({ name: 'outside2', pos: far2, target: base });
  }
  const cover = COVER_CAMERAS[slug];
  if (cover) out.push({ name: 'cover', pos: [...cover.pos], target: [...cover.target] });
  return out;
}

async function main(): Promise<void> {
  mkdirSync(outDir!, { recursive: true });
  const server = await startServer(log);
  const intel = process.env['GEN_GPU'] === 'intel';
  const browser = await chromium.launch({ executablePath: findChrome(), args: intel ? [...INTEL_ARGS] : [...CHROME_ARGS, '--disable-gpu-vsync', '--disable-frame-rate-limit'], headless: true });
  const results: unknown[] = [];
  try {
    for (const slug of slugs) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
      await ctx.addInitScript(SKIP_FIRST_RUN);
      await ctx.addInitScript('globalThis.__name = (f) => f;');
      try {
        const page = await ctx.newPage();
        page.on('pageerror', (e) => log(`  pageerror: ${e.message.slice(0, 200)}`));
        await open(page, server.url, slug);
        await waitVolume(page);
        const cams = await cameras(page, slug);
        const pre = process.env['EXP_PRE'];
        if (pre) {
          const [w, camName] = pre.split(':');
          const c = cams.find((x) => x.name === camName) ?? cams[0]!;
          await page.evaluate(
            ([walls, p, t]) => {
              const a = window.__aether;
              a?.store.getState().setArch({ walls } as never);
              const dx = t![0]! - p![0]!, dy = t![1]! - p![1]!, dz = t![2]! - p![2]!;
              a?.simulation?.renderer.setCameraPose(p![0]!, p![1]!, p![2]!, Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
            },
            [w, c.pos, c.target] as const,
          );
          await page.waitForTimeout(1500);
          await page.evaluate(() => window.__aether?.studio.commitUser([{ op: 'setEnvironment', set: { lightBake: { quality: 'low' } } }], 'rebake'));
          await page.waitForTimeout(3000);
          await waitVolume(page);
        }
        const rows: Record<string, Record<string, unknown>> = {};
        for (const walls of WALLS) {
          await page.evaluate((w) => window.__aether?.store.getState().setArch({ walls: w } as never), walls);
          for (const c of cams) {
            await page.evaluate(
              ([p, t]) => {
                const dx = t![0]! - p![0]!, dy = t![1]! - p![1]!, dz = t![2]! - p![2]!;
                window.__aether?.simulation?.renderer.setCameraPose(p![0]!, p![1]!, p![2]!, Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
              },
              [c.pos, c.target] as const,
            );
            await page.waitForTimeout(1500);
            const read = await page.evaluate((pos) => {
              const r = window.__aether?.simulation?.renderer as unknown as { lightVolumeAt(x: number, y: number, z: number): Record<string, unknown> | null; eyeExposure?: Record<string, unknown> };
              const s = r.lightVolumeAt(pos[0]!, pos[1]!, pos[2]!);
              return { vis: s?.['vis'], eyeEv: s?.['eyeEv'], pointEv: s?.['ev'], diag: r.eyeExposure ?? null };
            }, c.pos);
            (rows[walls] ??= {})[c.name] = read;
            if (SHOTS && (SHOT_CAMS.length === 0 || SHOT_CAMS.includes(c.name))) {
              const data = await page.evaluate(async ([w, h]) => (await window.__aether?.simulation?.renderer.screenshot({ width: w as number, height: h as number, mime: 'image/png' })) ?? null, [W, H]);
              if (data) writeFileSync(join(outDir!, `${slug}-${walls}-${c.name}.png`), Buffer.from(data.slice('data:image/png;base64,'.length), 'base64'));
            }
          }
        }
        // A walk from the outside view through the room to the spawn, in small steps (the eye adapts as it would on screen).
        const path: Array<Record<string, unknown>> = [];
        const out = cams.find((c) => c.name === 'outside');
        const sp = cams.find((c) => c.name === 'spawn');
        if (PATH && out && sp) {
          await page.evaluate((w) => window.__aether?.store.getState().setArch({ walls: w } as never), WALLS.includes('cutaway') ? 'cutaway' : (WALLS[0] ?? 'up'));
          const N = 18;
          for (let i = 0; i <= N; i++) {
            const f = i / N;
            const pos = [0, 1, 2].map((k) => out.pos[k]! + (sp.pos[k]! - out.pos[k]!) * f) as [number, number, number];
            await page.evaluate(
              ([p, t]) => {
                const dx = t![0]! - p![0]!, dy = t![1]! - p![1]!, dz = t![2]! - p![2]!;
                window.__aether?.simulation?.renderer.setCameraPose(p![0]!, p![1]!, p![2]!, Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
              },
              [pos, sp.target] as const,
            );
            await page.waitForTimeout(450);
            path.push(await page.evaluate(() => {
              const r = window.__aether?.simulation?.renderer as unknown as { eyeExposure?: { ev: number; room: string | null; weight: number; subject: boolean } };
              return { ev: r.eyeExposure?.ev ?? null, room: r.eyeExposure?.room ?? null, w: r.eyeExposure?.weight ?? null, subject: r.eyeExposure?.subject ?? null };
            }));
          }
        }
        const row = { slug, rows, path };
        results.push(row);
        log(JSON.stringify(row));
      } finally {
        await ctx.close();
      }
    }
  } finally {
    writeFileSync(join(outDir!, 'trace.json'), JSON.stringify(results, null, 2));
    await browser.close();
    await server.stop();
  }
}

await main();
