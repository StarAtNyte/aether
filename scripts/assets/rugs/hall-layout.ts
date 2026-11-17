/**
 * Lay the Rug Exhibition Hall out with the procedural rugs and display furniture (idempotent):
 *
 *   npx tsx scripts/assets/rugs/hall-layout.ts
 *
 * - the 29 rug entities point at their designs (`rug-*` assets) at their real size: floor rugs flat on oak-topped plinths
 *   (3 mm above the top), runners along oak display tables (2 mm above), wall rugs portrait (3:4), hung 4 cm off the wall
 *   with their centre line at 2.2 m (the Kashan centrepiece lower, its top under the acoustic panels);
 * - the plinths and tables are library models (`display-plinth-oak`, `display-table-oak`) instead of the procedural vitrine
 *   plinths and dining tables; the procedural rug piles that overlapped the runners and each other are removed;
 * - each wall's plaques sit beside their rug at 1.25 m;
 * - product sizes of the rugs that became 3:4 are updated (names, prices and details unchanged).
 *
 * Writes the world in canonical form (`stableStringify(doc) + '\n'`).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stableStringify } from '../../../packages/core/src/json';

const ROOT = resolve(import.meta.dirname, '../../..');
const FILE = join(ROOT, 'apps/studio/public/templates/worlds/rug-exhibition-hall.json');
const catalog = JSON.parse(readFileSync(join(ROOT, 'assets/catalog.json'), 'utf8')) as { entries: Array<{ id: string; size: [number, number, number] }> };
const sizeOf = (id: string): [number, number, number] => {
  const e = catalog.entries.find((x) => x.id === id);
  if (!e) throw new Error(`${id} is not in the catalog (run scripts/assets/rugs/build.ts)`);
  return e.size;
};

type V3 = [number, number, number];
interface Entity {
  id: string;
  name: string;
  shape: Record<string, unknown>;
  transform: { position: V3; rotation: V3; scale: V3 };
  product?: { name: string; size: string; price: string; details: string };
  physics?: Record<string, unknown>;
  [k: string]: unknown;
}

/** Real rug sizes in cm (width x length) by asset; the length hangs vertically on a wall. */
const RUG_CM: Record<string, [number, number]> = {
  'rug-vinton-teal': [165, 220], 'rug-vinton-rust': [210, 280], 'rug-motion-denim': [165, 220], 'rug-motion-marine': [210, 280],
  'rug-heriz-runner': [80, 300], 'rug-tabriz-runner': [80, 250], 'rug-isfahan-wall': [150, 200], 'rug-motion-wall-denim': [135, 180],
  'rug-farmhouse-border': [150, 200], 'rug-kashan-heirloom': [255, 340], 'rug-farmhouse-stripe': [180, 240], 'rug-mahal-wall': [150, 200],
  'rug-motion-wall-marine': [135, 180],
};
/** Wall rugs with a fringe at the bottom only: the asset's bounds (and pivot) include it. */
const BOTTOM_FRINGE = new Set(['rug-isfahan-wall', 'rug-kashan-heirloom', 'rug-mahal-wall']);

const PLINTH_TOP = 0.4;
const TABLE_TOP = 0.75;
/** Wall faces on the hall side (from the generated walls) and the hanging offset. */
const FACE = { north: 0.158, south: 14.922, east: 29.842, west: 0.158 };
const GAP = 0.042;
/** Euler XYZ (degrees) that turn a flat rug (top of the design at -Z) upright against each wall, facing the room. */
const ROT: Record<string, V3> = { north: [90, 0, 0], south: [90, 0, 180], east: [90, 0, 90], west: [90, 0, -90] };

const FLOOR: Array<[string, string, number, number]> = [
  // entity, asset, x, z (plinth centres)
  ['rug-real-1', 'rug-vinton-teal', 22.5, 5], ['rug-real-2', 'rug-vinton-rust', 17.5, 5], ['rug-real-3', 'rug-motion-denim', 12.5, 5], ['rug-real-4', 'rug-motion-marine', 7.5, 5],
  ['rug-real-5', 'rug-vinton-rust', 22.5, 9], ['rug-real-6', 'rug-motion-marine', 17.5, 9], ['rug-real-7', 'rug-vinton-teal', 12.5, 9], ['rug-real-8', 'rug-motion-denim', 7.5, 9],
];
const TABLES: Array<[string, string, number]> = [
  // entity, asset, x (tables at z = 17.5, long along Z)
  ['rug-table-1', 'rug-heriz-runner', 23], ['rug-table-2', 'rug-tabriz-runner', 26], ['rug-table-3', 'rug-tabriz-runner', 4.5], ['rug-table-4', 'rug-heriz-runner', 7.5],
];
const WALL: Array<[string, string, 'north' | 'south' | 'east' | 'west', number]> = [
  // entity, asset, wall, position along the wall (x on north / south, z on east / west)
  ['wall-rug-n1', 'rug-farmhouse-stripe', 'north', 2.2], ['wall-rug-n2', 'rug-isfahan-wall', 'north', 6.4], ['wall-rug-n3', 'rug-mahal-wall', 'north', 9.6],
  ['wall-rug-feature', 'rug-kashan-heirloom', 'north', 15], ['wall-rug-n4', 'rug-motion-wall-denim', 'north', 20.4], ['wall-rug-n5', 'rug-motion-wall-marine', 'north', 23.6],
  ['wall-rug-n6', 'rug-farmhouse-stripe', 'north', 27.9],
  ['wall-rug-s1', 'rug-farmhouse-border', 'south', 2.2], ['wall-rug-s2', 'rug-motion-wall-denim', 'south', 8], ['wall-rug-s3', 'rug-mahal-wall', 'south', 22],
  ['wall-rug-s4', 'rug-motion-wall-marine', 'south', 27.9],
  ['wall-rug-e1', 'rug-isfahan-wall', 'east', 1.9], ['wall-rug-e2', 'rug-motion-wall-denim', 'east', 7.5], ['wall-rug-e3', 'rug-farmhouse-border', 'east', 13.1],
  ['wall-rug-w1', 'rug-motion-wall-marine', 'west', 1.9], ['wall-rug-w2', 'rug-mahal-wall', 'west', 7.5], ['wall-rug-w3', 'rug-isfahan-wall', 'west', 13.1],
];

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

function main(): void {
  const doc = JSON.parse(readFileSync(FILE, 'utf8'));
  const ents = doc.world.entities as Record<string, Entity>;
  const template = ents['rug-real-1'];
  if (!template) throw new Error('rug-real-1 missing');
  const staticBox = { ...(template.physics as Record<string, unknown>), collider: 'box' };
  const furniture = (id: string, name: string, asset: string, pos: V3, tags: string[]): Entity => ({
    behaviors: [], castShadow: true, id, name, parent: null, physics: { ...staticBox }, receiveShadow: true, shape: { id: asset, kind: 'asset' }, state: {}, tags, template: false,
    transform: { position: pos, rotation: [0, 0, 0], scale: [1, 1, 1] }, visible: true,
  });

  // Procedural display pieces replaced by library models; overlapping procedural rug piles removed.
  for (const id of ['grid-of-vitrine-1', 'grid-of-table-1', 'grid-of-table-2', 'grid-of-rug-4', 'grid-of-rug-5', 'along-of-rug-1', 'along-of-rug-2']) delete ents[id];

  // Floor rugs on plinths: the rug's length along X (yaw 90), the plinth's long side along X.
  FLOOR.forEach(([eid, asset, x, z], i) => {
    const pid = `rug-plinth-${i + 1}`;
    ents[pid] = furniture(pid, 'Display plinth', 'display-plinth-oak', [x, 0, z], ['plinth', 'display']);
    const e = ents[eid] as Entity;
    e.shape = { id: asset, kind: 'asset' };
    e.transform = { position: [x, r3(PLINTH_TOP + 0.003), z], rotation: [0, 90, 0], scale: [1, 1, 1] };
  });
  // Runners along the display tables.
  TABLES.forEach(([eid, asset, x], i) => {
    const tid = `display-table-${i + 1}`;
    ents[tid] = furniture(tid, 'Display table', 'display-table-oak', [x, 0, 17.5], ['table', 'display']);
    const e = ents[eid] as Entity;
    e.shape = { id: asset, kind: 'asset' };
    e.transform = { position: [x, r3(TABLE_TOP + 0.002), 17.5], rotation: [0, 0, 0], scale: [1, 1, 1] };
  });
  // Wall rugs, portrait, centre line 2.2 m (2.3 m for the 2.4 m tall ones, 2.25 m for the Kashan).
  const plaques: Record<string, number[]> = { north: [], south: [], east: [], west: [] };
  for (const [eid, asset, wall, along] of WALL) {
    const e = ents[eid] as Entity;
    const [wcm, lcm] = RUG_CM[asset] as [number, number];
    const size = sizeOf(asset);
    const L = lcm / 100;
    const centre = asset === 'rug-kashan-heirloom' ? 2.25 : L > 2.3 ? 2.3 : 2.2;
    const y = centre - (BOTTOM_FRINGE.has(asset) ? (size[2] - L) / 2 : 0);
    const pos: V3 = wall === 'north' ? [along, y, FACE.north + GAP] : wall === 'south' ? [along, y, FACE.south - GAP] : wall === 'east' ? [FACE.east - GAP, y, along] : [FACE.west + GAP, y, along];
    e.shape = { id: asset, kind: 'asset' };
    e.transform = { position: pos.map(r3) as V3, rotation: ROT[wall] as V3, scale: [1, 1, 1] };
    const half = wcm / 200;
    // the plaque beside the rug, 20 cm from its edge
    plaques[wall]?.push(wall === 'south' ? along - half - 0.2 : along + half + 0.2);
  }
  const setPoints = (id: string, toLocal: (v: number) => number, vals: number[]): void => {
    const e = ents[id] as Entity;
    const pts = vals.sort((a, b) => a - b).map((v) => [r3(toLocal(v)), 1.25, 0]);
    (e.shape as { points: number[][]; count: number }).points = pts;
    (e.shape as { count: number }).count = pts.length;
    e.name = `${pts.length} x plaque beside the pieces`;
  };
  setPoints('wall-labels-1', (x) => x - 1, plaques['north'] ?? []);
  setPoints('wall-labels-4', (x) => 29 - x, plaques['south'] ?? []);
  setPoints('wall-labels-2', (z) => z - 1, plaques['east'] ?? []);
  setPoints('wall-labels-3', (z) => 1 - z, plaques['west'] ?? []);

  // Product sizes of the rugs that are now 3:4 (everything else unchanged).
  const sizeText = (cm: [number, number]): string => `${cm[0]} × ${cm[1]} cm`;
  for (const e of Object.values(ents)) {
    const id = (e.shape as { id?: string }).id;
    if (e.product && id && RUG_CM[id]) e.product.size = sizeText(RUG_CM[id] as [number, number]);
  }
  writeFileSync(FILE, `${stableStringify(doc)}\n`);
  console.log(`laid out ${FLOOR.length + TABLES.length + WALL.length} rugs, 8 plinths, 4 tables`);
}

main();
