import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInput } from '@aether/voxel/game';
import { TOUCH_HOLD_MS, TOUCH_LOOK_PER_PX, VoxelInput } from '../src/voxel/input';

type Listener = (e: unknown) => void;

/** An event target that records its listeners (the suite runs in Node). */
class Target {
  readonly listeners = new Map<string, Listener[]>();
  addEventListener(type: string, fn: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  removeEventListener(type: string, fn: Listener): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((f) => f !== fn));
  }
  fire(type: string, e: unknown): void {
    for (const fn of this.listeners.get(type) ?? []) fn(e);
  }
}

class FakeCanvas extends Target {
  tagName = 'CANVAS';
  isContentEditable = false;
  blur = vi.fn();
  requestPointerLock = vi.fn();
}

const win = new Target();
const doc = Object.assign(new Target(), { pointerLockElement: null as unknown, activeElement: null as unknown, exitPointerLock: vi.fn() });
let clock = 0;

function touch(id: number, x: number, y: number): { pointerType: string; pointerId: number; clientX: number; clientY: number; preventDefault: () => void; prevented: boolean } {
  const e = { pointerType: 'touch', pointerId: id, clientX: x, clientY: y, prevented: false, preventDefault: () => { e.prevented = true; } };
  return e;
}

/** Fire on the canvas and let it bubble to the window (as the browser would). */
function down(el: FakeCanvas, e: ReturnType<typeof touch>): void {
  win.listeners.get('pointerdown')?.forEach((fn) => fn(e));
  el.fire('pointerdown', e);
}

beforeEach(() => {
  win.listeners.clear();
  doc.listeners.clear();
  clock = 1000;
  vi.stubGlobal('HTMLElement', FakeCanvas);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', win);
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup(): { el: FakeCanvas; input: VoxelInput; out: ReturnType<typeof createInput> } {
  const el = new FakeCanvas();
  const input = new VoxelInput();
  input.attach(el as unknown as HTMLElement);
  return { el, input, out: createInput() };
}

describe('VoxelInput touch play', () => {
  it('a quick tap places (use), without pointer lock or emulated mouse events', () => {
    const { el, input, out } = setup();
    const e = touch(1, 100, 100);
    down(el, e);
    expect(e.prevented).toBe(true);
    expect(input.touch).toBe(true);
    clock += 120;
    win.fire('pointerup', touch(1, 102, 101));
    input.sample(out);
    expect(out.use).toBe(true);
    expect(out.primary).toBe(false);
    input.sample(out);
    expect(out.use).toBe(false);
    // Touch players are never asked to capture the mouse.
    input.lock();
    expect(el.requestPointerLock).not.toHaveBeenCalled();
    expect(input.needsCapture).toBe(false);
    input.detach();
  });

  it('touch and hold breaks until released, and aims while held', () => {
    const { el, input, out } = setup();
    down(el, touch(3, 200, 200));
    clock += TOUCH_HOLD_MS - 10;
    input.sample(out);
    expect(out.primary).toBe(false);
    clock += 20;
    input.sample(out);
    expect(out.primary).toBe(true);
    expect(out.attack).toBe(true);
    const yaw = out.yaw;
    win.fire('pointermove', touch(3, 230, 200));
    input.sample(out);
    expect(out.primary).toBe(true);
    expect(out.yaw).toBeCloseTo(yaw - 30 * TOUCH_LOOK_PER_PX, 9);
    win.fire('pointerup', touch(3, 230, 200));
    input.sample(out);
    expect(out.primary).toBe(false);
    // Releasing a hold is not a tap.
    expect(out.use).toBe(false);
    input.detach();
  });

  it('a drag looks around and neither places nor breaks', () => {
    const { el, input, out } = setup();
    input.sample(out);
    const yaw0 = out.yaw;
    const pitch0 = out.pitch;
    down(el, touch(5, 100, 300));
    win.fire('pointermove', touch(5, 104, 300));
    input.sample(out);
    // Inside the slop: no look yet (a tap may still follow).
    expect(out.yaw).toBe(yaw0);
    win.fire('pointermove', touch(5, 160, 260));
    clock += TOUCH_HOLD_MS * 3;
    input.sample(out);
    expect(out.yaw).toBeLessThan(yaw0);
    expect(out.pitch).toBeGreaterThan(pitch0);
    expect(out.primary).toBe(false);
    win.fire('pointerup', touch(5, 160, 260));
    input.sample(out);
    expect(out.use).toBe(false);
    input.detach();
  });

  it('ignores a second finger and mouse pointers; cancel and blur release the hold', () => {
    const { el, input, out } = setup();
    down(el, touch(7, 50, 50));
    down(el, touch(8, 300, 300));
    win.fire('pointerup', touch(8, 300, 300));
    input.sample(out);
    expect(out.use).toBe(false);
    clock += TOUCH_HOLD_MS + 1;
    input.sample(out);
    expect(out.primary).toBe(true);
    win.fire('pointercancel', touch(7, 50, 50));
    input.sample(out);
    expect(out.primary).toBe(false);
    const mouse = { ...touch(9, 10, 10), pointerType: 'mouse' };
    el.fire('pointerdown', mouse);
    expect(mouse.prevented).toBe(false);
    input.detach();
    // Detached: no listeners left behind.
    for (const t of [win, el]) for (const fns of t.listeners.values()) expect(fns).toHaveLength(0);
  });

  it('starts in touch mode on a coarse primary pointer: "tap to play" hints, no mouse capture', () => {
    const coarse = Object.assign(win, { matchMedia: (q: string) => ({ matches: q === '(pointer: coarse)' }) });
    vi.stubGlobal('window', coarse);
    const { el, input } = setup();
    expect(input.touch).toBe(true);
    expect(input.needsCapture).toBe(true);
    input.lock();
    expect(el.requestPointerLock).not.toHaveBeenCalled();
    expect(input.needsCapture).toBe(false);
    input.detach();
    delete (coarse as { matchMedia?: unknown }).matchMedia;
  });

  it('the inventory screen blocks touch gestures', () => {
    const { el, input, out } = setup();
    input.uiOpen = true;
    down(el, touch(11, 10, 10));
    clock += TOUCH_HOLD_MS * 2;
    win.fire('pointerup', touch(11, 10, 10));
    input.sample(out);
    expect(out.use).toBe(false);
    expect(out.primary).toBe(false);
    input.detach();
  });
});
