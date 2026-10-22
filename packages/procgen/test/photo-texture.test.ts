import { describe, expect, it } from 'vitest';
import {
  bestSquare,
  buildTextureSet,
  cameraModel,
  delight,
  fillHoles,
  newImage,
  project,
  rectify,
  rng,
  roomPlanes,
  seamless,
  surfaceClassOf,
  textureSetId,
  buildMaps,
  type FImage,
} from '../src/photo-texture';

function noise(n: number, seed: number): FImage {
  const r = rng(seed);
  const img = newImage(n, n);
  for (let i = 0; i < img.data.length; i++) img.data[i] = 0.6 + 0.4 * r();
  return img;
}

describe('photo textures', () => {
  it('projects the room through the camera: a point straight ahead lands in the middle', () => {
    const m = cameraModel({ x: 2, z: 4, height: 1.4, heading: 0, pitch: 0, fov: 80 }, 1.5);
    const p = project(m, [2, 1.4, 0]);
    expect(p?.u).toBeCloseTo(0.5, 5);
    expect(p?.v).toBeCloseTo(0.5, 5);
    expect(project(m, [2, 1.4, 6])).toBeNull();
    // To the east of the line of sight is to the right of the picture when facing north.
    expect((project(m, [3, 1.4, 0])?.u ?? 0) > 0.5).toBe(true);
  });

  it('rectifies a wall so that metres map to texels left to right', () => {
    const cam = cameraModel({ x: 2, z: 4, height: 1.4, heading: 0, pitch: 0, fov: 90 }, 1);
    const photo = newImage(200, 200);
    // Brightness grows to the right of the picture.
    for (let y = 0; y < 200; y++) for (let x = 0; x < 200; x++) for (let c = 0; c < 3; c++) photo.data[(y * 200 + x) * 3 + c] = x / 200;
    const wall = roomPlanes({ width: 4, depth: 4, ceiling: 2.6 })['wall-north']!;
    const r = rectify(photo, cam, wall, { ppm: 40 });
    expect(r.coverage).toBeGreaterThan(0.3);
    const row = Math.floor(r.image.height / 2);
    const first = r.image.data[(row * r.image.width + 10) * 3] as number;
    const last = r.image.data[(row * r.image.width + r.image.width - 10) * 3] as number;
    expect(last).toBeGreaterThan(first);
  });

  it('masks occluders and finds the clean square', () => {
    const cam = cameraModel({ x: 2, z: 4, height: 1.4, heading: 0, pitch: 0, fov: 90 }, 1);
    const photo = noise(200, 3);
    const wall = roomPlanes({ width: 4, depth: 4, ceiling: 2.6 })['wall-north']!;
    const r = rectify(photo, cam, wall, { ppm: 40, occluders: [[0.47, 0.3, 0.53, 0.7]] });
    const free = rectify(photo, cam, wall, { ppm: 40 });
    expect(r.coverage).toBeLessThan(free.coverage);
    const sq = bestSquare(r.valid, r.image.width, r.image.height, 16, 0.95);
    expect(sq).not.toBeNull();
  });

  it('fills holes with the surface texture', () => {
    const img = noise(64, 5);
    const valid = new Uint8Array(64 * 64).fill(1);
    for (let y = 20; y < 40; y++) for (let x = 20; x < 40; x++) valid[y * 64 + x] = 0;
    const f = fillHoles(img, valid);
    let mean = 0;
    for (let y = 22; y < 38; y++) for (let x = 22; x < 38; x++) mean += f.data[(y * 64 + x) * 3] as number;
    expect(mean / 256).toBeGreaterThan(0.5);
    expect(mean / 256).toBeLessThan(0.9);
  });

  it('takes a lighting gradient out', () => {
    const n = 96;
    const img = newImage(n, n);
    const r = rng(9);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) for (let c = 0; c < 3; c++) img.data[(y * n + x) * 3 + c] = (0.2 + 0.6 * (x / n)) * (0.9 + 0.2 * r());
    const d = delight(img);
    const col = (x: number): number => {
      let s = 0;
      for (let y = 0; y < n; y++) s += d.ratio.data[(y * n + x) * 3] as number;
      return s / n;
    };
    expect(Math.abs(col(8) - col(n - 8))).toBeLessThan(0.15);
  });

  it('makes a tile whose opposite edges agree', () => {
    const n = 96;
    const img = newImage(n, n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) for (let c = 0; c < 3; c++) img.data[(y * n + x) * 3 + c] = 0.5 + 0.4 * (x / n) + 0.1 * Math.sin(y / 5);
    const t = seamless(img);
    let seam = 0;
    let inner = 0;
    for (let y = 0; y < n; y++) {
      seam += Math.abs((t.data[(y * n) * 3] as number) - (t.data[(y * n + n - 1) * 3] as number));
      inner += Math.abs((t.data[(y * n + 40) * 3] as number) - (t.data[(y * n + 41) * 3] as number));
    }
    expect(seam / n).toBeLessThan(0.05);
    expect(seam).toBeLessThan(inner * 8 + 1);
  });

  it('builds the maps in the finish encoding and keeps ids stable', () => {
    const tile = seamless(noise(128, 2));
    const cls = surfaceClassOf('white duvet linen');
    expect(cls.finish).toBe('fabric');
    const m = buildMaps(tile, { tileMetres: 1, cls, size: 64 });
    expect(m.albedo.length).toBe(64 * 64 * 4);
    // Flat normals are (128, 128, 255): the map is mostly blue.
    let blue = 0;
    for (let i = 0; i < 64 * 64; i++) blue += m.normal[i * 4 + 2] as number;
    expect(blue / (64 * 64)).toBeGreaterThan(200);
    const a = textureSetId(buildMaps(tile, { tileMetres: 1, cls, size: 256 }), 1);
    const b = textureSetId(buildMaps(tile, { tileMetres: 1, cls, size: 256 }), 1);
    expect(a).toBe(b);
    expect(a).toMatch(/^tex-[0-9a-f]{12}$/);
  });

  it('keeps only the tiers whose maps fit the caps', async () => {
    const tile = seamless(noise(128, 2));
    // An encoder that never compresses: raw bytes. 256 px albedo = 256 KB > cap, so nothing fits.
    const none = await buildTextureSet(tile, { name: 'x', provenance: 'photographed', tileMetres: 1, mean: '#808080', cls: surfaceClassOf('paint') }, (rgba) => rgba, [256]);
    expect(none).toBeNull();
    const fake = await buildTextureSet(tile, { name: 'x', provenance: 'photographed', tileMetres: 1, mean: '#808080', cls: surfaceClassOf('paint') }, (_rgba, size) => new Uint8Array(size * 4), [256, 512]);
    expect(fake?.def.tiers).toEqual([256, 512]);
    expect(fake?.files.length).toBe(6);
  });
});
