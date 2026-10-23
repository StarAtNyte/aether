/**
 * Stills of procedural furniture pieces, one image per piece, for judging the craft of a generator.
 *
 *   GEN_GPU=intel npx tsx scripts/furn-sheet.ts <outDir> <kind[:{"param":"value"}]>... [--width=800] [--yaw=35] [--dist=2.2]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createWorld, type Json, type WorldDoc } from '@aether/core';
import { furnitureByKind, furnitureSize } from '@aether/arch';
import { GpuRoom } from './lib/gpu-room';

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith('--'));
const [outArg, ...specs] = args.filter((a) => !a.startsWith('--'));
if (!outArg || specs.length === 0) throw new Error('usage: furn-sheet <outDir> <kind[:json]>... [--width=N] [--yaw=deg] [--dist=m]');
const flag = (k: string, d: number): number => Number(flags.find((f) => f.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const out = resolve(outArg);
mkdirSync(out, { recursive: true });
const width = flag('width', 800);
const yaw = (flag('yaw', 35) * Math.PI) / 180;
const gpu = await GpuRoom.open({});
try {
  for (const spec of specs) {
    const at = spec.indexOf(':');
    const kind = at < 0 ? spec : spec.slice(0, at);
    const params = (at < 0 ? {} : JSON.parse(spec.slice(at + 1))) as Record<string, Json>;
    const def = furnitureByKind(kind);
    if (!def) throw new Error(`unknown kind ${kind}`);
    const size = furnitureSize(def, params);
    const wall = def.againstWall || def.mount === 'wall';
    const entities: Record<string, unknown> = {
      floor: { id: 'floor', shape: { kind: 'primitive', primitive: 'box', size: [8, 0.1, 8] }, transform: { position: [0, -0.05, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, material: { finish: 'oak' }, physics: { body: 'static' } },
      piece: { id: 'piece', shape: { kind: 'procedural', generator: def.id, params, seed: 1 }, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, physics: { body: 'static' } },
    };
    if (wall) entities['wall'] = { id: 'wall', shape: { kind: 'primitive', primitive: 'box', size: [8, 3, 0.1] }, transform: { position: [0, 1.5, -size[2] / 2 - 0.05], rotation: [0, 0, 0], scale: [1, 1, 1] }, material: { finish: 'plaster', color: '#d8d2c6' }, physics: { body: 'static' } };
    const world = createWorld({ entities, environment: { timeOfDay: 14 } } as never) as WorldDoc;
    await gpu.load(world);
    const r = Math.max(size[0], size[2], size[1]) * flag('dist', 1.9);
    const png = await gpu.still({ position: [Math.sin(yaw) * r, size[1] * 0.75 + 0.2, Math.cos(yaw) * r], target: [0, size[1] * 0.45, 0], fov: 38 }, { width, height: Math.round(width * 0.75) }, 'studio');
    const name = `${kind}${at < 0 ? '' : '-' + Buffer.from(spec.slice(at + 1)).toString('hex').slice(0, 6)}.png`;
    writeFileSync(join(out, name), png);
    process.stdout.write(`wrote ${join(out, name)}\n`);
  }
} finally {
  await gpu.close();
}
