/** Exact, bounded caster-input snapshots; unknown/dynamic casters conservatively keep live shadow updates. */
import { hasStaticShadowAlpha } from './shadow-alpha';
import { Material, Object3D, VSMShadowMap, type Mesh, type Texture, type BufferAttribute, type InterleavedBufferAttribute } from 'three';

const MATERIAL_INPUTS = ['visible', 'side', 'shadowSide', 'alphaTest', 'alphaHash', 'alphaToCoverage', 'vertexColors', 'opacity', 'transparent', 'transmission', 'depthWrite', 'depthTest', 'wireframe', 'forceSinglePass', 'displacementScale', 'displacementBias', 'polygonOffset', 'polygonOffsetFactor', 'polygonOffsetUnits'] as const;
type M = Material & { [key: string]: unknown };
type T = Texture & { isRenderTargetTexture?: boolean; isDepthTexture?: boolean; isStorageTexture?: boolean; isVideoTexture?: boolean; isCanvasTexture?: boolean; isHTMLTexture?: boolean; isExternalTexture?: boolean };
class InputState {
  protected numbers = new Float64Array(256);
  protected readonly refs: unknown[] = [];
  protected n = 0;
  protected r = 0;
  protected previousN = -1;
  protected dirty = true;


  invalidate(): void { this.previousN = -1; }
  clear(): void { this.refs.length = 0; this.previousN = -1; this.numbers = new Float64Array(256); }
  protected begin(): void { this.n = 0; this.r = 0; this.dirty = false; }
  protected finish(dynamic = false): boolean {
    const changed = this.dirty || dynamic || this.n !== this.previousN || this.r !== this.refs.length;
    this.previousN = this.n; this.refs.length = this.r;
    return changed;
  }
  protected value(value: unknown): void { if (typeof value === 'number') this.number(value); else this.ref(value); }
  protected number(value: number): void {
    if (this.n === this.numbers.length) { const next = new Float64Array(this.numbers.length * 2); next.set(this.numbers); this.numbers = next; }
    if (!Object.is(this.numbers[this.n], value)) this.dirty = true;
    this.numbers[this.n++] = value;
  }
  protected ref(value: unknown): void {
    if (!Object.is(this.refs[this.r], value)) this.dirty = true;
    this.refs[this.r++] = value;
  }
}

export class ShadowSceneState extends InputState {
  private dynamic = false;
  get dynamicInputs(): boolean { return this.dynamic; }
  changed(root: Object3D, cameraLayers: number, shadowType: unknown, reversedDepth = false, coordinateSystem?: number): boolean {
    this.begin(); this.dynamic = shadowType === VSMShadowMap; // VSM also draws receiveShadow-only objects.
    this.ref(root); this.ref(shadowType); this.number(cameraLayers); this.ref(reversedDepth); this.value(coordinateSystem);
    root.traverseVisible(this.visit);
    return this.finish(this.dynamic);
  }
  private readonly visit = (object: Object3D): void => {
    if (this.dynamic) return;
    if (object.onBeforeRender !== Object3D.prototype.onBeforeRender || object.onAfterRender !== Object3D.prototype.onAfterRender || object.onBeforeShadow !== Object3D.prototype.onBeforeShadow || object.onAfterShadow !== Object3D.prototype.onAfterShadow) { this.dynamic = true; return; }
    const clip = object as Object3D & { isClippingGroup?: boolean; enabled?: boolean; clipShadows?: boolean; clipIntersection?: boolean; clippingPlanes?: Array<{ normal: { x: number; y: number; z: number }; constant: number }> };
    if (clip.isClippingGroup) {
      this.ref(object); this.ref(clip.enabled); this.ref(clip.clipShadows); this.ref(clip.clipIntersection);
      for (const p of clip.clippingPlanes ?? []) { this.number(p.normal.x); this.number(p.normal.y); this.number(p.normal.z); this.number(p.constant); }
    }
    if ((object as Object3D & { isGroup?: boolean }).isGroup && object.renderOrder !== 0) { this.ref(object); this.number(object.renderOrder); }
    if (!object.castShadow) return;
    const mesh = object as Mesh & { isSkinnedMesh?: boolean; isBatchedMesh?: boolean; instanceMatrix?: BufferAttribute; instanceColor?: BufferAttribute; count?: number; customDepthMaterial?: Material; customDistanceMaterial?: Material };
    if (!mesh.isMesh) { if ((object as Object3D & { isLine?: boolean; isPoints?: boolean; isSprite?: boolean }).isLine || (object as Object3D & { isPoints?: boolean }).isPoints || (object as Object3D & { isSprite?: boolean }).isSprite) this.dynamic = true; return; }
    if (mesh.isSkinnedMesh || mesh.isBatchedMesh || mesh.customDepthMaterial || mesh.customDistanceMaterial || mesh.morphTargetInfluences?.length) { this.dynamic = true; return; }
    this.ref(mesh); this.number(mesh.layers.mask); this.number(mesh.renderOrder); this.ref(mesh.frustumCulled);
    const matrix = mesh.matrixWorld.elements;
    for (let i = 0; i < 16; i++) this.number(matrix[i]!);
    if (mesh.instanceMatrix) this.attribute(mesh.instanceMatrix);
    if (mesh.instanceColor) this.attribute(mesh.instanceColor);
    this.ref(mesh.count);
    const g = mesh.geometry;
    if ((g as typeof g & { indirect?: unknown }).indirect) this.dynamic = true;
    const sphere = (mesh as Mesh & { boundingSphere?: import('three').Sphere | null }).boundingSphere;
    this.sphere(sphere); this.sphere(g.boundingSphere);
    this.ref(g); this.number(g.drawRange.start); this.number(g.drawRange.count);
    this.ref((g as typeof g & { instanceCount?: number }).instanceCount);
    this.ref(g.index); if (g.index) this.attribute(g.index);
    for (const key in g.attributes) { this.ref(key); this.attribute(g.attributes[key]!); }
    this.ref(g.groups.length);
    for (const group of g.groups) { this.number(group.start); this.number(group.count); this.ref(group.materialIndex); }
    if (Array.isArray(mesh.material)) { for (const material of mesh.material) this.material(material as M); }
    else this.material(mesh.material as M);
  };
  private sphere(sphere: import('three').Sphere | null | undefined): void {
    this.ref(sphere);
    if (sphere) { this.number(sphere.center.x); this.number(sphere.center.y); this.number(sphere.center.z); this.number(sphere.radius); }
  }
  private attribute(attribute: BufferAttribute | InterleavedBufferAttribute): void {
    const a = attribute as BufferAttribute & { data?: { version: number; array: ArrayBufferView; stride: number }; offset?: number; isGLBufferAttribute?: boolean; isStorageBufferAttribute?: boolean };
    if (a.isGLBufferAttribute || a.isStorageBufferAttribute) this.dynamic = true;
    this.ref(a); this.ref(a.data); this.ref(a.data?.array ?? a.array);
    this.number(a.data?.version ?? a.version); this.number(a.itemSize); this.number(a.count);
    this.ref(a.normalized); this.ref(a.offset); this.ref(a.data?.stride); this.ref(a.usage); this.ref(a.gpuType);
  }
  private material(material: M): void {
    this.ref(material); this.number(material.version);
    if (material.onBeforeRender !== Material.prototype.onBeforeRender || material.onBeforeCompile !== Material.prototype.onBeforeCompile
        || material.positionNode || material.vertexNode || material.depthNode || material.opacityNode || material.shadowNode || material.castShadowNode
        || material.isShaderMaterial || material.alphaTestNode || material.clippingPlanes || material.contextNode || material.fragmentNode || material.castShadowPositionNode || material.maskNode || material.maskShadowNode || material.transmissionNode || material.backdropNode || (material.colorNode && !hasStaticShadowAlpha(material.colorNode))) this.dynamic = true;
    for (const key of MATERIAL_INPUTS) this.value(material[key]);
    this.texture(material.map as T | null); this.texture(material.alphaMap as T | null);
    this.texture(material.displacementMap as T | null);
  }
  private texture(texture: T | null): void {
    this.ref(texture);
    if (!texture) return;
    if (texture.isRenderTargetTexture || texture.isDepthTexture || texture.isStorageTexture || texture.isVideoTexture || texture.isCanvasTexture || texture.isHTMLTexture || texture.isExternalTexture) this.dynamic = true;
    this.number(texture.version); this.ref(texture.image); this.ref(texture.source); this.ref(texture.source.version);
    this.ref(texture.wrapS); this.ref(texture.wrapT); this.ref(texture.magFilter); this.ref(texture.minFilter); this.ref(texture.anisotropy); this.ref(texture.channel); this.ref(texture.flipY); this.ref(texture.colorSpace);
    this.number(texture.offset.x); this.number(texture.offset.y); this.number(texture.repeat.x); this.number(texture.repeat.y); this.number(texture.center.x); this.number(texture.center.y); this.number(texture.rotation);
    this.ref(texture.matrixAutoUpdate);
    if (!texture.matrixAutoUpdate) for (const n of texture.matrix.elements) this.number(n);
  }
}

const epochs = new WeakMap<object, { value: number }>();
function epoch(target: { addEventListener(type: 'dispose', listener: () => void): void }): number {
  let counter = epochs.get(target);
  if (!counter) { counter = { value: 0 }; const record = counter; target.addEventListener('dispose', () => { record.value++; }); epochs.set(target, counter); }
  return counter.value;
}
export type ShadowLight = Object3D & { target: Object3D; shadow: import('three').LightShadow };
/** Actual placed light/camera inputs, not an approximation of view movement. */
export class ShadowMapState extends InputState {
  private matrix(values: number[]): void { for (let i = 0; i < 16; i++) this.number(values[i]!); }
  changed(light: ShadowLight, cameraLayers: number): boolean {
    this.begin();
    this.ref(light); this.ref(light.target);
    this.matrix(light.matrixWorld.elements); this.matrix(light.target.matrixWorld.elements); this.matrix(light.shadow.camera.projectionMatrix.elements);
    const shadow = light.shadow, camera = shadow.camera;
    this.ref(camera); this.number(camera.up.x); this.number(camera.up.y); this.number(camera.up.z);
    this.number((camera.layers.mask & 0xFFFFFFFE) === 0 ? cameraLayers : camera.layers.mask);
    this.number(shadow.mapSize.x); this.number(shadow.mapSize.y); this.number(shadow.bias); this.number(shadow.normalBias); this.number(shadow.radius);
    this.value((shadow as typeof shadow & { blurSamples?: number }).blurSamples);
    this.ref(shadow.map);
    if (shadow.map) {
      this.number(epoch(shadow.map)); this.ref(shadow.map.depthTexture); this.value(shadow.map.depthTexture?.version);
      this.ref(shadow.map.scissorTest);
      const v = shadow.map.viewport, s = shadow.map.scissor;
      this.number(v.x); this.number(v.y); this.number(v.z); this.number(v.w);
      this.number(s.x); this.number(s.y); this.number(s.z); this.number(s.w);
    }
    return this.finish();
  }
}
