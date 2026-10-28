import { mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createWorld } from '@aether/core';
import { GpuRoom } from '../lib/gpu-room';
const [outDir, ...ids] = process.argv.slice(2);
mkdirSync(outDir!, { recursive: true });
const O = `${process.env['HOME']}/.local/share/aether/simready-bulk/out`;
const gpu = await GpuRoom.open({});
try {
  await gpu.load(createWorld({ name: 'lineup' }));
  const cols = 6;
  const res = [] as unknown[];
  let i = 0;
  for (const id of ids) {
    const full = `simready-${id}`;
    let dir = join(O, full, 'lib', 's');
    let f: string | undefined;
    try { f = readdirSync(dir).find((n) => /\.[0-9a-f]{8}\.glb$/.test(n) && !/lite|lod1/.test(n)); } catch { dir = `assets/lib/s`; f = readdirSync(dir).find((n) => n.startsWith(`${full}.`) && /\.[0-9a-f]{8}\.glb$/.test(n) && !/lite|lod1/.test(n)); }
    if (!f) { console.log('missing', id); continue; }
    const b64 = readFileSync(join(dir, f)).toString('base64');
    const x = (i % cols) * 3.2, z = Math.floor(i / cols) * -3.5;
    i++;
    const r = await gpu.evaluate(async ([name, b64, x, z]) => {
      const bytes = Uint8Array.from(atob(b64 as string), (c) => c.charCodeAt(0));
      const st = window.__aether!.studio;
      const before = new Set(Object.keys(st.history.current.entities));
      await st.assets.importFiles([new File([bytes], `${name}.glb`, { type: 'model/gltf-binary' })], null);
      const added = Object.keys(st.history.current.entities).filter((k) => !before.has(k));
      for (const e of added) st.commitUser([{ op: 'update', id: e, set: { transform: { position: [x, 0, z] } } }] as never, 'move');
      return added.join(',');
    }, [id, b64, x, z] as const);
    res.push(`${id}:${r}`);
  }
  console.log(JSON.stringify(res));
  await gpu.evaluate(async () => { await window.__aether?.simulation?.whenSynced(); }, null);
  const rows = Math.ceil(i / cols);
  const cx = ((Math.min(cols, i) - 1) * 3.2) / 2;
  for (const [n, pos, tgt, fov] of [
    ['front', [cx, 3.2, 8.5], [cx, 0.6, -((rows - 1) * 3.5) / 2], 60],
    ['top', [cx, 14, -((rows - 1) * 3.5) / 2 + 3], [cx, 0, -((rows - 1) * 3.5) / 2], 50],
  ] as Array<[string, [number, number, number], [number, number, number], number]>)
    writeFileSync(join(outDir!, `lineup-${n}.png`), await gpu.still({ position: pos, target: tgt, fov }, { width: 1400, height: 900 }, 'studio'));
} finally { await gpu.close(); }
