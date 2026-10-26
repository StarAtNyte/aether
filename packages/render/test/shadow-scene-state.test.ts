import { describe, expect, it } from 'vitest';
import { BoxGeometry, DataTexture, DirectionalLight, Group, InstancedMesh, Mesh, MeshStandardMaterial, RenderTarget, Scene, SkinnedMesh, Matrix4 } from 'three';
import { ShadowMapState, ShadowSceneState } from '../src/gpu/shadow-scene-state';
import { staticShadowAlpha } from '../src/gpu/shadow-alpha';
function fixture() {
 const scene=new Scene(),material=new MeshStandardMaterial(),geometry=new BoxGeometry(),mesh=new Mesh(geometry,material),sun=new DirectionalLight();
 mesh.castShadow=true;sun.castShadow=true;scene.add(mesh,sun,sun.target);scene.updateMatrixWorld(true);
 const cache=new ShadowSceneState(),changed=()=>cache.changed(scene,1,1);
 return{scene,mesh,material,geometry,sun,cache,changed};
}
describe('exact shadow caster inputs',()=>{
 it('settles unchanged scenes and ignores non-renderable lights with castShadow set',()=>{
  const f=fixture();expect(f.changed()).toBe(true);expect(f.changed()).toBe(false);f.cache.invalidate();expect(f.changed()).toBe(true);expect(f.changed()).toBe(false);
 });
 it('detects transforms, visibility, layer masks, render order and caster removal',()=>{
  const f=fixture();f.changed();
  for(const edit of [()=>{f.mesh.position.x=.1;f.scene.updateMatrixWorld(true);},()=>{f.mesh.layers.mask=2;},()=>{f.mesh.renderOrder=3;},()=>{f.mesh.visible=false;},()=>{f.mesh.visible=true;},()=>{f.mesh.castShadow=false;},()=>{f.mesh.castShadow=true;},()=>{f.mesh.removeFromParent();}]){edit();expect(f.changed()).toBe(true);expect(f.changed()).toBe(false);}
 });
 it('detects geometry, index, groups, in-place buffer uploads and instancing changes',()=>{
  const f=fixture();f.changed();const p=f.geometry.getAttribute('position');p.needsUpdate=true;expect(f.changed()).toBe(true);expect(f.changed()).toBe(false);
  f.geometry.index!.needsUpdate=true;expect(f.changed()).toBe(true);f.changed();f.geometry.groups[0]!.count=3;expect(f.changed()).toBe(true);
  f.mesh.geometry=new BoxGeometry(2,2,2);expect(f.changed()).toBe(true);
  const inst=new InstancedMesh(f.geometry,f.material,3);inst.castShadow=true;f.scene.add(inst);f.scene.updateMatrixWorld(true);f.changed();expect(f.changed()).toBe(false);
  inst.setMatrixAt(1,new Matrix4().makeTranslation(2,0,0));inst.instanceMatrix.needsUpdate=true;expect(f.changed()).toBe(true);expect(f.changed()).toBe(false);inst.count=1;expect(f.changed()).toBe(true);
 });
 it('detects material scalars, alpha textures and UV transforms without needing material.version changes',()=>{
  const f=fixture(),t=new DataTexture(new Uint8Array([255,255,255,255]),1,1);f.material.map=t;f.changed();expect(f.changed()).toBe(false);
  for(const edit of [()=>{f.material.opacity=.3;},()=>{t.needsUpdate=true;},()=>{t.offset.x=.4;},()=>{t.matrixAutoUpdate=false;},()=>{t.matrix.elements[6]=.7;},()=>{f.material.shadowSide=1;}]){edit();expect(f.changed()).toBe(true);expect(f.changed()).toBe(false);}
 });
 it('keeps live updates for skins, callbacks, unknown shader nodes and dynamic alpha sources',()=>{
  for(const configure of [(f:ReturnType<typeof fixture>)=>{f.scene.add(Object.assign(new SkinnedMesh(f.geometry,f.material),{castShadow:true}));},(f:ReturnType<typeof fixture>)=>{f.mesh.onBeforeRender=()=>{};},(f:ReturnType<typeof fixture>)=>{f.mesh.onBeforeShadow=()=>{};},(f:ReturnType<typeof fixture>)=>{f.mesh.onAfterShadow=()=>{};},(f:ReturnType<typeof fixture>)=>{Object.assign(f.geometry,{indirect:{}});},(f:ReturnType<typeof fixture>)=>{Object.assign(f.material,{positionNode:{}});},(f:ReturnType<typeof fixture>)=>{Object.assign(f.material,{colorNode:{}});},(f:ReturnType<typeof fixture>)=>{f.material.map=Object.assign(new DataTexture(),{isVideoTexture:true});}]){
   const f=fixture();configure(f);expect(f.changed()).toBe(true);expect(f.changed()).toBe(true);
  }
 });
 it('accepts the certified alpha behavior of built-in colour nodes and rechecks replacements',()=>{
  const f=fixture();Object.assign(f.material,{colorNode:staticShadowAlpha({})});f.changed();expect(f.changed()).toBe(false);
  Object.assign(f.material,{colorNode:{}});expect(f.changed()).toBe(true);expect(f.changed()).toBe(true);
 });
 it('detects clipping-plane changes',()=>{
  const f=fixture(),group=Object.assign(new Group(),{isClippingGroup:true,enabled:true,clipShadows:true,clipIntersection:false,clippingPlanes:[{normal:{x:0,y:1,z:0},constant:1}]});
  f.scene.add(group);f.changed();expect(f.changed()).toBe(false);group.clippingPlanes[0]!.constant=2;expect(f.changed()).toBe(true);expect(f.changed()).toBe(false);
 });
});
describe('placed shadow-map inputs',()=>{
 it('invalidates exact light, projection, layer, size and map-disposal changes',()=>{
  const light=new DirectionalLight();light.shadow.map=new RenderTarget(8,8);light.updateMatrixWorld();light.target.updateMatrixWorld();
  const cache=new ShadowMapState(),changed=()=>cache.changed(light,1);expect(changed()).toBe(true);expect(changed()).toBe(false);
  for(const edit of [()=>{light.position.x+=.00001;light.updateMatrixWorld();},()=>{light.shadow.camera.up.z=.1;},()=>{light.shadow.camera.projectionMatrix.elements[0]!+=.001;},()=>{light.shadow.mapSize.set(16,16);},()=>{light.shadow.map!.dispose();}]){edit();expect(changed()).toBe(true);expect(changed()).toBe(false);}
  expect(cache.changed(light,2)).toBe(true);
 });
});
