import { afterEach, describe, expect, it, vi } from 'vitest';
import { BufferAttribute, Mesh } from 'three';
import * as atmosphere from '../src/environment/atmosphere';
import { SkyDome } from '../src/environment/sky-dome';
import { computeSkyState } from '../src/environment/sky-state';
const state=()=>computeSkyState({sky:'day',sunIntensity:2.5,ambientIntensity:.4});
const geometry=(dome:SkyDome)=>(dome.group.children[0] as Mesh).geometry;
const colors=(dome:SkyDome)=>new Float32Array(geometry(dome).getAttribute('color').array);
afterEach(()=>vi.restoreAllMocks());
describe('exact physical-sky integration cache',()=>{
 it('reuses integration on detail changes and identical reapplications',()=>{
  const dome=new SkyDome(),s=state(),call=vi.spyOn(atmosphere,'skyDisplay');
  dome.apply(s);expect(call.mock.calls.length).toBeGreaterThan(1000);const before=colors(dome);call.mockClear();
  dome.apply(s);dome.setDetail(false);dome.setDetail(true);
  expect(call).not.toHaveBeenCalled();expect(colors(dome)).toEqual(before);dome.dispose();
 });
 it('keeps fog and physical weight changes exact against an uncached dome',()=>{
  const dome=new SkyDome(),s=state();dome.apply(s);
  const modified={...s,physical:{...s.physical!,weight:.37}};
  const call=vi.spyOn(atmosphere,'skyDisplay');dome.apply(modified,'#9faacc');expect(call).not.toHaveBeenCalled();
  const fresh=new SkyDome();fresh.apply(modified,'#9faacc');expect(colors(dome)).toEqual(colors(fresh));dome.dispose();fresh.dispose();
 });
 it('invalidates exact sun/turbidity values, including in-place state edits',()=>{
  const dome=new SkyDome(),s=state();dome.apply(s);const call=vi.spyOn(atmosphere,'skyDisplay');
  const storage=(dome as unknown as {atmosphere:{colors:Float64Array}}).atmosphere.colors;
  s.physical!.turbidity+=.001;dome.apply(s);expect(call).toHaveBeenCalled();expect((dome as unknown as {atmosphere:{colors:Float64Array}}).atmosphere.colors).toBe(storage);call.mockClear();
  s.physical!.sunDirection[0]+=.0001;dome.apply(s);expect(call).toHaveBeenCalled();
  const fresh=new SkyDome();fresh.apply(s);expect(colors(dome)).toEqual(colors(fresh));dome.dispose();fresh.dispose();
 });
 it('invalidates replaced and edited position attributes',()=>{
  const dome=new SkyDome(),s=state();dome.apply(s);const g=geometry(dome),pos=g.getAttribute('position') as BufferAttribute;
  const call=vi.spyOn(atmosphere,'skyDisplay');pos.setX(100,pos.getX(100)+1);pos.needsUpdate=true;dome.apply(s);expect(call).toHaveBeenCalled();call.mockClear();
  g.setAttribute('position',pos.clone());dome.apply(s);expect(call).toHaveBeenCalled();dome.dispose();
 });
});
