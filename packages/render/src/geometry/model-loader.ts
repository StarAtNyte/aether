/**
 * glTF model loading for `shape.kind === 'model'`. URLs come from the World IR
 * (i.e. potentially from an LLM), so they are allowlisted by scheme, loaded
 * models are shared per URL (refcounted) and each entity gets a lightweight
 * clone that reuses the source geometry and materials.
 */
import { Box3, Group, Mesh, Vector3, type Material, type Object3D } from 'three';
import { isAllowedModelUrl, MAX_MODEL_URL_LENGTH } from '@aether/core';
import { RefCache } from '../refcache';

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

/**
 * Default glTF loader (lazy-imports `GLTFLoader`, the meshopt decoder and
 * `SkeletonUtils`, so Node tests and worlds without models never load them).
 * Library files are meshopt-compressed (`EXT_meshopt_compression`); the
 * decoder is a small WebAssembly module (allowed by the `wasm-unsafe-eval`
 * CSP). Animation clips are kept on `scene.animations`.
 */
export function createGltfModelLoader(): ModelLoader {
  let loader: Promise<{ loadAsync(url: string): Promise<{ scene: Object3D; animations: Object3D['animations'] }> }> | null = null;
  return {
    async load(url: string): Promise<Object3D> {
      if (!isSafeModelUrl(url)) throw new Error('model url rejected (only same-origin paths, blob:/glTF data: URLs and allowlisted https hosts)');
      loader ??= Promise.all([
        import('three/addons/loaders/GLTFLoader.js'),
        import('three/addons/libs/meshopt_decoder.module.js'),
        import('three/addons/utils/SkeletonUtils.js'),
      ]).then(([{ GLTFLoader }, { MeshoptDecoder }, { clone }]) => {
        skeletonClone = clone;
        return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
      });
      const gltf = await (await loader).loadAsync(url);
      gltf.scene.animations = gltf.animations;
      return gltf.scene;
    },
  };
}

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
