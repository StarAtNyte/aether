/**
 * Where the frame cost of a world comes from: triangles, draws, shadow casters and texture memory grouped by
 * entity name, material and geometry. Run: `npm run build && GEN_GPU=intel npx tsx tests/e2e/scene-breakdown.e2e.ts [--world=casa-patio]`.
 */
import { chromium } from 'playwright';
import { CHROME_ARGS, SKIP_FIRST_RUN, findChrome, startServer } from './support/env';

const world = process.argv.find((a) => a.startsWith('--world='))?.slice(8) ?? 'casa-patio';
const srv = await startServer();
const browser = await chromium.launch({ executablePath: findChrome(), args: CHROME_ARGS, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.addInitScript(SKIP_FIRST_RUN);
  await page.goto(`${srv.url}/?debug=1#/new/${world}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const a = window.__aether;
    return !!a?.simulation && a.store.getState().loading === null && Object.keys(a.history.current.entities).length > 0;
  }, null, { timeout: 120_000, polling: 250 });
  await page.waitForTimeout(8000);
  const out = await page.evaluate(() => {
    const r = (window as any).__aether.simulation.renderer;
    const rows = new Map<string, any>();
    const geoms = new Map<string, { n: number; tris: number; name: string }>();
    const mats = new Set<any>();
    let total = { meshes: 0, tris: 0, inst: 0, casters: 0, casterTris: 0, drawsVisible: 0, skinned: 0 };
    r.scene.traverse((o: any) => {
      if (!o.isMesh) return;
      const g = o.geometry;
      const idx = g.index ? g.index.count : g.attributes.position.count;
      const tris = (idx / 3) * (o.isInstancedMesh ? o.count : 1);
      let p = o; let top = o.name || '?';
      while (p.parent && p.parent !== r.scene) { p = p.parent; if (p.name) top = p.name; }
      const key = top.replace(/[-_ ]?\d+$/, '').slice(0, 40);
      const mat = Array.isArray(o.material) ? o.material[0] : o.material;
      mats.add(mat);
      const row = rows.get(key) ?? { meshes: 0, tris: 0, cast: 0, inst: 0, visible: 0 };
      row.meshes++; row.tris += tris; if (o.castShadow) row.cast++; if (o.isInstancedMesh) row.inst++; if (o.visible) row.visible++;
      rows.set(key, row);
      total.meshes++; total.tris += tris; if (o.isInstancedMesh) total.inst++; if (o.isSkinnedMesh) total.skinned++;
      if (o.castShadow) { total.casters++; total.casterTris += tris; }
      if (o.visible) total.drawsVisible++;
      const gk = g.uuid; const e = geoms.get(gk) ?? { n: 0, tris: tris / (o.isInstancedMesh ? o.count : 1), name: key };
      e.n++; geoms.set(gk, e);
    });
    const dup = [...geoms.values()].filter((g) => g.n > 1).sort((a, b) => b.n * b.tris - a.n * a.tris).slice(0, 8);
    const sharedMeshes = [...geoms.values()].reduce((s, g) => s + (g.n > 1 ? g.n : 0), 0);
    const mkeys = new Map<string, number>();
    for (const m of mats) { const k = `${m.type}|${m.map?.uuid ?? ''}|${m.color?.getHex?.() ?? ''}|${m.roughness ?? ''}|${m.metalness ?? ''}`; mkeys.set(k, (mkeys.get(k) ?? 0) + 1); }
    const texs = new Map<string, { w: number; h: number; fmt: any; compressed: boolean; mip: boolean }>();
    for (const m of mats) for (const k of Object.keys(m)) { const t = m[k]; if (t?.isTexture && t.image) texs.set(t.uuid, { w: t.image.width ?? 0, h: t.image.height ?? 0, fmt: t.format, compressed: !!t.isCompressedTexture, mip: t.generateMipmaps }); }
    const big = [...texs.values()].filter((t) => t.w * t.h >= 2048 * 2048).length;
    const uncompressed = [...texs.values()].filter((t) => !t.compressed).length;
    return {
      total, materials: mats.size, distinctMatKeys: mkeys.size, geomShared: sharedMeshes, uniqueGeoms: geoms.size,
      textures: { n: texs.size, big2k: big, uncompressed },
      top: [...rows.entries()].sort((a, b) => b[1].tris - a[1].tris).slice(0, 14),
      dup, stats: r.stats(),
    };
  });
  console.log(JSON.stringify(out, null, 1));
} finally {
  await browser.close();
  await srv.stop();
}
