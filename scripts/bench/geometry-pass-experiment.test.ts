import { describe, expect, it } from 'vitest';
import { DirectionalLight, Group, Mesh, MeshStandardMaterial, Object3D, PerspectiveCamera, Scene } from 'three';
import { Lighting, type NodeFrame, type PassNode } from 'three/webgpu';
import { configureGeometryPass, GeometryLightingInputs } from './geometry-pass-experiment';

function fixture() {
  const scene = new Scene(), camera = new PerspectiveCamera(), material = new MeshStandardMaterial(), mesh = new Mesh(undefined, material), sun = new DirectionalLight();
  sun.castShadow = true; scene.add(mesh, sun);
  const inputs = new GeometryLightingInputs(), pending = () => inputs.requiresLighting(scene, camera, true);
  return { scene, camera, material, mesh, sun, inputs, pending };
}

describe('geometry-pass lighting inputs', () => {
  it('keeps native lighting for missing, automatic, dirty and custom shadow maps', () => {
    const f = fixture(); expect(f.pending()).toBe(true);
    Object.assign(f.sun.shadow, { map: {}, autoUpdate: false, needsUpdate: false }); expect(f.pending()).toBe(false);
    f.sun.shadow.needsUpdate = true; expect(f.pending()).toBe(true);
    f.sun.shadow.needsUpdate = false; f.sun.shadow.autoUpdate = true; expect(f.pending()).toBe(true);
    f.sun.shadow.autoUpdate = false; Object.assign(f.sun.shadow, { shadowNode: {} }); expect(f.pending()).toBe(true);
  });

  it('does not request shadow work for disabled shadows or invisible/layer-excluded lights', () => {
    const f = fixture(); expect(f.inputs.requiresLighting(f.scene, f.camera, false)).toBe(false);
    f.sun.layers.set(2); expect(f.pending()).toBe(false);
    f.sun.layers.set(0); f.sun.visible = false; expect(f.pending()).toBe(false);
  });

  it('retains callbacks and custom geometry outputs on opaque objects', () => {
    const f = fixture(); f.sun.castShadow = false;
    f.mesh.onBeforeRender = () => {}; expect(f.pending()).toBe(true);
    f.mesh.onBeforeRender = Object3D.prototype.onBeforeRender; expect(f.pending()).toBe(false);
    f.material.onBeforeRender = () => {}; expect(f.pending()).toBe(true);
    f.material.onBeforeRender = MeshStandardMaterial.prototype.onBeforeRender;
    Object.assign(f.material, { mrtNode: {} }); expect(f.pending()).toBe(true);
  });

  it('ignores transparent, transmissive and hidden materials excluded from the opaque pass', () => {
    const f = fixture(); f.sun.castShadow = false; f.mesh.onBeforeRender = () => {};
    f.material.transparent = true; expect(f.pending()).toBe(false);
    f.material.transparent = false; Object.assign(f.material, { transmission: 1 }); expect(f.pending()).toBe(false);
    Object.assign(f.material, { transmission: 0, transmissionNode: { isNode: true } }); expect(f.pending()).toBe(false);
    Object.assign(f.material, { transmissionNode: null }); f.material.visible = false; expect(f.pending()).toBe(false);
    f.material.visible = true; expect(f.pending()).toBe(true);
  });

  it('handles material arrays, root callbacks, groups and overrides', () => {
    const f = fixture(); f.sun.castShadow = false;
    Object.assign(f.mesh, { material: [new MeshStandardMaterial({ transparent: true }), f.material] }); f.material.onBeforeCompile = () => {}; expect(f.pending()).toBe(true);
    Object.assign(f.mesh, { material: [] }); expect(f.pending()).toBe(false);
    f.scene.layers.set(2); f.scene.onBeforeRender = () => {}; expect(f.pending()).toBe(true);
    f.scene.onBeforeRender = Object3D.prototype.onBeforeRender; f.scene.overrideMaterial = f.material; expect(f.pending()).toBe(true);
    expect(f.inputs.requiresLighting(new Group(), f.camera, true)).toBe(false);
  });

  it('uses stable, renderer-owned lighting namespaces across dirty/cached transitions and pass rebuilds', () => {
    const f = fixture(), renderer = { lighting: new Lighting(), shadowMap: { enabled: true } };
    const frame = { renderer } as unknown as NodeFrame;
    const makePass = () => ({ scene: f.scene, camera: f.camera, lighting: null, updateBefore() { return undefined; } }) as unknown as PassNode;
    const a = makePass(); configureGeometryPass(a, Lighting); a.updateBefore(frame); expect(a.lighting).toBeNull();
    Object.assign(f.sun.shadow, { map: {}, autoUpdate: false, needsUpdate: false }); a.updateBefore(frame);
    const unlit = a.lighting; expect(unlit?.enabled).toBe(false); expect(renderer.lighting.enabled).toBe(true);
    f.sun.shadow.needsUpdate = true; a.updateBefore(frame); expect(a.lighting).toBeNull();
    f.sun.shadow.needsUpdate = false; a.updateBefore(frame); expect(a.lighting).toBe(unlit);
    const b = makePass(); configureGeometryPass(b, Lighting); b.updateBefore(frame); expect(b.lighting).toBe(unlit);
    renderer.lighting.enabled = false; a.updateBefore(frame); expect(a.lighting).toBeNull();
  });
});
