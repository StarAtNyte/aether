import { readFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import { BACKED_TYPES, FRONT_OVERRIDES, backedFront, rotToFace } from '../../../scripts/assets/front';
import { scenePositions } from '../../../scripts/assets/process';

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions([EXTMeshoptCompression]).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const catalogJson = JSON.parse(readFileSync(new URL('../../../assets/catalog.json', import.meta.url), 'utf8')) as { entries: Array<{ id: string; file: string; interior?: { type?: string }; facing?: string }> };

/** Vertex positions of a library model (the build's final space: Y up, front +Z). */
async function positions(file: string): Promise<Float32Array> {
  return scenePositions(await io.read(new URL(`../../../assets/lib/${file}`, import.meta.url).pathname));
}

/** The points turned about Y by the build's `rot` convention. */
function rotated(p: Float32Array, deg: number): Float32Array {
  const [c, s] = [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
  const out = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    out[i] = (p[i] as number) * c + (p[i + 2] as number) * s;
    out[i + 1] = p[i + 1] as number;
    out[i + 2] = -(p[i] as number) * s + (p[i + 2] as number) * c;
  }
  return out;
}

describe('front of converted SimReady pieces', () => {
  it('rotToFace turns each axis onto +Z the way the build rotates', () => {
    for (const [d, want] of [[[0, 1], 0], [[1, 0], 270], [[0, -1], 180], [[-1, 0], 90]] as const) {
      const r = rotToFace(d[0], d[1]);
      expect(r).toBe(want);
      const q = rotated(new Float32Array([d[0], 0, d[1]]), r);
      expect(Math.round(q[2] as number)).toBe(1);
    }
  });

  it('finds the back of a library chair at any turn and rotates it to face +Z', async () => {
    const chair = await positions('s/simready-office-chair-black.925c2a07.glb');
    for (const turn of [0, 90, 180, 270]) {
      const d = backedFront(rotated(chair, turn));
      expect(d, `turn ${turn}`).not.toBeNull();
      const after = rotated(rotated(chair, turn), d?.rot ?? 0);
      const e = backedFront(after);
      expect(e?.rot ?? null, `turn ${turn} after`).toBeNull();
    }
  });

  it('every library model of a backed type faces +Z (backrest, cistern or sofa back on the -Z side)', async () => {
    const bad: string[] = [];
    for (const e of catalogJson.entries) {
      if (!e.id.startsWith('simready-') || !BACKED_TYPES.has(e.interior?.type ?? '') || (e.facing ?? '+z') !== '+z') continue;
      const d = backedFront(await positions(e.file));
      if (d && d.rot !== null) bad.push(`${e.id}: turn by ${d.rot} (${d.why})`);
    }
    expect(bad).toEqual([]);
  });

  it('knows nothing of a symmetric piece and lists the checked overrides', async () => {
    const mug = await positions(catalogJson.entries.find((e) => e.id === 'simready-mug-ceramic')!.file);
    expect(backedFront(new Float32Array(mug.slice(0, 9)))).toBeNull();
    expect(Object.values(FRONT_OVERRIDES).every((r) => [0, 90, 180, 270].includes(r))).toBe(true);
  });
});
