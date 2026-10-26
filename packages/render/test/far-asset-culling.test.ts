import { describe, expect, it } from 'vitest';
import { Group, Object3D, Vector3 } from 'three';
import { WorldRenderer } from '../src/world-renderer';
import { AssetSkinCache } from '../src/gpu/asset-skin-cache';
function fixture() {
  const content=new Group(),object=new Group();object.add(content);object.position.x=10000;object.updateMatrixWorld(true);
  const node={content,object,token:1,pending:false,placeholder:false,characterBody:null as null|string};
  content.add(Object.assign(new Object3D(),{isSkinnedMesh:true}));
  const state={qualityPlan:{tier:'low',quality:'realtime'},hiddenFar:new Set<Object3D>(),skinnedAsset:new AssetSkinCache(),farCullFrame:0,
    sync:{world:{entities:{animal:{shape:{kind:'asset'}}}},node:()=>node},perspective:{position:new Vector3()},needsDraw:false};
  const cull=(WorldRenderer.prototype as unknown as {cullFarAnimals(this:typeof state):void}).cullFarAnimals;
  return{node,state,run:()=>{state.farCullFrame=0;cull.call(state);}};
}
describe('low-tier asset culling with cached skin classification',()=>{
 it('still hides far skins and restores them near the camera',()=>{
  const f=fixture();f.run();expect(f.node.content.visible).toBe(false);expect(f.state.hiddenFar.has(f.node.content)).toBe(true);
  f.node.object.matrixWorld.makeTranslation(0,0,0);f.run();expect(f.node.content.visible).toBe(true);expect(f.state.hiddenFar.size).toBe(0);
 });
 it('releases owned hiding when a skinned model is replaced by static content',()=>{
  const f=fixture();f.run();f.node.token++;f.node.content.clear();f.node.content.add(new Group());f.run();
  expect(f.node.content.visible).toBe(true);expect(f.state.hiddenFar.size).toBe(0);
 });
 it('does not restore collider content hidden by a character replacement',()=>{
  const f=fixture();f.run();f.node.token++;f.node.content.clear();f.node.characterBody='person';f.run();
  expect(f.node.content.visible).toBe(false);expect(f.state.hiddenFar.size).toBe(0);
 });
});
