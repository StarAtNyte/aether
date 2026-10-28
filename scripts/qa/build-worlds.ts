import { mkdirSync, writeFileSync } from 'node:fs';
import { applyPatches, createWorld, type WorldDoc } from '@aether/core';
import { runDesignTool } from '@aether/arch';
import { loadCatalog } from '@aether/assets';
await loadCatalog();
const out = process.argv[2] ?? '.';
mkdirSync(out, { recursive: true });
type It = Record<string, unknown>;
function build(name: string, rect: number[], items: It[], style = 'modern'): WorldDoc {
  const plan = { id: name, name, style, brief: name, levels: [{ height: 2.8, rooms: [{ id: 'room', type: 'office', rect }], openings: [
    { kind: 'door', room: 'room', wall: 'south', to: 'outside', along: 0.9, width: 0.9, id: 'door', main: true },
    { kind: 'window', room: 'room', wall: 'north', along: (rect[2]! - rect[0]!) / 2, width: 1.6, height: 1.3, sill: 0.9, id: 'win' }] }] };
  let w = createWorld({ name });
  const r = runDesignTool(w, 'design_plan', { plan });
  if (!r.ok) throw new Error(r.text);
  w = applyPatches(w, r.patches).world;
  for (const it of items) {
    const p = runDesignTool(w, 'place_items', { items: [{ room: 'room', ...it, id: it['id'] }] });
    console.log(name, String(it['id'] ?? it['kind']), p.ok ? 'OK' : 'REFUSED', p.text.replace(/\s+/g, ' ').slice(0, 220));
    if (p.ok) w = applyPatches(w, p.patches).world;
  }
  return w;
}
const m = (id: string): string => `model:simready-${id}`;
const office = build('office', [0, 0, 5, 4], [
  { kind: m('desk-office'), id: 'desk', wall: 'north', align: 'centre' },
  { kind: m('office-chair-black'), id: 'chair', at: [2.5, 1.1], faces: 'office-desk' },
  { kind: m('monitor-office'), id: 'monitor', on: 'office-desk', offset: [0, 0] },
  { kind: m('keyboard-computer'), id: 'kb', on: 'office-desk', offset: [0, 0.25] },
  { kind: m('lamp-desk-arm'), id: 'lamp', on: 'office-desk', offset: [0.6, 0] },
  { kind: m('mug-ceramic'), id: 'mug', on: 'office-desk', offset: [-0.55, 0.15] },
  { kind: m('shelf-storage-basic'), id: 'shelf', wall: 'east', align: 'centre' },
  { kind: m('cabinet-filing'), id: 'cabinet', wall: 'west', align: 'centre' },
  { kind: m('bin-waste'), id: 'bin', at: [3.6, 0.5] },

]);
const shop = build('workshop', [0, 0, 6, 4.5], [
  { kind: m('workbench-standard'), id: 'bench', wall: 'north', align: 'centre' },
  { kind: m('toolbox-metal'), id: 'toolbox', at: [1.2, 2.5] },
  { kind: m('hammer-claw'), id: 'hammer', on: 'workshop-bench', offset: [0.3, 0.1] },
  { kind: m('wrench-adjustable'), id: 'wrench', on: 'workshop-bench', offset: [0.6, 0] },
  { kind: m('tool-cabinet-rolling'), id: 'tcab', wall: 'west', align: 'centre' },
  { kind: m('box-shipping'), id: 'crate1', at: [4.5, 3.2] },
  { kind: m('box-cardboard'), id: 'box1', at: [5.2, 3.2] },
  { kind: m('bucket-red'), id: 'bucket', at: [1.5, 0.6] },
  { kind: m('toolbox-hardcase'), id: 'tb2', at: [3, 3.5] },
  { kind: m('light-work-tripod'), id: 'tripod', at: [5.2, 0.6] },
]);
const kitchen = build('kitchen', [0, 0, 5, 4], [
  { kind: m('range-cooker-lg'), id: 'cooker', wall: 'north', align: 'centre' },
  { kind: m('table-stainless'), id: 'table', at: [2.5, 2.3] },
  { kind: m('stool-padded-vinyl'), id: 'stool', at: [1.6, 2.9] },
  { kind: m('plate-dinner'), id: 'plate', on: 'kitchen-table', offset: [0, 0] },
  { kind: m('mug-ceramic'), id: 'mug', on: 'kitchen-table', offset: [0.4, 0.1] },
  { kind: m('bin-pedal'), id: 'bin', at: [4.5, 0.5] },
], 'modern');
for (const [n, w] of Object.entries({ office, workshop: shop, kitchen })) writeFileSync(`${out}/${n}.json`, JSON.stringify(w));
