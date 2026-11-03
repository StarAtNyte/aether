/**
 * Close-ups of the people and the common props of a game world, for judging how they look: the Kestrel Outpost template with
 * a line-up of its cast (player, raider, heavy, rusher) standing in the sun north of the relay, and the props of the
 * outpost (containers, crates, sandbags, the relay, boulders, barrels) seen from a few metres. Extra props can be appended
 * with `--props=<json>` (an array of entities) and the camera shots replaced with `--shots=<json>`. Stills are drawn with the studio's photoreal chain.
 *
 *   STATIC_DIR=<built studio> GEN_GPU=intel nice -n 10 npx tsx scripts/look-shots.ts --out=<dir> [--only=name,name]
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createWorld, type WorldDoc } from '@aether/core';
import { GpuRoom, type GpuView } from './lib/gpu-room';

const args = process.argv.slice(2);
const arg = (name: string): string | undefined => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const out = resolve(arg('out') ?? 'probe-out/look-shots');
const only = arg('only')?.split(',');
const file = arg('world') ?? 'apps/studio/public/templates/worlds/kestrel-outpost.json';
const raw = JSON.parse(readFileSync(resolve(file), 'utf8')) as { world?: Record<string, unknown> };
const doc = structuredClone((raw.world ?? raw) as Record<string, unknown>) as { entities: Record<string, Record<string, unknown>>; player?: { character?: unknown } };

/** A standing person (no behaviour) at `x, z`, turned to face +Z (toward the cameras). */
function person(id: string, x: number, z: number, character: unknown, yaw = 180): Record<string, unknown> {
  return { id, name: id, parent: null, castShadow: true, receiveShadow: true, shape: { kind: 'primitive', primitive: 'capsule', size: [0.56, 1.7, 0.56] }, character, transform: { position: [x, 0.85, z], rotation: [0, yaw, 0], scale: [1, 1, 1] }, tags: [] };
}
/** Where the line-up stands: in the late sun that comes through the west pass (the cliffs shade most of the floor). */
const Z = -15.5;
const tpl = (id: string): unknown => doc.entities[id]?.['character'];
const line: Array<[string, unknown]> = [
  ['look-player', doc.player?.character],
  ['look-raider', tpl('raider-e')],
  ['look-heavy', tpl('heavy-e')],
  ['look-rusher', tpl('rusher-e')],
];
line.forEach(([id, c], i) => {
  if (c) doc.entities[id] = person(id, -2.4 + i * 1.6, Z, c);
});
const extra = arg('props');
if (extra) for (const e of JSON.parse(readFileSync(resolve(extra), 'utf8')) as Array<Record<string, unknown>>) doc.entities[e['id'] as string] = e;
const world = createWorld(doc as unknown as WorldDoc) as WorldDoc;

const v = (position: [number, number, number], target: [number, number, number], fov: number): GpuView => ({ position, target, fov });
const shots: Array<[string, GpuView]> = [
  ['cast', v([0, 1.25, Z + 5], [0, 0.95, Z], 34)],
  ['faces', v([-1.2, 1.62, Z + 1.7], [-1.2, 1.5, Z], 38)],
  ['heavy-rusher', v([1.6, 1.5, Z + 2.2], [1.6, 1.15, Z], 40)],
  ['rifle', v([-3.6, 1.45, Z + 1.1], [-2.4, 1.2, Z], 36)],
  ['containers', v([9.5, 2.0, -8.5], [14, 1.2, -15], 52)],
  ['sandbags-relay', v([0.5, 1.9, 7.5], [2.2, 1.0, -1.5], 52)],
  ['crates', v([5.5, 1.5, -12.8], [7.6, 0.6, -17.2], 46)],
  ['boulder-barrels', v([16, 1.8, 1.5], [21, 0.6, -3], 50)],
];
// `--shots=<json>`: an array of [name, position, target, fov] drawn instead of the shots above.
const shotFile = arg('shots');
if (shotFile) {
  shots.length = 0;
  for (const [name, position, target, fov] of JSON.parse(readFileSync(resolve(shotFile), 'utf8')) as Array<[string, [number, number, number], [number, number, number], number]>) shots.push([name, v(position, target, fov)]);
}
await mkdir(out, { recursive: true });
const gpu = await GpuRoom.open({});
try {
  await gpu.load(world);
  const files: string[] = [];
  for (const [name, view] of shots) {
    if (only && !only.includes(name)) continue;
    const png = await gpu.still(view, { width: 960, height: 640 }, 'studio');
    const f = join(out, `${name}.png`);
    await writeFile(f, png);
    files.push(f);
    console.log('wrote', f);
  }
  if (files.length > 1) execFileSync('montage', [...files, '-tile', '2x', '-geometry', '720x480+3+3', join(out, 'sheet.jpg')]);
} finally {
  await gpu.close();
}
process.exit(0);
