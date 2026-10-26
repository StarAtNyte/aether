/**
 * Lighting at walking eye height (1.65 m): stills at the spawn and at the centre of every room of a building, four
 * headings each, walls up (the view of someone inside), with luminance statistics per still: mean, p5, p95, share
 * of crushed texels (< 8 of 255) and clipped texels (> 247). The numbers are advisory (the picture is what is judged);
 * the run fails only when a still is blank. `--out=dir` saves the PNGs.
 *
 * Run: `npm run build && [GEN_GPU=intel] npx tsx tests/e2e/eye-light.e2e.ts [--worlds=a,b] [--wait=ms] [--out=dir] [--size=960x540]`
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { CHROME_ARGS, SKIP_FIRST_RUN, findChrome, startServer } from './support/env';
import { decodePng } from './support/png';

const ARGS = process.argv.slice(2);
const arg = (n: string): string | undefined => ARGS.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const WORLDS = (arg('worlds') ?? 'photo-hotel-bedroom,photo-twin-room,photo-vaulted-bedroom,skyline-penthouse,casa-patio,highland-trail').split(',').filter(Boolean);
const OUT = arg('out');
const [W, H] = (arg('size') ?? '960x540').split('x').map(Number) as [number, number];
const EYE = 1.65;
const WAIT = Number(arg('wait') ?? 2500);
const t0 = performance.now();
const log = (l: string): void => void process.stdout.write(`[${((performance.now() - t0) / 1000).toFixed(1).padStart(6)}s] ${l}\n`);

interface R {
  setCameraPose(x: number, y: number, z: number, yaw: number, pitch: number): void;
  requestRender(): void;
  eyeExposure: { ev: number; trim: number; rooms: Array<{ id: string; name: string | null; box: { minX: number; maxX: number; minZ: number; maxZ: number; floorY: number } }> };
  atRest: boolean;
}
interface Row { world: string; spot: string; heading: number; ev: number; mean: number; p5: number; p95: number; crushed: number; clipped: number }

async function stats(page: Page): Promise<Omit<Row, 'world' | 'spot' | 'heading' | 'ev'> & { png: Buffer }> {
  const box = await page.locator('.viewport__host canvas').first().boundingBox();
  const png = await page.screenshot(box ? { clip: { x: box.x, y: box.y, width: box.width, height: box.height } } : {});
  const img = decodePng(png);
  const lum: number[] = [];
  for (let i = 0; i < img.data.length; i += 4 * 7) lum.push(0.2126 * (img.data[i] as number) + 0.7152 * (img.data[i + 1] as number) + 0.0722 * (img.data[i + 2] as number));
  lum.sort((a, b) => a - b);
  const q = (p: number): number => lum[Math.min(lum.length - 1, Math.floor(p * lum.length))] as number;
  return { png, mean: lum.reduce((s, v) => s + v, 0) / lum.length, p5: q(0.05), p95: q(0.95), crushed: lum.filter((v) => v < 8).length / lum.length, clipped: lum.filter((v) => v > 247).length / lum.length };
}

async function main(): Promise<void> {
  const server = await startServer(log);
  const browser = await chromium.launch({ executablePath: findChrome(), args: [...CHROME_ARGS] });
  const rows: Row[] = [];
  let blank = 0;
  try {
    if (OUT) mkdirSync(OUT, { recursive: true });
    for (const slug of WORLDS) {
      const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
      await ctx.addInitScript({ content: SKIP_FIRST_RUN });
      await ctx.addInitScript({ content: 'globalThis.__name = (f) => f;' });
      try {
        const page = await ctx.newPage();
        await page.goto(`${server.url}/?debug=1#/new/${slug}`, { waitUntil: 'commit' });
        await page.waitForFunction(() => { const a = window.__aether; return !!a && a.simulation !== null && a.store.getState().loading === null && !a.store.getState().agentBusy && Object.keys(a.history.current.entities).length > 0; }, null, { timeout: 180_000, polling: 250 });
        await page.evaluate(async () => window.__aether?.simulation?.whenSynced());
        await page.evaluate(() => { const st = window.__aether?.store.getState(); st?.setPanel('left', false); st?.setPanel('right', false); st?.setArch({ walls: 'up' }); });
        await page.waitForTimeout(4000);
        const spots = await page.evaluate((eye) => {
          const w = window.__aether!.history.current;
          const r = window.__aether!.simulation!.renderer as unknown as R;
          const sp = (w.player as { spawn?: number[]; yaw?: number } | undefined) ?? {};
          const out: Array<{ spot: string; p: [number, number, number]; yaw: number }> = [];
          const s = sp.spawn ?? [0, 0, 0];
          out.push({ spot: 'spawn', p: [s[0] as number, (s[1] as number) + eye, s[2] as number], yaw: ((sp.yaw ?? 0) * Math.PI) / 180 });
          for (const room of r.eyeExposure.rooms.slice(0, 6)) {
            const b = room.box;
            out.push({ spot: room.name ?? room.id, p: [(b.minX + b.maxX) / 2, b.floorY + eye, (b.minZ + b.maxZ) / 2], yaw: 0 });
          }
          return out;
        }, EYE);
        for (const sp of spots) {
          for (let k = 0; k < 4; k++) {
            const yaw = sp.yaw + (k * Math.PI) / 2;
            await page.evaluate(([x, y, z, ya]) => { const r = window.__aether!.simulation!.renderer as unknown as R; r.setCameraPose(x as number, y as number, z as number, ya as number, -0.03); r.requestRender(); }, [...sp.p, yaw]);
            await page.waitForTimeout(WAIT);
            const ev = await page.evaluate(() => { const e = (window.__aether!.simulation!.renderer as unknown as R).eyeExposure; return e.ev + e.trim; });
            const s = await stats(page);
            const row: Row = { world: slug, spot: sp.spot, heading: k * 90, ev: Math.round(ev * 100) / 100, mean: Math.round(s.mean), p5: Math.round(s.p5), p95: Math.round(s.p95), crushed: Math.round(s.crushed * 100) / 100, clipped: Math.round(s.clipped * 100) / 100 };
            rows.push(row);
            if (s.p95 < 8 || s.mean > 252) blank++;
            log(`${slug} ${sp.spot} @${k * 90}: ev ${row.ev} mean ${row.mean} p5 ${row.p5} p95 ${row.p95} crushed ${row.crushed} clipped ${row.clipped}`);
            if (OUT) writeFileSync(join(OUT, `${slug}-${sp.spot.replace(/\W+/g, '_')}-${k * 90}.png`), s.png);
          }
        }
      } catch (e) {
        log(`${slug}: FAILED ${String(e).slice(0, 240)}`);
        blank++;
      } finally {
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    await server.stop();
  }
  if (OUT) writeFileSync(join(OUT, 'eye-light.json'), JSON.stringify(rows, null, 1));
  const dark = rows.filter((r) => r.mean < 45);
  const hot = rows.filter((r) => r.clipped > 0.12);
  log(`## ${rows.length} stills; dark (mean < 45): ${dark.length}; clipped over 12 %: ${hot.length}; blank: ${blank}`);
  if (blank > 0) process.exitCode = 1;
}
main().catch((e: unknown) => { log(`FAILED: ${String(e)}`); process.exitCode = 1; });
