/**
 * glTF model loading for `shape.kind === 'model'`. URLs come from the World IR
 * (i.e. potentially from an LLM), so they are allowlisted by scheme, loaded
 * models are shared per URL (refcounted) and each entity gets a lightweight
 * clone that reuses the source geometry and materials.
 */
import { Box3, Group, Mesh, Sphere, Vector3, type Material, type Object3D, type Skeleton, type SkinnedMesh } from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import type { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { isAllowedModelUrl, MAX_MODEL_URL_LENGTH } from '@aether/core';
import { aboFileOf, aboLoadUrl, aboOffset, isAboRemoteUrl, isLibraryRemoteUrl, loadTextureVariants, textureVariantUrl } from '@aether/assets';
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
  // Plus the library CDN of a lean studio build (its base is fixed at build time, see `isLibraryRemoteUrl`) and the
  // product files of the Amazon Berkeley Objects pack at its pinned Hugging Face revision (`isAboRemoteUrl`).
  return isAllowedModelUrl(url) || isLibraryRemoteUrl(url) || isAboRemoteUrl(url);
}

/** Draw objects and palettes belong to an instance; geometry/material resources belong to the source cache. */
interface ModelInstance {
  objects: Object3D[];
  skeletons: Set<Skeleton> | null;
}
const ownedInstances = new WeakMap<Object3D, ModelInstance>();

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
  parseAsync(data: ArrayBuffer, path: string): Promise<{ scene: Object3D; animations: Object3D['animations'] }>;
  setKTX2Loader(loader: KTX2Loader): unknown;
}

/** Cache Storage bucket of Amazon Berkeley Objects files (pinned revision: a URL's bytes never change). */
export const ABO_CACHE = 'aether-abo-v1';
const aboInFlight = new Map<string, Promise<ArrayBuffer>>();

/**
 * Bytes of a product file: from the page's Cache Storage when it has them (a product loads once per browser, not per
 * session: Hugging Face's redirect is `no-store`), else fetched, kept and shared by concurrent loads of the same file.
 */
function fetchAbo(url: string): Promise<ArrayBuffer> {
  const pending = aboInFlight.get(url);
  if (pending) return pending;
  const p = (async (): Promise<ArrayBuffer> => {
    const cache = typeof caches !== 'undefined' ? await caches.open(ABO_CACHE).catch(() => null) : null;
    const hit = cache ? await cache.match(url).catch(() => undefined) : undefined;
    if (hit) return hit.arrayBuffer();
    const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.slice(0, 160)}`);
    if (cache) await cache.put(url, res.clone()).catch(() => undefined);
    return res.arrayBuffer();
  })().finally(() => aboInFlight.delete(url));
  aboInFlight.set(url, p);
  return p;
}

/**
 * An Amazon Berkeley Objects product file wrapped so its base rests on y = 0, centred on X/Z (the shift comes from the
 * index, the same for every level, so the levels of one product line up).
 */
function normaliseAbo(url: string, scene: Object3D): Object3D {
  const off = aboOffset(url);
  if (!off) return scene;
  const root = new Group();
  root.name = 'abo-product';
  scene.position.set(scene.position.x + off[0], scene.position.y + off[1], scene.position.z + off[2]);
  scene.updateMatrix();
  root.add(scene);
  root.animations = scene.animations;
  return root;
}

/**
 * Default glTF loader (lazy-imports `GLTFLoader` and the meshopt decoder,
 * so Node tests and worlds without glTF files never load them).
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
    ]).then(([{ GLTFLoader }, { MeshoptDecoder }]) => {
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
      // Amazon Berkeley Objects: KTX2 levels where the transcoder runs (never above the renderer's texture cap), the WebP
      // copy where it does not.
      if (aboFileOf(url)) {
        const parse = async (target: string, loader: GltfLike): Promise<Object3D> => {
          if (!isSafeModelUrl(target)) throw new Error('model url rejected');
          const gltf = await loader.parseAsync(await fetchAbo(target), target.slice(0, target.lastIndexOf('/') + 1));
          gltf.scene.animations = gltf.animations;
          sharpenObject(gltf.scene);
          return normaliseAbo(url, gltf.scene);
        };
        const webp = aboLoadUrl(url, { ktx2: false, textureCap: 0 }) ?? url;
        if (!withKtx2) return parse(webp, await base());
        try {
          return await parse(aboLoadUrl(url, { ktx2: true, textureCap: opts.compression?.textureCap() ?? 0 }) ?? url, withKtx2);
        } catch (e) {
          log.warn(`KTX2 copy of ${url.slice(0, 160)} failed, loading the WebP copy: ${errorMessage(e)}`);
          return parse(webp, await base());
        }
      }
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
  const skinned = hasSkin(source);
  const clone = skinned ? cloneSkeleton(source) : source.clone(true);
  if (skinned) shareSkeletons(clone);
  const instance: ModelInstance = { objects: [], skeletons: skinned ? new Set<Skeleton>() : null };
  clone.traverse((object) => {
    const draw = object as Object3D & { isMesh?: boolean; isLine?: boolean; isPoints?: boolean; isSprite?: boolean };
    if (draw.isMesh || draw.isLine || draw.isPoints || draw.isSprite) instance.objects.push(object);
    const mesh = object as SkinnedMesh;
    if (mesh.isSkinnedMesh && mesh.skeleton) instance.skeletons?.add(mesh.skeleton);
  });
  ownedInstances.set(clone, instance);
  clone.animations = source.animations;
  return clone;
}

/**
 * Release instance draw state and palettes once, through wrappers and LODs. Source geometry/materials
 * and their textures are untouched. Collect before notifying listeners, which may alter the tree.
 */
export function disposeModelInstance(root: Object3D): void {
  const instances: ModelInstance[] = [];
  root.traverse((object) => {
    const instance = ownedInstances.get(object);
    if (!instance) return;
    ownedInstances.delete(object);
    instances.push(instance);
  });
  for (const instance of instances) {
    for (const object of instance.objects) {
      // The common renderer subscribes to object disposal to free render objects, bindings and uniform buffers.
      (object as unknown as { dispatchEvent(event: { type: 'dispose' }): void }).dispatchEvent({ type: 'dispose' });
    }
    if (instance.skeletons) for (const skeleton of instance.skeletons) skeleton.dispose();
  }
}

/**
 * SkeletonUtils forks a palette per mesh. Parts of one fresh model can share the palette when every
 * bone reference and inverse bind matrix is identical. Instance-local scope prevents actors sharing poses.
 * Already uploaded skeletons are left alone: no GPU resource is discarded by this setup optimization.
 */
export function shareSkeletons(root: Object3D): number {
  const groups = new WeakMap<Object3D, Skeleton[]>();
  let shared = 0;
  root.traverse((object) => {
    const mesh = object as SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    const skeleton = mesh.skeleton;
    const first = skeleton?.bones[0];
    if (!first || skeleton.boneTexture !== null) return;
    let candidates = groups.get(first);
    if (!candidates) {
      candidates = [];
      groups.set(first, candidates);
    }
    for (const candidate of candidates) {
      if (candidate === skeleton) return;
      if (!sameSkinBindings(candidate, skeleton)) continue;
      mesh.skeleton = candidate;
      shared++;
      return;
    }
    candidates.push(skeleton);
  });
  return shared;
}

function sameSkinBindings(a: Skeleton, b: Skeleton): boolean {
  if (a.bones.length !== b.bones.length || a.boneInverses.length !== b.boneInverses.length) return false;
  for (let i = 0; i < a.bones.length; i++) if (a.bones[i] !== b.bones[i]) return false;
  for (let i = 0; i < a.boneInverses.length; i++) {
    if (a.boneInverses[i] !== b.boneInverses[i] && !a.boneInverses[i]!.equals(b.boneInverses[i]!)) return false;
  }
  return true;
}

type SkinnedLike = Object3D & { isSkinnedMesh?: boolean; boundingSphere: Sphere | null; computeBoundingSphere(): void; skeleton: { update(): void } };

/** Source skinned meshes whose bounds were already widened (clones copy the sphere from their source). */
const boundedSources = new WeakSet<Object3D>();

/**
 * Give every skinned mesh of a loaded model a conservative bounding sphere, so it can be frustum culled like any other mesh.
 * three tests the bind-pose bounds of the geometry, which do not follow the animation; the pose-computed sphere is widened
 * by half its radius plus half a metre, enough for the in-place gaits, wing beats and tail swings of the library models.
 * Without this every skinned mesh of a world (368 in Highland Trail, each a draw call per pass) was drawn whether or not
 * it was in view.
 */
function widenSkinBounds(source: Object3D): void {
  if (boundedSources.has(source)) return;
  boundedSources.add(source);
  source.updateMatrixWorld(true);
  source.traverse((o) => {
    const m = o as SkinnedLike;
    if (m.isSkinnedMesh !== true) return;
    try {
      m.skeleton.update();
      m.computeBoundingSphere();
      const b = m.boundingSphere;
      if (b && !b.isEmpty() && Number.isFinite(b.radius)) b.radius = b.radius * 1.5 + 0.5;
      else m.boundingSphere = null;
    } catch {
      m.boundingSphere = null;
    }
  });
}

/**
 * Clone a library / imported asset: models are already normalised (metres,
 * base on y = 0, centred), so only a uniform `scale` is applied. Skinned
 * meshes are frustum culled by a widened pose-computed sphere (see {@link widenSkinBounds});
 * one whose bounds cannot be computed is never culled.
 */
export function instantiateAsset(source: Object3D, scale: number): Group {
  widenSkinBounds(source);
  const clone = cloneModel(source);
  const wrapper = new Group();
  wrapper.name = 'asset';
  wrapper.add(clone);
  if (scale !== 1) clone.scale.multiplyScalar(scale);
  clone.traverse((o) => {
    const m = o as SkinnedLike;
    if (m.isSkinnedMesh === true && m.boundingSphere === null) o.frustumCulled = false;
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
