/**
 * glTF model loading for `shape.kind === 'model'`. URLs come from the World IR
 * (i.e. potentially from an LLM), so they are allowlisted by scheme, loaded
 * models are shared per URL (refcounted) and each entity gets a lightweight
 * clone that reuses the source geometry and materials.
 */
import { Box3, Group, Mesh, Vector3, type Material, type Object3D } from 'three';
import type { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { isAllowedModelUrl, MAX_MODEL_URL_LENGTH } from '@aether/core';
import { loadTextureVariants, textureVariantUrl } from '@aether/assets';
import type { TextureCompression } from '../gpu/texture-compression';
import { errorMessage, log } from '../log';
import { RefCache } from '../refcache';
import { sharpenObject } from '../materials/anisotropy';

/** Loads a model URL into a scene graph. Injected so tests can fake it. */
export interface ModelLoader {
  load(url: string): Promise<Object3D>;
}

export { MAX_MODEL_URL_LENGTH };

/**
 * True for URLs the renderer may fetch: same-origin relative paths, `blob:`,
 * glTF `data:` URIs and `https:` URLs on the core asset-host allowlist
 * (`MODEL_URL_HTTPS_HOSTS`). Rejects `http:`, `javascript:`, `file:`,
 * protocol-relative `//host` and any other host or scheme. Same policy as
 * world validation (`isAllowedModelUrl` in @aether/core).
 */
export function isSafeModelUrl(url: string): boolean {
  return isAllowedModelUrl(url);
}

/** Skeleton-aware clone (three's `SkeletonUtils.clone`), installed when the glTF loader module loads. */
let skeletonClone: ((source: Object3D) => Object3D) | null = null;

/** Options of {@link createGltfModelLoader}. */
export interface GltfLoaderOptions {
  /**
   * KTX2 support of the renderer: library files with a GPU-compressed twin (`textureVariantUrl`)
   * load that twin when it resolves a loader; otherwise, and whenever the twin fails, the original
   * file loads. Omitted: originals only.
   */
  compression?: TextureCompression | null;
  /** Compressed twin of a model URL (default: the library index, loaded on first use). Injected by tests. */
  variantOf?: (url: string) => Promise<string | null>;
}

/**
 * Character bodies and motion sets (`/c/`) load as they are. Their WebP textures are 0.7 MB, the KTX2 twin 2.8 MB, and a
 * recoloured body has to download the original's images anyway (see `COMPRESSED_SOURCE_KEY`): the twin only added bytes.
 */
export const CHARACTER_FILE = /\/c\/[^/]+\.glb$/;

const libraryVariant = async (url: string): Promise<string | null> => (CHARACTER_FILE.test(url) ? null : textureVariantUrl(url, await loadTextureVariants()));

interface GltfLike {
  loadAsync(url: string): Promise<{ scene: Object3D; animations: Object3D['animations'] }>;
  setKTX2Loader(loader: KTX2Loader): unknown;
}

/**
 * Default glTF loader (lazy-imports `GLTFLoader`, the meshopt decoder and
 * `SkeletonUtils`, so Node tests and worlds without models never load them).
 * Library files are meshopt-compressed (`EXT_meshopt_compression`); the
 * decoder is a small WebAssembly module (allowed by the `wasm-unsafe-eval`
 * CSP). Animation clips are kept on `scene.animations`. With
 * `opts.compression`, library models load their KTX2 twins (see
 * {@link GltfLoaderOptions}).
 */
export function createGltfModelLoader(opts: GltfLoaderOptions = {}): ModelLoader {
  let loader: Promise<GltfLike> | null = null;
  let ktx2Ready: Promise<boolean> | null = null;
  const variantOf = opts.variantOf ?? libraryVariant;
  const base = (): Promise<GltfLike> =>
    (loader ??= Promise.all([
      import('three/addons/loaders/GLTFLoader.js'),
      import('three/addons/libs/meshopt_decoder.module.js'),
      import('three/addons/utils/SkeletonUtils.js'),
    ]).then(([{ GLTFLoader }, { MeshoptDecoder }, { clone }]) => {
      skeletonClone = clone;
      return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder) as unknown as GltfLike;
    }));
  /** The glTF loader with the KTX2 loader attached, or null when compressed textures are off. */
  const compressed = async (): Promise<GltfLike | null> => {
    const c = opts.compression;
    if (!c) return null;
    const gltf = await base();
    ktx2Ready ??= c.loader().then((k) => {
      if (k) gltf.setKTX2Loader(k);
      return k !== null;
    });
    return (await ktx2Ready) && c.state === 'on' ? gltf : null;
  };
  return {
    async load(url: string): Promise<Object3D> {
      if (!isSafeModelUrl(url)) throw new Error('model url rejected (only same-origin paths, blob:/glTF data: URLs and allowlisted https hosts)');
      const withKtx2 = await compressed();
      const twin = withKtx2 ? await variantOf(url).catch(() => null) : null;
      if (withKtx2 && twin && isSafeModelUrl(twin)) {
        try {
          const gltf = await withKtx2.loadAsync(twin);
          gltf.scene.animations = gltf.animations;
          gltf.scene.userData[COMPRESSED_SOURCE_KEY] = url;
          sharpenObject(gltf.scene);
          return gltf.scene;
        } catch (e) {
          log.warn(`compressed twin of ${url} failed, loading the original: ${errorMessage(e)}`);
        }
      }
      const gltf = await (await base()).loadAsync(url);
      gltf.scene.animations = gltf.animations;
      sharpenObject(gltf.scene);
      return gltf.scene;
    },
  };
}

/** `userData` key on a model loaded from its KTX2 twin: the original file's URL. */
export const COMPRESSED_SOURCE_KEY = 'aetherCompressedSource';

/** True when the tree contains skinned meshes (needs a skeleton-aware clone). */
export function hasSkin(root: Object3D): boolean {
  let skinned = false;
  root.traverse((o) => {
    if ((o as { isSkinnedMesh?: boolean }).isSkinnedMesh) skinned = true;
  });
  return skinned;
}

/** Clone a loaded model for one entity (geometry and materials shared; skeletons rebound). */
export function cloneModel(source: Object3D): Object3D {
  const clone = skeletonClone && hasSkin(source) ? skeletonClone(source) : source.clone(true);
  clone.animations = source.animations;
  return clone;
}

/**
 * Clone a library / imported asset: models are already normalised (metres,
 * base on y = 0, centred), so only a uniform `scale` is applied. Skinned
 * meshes skip frustum culling (their bind-pose bounds do not follow the
 * animation).
 */
export function instantiateAsset(source: Object3D, scale: number): Group {
  const clone = cloneModel(source);
  const wrapper = new Group();
  wrapper.name = 'asset';
  wrapper.add(clone);
  if (scale !== 1) clone.scale.multiplyScalar(scale);
  clone.traverse((o) => {
    if ((o as { isSkinnedMesh?: boolean }).isSkinnedMesh) o.frustumCulled = false;
  });
  clone.updateMatrix();
  return wrapper;
}

function disposeTree(root: Object3D): void {
  const materials = new Set<Material>();
  root.traverse((o) => {
    if (o instanceof Mesh) {
      o.geometry.dispose();
      const m: Material | Material[] = o.material;
      if (Array.isArray(m)) for (const x of m) materials.add(x);
      else materials.add(m);
    }
  });
  for (const m of materials) {
    for (const value of Object.values(m)) if (value && typeof value === 'object' && 'isTexture' in value) (value as { dispose(): void }).dispose();
    m.dispose();
  }
}

/** Shared model sources: one load per URL, disposed when the last user releases it. */
export class ModelCache {
  private readonly cache = new RefCache<Promise<Object3D>>((p) => {
    p.then(disposeTree, () => undefined);
  });

  constructor(private readonly loader: ModelLoader) {}

  /** Retain and (if needed) start loading `url`. Pair with {@link release}. */
  acquire(url: string): Promise<Object3D> {
    return this.cache.acquire(url, () => {
      const p = isSafeModelUrl(url) ? this.loader.load(url) : Promise.reject(new Error('model url rejected'));
      p.catch(() => undefined); // observed by callers; avoid unhandled rejections in the cache itself
      return p;
    });
  }

  /** Release one reference. */
  release(url: string): void {
    this.cache.release(url);
  }

  /** Number of cached URLs. */
  get size(): number {
    return this.cache.size;
  }

  /** Dispose everything. */
  dispose(): void {
    this.cache.clear();
  }
}

const _box = new Box3();
const _size = new Vector3();
const _center = new Vector3();

/**
 * Clone a loaded model (sharing geometry/materials) and normalize it: scaled
 * so its largest dimension equals `fitSize` (when given), centered in X/Z and
 * resting on y = 0 like procedural outputs.
 */
export function instantiateModel(source: Object3D, fitSize?: number): Group {
  const clone = cloneModel(source);
  const wrapper = new Group();
  wrapper.name = 'model';
  wrapper.add(clone);
  clone.updateMatrixWorld(true);
  _box.setFromObject(clone);
  if (_box.isEmpty()) return wrapper;
  _box.getSize(_size);
  const largest = Math.max(_size.x, _size.y, _size.z);
  const s = fitSize && fitSize > 0 && largest > 1e-9 ? fitSize / largest : 1;
  _box.getCenter(_center);
  clone.position.multiplyScalar(s);
  clone.position.x -= _center.x * s;
  clone.position.y -= _box.min.y * s;
  clone.position.z -= _center.z * s;
  clone.scale.multiplyScalar(s);
  clone.updateMatrix();
  return wrapper;
}
