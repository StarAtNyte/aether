import { describe, expect, it, vi } from 'vitest';
import { Group, Object3D } from 'three';
import { AssetSkinCache } from '../src/gpu/asset-skin-cache';
const skin=()=>Object.assign(new Object3D(),{isSkinnedMesh:true});
const node=()=>({content:new Group(),token:1,pending:false,placeholder:false});
describe('mounted asset skin classification',()=>{
  it('caches both static and skinned content without recurring subtree walks',()=>{
    const cache=new AssetSkinCache(),a=node(),b=node();a.content.add(new Group());b.content.add(skin());
    const walkA=vi.spyOn(a.content,'traverse'),walkB=vi.spyOn(b.content,'traverse');
    for(let i=0;i<20;i++){expect(cache.hasSkin(a)).toBe(false);expect(cache.hasSkin(b)).toBe(true);}
    expect(walkA).toHaveBeenCalledOnce();expect(walkB).toHaveBeenCalledOnce();
  });
  it('does not cache a placeholder or in-flight load as a settled static asset',()=>{
    const cache=new AssetSkinCache(),a=node();a.pending=true;expect(cache.hasSkin(a)).toBe(false);
    a.pending=false;a.placeholder=true;expect(cache.hasSkin(a)).toBe(false);
    a.placeholder=false;a.content.add(skin());expect(cache.hasSkin(a)).toBe(true);
  });
  it('reclassifies replacement content and keeps different nodes independent',()=>{
    const cache=new AssetSkinCache(),a=node(),b=node();a.content.add(skin());expect(cache.hasSkin(a)).toBe(true);expect(cache.hasSkin(b)).toBe(false);
    a.content.clear();a.token++;expect(cache.hasSkin(a)).toBe(false);
    b.content.add(skin());b.token++;expect(cache.hasSkin(b)).toBe(true);
  });
});
