import { describe, expect, it } from 'vitest';
import { BoxGeometry, DataTexture, FloatType, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, PerspectiveCamera, RGBAFormat, Texture } from 'three';
import { applyVignette, blitTile, normalizePixels, stillSize, tileLayout, TILE_MARGIN } from '../src/view/still';
import { captureStill, openCaptureSession, type CaptureHost, type CaptureSession } from '../src/view/capture-session';
import { buildExportScene } from '../src/view/gltf-export';
import { BATCHED_LAYER } from '../src/sync/static-batches';
import { ENTITY_ID_KEY } from '../src/sync/entity-node';
import { vignetteFactor } from '../src/gpu/post';

describe('still tiles', () => {
  it('covers every pixel exactly once with overlapping render windows', () => {
    for (const [W, H, tw, th] of [
      [3840, 2160, 2048, 2048],
      [8192, 4096, 2048, 2048],
      [1000, 700, 512, 512],
      [640, 480, 2048, 2048],
    ] as const) {
      const tiles = tileLayout(W, H, tw, th);
      const hits = new Uint8Array(W * H);
      for (const t of tiles) {
        expect(t.w).toBeGreaterThan(0);
        expect(t.x - t.rx).toBeGreaterThanOrEqual(0);
        expect(t.x - t.rx + t.w).toBeLessThanOrEqual(tw);
        expect(t.y - t.ry + t.h).toBeLessThanOrEqual(th);
        for (let y = t.y; y < t.y + t.h; y++) for (let x = t.x; x < t.x + t.w; x++) hits[y * W + x] = (hits[y * W + x] as number) + 1;
      }
      expect(hits.every((h) => h === 1), `${W}x${H}`).toBe(true);
      if (W > tw) expect(tiles[0]?.rx).toBe(-TILE_MARGIN);
    }
    expect(tileLayout(640, 480, 2048, 2048)).toEqual([{ x: 0, y: 0, w: 640, h: 480, rx: 0, ry: 0 }]);
  });

  it('normalizes padded WebGPU rows and bottom-up WebGL2 rows (regression: skewed thumbnails)', () => {
    const w = 3;
    const h = 2;
    // WebGPU: rows padded to 256 bytes, last row tight.
    const padded = new Uint8Array(256 + w * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) padded.set([y * 10 + x, 0, 0, 7], y * 256 + x * 4);
    const out = new Uint8Array(w * h * 4);
    normalizePixels(padded, w, h, false, out);
    expect([out[0], out[4], out[8], out[12], out[16], out[20]]).toEqual([0, 1, 2, 10, 11, 12]);
    expect(out[3]).toBe(255);
    // WebGL2: tight rows, bottom-up.
    const tight = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) tight[(y * w + x) * 4] = y * 10 + x;
    normalizePixels(tight, w, h, true, out);
    expect([out[0], out[12]]).toEqual([10, 0]);
    expect(() => normalizePixels(new Uint8Array(4), w, h, false, out)).toThrow();
  });

  it('blits tiles and applies the CPU vignette (corners darker, centre untouched)', () => {
    const W = 64;
    const H = 32;
    const dst = new Uint8Array(W * H * 4).fill(200);
    const tile = { x: 10, y: 5, w: 4, h: 3, rx: 8, ry: 3 };
    const src = new Uint8Array(16 * 16 * 4).fill(9);
    blitTile(src, 16, tile, dst, W);
    expect(dst[(5 * W + 10) * 4]).toBe(9);
    expect(dst[(4 * W + 10) * 4]).toBe(200);
    applyVignette(dst, W, H);
    expect(dst[0]).toBe(Math.round(200 * vignetteFactor(Math.hypot(0.5 - 0.5 / W, 0.5 - 0.5 / H))));
    expect(dst[((H / 2) * W + W / 2) * 4]).toBe(200);
  });

  it('clamps sizes to the 8K limit keeping the aspect', () => {
    expect(stillSize(16384, 8192)).toEqual({ width: 8192, height: 4096 });
    expect(stillSize(Number.NaN, 0)).toEqual({ width: 1920, height: 1080 });
  });
});

/** A fake GPU: each frame's pixel (x, y) encodes its position in the full image. */
function fakeHost(log: string[]): CaptureHost & { camera: PerspectiveCamera } {
  const camera = new PerspectiveCamera(55, 1.5, 0.1, 100);
  camera.position.set(1, 2, 3);
  let size = [0, 0];
  return {
    camera,
    flipY: false,
    alive: () => true,
    begin: (w, h, vignette) => {
      size = [w, h];
      log.push(`begin ${w}x${h} vignette=${vignette}`);
    },
    advance: (dt) => log.push(`advance ${dt}`),
    drawToTarget: () => {
      // Temporal AA jitters through the camera's view offset: emulate it.
      camera.setViewOffset(size[0] as number, size[1] as number, 0.25, -0.25, size[0] as number, size[1] as number);
      log.push(`accumulate ${camera.view?.offsetX ?? 'none'}`);
      camera.clearViewOffset();
    },
    readback: async (w, h) => {
      const v = camera.view;
      const ox = v?.enabled ? v.offsetX : 0;
      const oy = v?.enabled ? v.offsetY : 0;
      log.push(`read ${v?.enabled ? `${v.fullWidth}x${v.fullHeight}@${ox},${oy}` : 'full'}`);
      const px = new Uint8Array(w * h * 4);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        px[(y * w + x) * 4] = (ox + x) & 0xff;
        px[(y * w + x) * 4 + 1] = (oy + y) & 0xff;
      }
      return px;
    },
    finish: () => log.push('finish'),
  };
}

describe('capture sessions', () => {
  it('waits for pending shader links and does not draw after cancellation while waiting', async () => {
    const log: string[] = [], host = fakeHost(log);
    let ready!: () => void;
    host.ready = () => new Promise<void>(resolve => { ready = resolve; });
    const session = openCaptureSession(host, 32, 32);
    const pending = session.frame({ pos: [4, 5, 6], target: [0, 0, 0] });
    expect(host.camera.position.toArray()).toEqual([1, 2, 3]);
    expect(log).toHaveLength(1);
    session.end();
    ready();
    await expect(pending).rejects.toThrow('capture session ended');
    expect(log).toEqual(['begin 32x32 vignette=true', 'finish']);
  });

  it('poses the camera, accumulates, reads back and restores everything', async () => {
    const log: string[] = [];
    const host = fakeHost(log);
    const s = openCaptureSession(host, 64, 32);
    const px = await s.frame({ pos: [0, 10, 0], target: [0, 0, 0], fov: 30 }, { frames: 3, dt: 1 / 30 });
    expect(px.length).toBe(64 * 32 * 4);
    expect(host.camera.fov).toBe(30);
    expect(host.camera.aspect).toBe(2);
    // Looking straight down still has a defined orientation.
    expect(Number.isFinite(host.camera.quaternion.x)).toBe(true);
    await expect(Promise.all([s.frame({ pos: [0, 1, 0], target: [1, 0, 0] }), s.frame({ pos: [0, 1, 0], target: [1, 0, 0] })])).rejects.toThrow(/one at a time/);
    s.end();
    s.end();
    expect(host.camera.position.toArray()).toEqual([1, 2, 3]);
    expect(host.camera.fov).toBe(55);
    expect(host.camera.view === null || host.camera.view.enabled === false).toBe(true);
    expect(log.filter((l) => l === 'finish')).toHaveLength(1);
    await expect(s.frame({ pos: [0, 1, 0], target: [0, 0, 0] })).rejects.toThrow(/ended/);
  });

  it('keeps the tile offset under temporal-AA jitter and assembles tiled stills', async () => {
    const log: string[] = [];
    const host = fakeHost(log);
    let session: CaptureSession | null = null;
    const img = await captureStill(
      (w, h, vignette) => (session = openCaptureSession(host, w, h, { vignette })),
      { width: 300, height: 200, pose: { pos: [5, 5, 5], target: [0, 0, 0] }, tileSize: 256, frames: 2 },
    );
    expect(session).not.toBeNull();
    expect(img.width).toBe(300);
    expect(img.height).toBe(200);
    expect(log[0]).toBe('begin 256x200 vignette=false');
    // The jitter happens inside the tile window of the full image (offsets carry the tile origin).
    expect(log.some((l) => /^accumulate -?\d+\.25$/.test(l))).toBe(true);
    expect(log.filter((l) => l.startsWith('read 300x200@'))).toHaveLength(2);
    // Every pixel holds its own full-image coordinates (mod 256) before the vignette darkened the edges.
    const centre = (100 * 300 + 150) * 4;
    expect(img.data[centre]).toBe(150);
    expect(img.data[centre + 1]).toBe(100);
    const right = (100 * 300 + 260) * 4;
    expect(Math.abs((img.data[right] as number) - (260 & 0xff))).toBeLessThanOrEqual(1);
    expect(log[log.length - 1]).toBe('finish');
  });

  it('renders a single draw (with the GPU vignette) when the still fits', async () => {
    const log: string[] = [];
    const host = fakeHost(log);
    const img = await captureStill((w, h, v) => openCaptureSession(host, w, h, { vignette: v }), { width: 200, height: 100, pose: { pos: [5, 5, 5], target: [0, 0, 0] } });
    expect(log[0]).toBe('begin 200x100 vignette=true');
    expect(log.filter((l) => l.startsWith('read'))).toEqual(['read full']);
    expect(img.data[(50 * 200 + 120) * 4]).toBe(120);
  });

  it('stops a tiled still when cancelled', async () => {
    const host = fakeHost([]);
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(captureStill((w, h, v) => openCaptureSession(host, w, h, { vignette: v }), { width: 600, height: 600, tileSize: 256, pose: { pos: [1, 1, 1], target: [0, 0, 0] }, signal: ctrl.signal })).rejects.toThrow(/cancelled/);
  });
});

describe('glTF export scene', () => {
  it('flattens what the camera draws: batches instead of members, no hidden objects, plain PBR materials', () => {
    const camera = new PerspectiveCamera();
    const content = new Group();
    const entity = new Group();
    entity.userData[ENTITY_ID_KEY] = 'crate';
    entity.position.set(1, 2, 3);
    const box = new BoxGeometry(1, 1, 1);
    const visible = new Mesh(box, new MeshStandardMaterial({ color: 0xff0000, roughness: 0.3 }));
    entity.add(visible);
    const batchedMember = new Mesh(box, new MeshStandardMaterial());
    batchedMember.layers.set(BATCHED_LAYER);
    const hidden = new Mesh(box, new MeshBasicMaterial());
    hidden.visible = false;
    const batch = new InstancedMesh(box, new MeshStandardMaterial(), 10);
    batch.count = 4;
    for (let i = 0; i < 4; i++) batch.setMatrixAt(i, new Matrix4().makeTranslation(i, 0, 0));
    content.add(entity, batchedMember, hidden, batch);
    const scene = buildExportScene(content, camera);
    expect(scene.meshes).toBe(2);
    expect(scene.triangles).toBe(12 + 12 * 4);
    const names = scene.root.children.map((c) => c.name);
    expect(names).toContain('crate');
    const crate = scene.root.children.find((c) => c.name === 'crate') as Mesh;
    expect(crate.position.toArray()).toEqual([1, 2, 3]);
    const mat = crate.material as MeshStandardMaterial;
    expect(mat).toBeInstanceOf(MeshStandardMaterial);
    expect(mat.color.getHex()).toBe(0xff0000);
    expect(mat.roughness).toBeCloseTo(0.3);
    const inst = scene.root.children.find((c) => c instanceof InstancedMesh) as InstancedMesh;
    expect(inst.count).toBe(4);
    scene.dispose();
    expect(scene.root.children).toHaveLength(0);
  });

  it('keeps only textures the exporter can draw (regression: a non-image texture failed the whole export)', () => {
    const camera = new PerspectiveCamera();
    const content = new Group();
    const box = new BoxGeometry(1, 1, 1);
    const rgba = new DataTexture(new Uint8Array(4 * 4 * 4), 4, 4, RGBAFormat);
    const float = new DataTexture(new Float32Array(4 * 4 * 4), 4, 4, RGBAFormat, FloatType);
    const placeholder = new Texture({ width: 8, height: 8 } as unknown as HTMLImageElement);
    content.add(new Mesh(box, new MeshStandardMaterial({ map: rgba, normalMap: float, roughnessMap: placeholder })));
    const scene = buildExportScene(content, camera);
    const m = (scene.root.children[0] as Mesh).material as MeshStandardMaterial;
    expect(m.map).toBe(rgba);
    expect(m.normalMap).toBeNull();
    expect(m.roughnessMap).toBeNull();
    scene.dispose();
  });

  it('respects the triangle budget', () => {
    const camera = new PerspectiveCamera();
    const content = new Group();
    const box = new BoxGeometry(1, 1, 1);
    for (let i = 0; i < 5; i++) content.add(new Mesh(box, new MeshStandardMaterial()));
    const scene = buildExportScene(content, camera, 30);
    expect(scene.meshes).toBe(2);
    expect(scene.skipped).toBe(3);
  });
});
