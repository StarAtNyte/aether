import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorldRenderer } from '../src/world-renderer';
import { leanShading } from '../src/materials/anti-tile';

function state() {
  return {
    qualityPlan: { moveEffects: {} }, atRest: false, motionFrameReady: false,
    preparation: { pending: 0 }, programs: { pending: 0 }, lastChangeAt: 0,
    restDeferred: false, restAnimating: false, restSlow: 0,
    forceLean: null as boolean | null, motionScale: .75,
    adaptive: { enabled: true, scale: .75, reset: vi.fn() },
    refinement: { restart: vi.fn() }, resize: vi.fn(), cssWidth: 800, cssHeight: 600,
  };
}
type State = ReturnType<typeof state>;
const syncRest = (WorldRenderer.prototype as unknown as { syncRest(this: State, motion: boolean, animating: boolean): void }).syncRest;
afterEach(() => vi.restoreAllMocks());

describe('quality phases while resources prepare', () => {
  it('keeps background refinement quiet while still reporting pending render work', () => {
    const processing = Object.getOwnPropertyDescriptor(WorldRenderer.prototype, 'processingStage')!.get!;
    const s = {
      disposed: false, lost: false, captureActive: false, tracing: false,
      syncing: 0, sync: { idle: true }, foliagePending: false,
      warming: false, postPending: false, preparation: { pending: 0 },
      programs: { pending: 0 }, lightVolumeBaking: false,
      atRest: true, restAnimating: false, framesDrawn: 1, refineProgress: 0,
    };
    expect(processing.call(s)).toBeNull();
    s.preparation.pending = 1;
    expect(processing.call(s)).toBe('render');
  });
  it('does not report ongoing animation as still refinement without a separate motion phase', () => {
    const s = { ...state(), qualityPlan: { moveEffects: null } };
    syncRest.call(s as unknown as State, false, true);
    expect(s.restAnimating).toBe(true);
    syncRest.call(s as unknown as State, true, false);
    expect(s.restAnimating).toBe(true);
    syncRest.call(s as unknown as State, false, false);
    expect(s.restAnimating).toBe(false);
  });
  it('keeps material sampling and normal maps stable when camera motion starts or stops', () => {
    vi.spyOn(performance, 'now').mockReturnValue(10000);
    const s = state(); s.atRest = true;
    syncRest.call(s, true, false); expect(leanShading.value).toBe(0);
    s.motionFrameReady = true; s.lastChangeAt = 0;
    syncRest.call(s, false, false); expect(leanShading.value).toBe(0);
    const override = { ...s, forceLean: true }; syncRest.call(override, true, false); expect(leanShading.value).toBe(1);
    leanShading.value = 0;
  });
  it('shows a completed motion frame before starting the full rest pipeline', () => {
    vi.spyOn(performance, 'now').mockReturnValue(10000);
    const s = state();
    syncRest.call(s, false, false);
    expect(s.atRest).toBe(false);
    expect(s.resize).not.toHaveBeenCalled();
    s.motionFrameReady = true;
    syncRest.call(s, false, false);
    expect(s.atRest).toBe(true);
    expect(s.refinement.restart).toHaveBeenCalledOnce();
  });
  it('keeps targets stable while graphs or programs are pending', () => {
    vi.spyOn(performance, 'now').mockReturnValue(10000);
    const s = state();s.motionFrameReady = true;s.preparation.pending = 20;
    syncRest.call(s, false, false);
    s.preparation.pending = 0;s.programs.pending = 1;
    syncRest.call(s, false, false);
    expect(s.atRest).toBe(false);
    expect(s.adaptive.reset).not.toHaveBeenCalled();
    expect(s.resize).not.toHaveBeenCalled();
    s.programs.pending = 0;
    syncRest.call(s, false, false);
    expect(s.atRest).toBe(true);
    expect(s.adaptive.reset).toHaveBeenCalledOnce();
  });
  it('still enters motion immediately for real input and honors the slow-animation fallback', () => {
    vi.spyOn(performance, 'now').mockReturnValue(10000);
    const s = state();s.atRest = true;s.motionFrameReady = true;s.preparation.pending = 20;
    syncRest.call(s, true, false);
    expect(s.atRest).toBe(false);expect(s.motionFrameReady).toBe(false);expect(s.lastChangeAt).toBe(10000);
    s.motionFrameReady = true;s.preparation.pending = 0;s.restDeferred = true;
    syncRest.call(s, false, true);
    expect(s.atRest).toBe(false);
  });
});
