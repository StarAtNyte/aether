/**
 * Imported images as framed posters / decals. Textures are shared per URL
 * (refcounted, disposed with the last user); each poster owns its small
 * frame and picture geometries, released through the returned dispose.
 */
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, PlaneGeometry, SRGBColorSpace, TextureLoader, type Texture } from 'three';
import { isAllowedModelUrl } from '@aether/core';
import { RefCache } from '../refcache';
import { TEXTURE_ANISOTROPY } from '../materials/anisotropy';

/** Loads a texture from a URL. Injected so tests can fake it. */
export interface TextureSource {
  load(url: string): Promise<Texture>;
}

/** Browser texture loader (same-origin / blob: URLs only). */
export function createTextureSource(): TextureSource {
  const loader = new TextureLoader();
  return {
    async load(url: string): Promise<Texture> {
      if (!url.startsWith('blob:') && !(url.startsWith('/') && isAllowedModelUrl(url))) throw new Error('image url rejected');
      const tex = await loader.loadAsync(url);
      tex.colorSpace = SRGBColorSpace;
      tex.anisotropy = TEXTURE_ANISOTROPY;
      return tex;
    },
  };
}

/** Shared textures, one load per URL. */
export class TextureCache {
  private readonly cache = new RefCache<Promise<Texture>>((p) => {
    p.then((t) => t.dispose(), () => undefined);
  });

  constructor(private readonly source: TextureSource) {}

  /** Retain (and load if needed). Pair with {@link release}. */
  acquire(url: string): Promise<Texture> {
    return this.cache.acquire(url, () => {
      const p = this.source.load(url);
      p.catch(() => undefined);
      return p;
    });
  }

  release(url: string): void {
    this.cache.release(url);
  }

  get size(): number {
    return this.cache.size;
  }

  dispose(): void {
    this.cache.clear();
  }
}

/** Frame border (metres) around a poster. */
const FRAME = 0.035;

/**
 * A framed picture `width` × `height` metres, `depth` thick, standing on
 * y = 0 and facing +Z. Returns the group and a dispose for its own
 * geometries and materials (the texture belongs to the cache).
 */
export function createPoster(texture: Texture, width: number, height: number, depth: number): { group: Group; dispose: () => void } {
  const group = new Group();
  group.name = 'poster';
  const frameGeo = new BoxGeometry(width + FRAME * 2, height + FRAME * 2, depth);
  const frameMat = new MeshStandardMaterial({ color: '#2b2622', roughness: 0.6, metalness: 0.1 });
  const frame = new Mesh(frameGeo, frameMat);
  frame.position.set(0, height / 2 + FRAME, 0);
  const picGeo = new PlaneGeometry(width, height);
  const picMat = new MeshStandardMaterial({ map: texture, roughness: 0.55, metalness: 0 });
  const pic = new Mesh(picGeo, picMat);
  pic.position.set(0, height / 2 + FRAME, depth / 2 + 0.001);
  group.add(frame, pic);
  return {
    group,
    dispose: () => {
      frameGeo.dispose();
      frameMat.dispose();
      picGeo.dispose();
      picMat.dispose();
    },
  };
}

/** Give every mesh of `target` the material of the mesh at the same traversal index in `source` (LOD files ship without textures). */
export function shareMaterials(source: { traverse(cb: (o: unknown) => void): void }, target: { traverse(cb: (o: unknown) => void): void }): void {
  const mats: unknown[] = [];
  source.traverse((o) => {
    if (o instanceof Mesh) mats.push(o.material);
  });
  let i = 0;
  target.traverse((o) => {
    if (o instanceof Mesh) {
      const m = mats[i++];
      if (m) o.material = m as Mesh['material'];
    }
  });
}
