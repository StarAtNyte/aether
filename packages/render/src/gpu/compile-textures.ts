/** Upload known material textures between tasks, before native compileAsync enters its atomic binding phase. */
import type { WebGPURenderer } from 'three/webgpu';
import { textureWork } from './task-queue';

export interface UploadTexture {
  version: number;
  isTexture?: boolean;
  image?: { complete?: boolean } | unknown[];
  source?: { dataReady?: boolean };
  isRenderTargetTexture?: boolean;
  isDepthTexture?: boolean;
  isFramebufferTexture?: boolean;
  isVideoTexture?: boolean;
  isStorageTexture?: boolean;
  isExternalTexture?: boolean;
  isHTMLTexture?: boolean;
}
interface RenderObject { material?: unknown; getBindings(): Array<{ bindings: Array<{ isSampledTexture?: boolean; texture?: UploadTexture | null }> }> }
interface Port {
  _nodes: { getForRenderAsync(object: RenderObject): Promise<unknown> };
  _textures: { get(texture: UploadTexture): { initialized?: boolean; version?: number } };
  initTexture(texture: UploadTexture): void;
}
/** Scheduling is injectable so cancellation and interleavings can be checked without a GPU. */
type Schedule = (upload: () => void) => Promise<void>;

export function textureReadyForUpload(texture: UploadTexture): boolean {
  const image = texture.image;
  return !!image && texture.version > 0 && texture.source?.dataReady !== false
    && (Array.isArray(image) ? image.every(i => i && (i as { complete?: boolean }).complete !== false) : image.complete !== false)
    && !texture.isRenderTargetTexture && !texture.isDepthTexture && !texture.isFramebufferTexture
    && !texture.isVideoTexture && !texture.isStorageTexture && !texture.isExternalTexture && !texture.isHTMLTexture;
}

interface MaterialReference {
  isMaterialReferenceNode?: boolean;
  uniformType?: string;
  material?: unknown;
  getValueFromReference?(object: unknown): unknown;
}
const noTextures: readonly UploadTexture[] = Object.freeze([]);
/** Resolve only texture references actually used by the built shader, without mutating shared reference nodes. */
export function materialReferenceTextures(state: unknown, material: unknown): readonly UploadTexture[] {
  const nodes = (state as { updateNodes?: MaterialReference[] } | undefined)?.updateNodes;
  if (!nodes) return noTextures;
  let textures: UploadTexture[] | undefined;
  for (const node of nodes) {
    if (!node.isMaterialReferenceNode || (node.uniformType !== 'texture' && node.uniformType !== 'cubeTexture') || !node.getValueFromReference) continue;
    const value = node.getValueFromReference(node.material ?? material) as UploadTexture | null;
    if (value?.isTexture && textureReadyForUpload(value)) (textures ??= []).push(value);
  }
  return textures ?? noTextures;
}

export function prepareCompileTextures(renderer: WebGPURenderer, schedule: Schedule = upload => textureWork.run(upload, 'material texture upload')): { dispose(): void } {
  const r = renderer as unknown as Port;
  const build = r._nodes?.getForRenderAsync;
  if (typeof build !== 'function' || typeof r._textures?.get !== 'function' || typeof r.initTexture !== 'function') return { dispose() {} };
  let disposed = false;
  const check = (): void => { if (disposed) throw new DOMException('Renderer disposed during texture preparation', 'AbortError'); };
  const current = (texture: UploadTexture): boolean => {
    const data = r._textures.get(texture);
    return data.initialized === true && data.version === texture.version;
  };
  async function getForRenderAsync(this: Port['_nodes'], object: RenderObject): Promise<unknown> {
    check();
    const result = await build.call(this, object);
    check();
    // Native compilation has not set _isPreCompiling yet. No renderer target or pass state
    // is held over these yields; dynamic/target textures remain in the normal updateBefore path.
    for (const texture of materialReferenceTextures(result, object.material)) {
      if (current(texture)) continue;
      await schedule(() => { check(); if (textureReadyForUpload(texture) && !current(texture)) r.initTexture(texture); });
      check();
    }
    for (const group of object.getBindings()) for (const binding of group.bindings) {
      const texture = binding.texture;
      if (!binding.isSampledTexture || !texture || !textureReadyForUpload(texture) || current(texture)) continue;
      await schedule(() => {
        check();
        // A concurrent warmup, late image, or version change may have altered the need for upload.
        if (textureReadyForUpload(texture) && !current(texture)) r.initTexture(texture);
      });
      check();
    }
    return result;
  }
  r._nodes.getForRenderAsync = getForRenderAsync;
  return { dispose() {
    if (disposed) return;
    disposed = true;
    if (r._nodes.getForRenderAsync === getForRenderAsync) r._nodes.getForRenderAsync = build;
  } };
}
