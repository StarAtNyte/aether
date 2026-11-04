/**
 * Runtime patches for per-frame CPU cost in three.js's renderer (r186). Each one keeps three's behaviour and only
 * removes work; each is idempotent and falls back to the default path when the internals it touches are missing.
 */
import { Material } from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { cacheUniformUploads } from './gpu/buffer-uploads';
import { cacheUniformBindingKeys } from './gpu/uniform-binding-keys';
import { cachePixelStoreState } from './gpu/pixel-store-cache';
import { specializeTextureUvMath } from './gpu/uv-transform';
import { shareOpaqueShadowPrograms } from './gpu/opaque-shadow-nodes';
import { installMatrixDirtyCheck } from './gpu/matrix-dirty-check';

let alphaSetterPatched = false;

/**
 * The renderer's shadow passes draw every caster with one shared override material and copy the caster's `alphaTest`
 * onto it before each draw. three bumps `material.version` whenever that flips between "on" and "off", so each frame
 * the override's version moved several times and every render object (one per caster and pass) saw a stale version,
 * recomputed its whole material cache key (property scan, regexes, string building: 9 to 13 ms and 5 to 11 MB of
 * garbage per frame on Highland Trail) and found it unchanged. The version is not bumped for shadow-pass materials
 * any more; the on/off bit is mixed into the render object's dynamic key instead, so a caster whose own alpha test
 * really changes still rebuilds its shadow program.
 */
function patchShadowAlphaTest(): void {
  if (alphaSetterPatched) return;
  alphaSetterPatched = true;
  const proto = Material.prototype as unknown as Record<string, unknown>;
  const d = Object.getOwnPropertyDescriptor(proto, 'alphaTest');
  if (!d || typeof d.set !== 'function' || typeof d.get !== 'function') return;
  const set = d.set;
  Object.defineProperty(proto, 'alphaTest', {
    configurable: true,
    enumerable: d.enumerable ?? false,
    get: d.get,
    set(this: { isShadowPassMaterial?: boolean; _alphaTest: number }, value: number) {
      if (this.isShadowPassMaterial === true) this._alphaTest = value;
      else set.call(this, value);
    },
  });
}

interface RenderObjectLike {
  material: { isShadowPassMaterial?: boolean; _alphaTest?: number };
  getDynamicCacheKey(): number;
}

/** Mix the shadow override's alpha-test bit into the render object's dynamic key (see {@link patchShadowAlphaTest}). */
function patchRenderObject(r: WebGPURenderer): void {
  const objects = (r as unknown as { _objects?: { createRenderObject?: (...a: unknown[]) => RenderObjectLike } })._objects;
  const create = objects?.createRenderObject;
  if (!objects || typeof create !== 'function') return;
  objects.createRenderObject = function (this: unknown, ...args: unknown[]): RenderObjectLike {
    const ro = create.apply(this, args);
    const proto = Object.getPrototypeOf(ro) as { getDynamicCacheKey: () => number; __aetherKeyed?: boolean };
    if (!proto.__aetherKeyed && typeof proto.getDynamicCacheKey === 'function') {
      proto.__aetherKeyed = true;
      const dynamicKey = proto.getDynamicCacheKey;
      proto.getDynamicCacheKey = function (this: RenderObjectLike): number {
        const k = dynamicKey.call(this);
        const m = this.material;
        return m.isShadowPassMaterial === true && (m._alphaTest ?? 0) > 0 ? k + 1 : k;
      };
    }
    return ro;
  };
}

export function installRenderPatches(r: WebGPURenderer): void {
  try {
    patchShadowAlphaTest();
    installMatrixDirtyCheck();
    patchRenderObject(r);
    cacheUniformUploads(r.backend as unknown as Parameters<typeof cacheUniformUploads>[0]);
    cacheUniformBindingKeys(r.backend as unknown as Parameters<typeof cacheUniformBindingKeys>[0]);
    cachePixelStoreState(r.backend as unknown as Parameters<typeof cachePixelStoreState>[0]);
    specializeTextureUvMath();
    if ((globalThis as { __AETHER_OPAQUE_SHADOWS?: boolean }).__AETHER_OPAQUE_SHADOWS !== false) shareOpaqueShadowPrograms(r);
  } catch {
    // The default paths still work, only slower.
  }
}
