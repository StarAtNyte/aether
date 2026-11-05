import { describe, expect, it } from 'vitest';
import { cappedSize } from '../src/gpu/texture-cap';

describe('texture cap', () => {
  it('scales the long side to the cap and keeps the aspect', () => {
    expect(cappedSize(1024, 1024, 512)).toEqual([512, 512]);
    expect(cappedSize(2048, 1024, 512)).toEqual([512, 256]);
  });
  it('leaves images at or under the cap, and a cap of 0, alone', () => {
    expect(cappedSize(512, 512, 512)).toEqual([512, 512]);
    expect(cappedSize(300, 200, 512)).toEqual([300, 200]);
    expect(cappedSize(4096, 4096, 0)).toEqual([4096, 4096]);
  });
});
