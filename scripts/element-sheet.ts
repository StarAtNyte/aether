/**
 * Stills of the architecture elements (spiral stair, dormer, turret roof, column styles), each beside the state it
 * improves on, for judging them in the studio's renderer.
 *
 *   GEN_GPU=intel npx tsx scripts/element-sheet.ts <outDir> [spiral|spiral-before|dormer|dormer-before|turret|turret-before|columns|columns-before ...] [--width=900]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createWorld, type Json, type WorldDoc } from '@aether/core';
import { dormerPlacement } from '@aether/arch';
import { GpuRoom } from './lib/gpu-room';

interface Scene {
  entities: Record<string, unknown>;
  position: [number, number, number];
  target: [number, number, number];
  fov?: number;
}

const T = (position: [number, number, number], rotationY = 0): unknown => ({ position, rotation: [0, rotationY, 0], scale: [1, 1, 1] });
const gen = (id: string, generator: string, params: Record<string, Json>, position: [number, number, number], rotationY = 0): unknown => ({ id, shape: { kind: 'procedural', generator, params }, transform: T(position, rotationY), physics: { body: 'static' } });
const slab = (id: string, size: [number, number, number], position: [number, number, number], finish = 'oak', color?: string): unknown => ({ id, shape: { kind: 'primitive', primitive: 'box', size }, transform: T(position), material: color ? { finish, color } : { finish }, physics: { body: 'static' } });
const ground = (): unknown => slab('ground', [30, 0.1, 30], [0, -0.05, 0], 'grass');

/** A hole-less stand-in for the floor above: two slabs leave the stairwell open. */
function upperFloor(): unknown[] {
  return [slab('up-a', [6, 0.2, 2.2], [0, 2.7, -1.9], 'oak'), slab('up-b', [6, 0.2, 2.2], [0, 2.7, 1.9], 'oak'), slab('up-c', [2.0, 0.2, 1.6], [-2, 2.7, 0], 'oak'), slab('up-d', [2.0, 0.2, 1.6], [2.4, 2.7, 0], 'oak'), slab('wall-b', [6, 3, 0.15], [0, 1.4, -3.1], 'plaster', '#e6e0d6'), slab('wall-l', [0.15, 3, 6], [-3.1, 1.4, 0], 'plaster', '#e6e0d6')];
}

function roofScene(withDormers: boolean): Scene {
  const roofParams = { shape: 'gable', width: 10, depth: 7, pitch: 35, overhang: 0.45, ridgeAlongX: true, gutters: true, downpipe: 0 };
  const ents: unknown[] = [ground(), slab('walls', [10, 3, 7], [0, 1.5, 0], 'plaster', '#e8e2d6'), gen('roof', 'arch-roof', roofParams as unknown as Record<string, Json>, [0, 3, 0])];
  if (withDormers) {
    const roof = { width: 10, depth: 7, pitch: 35, thickness: 0.22, ridgeAlongX: true, shape: 'gable' } as const;
    const spots: Array<[string, 'gable' | 'shed' | 'hip', number]> = [['d1', 'gable', -3], ['d2', 'hip', 0], ['d3', 'shed', 3]];
    for (const [id, style, along] of spots) {
      const place = dormerPlacement(roof, 'south', along, 1.1);
      if (!place) continue;
      ents.push(gen(id, 'arch-dormer', { style, width: 1.3, wallHeight: 1.25, roofPitch: 35, pitch: style === 'shed' ? 18 : 32 }, [place.position[0], 3 + place.position[1], place.position[2]], place.rotationY));
    }
  }
  return { entities: Object.fromEntries((ents as Array<{ id: string }>).map((e) => [e.id, e])), position: [3.5, 4.6, 14], target: [0, 4, 3.4], fov: 40 };
}

function turretScene(withTurret: boolean): Scene {
  const ents: unknown[] = [ground(), gen('wall', 'arch-turret-roof', { radius: 1.6, height: 0.3, finial: 0, wallHeight: 6.5, slits: 5, profile: 'cone', finish: { finish: 'plaster', color: '#e4dccd' } }, [0, 6.5, 0])];
  if (withTurret) {
    ents.pop();
    ents.push(gen('turret', 'arch-turret-roof', { radius: 1.6, height: 3.2, wallHeight: 6.5, slits: 5, profile: 'bell', sides: 0, finish: { finish: 'slate' } }, [0, 6.5, 0]));
    ents.push(gen('hex', 'arch-turret-roof', { radius: 1.2, height: 2.4, wallHeight: 4, slits: 0, sides: 6, profile: 'cone', finish: { finish: 'roof-tile' } }, [5, 4, 0]));
    ents.push(gen('dome', 'arch-turret-roof', { radius: 1.2, height: 1.4, wallHeight: 4, profile: 'dome', finish: { finish: 'metal-roof' } }, [-5, 4, 0]));
  } else ents.push(slab('flat-cap', [3.4, 0.25, 3.4], [0, 6.6, 0], 'concrete'));
  return { entities: Object.fromEntries((ents as Array<{ id: string }>).map((e) => [e.id, e])), position: [7, 5.5, 13], target: [0, 4.5, 0], fov: 42 };
}

function columnScene(styled: boolean): Scene {
  const ents: unknown[] = [ground(), slab('beam', [11, 0.35, 0.8], [0, 3.35, 0], 'plaster', '#e6e0d6'), slab('wall', [11, 3.2, 0.2], [0, 1.6, -1.2], 'plaster', '#8f4a3c')];
  const stone = { finish: 'marble', color: '#ece6da' };
  const specs: Array<Record<string, Json>> = styled
    ? [{ shape: 'round', style: 'fluted' }, { shape: 'round', style: 'classical', capital: 'tuscan' }, { shape: 'round', style: 'classical', capital: 'doric', flutes: 20 }, { shape: 'round', style: 'classical', capital: 'ionic', flutes: 20 }, { shape: 'square', style: 'classical' }]
    : [{ shape: 'round' }, { shape: 'round' }, { shape: 'round' }, { shape: 'square' }, { shape: 'square' }];
  specs.forEach((s, i) => ents.push(gen(`col${i}`, 'arch-column', { size: 0.46, height: 3.2, finish: stone, ...s }, [-4 + i * 2, 0, 0])));
  if (styled) ents.push(gen('pilaster', 'arch-column', { size: 0.46, height: 3.2, style: 'pilaster', projection: 0.14, finish: stone }, [4.9, 0, -1.1]));
  else ents.push(gen('pier', 'arch-column', { shape: 'square', size: 0.46, height: 3.2, finish: stone }, [4.9, 0, -1.1]));
  return { entities: Object.fromEntries((ents as Array<{ id: string }>).map((e) => [e.id, e])), position: [3, 2.2, 9], target: [0, 1.7, 0], fov: 40 };
}

function spiralScene(spiral: boolean): Scene {
  const ents: unknown[] = [ground(), slab('floor', [7, 0.1, 7], [0, -0.05, 0], 'oak'), ...upperFloor()];
  if (spiral) ents.push(gen('stair', 'arch-spiral-stair', { radius: 1.05, rise: 2.8, turns: 1.1, hand: 'right', core: 'solid', balustrade: 'steel' }, [0, 0, 0], 0));
  else ents.push(gen('stair', 'arch-stair', { shape: 'straight', rise: 2.8, width: 1 }, [-1.8, 0, 0], 0));
  return { entities: Object.fromEntries((ents as Array<{ id: string }>).map((e) => [e.id, e])), position: [4.6, 3.4, 5.4], target: [0, 1.6, 0], fov: 46 };
}

const SCENES: Record<string, () => Scene> = {
  spiral: () => spiralScene(true),
  'spiral-before': () => spiralScene(false),
  dormer: () => roofScene(true),
  'dormer-before': () => roofScene(false),
  turret: () => turretScene(true),
  'turret-before': () => turretScene(false),
  columns: () => columnScene(true),
  'columns-before': () => columnScene(false),
};

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith('--'));
const [outArg, ...names] = args.filter((a) => !a.startsWith('--'));
if (!outArg) throw new Error('usage: element-sheet <outDir> [scene...] [--width=N]');
const width = Number(flags.find((f) => f.startsWith('--width='))?.split('=')[1] ?? 900);
const out = resolve(outArg);
mkdirSync(out, { recursive: true });
const gpu = await GpuRoom.open({});
try {
  for (const name of names.length > 0 ? names : Object.keys(SCENES)) {
    const make = SCENES[name];
    if (!make) throw new Error(`unknown scene ${name}`);
    const sc = make();
    const world = createWorld({ entities: sc.entities, environment: { timeOfDay: 14 } } as never) as WorldDoc;
    await gpu.load(world);
    const png = await gpu.still({ position: sc.position, target: sc.target, fov: sc.fov ?? 40 }, { width, height: Math.round(width * 0.66) }, 'studio');
    writeFileSync(join(out, `${name}.png`), png);
    process.stdout.write(`wrote ${join(out, `${name}.png`)}\n`);
  }
} finally {
  await gpu.close();
}
