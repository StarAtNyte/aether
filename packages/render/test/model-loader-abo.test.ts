import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Group, Object3D } from 'three';
import { ABO_REMOTE_BASE, aboEntries, aboPath, libraryUrl, loadAboIndex, loadCatalog } from '@aether/assets';

const parsed: string[] = [];
vi.mock('three/addons/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class {
    setMeshoptDecoder(): this {
      return this;
    }
    setKTX2Loader(): this {
      return this;
    }
    async loadAsync(): Promise<never> {
      throw new Error('product files are fetched, then parsed');
    }
    async parseAsync(_data: ArrayBuffer, path: string): Promise<{ scene: Object3D; animations: [] }> {
      parsed.push(path);
      return { scene: new Group(), animations: [] };
    }
  },
}));
vi.mock('three/addons/libs/meshopt_decoder.module.js', () => ({ MeshoptDecoder: {} }));

const { createGltfModelLoader, isSafeModelUrl } = await import('../src/geometry/model-loader');

const fetched: string[] = [];
beforeAll(async () => {
  await loadCatalog();
  await loadAboIndex();
  vi.stubGlobal('fetch', async (url: string) => {
    fetched.push(url);
    return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
  });
});
afterEach(() => {
  fetched.length = 0;
  parsed.length = 0;
});

/** A compression stand-in: KTX2 on, with the renderer's texture cap. */
const compression = (cap: number): never => ({ state: 'on', loader: async () => ({}), textureCap: () => cap }) as never;

describe('Amazon Berkeley Objects in the model loader', () => {
  const art = (): ReturnType<typeof aboEntries>[number] => aboEntries().find((e) => e.interior?.type === 'picture' && e.placement === 'wall')!;

  it('accepts the pinned pack files and nothing else of Hugging Face', () => {
    expect(isSafeModelUrl(`${ABO_REMOTE_BASE}${aboPath('B0714QGC72', 0)}`)).toBe(true);
    expect(isSafeModelUrl('https://huggingface.co/datasets/codepawl/abo-glb/resolve/main/objects/B0714QGC72/B0714QGC72.glb')).toBe(false);
    expect(isSafeModelUrl('https://huggingface.co/datasets/other/repo/resolve/x/model.glb')).toBe(false);
  });

  it('loads the WebP copy where KTX2 cannot be read', async () => {
    const e = art();
    const id = e.id.slice(4).toUpperCase();
    await createGltfModelLoader({ compression: null }).load(libraryUrl(e.lods[0]!.file));
    expect(fetched).toEqual([`${ABO_REMOTE_BASE}objects/${id}/${id}.glb`]);
  });

  it('never loads a level whose textures exceed the cap (512 px on integrated GPUs)', async () => {
    const e = art();
    const id = e.id.slice(4).toUpperCase();
    await createGltfModelLoader({ compression: compression(512) }).load(libraryUrl(e.file!));
    expect(fetched).toEqual([`${ABO_REMOTE_BASE}lods/${id}/${id}_lod2.glb`]);
    fetched.length = 0;
    await createGltfModelLoader({ compression: compression(0) }).load(libraryUrl(e.file!));
    expect(fetched).toEqual([`${ABO_REMOTE_BASE}objects_ktx2/${id}/${id}.glb`]);
  });

  it('puts the product on a floor-centre pivot (wall art hangs centred on its back)', async () => {
    const e = art();
    const root = await createGltfModelLoader({ compression: compression(0) }).load(libraryUrl(e.file!));
    expect(root.name).toBe('abo-product');
    const inner = root.children[0]!;
    expect(inner.position.y).toBeCloseTo(e.size[1] / 2, 2);
    expect(inner.position.z).toBeCloseTo(-e.size[2] / 2, 2);
  });
});
