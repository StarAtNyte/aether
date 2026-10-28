import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createWorld, type WorldDoc } from '@aether/core';
import { GpuRoom } from '../lib/gpu-room';
const [dir, outDir] = process.argv.slice(2);
mkdirSync(outDir!, { recursive: true });
const world = createWorld(JSON.parse(readFileSync(join(dir!, 'kitchen.json'), 'utf8'))) as WorldDoc;
const gpu = await GpuRoom.open({});
const page = (gpu as unknown as { page: import('playwright').Page }).page;
const dump = (s: string): void => console.log(s);
try {
  await gpu.load(world);
  const added = await gpu.evaluate(async () => {
    const st = window.__aether!.studio;
    const out: unknown[] = [];
    const items: Array<[string, [number, number, number], number]> = [
      ['simready-kitchenware-kettle-a01', [2.1, 0.85, 2.25], 0],
      ['simready-kitchenware-kettle-e01', [3.0, 0.85, 2.3], 0],
      ['simready-warehouse-chair-office-amf-black-a01', [3.7, 0, 3.0], 0],
    ];
    for (const [id, pos, yaw] of items) {
      const r = await st.assets.importHubModel(id);
      if (!r.ok) { out.push({ id, ok: false, msg: r.message }); continue; }
      const ent = await st.assets.place(r.meta.id, null);
      if (ent) st.commitUser([{ op: 'update', id: ent, set: { transform: { position: pos, rotation: [0, yaw, 0] } } }] as never, `Move ${id}`);
      out.push({ id, ok: true, asset: r.meta.id, credit: r.meta.credit, origin: (r.meta as { origin?: string }).origin, licence: r.licence, ent });
    }
    await window.__aether?.simulation?.whenSynced();
    return out;
  }, null);
  dump('HUBADD ' + JSON.stringify(added));
  await page.waitForTimeout(3000);
  for (const [n, position, target, fov] of [
    ['hub-close', [2.7, 1.5, 3.4], [2.7, 0.7, 2.3], 55],
    ['hub-chair', [3.0, 1.4, 4.0], [3.7, 0.5, 3.0], 55],
  ] as Array<[string, [number, number, number], [number, number, number], number]>) writeFileSync(join(outDir!, `${n}.png`), await gpu.still({ position, target, fov }, { width: 1000, height: 667 }, 'studio'));
  // credits dialog + package
  const credits = await gpu.evaluate(async () => {
    window.__aether!.studio.assets.setCreditsOpen(true);
    await new Promise((r) => setTimeout(r, 800));
    const t = document.querySelector('[role="dialog"]')?.textContent ?? '';
    window.__aether!.studio.assets.setCreditsOpen(false);
    return t.slice(0, 900);
  }, null);
  dump('CREDITS_DIALOG ' + credits);
  const pkg = await gpu.evaluate(async () => {
    const p = await window.__aether!.studio.assets.buildPackage();
    let bin = ''; for (let i = 0; i < p.bytes.length; i += 0x8000) bin += String.fromCharCode(...p.bytes.subarray(i, i + 0x8000));
    return { name: p.name, b64: btoa(bin) };
  }, null);
  writeFileSync(join(outDir!, 'kitchen-hub.package.zip'), Buffer.from(pkg.b64, 'base64'));
  dump('PACKAGE ' + pkg.name);
} finally { await gpu.close(); }
