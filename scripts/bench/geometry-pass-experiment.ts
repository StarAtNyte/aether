/** Research-only guarded geometry-lighting specialization; not used by the runtime. */
/** Omit discarded scene illumination from a geometry pass while preserving shadow-update ordering. */
import { Material, Object3D, type Camera, type Scene } from 'three';
import type { Lighting, NodeFrame, PassNode } from 'three/webgpu';

// Keep two stable lighting namespaces (native + geometry), rather than rebuilding every
// render object's shader when a shadow refresh switches the geometry pass back to lighting.
const managers = new WeakMap<object, Lighting>();
type ShadowObject = Object3D & { isLight?: boolean; shadow?: { autoUpdate: boolean; needsUpdate: boolean; map: unknown; shadowNode?: unknown } };
type DrawObject = Object3D & { material?: Material | Material[] };

export class GeometryLightingInputs {
  private pending = false;
  private layers = 1;
  private shadows = true;

  /** A live shadow update or custom render hook retains the native pass, including its ordering. */
  requiresLighting(scene: Object3D, camera: Camera, shadows: boolean): boolean {
    this.pending = (scene as Scene).overrideMaterial != null || scene.onBeforeRender !== Object3D.prototype.onBeforeRender || scene.onAfterRender !== Object3D.prototype.onAfterRender;
    this.layers = camera.layers.mask; this.shadows = shadows;
    scene.traverseVisible(this.visit);
    return this.pending;
  }

  private readonly visit = (object: Object3D): void => {
    if (this.pending || (object.layers.mask & this.layers) === 0) return;
    const light = object as ShadowObject;
    if (this.shadows && light.isLight && light.castShadow) {
      const shadow = light.shadow;
      if (!shadow || !shadow.map || shadow.autoUpdate !== false || shadow.needsUpdate || shadow.shadowNode) { this.pending = true; return; }
    }
    const material = (object as DrawObject).material;
    if (Array.isArray(material)) {
      let opaque = false;
      for (const m of material) {
        if (!this.opaque(m)) continue;
        opaque = true;
        if (this.customMaterial(m)) { this.pending = true; return; }
      }
      if (!opaque) return;
    } else {
      if (!material || !this.opaque(material)) return;
      if (this.customMaterial(material)) { this.pending = true; return; }
    }
    if (object.onBeforeRender !== Object3D.prototype.onBeforeRender || object.onAfterRender !== Object3D.prototype.onAfterRender) this.pending = true;
  };

  private opaque(material: Material): boolean {
    const m = material as Material & { transmission?: number; transmissionNode?: { isNode?: boolean }; backdropNode?: { isNode?: boolean } };
    return m.visible && !m.transparent && !(m.transmission! > 0) && m.transmissionNode?.isNode !== true && m.backdropNode?.isNode !== true;
  }

  private customMaterial(material: Material): boolean {
    const m = material as Material & { lightsNode?: unknown; contextNode?: unknown; mrtNode?: unknown; fragmentNode?: unknown; outputNode?: unknown; isShaderMaterial?: boolean };
    return m.onBeforeRender !== Material.prototype.onBeforeRender || m.onBeforeCompile !== Material.prototype.onBeforeCompile
      || !!(m.lightsNode || m.contextNode || m.mrtNode || m.fragmentNode || m.outputNode || m.isShaderMaterial);
  }
}

export function configureGeometryPass(pass: PassNode, LightingClass: typeof import('three/webgpu').Lighting): void {
  const inputs = new GeometryLightingInputs(), update = pass.updateBefore;
  pass.updateBefore = function (frame: NodeFrame) {
    const renderer = frame.renderer!;
    const native = !renderer.lighting.enabled || inputs.requiresLighting(this.scene, this.camera, renderer.shadowMap.enabled);
    if (native) this.lighting = null;
    else {
      let lighting = managers.get(renderer);
      if (!lighting) { lighting = new LightingClass(); lighting.enabled = false; managers.set(renderer, lighting); }
      this.lighting = lighting;
    }
    return update.call(this, frame);
  };
}
