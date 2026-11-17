/**
 * Dump a world's generated geometry (procedural, primitive and scatter entities) in world space, plus every entity's
 * world bounds, so Blender can render the layout and `check_layout.py` can test placements numerically.
 *
 *   npx tsx scripts/assets/rugs/world-dump.ts <world.json> <out-dir>
 *
 * Writes `<out-dir>/geo.bin` (float32 positions, uint32 indices per part) and `<out-dir>/geo.json` (parts: entity,
 * colour, offsets; entities: transform, shape, bounds). Asset entities are listed with their transform only.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eulerDegToQuat, rotateVec3, type Vec3 } from '@aether/core';
import { generate } from '@aether/procgen';
import { createNodeSandbox } from '@aether/procgen/node';
import { scatterInstances } from '../../../packages/physics/src/scatter';

const [file, out] = process.argv.slice(2);
if (!file || !out) throw new Error('usage: world-dump.ts <world.json> <out-dir>');
mkdirSync(out, { recursive: true });
const doc = JSON.parse(readFileSync(file, 'utf8'));
const world = doc.world ?? doc;
const sandbox = createNodeSandbox({ timeoutMs: 120_000 });
const chunks: Buffer[] = [];
let offset = 0;
const parts: unknown[] = [];
const ents: Record<string, unknown> = {};
const FINISH_RGB: Record<string, string> = { oak: '#a87a4f', walnut: '#5b3b26', 'black-metal': '#222222', brass: '#b08d57', chrome: '#cccccc', marble: '#e8e4dc', glass: '#cfe3e8' };

type T = { position: Vec3; rotation: Vec3; scale: Vec3 };
const apply = (t: T, inst: { position: Vec3; yawDeg: number; scale: number } | null, p: Vec3): Vec3 => {
  let v: Vec3 = p;
  if (inst) {
    v = [v[0] * inst.scale, v[1] * inst.scale, v[2] * inst.scale];
    v = rotateVec3(eulerDegToQuat([0, inst.yawDeg, 0]), v);
    v = [v[0] + inst.position[0], v[1] + inst.position[1], v[2] + inst.position[2]];
  }
  v = [v[0] * t.scale[0], v[1] * t.scale[1], v[2] * t.scale[2]];
  v = rotateVec3(eulerDegToQuat(t.rotation), v);
  return [v[0] + t.position[0], v[1] + t.position[1], v[2] + t.position[2]];
};

try {
  for (const [id, e] of Object.entries(world.entities as Record<string, { shape: any; transform: T; material?: any; parent?: string | null }>)) {
    const s = e.shape;
    const t = e.transform;
    const rec: { shape: string; transform: T; instances: Array<{ min: Vec3; max: Vec3; local: { min: Vec3; max: Vec3 } }> } = { shape: s.kind === 'asset' ? `asset:${s.id}` : s.kind === 'scatter' ? `scatter:${s.of.generator ?? s.of.primitive}` : (s.generator ?? s.primitive ?? s.kind), transform: t, instances: [] };
    ents[id] = rec;
    if (!['procedural', 'primitive', 'scatter'].includes(s.kind)) continue;
    const g = s.kind === 'scatter' ? s.of : s;
    let o;
    try {
      o = await generate(g, world, { sandbox });
    } catch (err) {
      console.error(id, String(err));
      continue;
    }
    const insts = s.kind === 'scatter' ? scatterInstances(s) : [null];
    for (const inst of insts) {
      const min: Vec3 = [Infinity, Infinity, Infinity];
      const max: Vec3 = [-Infinity, -Infinity, -Infinity];
      for (const part of o.parts) {
        const n = part.positions.length / 3;
        const pos = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          const w = apply(t, inst, [part.positions[i * 3]!, part.positions[i * 3 + 1]!, part.positions[i * 3 + 2]!]);
          pos.set(w, i * 3);
          for (let k = 0; k < 3; k++) {
            min[k] = Math.min(min[k]!, w[k]!);
            max[k] = Math.max(max[k]!, w[k]!);
          }
        }
        const idx = new Uint32Array(part.indices);
        const m = { ...(e.material ?? {}), ...(part.material ?? {}) };
        const color = m.color ?? (m.finish ? FINISH_RGB[m.finish] : undefined) ?? '#bbbbbb';
        let cols: Float32Array | null = null;
        if (part.colors && m.vertexColors) cols = new Float32Array(part.colors);
        parts.push({ entity: id, color, finish: m.finish ?? null, opacity: m.opacity ?? 1, emissive: m.emissive ?? null, metal: m.metalness ?? 0, rough: m.roughness ?? 0.7, pos: [offset, n], idx: [offset + n * 12, idx.length], col: cols ? [offset + n * 12 + idx.length * 4, n] : null });
        chunks.push(Buffer.from(pos.buffer), Buffer.from(idx.buffer));
        offset += n * 12 + idx.length * 4;
        if (cols) {
          chunks.push(Buffer.from(cols.buffer));
          offset += cols.byteLength;
        }
      }
      rec.instances.push({ min, max, local: { min: o.bounds.min, max: o.bounds.max } });
    }
  }
} finally {
  sandbox.dispose();
}
writeFileSync(join(out, 'geo.bin'), Buffer.concat(chunks));
writeFileSync(join(out, 'geo.json'), JSON.stringify({ parts, entities: ents }));
console.log(`${parts.length} parts, ${(offset / 1048576).toFixed(1)} MB`);
process.exit(0);
