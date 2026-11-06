import { describe, expect, it } from 'vitest';
import { AGE_MS, FAIR_MS, gateWorker, MOTION_PAUSED, PAUSE_LIMIT_MS, workerBudget, WorkerScheduler, WorkerSlot, type GateableWorker, type WorkToken } from '../src/worker-scheduler';

function sched(budget: number): { s: WorkerScheduler; clock: { t: number } } {
  const clock = { t: 0 };
  return { s: new WorkerScheduler({ budget, enabled: true, clock: () => clock.t }), clock };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('workerBudget', () => {
  it('leaves two threads and follows device memory', () => {
    expect(workerBudget({ hardwareConcurrency: 8, deviceMemory: 8 })).toBe(6);
    expect(workerBudget({ hardwareConcurrency: 2, deviceMemory: 8 })).toBe(1);
    expect(workerBudget({ hardwareConcurrency: 16, deviceMemory: 4 })).toBe(2);
    expect(workerBudget({ hardwareConcurrency: 16, deviceMemory: 2 })).toBe(1);
    expect(workerBudget({})).toBe(2);
  });
});

describe('WorkerScheduler', () => {
  it('grants at most the budget and hands freed slots to the most urgent waiter', async () => {
    const { s } = sched(2);
    const a = s.tryAcquire('visible') as WorkToken;
    const b = s.tryAcquire('load') as WorkToken;
    expect(a && b).toBeTruthy();
    expect(s.tryAcquire('visible')).toBeNull();
    const order: string[] = [];
    void s.acquire('background').then((t) => (order.push('background'), t));
    void s.acquire('visible').then((t) => (order.push('visible'), t));
    b.release();
    await tick();
    expect(order).toEqual(['visible']);
    expect(s.snapshot().classes.background.queued).toBe(1);
  });

  it('lets load-critical and interactive jobs go over the budget, a little', () => {
    const { s } = sched(1);
    s.tryAcquire('visible');
    expect(s.tryAcquire('visible')).toBeNull();
    expect(s.tryAcquire('load')).not.toBeNull();
    expect(s.tryAcquire('load')).toBeNull();
    expect(s.tryAcquire('interactive')).not.toBeNull();
    expect(s.tryAcquire('interactive')).toBeNull();
  });

  it('keeps a slot from the low classes', () => {
    const { s } = sched(3);
    expect(s.tryAcquire('bake')).not.toBeNull();
    expect(s.tryAcquire('volume')).not.toBeNull();
    expect(s.tryAcquire('background')).toBeNull();
    expect(s.tryAcquire('visible')).not.toBeNull();
  });

  it('asks a holder to yield to a more urgent waiter, and ages waiters', async () => {
    const { s, clock } = sched(1);
    const gen = s.tryAcquire('visible') as WorkToken;
    void s.acquire('volume');
    // A light-volume waiter does not outrank generation at first, but does once it has waited.
    expect(gen.yieldRequested).toBe(false);
    clock.t += AGE_MS * 2.6;
    expect(gen.yieldRequested).toBe(true);
    const order: string[] = [];
    void s.acquire('visible').then(() => order.push('visible-late'));
    gen.release();
    await tick();
    expect(s.snapshot().classes.volume.running).toBe(1);
    expect(order).toEqual([]);
  });

  it('lets lanes of one class take turns', () => {
    const { s, clock } = sched(1);
    const a = s.tryAcquire('visible') as WorkToken;
    void s.acquire('visible');
    expect(a.yieldRequested).toBe(false);
    clock.t += FAIR_MS;
    expect(a.yieldRequested).toBe(true);
  });

  it('pauses bakes and background work, explicitly and while held', async () => {
    const { s, clock } = sched(4);
    s.setPaused('first-picture', true);
    expect(s.tryAcquire('bake')).toBeNull();
    expect(s.tryAcquire('visible')).not.toBeNull();
    let got = false;
    void s.acquire('bake').then(() => (got = true));
    s.setPaused('first-picture', false);
    await tick();
    expect(got).toBe(true);
    const bake = s.tryAcquire('bake') as WorkToken;
    s.holdPause('view-moving', 300);
    expect(bake.yieldRequested).toBe(true);
    clock.t += 301;
    expect(bake.yieldRequested).toBe(false);
    // A view that moves without a break stops holding work back after the limit.
    for (let t = 0; t <= PAUSE_LIMIT_MS + 600; t += 100) {
      clock.t += 100;
      s.holdPause('view-moving', 300);
    }
    expect(s.isPaused('bake')).toBe(false);
  });

  it('holds the light volume back only for pauses that name it', () => {
    const { s } = sched(4);
    s.setPaused('first-picture', true);
    expect(s.isPaused('volume')).toBe(false);
    s.setPaused('editor-drag', true, MOTION_PAUSED);
    expect(s.isPaused('volume')).toBe(true);
    expect(s.isPaused('load')).toBe(false);
    s.setPaused('editor-drag', false);
    expect(s.isPaused('volume')).toBe(false);
  });

  it('switched off, grants everything at once', () => {
    const s = new WorkerScheduler({ budget: 1, enabled: false });
    for (let i = 0; i < 5; i++) expect(s.tryAcquire('background')).not.toBeNull();
  });
});

describe('WorkerSlot', () => {
  it('claims synchronously when free, else calls back on grant', async () => {
    const { s } = sched(1);
    const a = new WorkerSlot('visible', s);
    const b = new WorkerSlot('visible', s);
    expect(a.claim(() => undefined)).toBe(true);
    let granted = false;
    expect(b.claim(() => (granted = true))).toBe(false);
    a.release();
    await tick();
    expect(granted).toBe(true);
    expect(b.held).toBe(true);
  });
});

class FakeWorker implements GateableWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  sent: unknown[] = [];
  private listeners: Array<(e: Event) => void> = [];
  postMessage(m: unknown): void {
    this.sent.push(m);
  }
  terminate(): void {}
  addEventListener(type: string, l: (e: Event) => void): void {
    if (type === 'message') this.listeners.push(l);
  }
  removeEventListener(): void {}
  reply(data: unknown): void {
    const e = { type: 'message', data } as MessageEvent;
    for (const l of this.listeners) l(e);
    this.onmessage?.(e);
  }
}

describe('gateWorker', () => {
  it('holds requests until a slot is free and frees it with the last reply', async () => {
    const g = globalThis as { __aetherWorkerScheduler?: unknown };
    const prev = g.__aetherWorkerScheduler;
    const { s } = sched(1);
    g.__aetherWorkerScheduler = s;
    try {
      const other = s.tryAcquire('visible') as WorkToken;
      const w = gateWorker(new FakeWorker(), 'background');
      w.postMessage({ id: 1 });
      expect(w.sent).toEqual([]);
      other.release();
      await tick();
      expect(w.sent).toEqual([{ id: 1 }]);
      expect(s.busy).toBe(1);
      w.reply({ id: 1 });
      expect(s.busy).toBe(0);
    } finally {
      g.__aetherWorkerScheduler = prev;
    }
  });
});
