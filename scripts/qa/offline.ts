import { readFileSync, writeFileSync } from 'node:fs';
import { GpuRoom } from '../lib/gpu-room';
const [zip, out] = process.argv.slice(2);
const gpu = await GpuRoom.open({});
const page = (gpu as unknown as { page: import('playwright').Page }).page;
let blocked = 0;
await page.context().route(/huggingface\.co|hf\.co|\/__hub\//, (r) => { blocked++; void r.abort(); });
try {
  const b64 = readFileSync(zip!).toString('base64');
  const r = await gpu.evaluate(async (b) => {
    const bytes = Uint8Array.from(atob(b as string), (c) => c.charCodeAt(0));
    const st = window.__aether!.studio;
    const err = await st.assets.importPackage(new File([bytes], 'kitchen.aether.zip'));
    await window.__aether?.simulation?.whenSynced();
    const ents = Object.values(st.history.current.entities);
    return { err, total: ents.length, hubModels: ents.filter((e) => e.shape.kind === 'asset' && e.shape.id.startsWith('user-')).map((e) => e.shape.kind === 'asset' ? e.shape.id : '') };
  }, b64);
  console.log('IMPORT', JSON.stringify(r), 'hub requests blocked:', blocked);
  await page.waitForTimeout(3000);
  writeFileSync(`${out}/offline-hub-close.png`, await gpu.still({ position: [2.7, 1.5, 3.4], target: [2.7, 0.7, 2.3], fov: 55 }, { width: 1000, height: 667 }, 'studio'));
  console.log('still done; blocked', blocked);
} finally { await gpu.close(); }
