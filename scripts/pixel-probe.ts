/** Debug: which entity is under a pixel of the spawn view. `npx tsx scripts/pixel-probe.ts <slug> <px,py>… ` (640x360 image coordinates). */
import { chromium } from 'playwright';
import { CHROME_ARGS, SKIP_FIRST_RUN, findChrome, startServer } from '../tests/e2e/support/env';
const [slug = 'photo-vaulted-bedroom', ...pts] = process.argv.slice(2);
const server = await startServer((l) => void process.stdout.write(`${l}\n`));
const intel = process.env['GEN_GPU'] === 'intel';
const browser = await chromium.launch({ executablePath: findChrome(), args: intel ? ['--enable-unsafe-webgpu', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu'] : [...CHROME_ARGS], headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(SKIP_FIRST_RUN);
  await ctx.addInitScript('globalThis.__name = (f) => f;');
  const page = await ctx.newPage();
  await page.goto(`${server.url}/?debug=1#/new/${slug}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { const a = window.__aether; return !!a?.simulation && a.store.getState().loading === null && Object.keys(a.history.current.entities).length > 0; }, null, { timeout: 180000, polling: 250 });
  await page.waitForFunction(() => window.__aether?.simulation?.renderer.lightVolumeReady === true, null, { timeout: 300000, polling: 500 });
  await page.waitForTimeout(3000);
  const out = await page.evaluate(async (points) => {
    const a = window.__aether!;
    const r = a.simulation!.renderer as unknown as { setCameraPose(...n: number[]): void; raycastEntity(x: number, y: number): { id: string; point?: number[] } | null };
    const p = a.history.current.player as { spawn: number[]; yaw?: number };
    const yaw = ((p.yaw ?? 0) * Math.PI) / 180;
    const pos = [p.spawn[0]!, p.spawn[1]! + 1.6, p.spawn[2]!];
    const t = [pos[0]! - Math.sin(yaw) * 4, pos[1]! - 0.25, pos[2]! - Math.cos(yaw) * 4];
    const dx = t[0]! - pos[0]!, dy = t[1]! - pos[1]!, dz = t[2]! - pos[2]!;
    r.setCameraPose(pos[0]!, pos[1]!, pos[2]!, Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
    await new Promise((res) => setTimeout(res, 1500));
    const res: string[] = [];
    for (const s of points) {
      const [px, py] = s.split(',').map(Number);
      const h = r.raycastEntity((2 * px!) / 640 - 1, 1 - (2 * py!) / 360);
      const e = h ? (a.history.current.entities as Record<string, { arch?: unknown; shape: unknown; material?: unknown; name?: string }>)[h.id] : null;
      res.push(`${s} -> ${h?.id} ${JSON.stringify(h?.point)} ${JSON.stringify(e?.arch)?.slice(0, 120)} ${JSON.stringify(e?.shape)?.slice(0, 300)} ${JSON.stringify(e?.material)?.slice(0, 200)}`);
    }
    return res;
  }, pts);
  process.stdout.write(`${out.join('\n')}\n`);
} finally { await browser.close(); await server.stop(); }
