import { describe, expect, it } from 'vitest';
import { fractalNoise, cloudPixels } from '../src/environment/clouds';
import * as reference from '../../../scripts/bench/cloud-reference';
describe('cloud generation against the frozen original algorithm',()=>{
 it('retains every noise sample for multiple sizes, seeds and lattice stretches',()=>{
  for(const size of [1,16,64,257])for(const seed of [0,0xc10d5])for(const stretch of [1,3,4]){
   const before=reference.fractalNoise(size,seed,stretch),after=fractalNoise(size,seed,stretch);
   expect(new Uint8Array(after.buffer)).toEqual(new Uint8Array(before.buffer));
  }
 });
 it('retains cloud pixels across coverage, sun directions and shadow boundaries',()=>{
  const fbm=reference.fractalNoise(64,0xc10d5);
  for(const cover of [0,.05,.4,.95,1])for(const sun of [undefined,{x:0,y:0},{x:1.5,y:-2.5},{x:.4999999999999999,y:-.5000000000000001},{x:-3.12,y:1.91}]){
   expect(cloudPixels(64,cover,fbm,sun)).toEqual(reference.cloudPixels(64,cover,fbm,sun));
  }
 });
});
