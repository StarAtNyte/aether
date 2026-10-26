import { describe, expect, it } from 'vitest';
import { tileableGradientNoise, noisePixels } from '../src/materials/noise-texture';
import * as reference from '../../../scripts/bench/material-noise-reference';
const sameBytes=(a:Float32Array|Uint8Array,b:Float32Array|Uint8Array)=>expect(Buffer.from(a.buffer,a.byteOffset,a.byteLength).equals(Buffer.from(b.buffer,b.byteOffset,b.byteLength))).toBe(true);
describe('material noise against the frozen original algorithm',()=>{
 it('retains all float samples across sizes, periods and seeds',()=>{
  for(const size of [-1,0,1,16,16.5,64,257])for(const period of [1,2.5,3,16])for(const seed of [0,17,-24]){
   const before=reference.tileableGradientNoise(size,period,seed),after=tileableGradientNoise(size,period,seed);
   sameBytes(after,before);
  }
 });
 it('retains all RGBA pixels after normalization and rounding',()=>{
  for(const [size,period]of [[16,3],[64,16],[256,16],[257,7]])sameBytes(noisePixels(size,period),reference.noisePixels(size,period));
 });
});
