import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInput } from '@aether/voxel/game';
import { VoxelInput } from '../src/voxel/input';

/** Minimal DOM stand-ins (the suite runs in Node). */
class FakeElement {
  tagName = 'CANVAS';
  isContentEditable = false;
  blur = vi.fn();
  addEventListener(): void {}
  removeEventListener(): void {}
  requestPointerLock: (() => unknown) | undefined = undefined;
}

const doc = {
  pointerLockElement: null as unknown,
  activeElement: null as unknown,
  addEventListener(): void {},
  removeEventListener(): void {},
  exitPointerLock(): void {
    doc.pointerLockElement = null;
  },
};

beforeEach(() => {
  vi.stubGlobal('HTMLElement', FakeElement);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
  doc.pointerLockElement = null;
  doc.activeElement = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('VoxelInput capture overlay', () => {
  it('shows until engaged; stays away when the browser refuses pointer lock', async () => {
    const el = new FakeElement();
    el.requestPointerLock = () => Promise.reject(new Error('denied'));
    const input = new VoxelInput();
    input.attach(el as unknown as HTMLElement);
    expect(input.needsCapture).toBe(true);
    input.lock();
    await Promise.resolve();
    await Promise.resolve();
    // Lock refused: the overlay must not trap the player (drag-to-look instead).
    expect(input.needsCapture).toBe(false);
    input.detach();
  });

  it('hides while locked and comes back after Esc when locking works', () => {
    const el = new FakeElement();
    el.requestPointerLock = () => {
      doc.pointerLockElement = el;
    };
    const input = new VoxelInput();
    input.attach(el as unknown as HTMLElement);
    input.lock();
    expect(input.locked).toBe(true);
    expect(input.needsCapture).toBe(false);
    doc.pointerLockElement = null; // the player pressed Esc
    expect(input.needsCapture).toBe(true);
    input.detach();
  });

  it('without pointer lock support, one click engages for good', () => {
    const el = new FakeElement();
    const input = new VoxelInput();
    input.attach(el as unknown as HTMLElement);
    expect(input.needsCapture).toBe(true);
    input.lock();
    expect(input.needsCapture).toBe(false);
    input.detach();
  });

  it('releases a focused text field so game keys are not typed into it', () => {
    const box = new FakeElement();
    box.tagName = 'TEXTAREA';
    doc.activeElement = box;
    const input = new VoxelInput();
    input.attach(new FakeElement() as unknown as HTMLElement);
    expect(box.blur).toHaveBeenCalledTimes(1);
    input.detach();
  });
});

describe('VoxelInput clicks without an answered pointer lock', () => {
  it('a lock request that is never answered stops swallowing clicks after a grace period', () => {
    const handlers = new Map<string, (e: unknown) => void>();
    const el = new FakeElement();
    el.addEventListener = ((type: string, fn: (e: unknown) => void) => handlers.set(type, fn)) as never;
    el.requestPointerLock = () => undefined; // silently ignored (headless, embedded views)
    const input = new VoxelInput();
    input.attach(el as unknown as HTMLElement);
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValue(1000);
    input.lock();
    const down = handlers.get('mousedown');
    if (!down) throw new Error('no mousedown handler');
    // Within the grace period the click is still the capture click.
    now.mockReturnValue(1500);
    down({ button: 0 });
    const a = createInput();
    input.sample(a);
    expect(a.primary).toBe(false);
    // Unanswered for over a second: clicks act directly.
    now.mockReturnValue(3000);
    down({ button: 0 });
    input.sample(a);
    expect(a.primary).toBe(true);
    now.mockRestore();
    input.detach();
  });
});
