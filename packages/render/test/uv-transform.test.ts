import { describe, expect, it } from 'vitest';
import { Matrix3, Texture } from 'three';
import { specializeTextureUvMath, specializeUvTransform } from '../src/gpu/uv-transform';

const native = Matrix3.prototype.setUvTransform, fast = specializeUvTransform(native);
type Args = [number, number, number, number, number, number, number];
const bits = (m: Matrix3) => Array.from(new Uint32Array(new Float64Array(m.elements).buffer));

describe('exact zero-rotation UV math', () => {
  it('recognizes the native setter and is idempotent', () => {
    expect(fast).not.toBe(native); expect(specializeUvTransform(fast)).toBe(fast);
    expect(fast.name).toBe(native.name); expect(fast.length).toBe(native.length);
    expect(Object.hasOwn(fast, 'prototype')).toBe(false);
  });
  it('matches every matrix bit for zero, signed zero, nonzero, nonfinite and randomized inputs', () => {
    const a = new Matrix3(), b = new Matrix3(), values = [0, -0, 1, -1, 1e-100, 1e100, Infinity, -Infinity, NaN];
    let seed = 4981;
    for (let i = 0; i < 1200; i++) {
      const args = Array.from({ length: 7 }, (_, j) => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return i < 90 ? values[(i + j * 3) % values.length]! : (seed / 2 ** 32 - .5) * 10;
      }) as Args;
      if (i % 3 === 0) args[4] = 0; else if (i % 3 === 1) args[4] = -0;
      native.call(a, ...args); fast.call(b, ...args); expect(bits(b)).toEqual(bits(a));
    }
  });
  it('still calls custom matrix.set methods and repairs externally changed elements on every call', () => {
    for (const rotation of [0, -0, .4]) {
      const run = (fn: typeof fast) => {
        const m = new Matrix3(), calls: number[][] = [], set = m.set;
        Object.defineProperty(m, 'set', { get() { calls.push([99]); return function (this: Matrix3, ...args: Parameters<Matrix3['set']>) { calls.push(args); return set.apply(this, args); }; } });
        fn.call(m, .3, -.4, 2, 3, rotation, .5, .2); m.elements[0] = 999; fn.call(m, .3, -.4, 2, 3, rotation, .5, .2);
        return { calls, bits: bits(m) };
      };
      expect(run(fast)).toEqual(run(native));
    }
  });
  it('preserves numeric-coercion order for unusual caller arguments', () => {
    const run = (fn: typeof fast, objectRotation: boolean) => {
      const trace: number[] = [], m = new Matrix3();
      const args = Array.from({ length: 7 }, (_, i) => ({ valueOf() { trace.push(i); return trace.length / 10; } })) as unknown as Args;
      if (!objectRotation) args[4] = 0;
      fn.call(m, ...args); return { trace, bits: bits(m) };
    };
    expect(run(fast, false)).toEqual(run(native, false)); expect(run(fast, true)).toEqual(run(native, true));
  });
  it('uses changed Math implementations instead of assuming their zero values', () => {
    const cos = Math.cos, sin = Math.sin;
    try {
      Math.cos = () => .25; Math.sin = () => -.75;
      const a = new Matrix3(), b = new Matrix3(); native.call(a, 0, 0, 1, 1, 0, .5, .5); fast.call(b, 0, 0, 1, 1, 0, .5, .5);
      expect(bits(b)).toEqual(bits(a)); expect(specializeUvTransform(native)).toBe(native);
    } finally { Math.cos = cos; Math.sin = sin; }
  });
  it('preserves Math getter order, receivers and changes made by the cosine call', () => {
    const cos = Object.getOwnPropertyDescriptor(Math, 'cos')!, sin = Object.getOwnPropertyDescriptor(Math, 'sin')!;
    const run = (fn: typeof fast) => {
      const trace: string[] = [], matrix = new Matrix3();
      try {
        Object.defineProperty(Math, 'cos', { configurable: true, get() {
          trace.push('get-cos');
          const fn = function (this: Math) {
            trace.push(this === Math ? 'cos' : 'bad-receiver');
            Object.defineProperty(Math, 'sin', { ...sin, value: function (this: Math) { trace.push(this === Math ? 'sin' : 'bad-receiver'); return -.5; } });
            return .25;
          };
          Object.defineProperty(fn, 'call', { value() { throw new Error('custom call property must not run'); } });
          return fn;
        } });
        fn.call(matrix, 0, 0, 1, 1, -0, .3, .5); return { trace, bits: bits(matrix) };
      } finally { Object.defineProperty(Math, 'cos', cos); Object.defineProperty(Math, 'sin', sin); }
    };
    expect(run(fast)).toEqual(run(native));
  });
  it('recognizes minified native code while leaving arbitrary custom setters untouched', () => {
    function minified(this: Matrix3, e: number, t: number, n: number, r: number, i: number, a: number, o: number) {
      const s = Math.cos(i), c = Math.sin(i);
      return this.set(n * s, n * c, -n * (s * a + c * o) + a + e, -r * c, r * s, -r * (-c * a + s * o) + o + t, 0, 0, 1), this;
    }
    expect(specializeUvTransform(minified)).not.toBe(minified);
    const custom = function (this: Matrix3, ...args: Args) { return native.apply(this, args); };
    expect(specializeUvTransform(custom)).toBe(custom);
  });
  it('installs once, preserves texture updates and respects non-writable or custom setters', () => {
    const descriptor = Object.getOwnPropertyDescriptor(Matrix3.prototype, 'setUvTransform')!;
    try {
      expect(specializeTextureUvMath()).toBe(true);
      const installed = Matrix3.prototype.setUvTransform;
      expect(installed).not.toBe(native); expect(specializeTextureUvMath()).toBe(true); expect(Matrix3.prototype.setUvTransform).toBe(installed);
      const texture = new Texture(); texture.repeat.set(2, 3); texture.center.set(.4, .2); texture.rotation = -0; texture.updateMatrix();
      expect(bits(texture.matrix)).toEqual(bits(native.call(new Matrix3(), 0, 0, 2, 3, -0, .4, .2)));
      Object.defineProperty(Matrix3.prototype, 'setUvTransform', { ...descriptor, writable: false });
      expect(specializeTextureUvMath()).toBe(false);
      const custom = function (this: Matrix3, ...args: Args) { return native.apply(this, args); };
      Object.defineProperty(Matrix3.prototype, 'setUvTransform', { ...descriptor, value: custom });
      expect(specializeTextureUvMath()).toBe(false); expect(Matrix3.prototype.setUvTransform).toBe(custom);
    } finally { Object.defineProperty(Matrix3.prototype, 'setUvTransform', descriptor); }
  });
});
