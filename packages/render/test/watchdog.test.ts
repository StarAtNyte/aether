import { describe, expect, it } from 'vitest';
import { BlackScreenWatchdog, GpuLogCapture, isBlackFrame, isShaderFailure, measureFrame, WATCHDOG_STEPS } from '../src/gpu/watchdog';

const black = { mean: 0, spread: 0 };
const image = { mean: 120, spread: 90 };

describe('measureFrame', () => {
  it('reads flat black and a gradient', () => {
    expect(isBlackFrame(measureFrame(new Uint8Array(64)))).toBe(true);
    const px = new Uint8Array(16 * 4);
    for (let i = 0; i < 16; i++) px.set([i * 16, i * 16, i * 16, 255], i * 4);
    expect(isBlackFrame(measureFrame(px))).toBe(false);
  });
  it('a flat bright colour is not black', () => {
    expect(isBlackFrame({ mean: 200, spread: 0 })).toBe(false);
  });
});

describe('BlackScreenWatchdog', () => {
  it('does not spend GPU recovery steps or give-up time while background geometry is preparing', () => {
    const w = new BlackScreenWatchdog({ firstFrameMs: 1000, giveUpMs: 2000 });
    w.begin(0, 0); expect(w.tick(500, 0, null)).toBeNull();
    expect(w.tick(1000, 0, null, true)).toBeNull(); expect(w.tick(10000, 0, null, true)).toBeNull();
    expect(w.finished).toBe(false); expect(w.stepsTaken).toBe(0);
    expect(w.tick(10010, 0, null)).toBeNull();
    expect(w.tick(10499, 0, null)).toBeNull(); expect(w.tick(10510, 0, null)?.reason).toBe('no-frame');
    const ready = new BlackScreenWatchdog({ firstFrameMs: 1000, giveUpMs: 2000 });
    ready.begin(0, 0); ready.tick(10000, 0, null, true);
    expect(ready.tick(10010, 1, image)).toBeNull(); expect(ready.healthy).toBe(true);
  });
  it('stays quiet while frames show an image', () => {
    const w = new BlackScreenWatchdog();
    w.begin(0, 0);
    expect(w.tick(1000, 1, image)).toBeNull();
    expect(w.finished).toBe(true);
    expect(w.tick(900_000, 1, black)).toBeNull();
  });

  it('steps after the first-frame wait when nothing is drawn, then again after each step', () => {
    const w = new BlackScreenWatchdog({ firstFrameMs: 1000, stepFrameMs: 500 });
    w.begin(0, 0);
    expect(w.tick(999, 0, null)).toBeNull();
    const a = w.tick(1000, 0, null);
    expect(a?.step).toBe('low-tier');
    expect(a?.reason).toBe('no-frame');
    expect(w.tick(1400, 0, null)).toBeNull();
    expect(w.tick(1500, 0, null)?.step).toBe('no-effects');
  });

  it('steps after three dark read-backs in a row, and a frame in between that shows an image ends it', () => {
    const w = new BlackScreenWatchdog({ sampleEveryMs: 100, darkSamples: 3 });
    w.begin(0, 0);
    expect(w.wantsSample(50, 1)).toBe(false);
    expect(w.wantsSample(150, 1)).toBe(true);
    expect(w.tick(150, 1, black)).toBeNull();
    expect(w.tick(300, 2, black)).toBeNull();
    const a = w.tick(450, 3, black);
    expect(a?.step).toBe('low-tier');
    expect(a?.reason).toBe('black-frame');
    const w2 = new BlackScreenWatchdog({ sampleEveryMs: 100, darkSamples: 3 });
    w2.begin(0, 0);
    w2.tick(150, 1, black);
    w2.tick(300, 2, black);
    expect(w2.tick(450, 3, image)).toBeNull();
    expect(w2.healthy).toBe(true);
  });

  it('goes through every step, then reports it is out of steps once', () => {
    const w = new BlackScreenWatchdog({ firstFrameMs: 10, stepFrameMs: 10 });
    w.begin(0, 0);
    const steps: string[] = [];
    for (let t = 10; t < 200; t += 10) {
      const a = w.tick(t, 0, null);
      if (a) steps.push(a.step);
    }
    expect(steps).toEqual([...WATCHDOG_STEPS, 'exhausted']);
    expect(w.finished).toBe(true);
  });

  it('does not run before begin()', () => {
    const w = new BlackScreenWatchdog({ firstFrameMs: 1 });
    expect(w.tick(1e6, 0, null)).toBeNull();
  });
});

describe('GpuLogCapture', () => {
  it('flags shader and link failures, not driver hints', () => {
    expect(isShaderFailure('THREE.WebGLProgram: Shader Error 0 - VALIDATE_STATUS false')).toBe(true);
    expect(isShaderFailure('WebGL warning: drawElementsInstanced: Depth texture comparison requests (e.g. LINEAR) Filtering, but behavior is implementation-defined')).toBe(false);
    expect(isShaderFailure('WebGL warning: Tex image TEXTURE_2D level 0 is incurring lazy initialization')).toBe(false);
    expect(isShaderFailure('program link failed: too many varying components')).toBe(true);
  });

  it('keeps a ring, calls back once per distinct failure and passes the console through', () => {
    const cap = new GpuLogCapture(3);
    const told: string[] = [];
    cap.onShaderFailure = (t) => told.push(t);
    const out: unknown[][] = [];
    const fake = { warn: (...a: unknown[]) => void out.push(a), error: (...a: unknown[]) => void out.push(a) } as Pick<Console, 'warn' | 'error'>;
    const undo = cap.install(fake);
    fake.error('THREE.WebGLProgram: shader compile error in fragment');
    fake.error('THREE.WebGLProgram: shader compile error in fragment');
    fake.warn('unrelated');
    for (let i = 0; i < 5; i++) fake.warn(`WebGL warning ${i}`);
    expect(told).toHaveLength(1);
    expect(cap.shaderFailures).toBe(1);
    expect(cap.lines.length).toBe(3);
    expect(out.length).toBe(8);
    undo();
  });
});
