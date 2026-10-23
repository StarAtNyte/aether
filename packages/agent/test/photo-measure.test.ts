import { describe, expect, it } from 'vitest';
import { parseRoomDescription } from '@aether/arch/photo';
import { DEPTH_MODEL, encodePng, inputSize, loadDepthWeights, preprocess } from '../src/photo/depth-model';
import { autoAnchor, measureRoom, parseMeasureInput } from '../src/photo/measure';

const fakeMap = (): { width: number; height: number; data: Float32Array } => {
  const W = 80, H = 60;
  const data = new Float32Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) data[j * W + i] = 0.2 + (j / H) * 0.8 + 0.1 * Math.abs(i / W - 0.5);
  return { width: W, height: H, data };
};
const raster = { width: 8, height: 6, data: new Uint8ClampedArray(8 * 6 * 4).fill(128) };

describe('measure_room', () => {
  it('says the model is unavailable and changes nothing when the network cannot run', async () => {
    const m = await measureRoom({ raster: async () => raster, estimate: async () => ({ ok: false, reason: 'offline' }) }, undefined);
    expect(m.isError).toBe(true);
    expect(m.text).toContain('not available (offline)');
    expect(m.estimate).toBeNull();
  });

  it('says so when the host cannot decode', async () => {
    const m = await measureRoom({ raster: async () => null }, undefined);
    expect(m.isError).toBe(true);
    expect(m.text).toContain('could not decode');
  });

  it('returns advisory numbers next to the model reading and a depth picture', async () => {
    const m = await measureRoom({ raster: async () => raster, estimate: async () => ({ ok: true, map: fakeMap(), image: 'data:image/png;base64,AAAA' }) }, undefined, { width: 3.3, depth: 5, ceiling: 2.5 });
    expect(m.text).toContain('Your reading: 3.3 m wide');
    expect(m.text).toContain('advisory');
    expect(m.blocks.some((b) => b.type === 'image')).toBe(true);
  });

  it('validates the anchor and orders its box', () => {
    expect(parseMeasureInput({})).toEqual({});
    expect(parseMeasureInput({ anchor: { name: 'door', size_m: 2.05, axis: 'height', box: [0.6, 0.8, 0.4, 0.2] } })?.anchor?.box).toEqual([0.4, 0.2, 0.6, 0.8]);
    expect(parseMeasureInput({ anchor: { name: 'door', size_m: 2.05, axis: 'height', box: [0.5, 0.5, 0.505, 0.9] } })).toBeNull();
    expect(parseMeasureInput({ anchor: { name: 'x', size_m: 'big' } })).toBeNull();
  });

  it('anchors on a whole visible door only', () => {
    const base = { roomType: 'bedroom', camera: { x: 2, z: 4.5, heading: 0 }, footprint: { width: 4, depth: 5, ceiling: 2.5 } };
    const door = (box: number[], visible = true): unknown => ({ ...base, openings: [{ id: 'd1', kind: 'door', wall: 'east', along: 1, width: 0.9, visible, box }] });
    const desc = (raw: unknown): ReturnType<typeof autoAnchor> => {
      const p = parseRoomDescription(raw, []);
      if (!p.ok) throw new Error(p.error);
      return autoAnchor(p.value);
    };
    expect(desc(door([0.7, 0.3, 0.8, 0.9]))?.sizeM).toBe(2.05);
    expect(desc(door([0.7, 0.3, 0.8, 1]))).toBeUndefined();
    expect(desc(door([0.7, 0.3, 0.8, 0.9], false))).toBeUndefined();
  });

  it('pins the weights: pinned revision and checksum, local file refused when it differs, off switch honoured', async () => {
    expect(DEPTH_MODEL.url).toMatch(/resolve\/[0-9a-f]{40}\//);
    expect(DEPTH_MODEL.sha256).toMatch(/^[0-9a-f]{64}$/);
    const w = await loadDepthWeights();
    expect(w.ok).toBe(false); // vitest sets AETHER_DEPTH=off
  });

  it('prepares the network input and a valid PNG', () => {
    expect(inputSize(1280, 960)).toEqual({ w: 518, h: 392 });
    const t = preprocess(raster, 28, 14);
    expect(t.length).toBe(3 * 28 * 14);
    expect(t[0]).toBeCloseTo((128 / 255 - 0.485) / 0.229, 4);
    const png = encodePng(2, 2, new Uint8Array(12));
    expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });
});
