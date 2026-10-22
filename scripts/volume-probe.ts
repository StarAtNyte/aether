/** Debug: the light volume's sky visibility over a room's plan at eye height, and the building's windows. `npx tsx scripts/volume-probe.ts <slug>` (GEN_GPU=intel). */
import { chromium } from 'playwright';
import { CHROME_ARGS, SKIP_FIRST_RUN, findChrome, startServer } from '../tests/e2e/support/env';
const slug = process.argv[2] ?? 'photo-vaulted-bedroom';
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
  const out = await page.evaluate(() => {
    const a = window.__aether!;
    const w = a.history.current;
    const ents = Object.values(w.entities) as Array<{ id: string; arch?: { role: string; name?: string }; shape: { kind: string; generator?: string; params?: Record<string, unknown> }; transform: { position: number[] } }>;
    const wins = ents.filter((e) => ['window', 'door', 'opening'].includes(e.arch?.role ?? '')).map((e) => `${e.arch?.role} ${e.shape.generator} at ${e.transform.position.map((x) => x.toFixed(2)).join(',')} ${JSON.stringify(e.shape.params).slice(0, 140)}`);
    const r = a.simulation!.renderer as unknown as { lightVolumeAt(x: number, y: number, z: number): { vis: number; bounce: number } | null; eyeExposure: { rooms: Array<{ box: { minX: number; maxX: number; minZ: number; maxZ: number } }> } };
    const b = r.eyeExposure.rooms[0]?.box;
    const rows: string[] = [];
    if (b) for (let z = b.minZ; z <= b.maxZ; z += 0.4) { let row = ''; for (let x = b.minX; x <= b.maxX; x += 0.4) { const s = r.lightVolumeAt(x, 1.5, z); row += s ? Math.min(9, Math.floor(s.vis * 40)).toString() : '.'; } rows.push(row); }
    return { box: b, wins, rows };
  });
  process.stdout.write(`${JSON.stringify(out.box)}\n${out.wins.join('\n')}\n${out.rows.join('\n')}\n`);
} finally { await browser.close(); await server.stop(); }
