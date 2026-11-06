/**
 * Checks that a world's geometry draws complete in the standalone player: every mesh the camera draws has its vertex
 * attributes in three's program state, and no merge is shown before its geometry arrives.
 *
 * A building merge drawn once while its geometry was still on the way (the first-use pass draws one object of each program
 * with frustum culling off) left three a program state without attributes for it; once the geometry arrived the merge
 * drew nothing, and Casa del Patio showed sky through its rooms (walls, ceilings and roof missing). This probe renders
 * the opening view once more with culling off and counts render objects whose mesh has positions but whose program
 * reads no attribute (`attributeless`), and visible merges without geometry (`visibleEmpty`). Both must be 0.
 *
 *   STATIC_DIR=<dist> GEN_GPU=intel npx tsx scripts/complete-geometry-probe.ts --out=<dir> [--live] [--cooked] [slug ...]
 *
 * Without --live or --cooked it checks both. Writes `<slug>-<live|cooked>.png` and `report.json`; exits 1 on a failure.
 * Run it in a capped scope, one browser at a time.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import * as env from '../tests/e2e/support/env';

const args = process.argv.slice(2);
const out = resolve(args.find((a) => a.startsWith('--out='))?.slice(6) ?? 'probe-out/complete-geometry');
const DEFAULT = ['casa-patio', 'skyline-penthouse', 'villa-pool', 'apartment', 'dusk-lake-house', 'cafe-interior', 'office-floor', 'photo-hotel-bedroom', 'lisbon-hills', 'kestrel-outpost', 'cliff-sanctuary'];
const slugs = args.filter((a) => !a.startsWith('--'));
const modes = [...(args.includes('--live') || !args.includes('--cooked') ? ['live'] : []), ...(args.includes('--cooked') || !args.includes('--live') ? ['cooked'] : [])];
mkdirSync(out, { recursive: true });

interface Check { merged: number; visibleEmpty: number; attributeless: number; examples: string[]; drawn: number }

/** Runs in the page: one render of the scene with frustum culling off, watching the render objects three meets. */
const CHECK = `(() => {
  const r = window.__aetherPlayer.simulation.renderer;
  const R = r.renderer;
  let merged = 0, visibleEmpty = 0, drawn = 0;
  const culled = [];
  r.scene.traverse((o) => {
    if (o.isMesh && o.name === 'aether:merged') { merged++; if (o.visible && !o.geometry.getAttribute('position')) visibleEmpty++; }
    if ((o.isMesh || o.isPoints || o.isLine) && o.frustumCulled) { culled.push(o); o.frustumCulled = false; }
  });
  const bad = [];
  const nodes = R._nodes;
  const own = Object.prototype.hasOwnProperty.call(nodes, 'needsRefresh');
  const previous = nodes.needsRefresh;
  nodes.needsRefresh = function (ro) {
    drawn++;
    const g = ro.object.geometry;
    if (g && g.getAttribute && g.getAttribute('position') && !ro.object.isQuadMesh && ro.getAttributes().length === 0) bad.push(ro.object.name || ro.object.type);
    return previous.call(this, ro);
  };
  try { r.preparation.synchronous(() => r.programs.synchronous(() => R.render(r.scene, r.perspective))); }
  finally { if (own) nodes.needsRefresh = previous; else delete nodes.needsRefresh; for (const o of culled) o.frustumCulled = true; }
  return { merged, visibleEmpty, attributeless: bad.length, examples: [...new Set(bad)].slice(0, 8), drawn };
})()`;

const report: Record<string, Record<string, unknown>> = {};
let failed = 0;
const server = await env.startServer(() => undefined);
try {
  for (const slug of slugs.length > 0 ? slugs : DEFAULT) {
    for (const mode of modes) {
      const browser = await chromium.launch({ executablePath: env.findChrome(), args: [...env.CHROME_ARGS], headless: env.HEADLESS });
      try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
        if (process.env['GEN_GPU'] === 'intel') await page.addInitScript({ content: 'delete Navigator.prototype.gpu; try { delete navigator.gpu; } catch {}' });
        await page.goto(`${server.url}/play.html#t=${slug}${mode === 'live' ? '&cook=0' : ''}`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => (window as unknown as { __aetherCook?: { ready: boolean } }).__aetherCook?.ready === true, null, { timeout: 300_000, polling: 250 });
        await page.waitForFunction(() => (window as unknown as { __aetherPlayer?: { simulation: { renderer: { processingStage: unknown } } | null } }).__aetherPlayer?.simulation?.renderer.processingStage === null, null, { timeout: 180_000, polling: 250 }).catch(() => undefined);
        await page.waitForTimeout(3000);
        const shot = join(out, `${slug}-${mode}.png`);
        await page.screenshot({ path: shot });
        const c = (await page.evaluate(CHECK)) as Check;
        // A cooked load that fell back to live (a stale or missing package) still checks the page, but says so.
        const cook = await page.evaluate(() => { const h = (window as unknown as { __aetherCook?: { path: string; reason: string | null } }).__aetherCook; return h ? { path: h.path, reason: h.reason } : null; });
        const ok = c.attributeless === 0 && c.visibleEmpty === 0;
        if (!ok) failed++;
        (report[slug] ??= {})[mode] = { ok, ...c, cook, shot };
        process.stdout.write(`${ok ? 'ok  ' : 'FAIL'} ${slug} ${mode}${cook && cook.path !== (mode === 'live' ? 'live' : 'cooked') ? ` (loaded ${cook.path}: ${cook.reason ?? ''})` : ''}: ${c.drawn} render objects, ${c.attributeless} without attributes${c.examples.length ? ` (${c.examples.join(', ')})` : ''}, ${c.merged} merges, ${c.visibleEmpty} shown empty\n`);
      } catch (e) {
        failed++;
        (report[slug] ??= {})[mode] = { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : String(e) };
        process.stdout.write(`FAIL ${slug} ${mode}: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}\n`);
      } finally {
        await browser.close();
      }
      writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
    }
  }
} finally {
  await server.stop();
}
process.exit(failed > 0 ? 1 : 0);
