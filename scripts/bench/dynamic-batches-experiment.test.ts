import { describe, expect, it } from 'vitest';
import { BatchedMesh, BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene } from 'three';
import { batchTransformSupported, dynamicBatchKey, DynamicBatchesExperiment, prepareDynamicBatchDraws } from './dynamic-batches-experiment';
import { BATCHED_LAYER } from '../../packages/render/src/sync/static-batches';

function fixture() {
  const root=new Group(), parent=new Group(), material=new MeshStandardMaterial(), geometry=new BoxGeometry();root.add(parent);
  const meshes=Array.from({length:8},(_,i)=>{const m=new Mesh(geometry,material);m.position.x=i*2;parent.add(m);return m;});
  root.updateMatrixWorld(true);
  return{root,parent,material,geometry,meshes};
}
describe('dynamic multi-draw research',()=>{
 it('keeps source meshes for picking, follows moving and hidden members, and restores ownership on disposal',()=>{
  const f=fixture(),b=new DynamicBatchesExperiment(f.root,f.meshes);expect(b.saved).toBe(7);expect(b.batches).toHaveLength(1);expect(b.update()).toBe(false);
  const native=b.batches[0]!.mesh,matrix=new Matrix4();expect(f.meshes.every(m=>m.layers.isEnabled(BATCHED_LAYER))).toBe(true);
  f.meshes[2]!.position.y=3;f.root.updateMatrixWorld(true);expect(b.update()).toBe(true);native.getMatrixAt(2,matrix);expect(matrix.elements[13]).toBe(3);expect(b.update()).toBe(false);
  f.parent.visible=false;expect(b.update()).toBe(true);expect(native.getVisibleAt(2)).toBe(false);f.parent.visible=true;b.update();expect(native.getVisibleAt(2)).toBe(true);
  f.meshes[1]!.removeFromParent();b.update();expect(native.getVisibleAt(1)).toBe(false);
  b.dispose();expect(f.meshes.every(m=>m.layers.mask===1)).toBe(true);expect(f.root.children).toEqual([f.parent]);expect(f.geometry.attributes.position!.count).toBe(24);f.geometry.dispose();f.material.dispose();
 });
 it('returns changed materials, geometry and unsupported transforms to standalone drawing',()=>{
  const f=fixture(),b=new DynamicBatchesExperiment(f.root,f.meshes),native=b.batches[0]!.mesh;
  f.meshes[0]!.material=new MeshStandardMaterial();f.meshes[1]!.geometry=new BoxGeometry(2,2,2);f.meshes[2]!.scale.x=-1;f.meshes[3]!.castShadow=true;f.root.updateMatrixWorld(true);b.update();
  for(let i=0;i<4;i++){expect(native.getVisibleAt(i)).toBe(false);expect(f.meshes[i]!.layers.mask).toBe(1);}expect(native.getVisibleAt(4)).toBe(true);b.dispose();
 });
 it('never flattens existing instanced or batched meshes into one rigid mesh',()=>{
  const f=fixture(),instances=new InstancedMesh(f.geometry,f.material,16),nativeBatch=new BatchedMesh(4,24,36,f.material);
  expect(instances.type).toBe('Mesh');expect(dynamicBatchKey(instances)).toBeNull();expect(dynamicBatchKey(nativeBatch)).toBeNull();instances.dispose();nativeBatch.dispose();f.geometry.dispose();f.material.dispose();
 });
 it('excludes partial geometry, deformation, custom hooks, mirrored or sheared transforms and transparency',()=>{
  const f=fixture(),m=f.meshes[0]!;expect(dynamicBatchKey(m)).not.toBeNull();m.geometry.setDrawRange(3,6);expect(dynamicBatchKey(m)).toBeNull();m.geometry.setDrawRange(0,Infinity);
  m.onBeforeRender=()=>{};expect(dynamicBatchKey(m)).toBeNull();m.onBeforeRender=Mesh.prototype.onBeforeRender;
  f.material.transparent=true;expect(dynamicBatchKey(m)).toBeNull();f.material.transparent=false;
  m.matrixWorld.makeScale(-1,1,1);expect(dynamicBatchKey(m)).toBeNull();
  expect(batchTransformSupported(new Matrix4().makeScale(2,1,.5))).toBe(true);expect(batchTransformSupported(new Matrix4().makeShear(.2,0,0,0,0,0))).toBe(false);expect(batchTransformSupported(new Matrix4().makeScale(0,1,1))).toBe(false);
 });
 it('evicts copied geometry after in-place attribute, index, layout or draw-range changes',()=>{
  for(const change of [
   (g:BoxGeometry)=>{g.attributes.position!.needsUpdate=true;},
   (g:BoxGeometry)=>{g.index!.needsUpdate=true;},
   (g:BoxGeometry)=>{g.deleteAttribute('uv');},
   (g:BoxGeometry)=>{g.setDrawRange(0,3);},
   (g:BoxGeometry)=>{g.computeBoundingSphere();g.boundingSphere!.radius+=1;},
  ]){
   const f=fixture(),b=new DynamicBatchesExperiment(f.root,f.meshes),native=b.batches[0]!.mesh;change(f.geometry);expect(b.update()).toBe(true);
   for(let i=0;i<8;i++){expect(native.getVisibleAt(i)).toBe(false);expect(f.meshes[i]!.layers.mask).toBe(1);}b.dispose();f.geometry.dispose();f.material.dispose();
  }
 });
 it('evicts a batch when its shared material changes pipeline semantics',()=>{
  for(const change of [(m:MeshStandardMaterial)=>{m.transparent=true;},(m:MeshStandardMaterial)=>{m.onBeforeCompile=()=>{};}]){
   const f=fixture(),b=new DynamicBatchesExperiment(f.root,f.meshes);change(f.material);expect(b.update()).toBe(true);expect(f.meshes.every(m=>m.layers.mask===1)).toBe(true);b.dispose();f.geometry.dispose();f.material.dispose();
  }
 });
 it('preserves sources that disable frustum culling and rejects ordered ancestor groups',()=>{
  const f=fixture();for(const m of f.meshes)m.frustumCulled=false;
  const b=new DynamicBatchesExperiment(f.root,f.meshes);expect(b.batches[0]!.mesh.perObjectFrustumCulled).toBe(false);expect(b.update()).toBe(false);b.dispose();
  f.parent.renderOrder=2;expect(dynamicBatchKey(f.meshes[0]!)).toBeNull();f.geometry.dispose();f.material.dispose();
 });
 it('restores standalone rendering when callbacks or ancestor ordering change',()=>{
  const f=fixture(),b=new DynamicBatchesExperiment(f.root,f.meshes);
  f.meshes[0]!.onBeforeRender=()=>{};b.update();expect(f.meshes[0]!.layers.mask).toBe(1);expect(b.batches[0]!.mesh.getVisibleAt(0)).toBe(false);
  f.parent.renderOrder=1;b.update();expect(f.meshes.every(m=>m.layers.mask===1)).toBe(true);b.dispose();f.geometry.dispose();f.material.dispose();
 });
 it('prepares the main-camera list after shadow culling before native node updates',()=>{
  const f=fixture(),b=new DynamicBatchesExperiment(f.root,f.meshes),mesh=b.batches[0]!.mesh;
  const main=new PerspectiveCamera(60,1,.1,100);main.position.set(7,2,20);main.lookAt(7,0,0);main.updateMatrixWorld();
  const shadow=new PerspectiveCamera(20,1,.1,100);shadow.position.set(0,2,10);shadow.lookAt(0,0,0);shadow.updateMatrixWorld();
  let count=0;const renderer={_nodes:{updateForRender(ro:any){count=(ro.object as any)._multiDrawCount;}}};const original=renderer._nodes.updateForRender,restore=prepareDynamicBatchDraws(renderer);
  const ro={object:mesh,scene:new Scene(),geometry:mesh.geometry,material:f.material,camera:shadow,group:null};renderer._nodes.updateForRender(ro);const narrow=count;ro.camera=main;renderer._nodes.updateForRender(ro);expect(count).toBe(8);expect(narrow).toBeLessThan(count);restore();expect(renderer._nodes.updateForRender).toBe(original);b.dispose();
 });
});
