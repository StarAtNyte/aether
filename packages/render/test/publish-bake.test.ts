import { describe, expect, it } from 'vitest';
import { WorkerScheduler } from '@aether/core';
import { bakeLanes, bakeLightmapSplit, finishBytes, laneBytes } from '../src/view/publish-bake';
import type { LightmapWorkerLike } from '../src/view/lightmap-controller';
import { MAX_SUN_KEYS } from '../src/environment/light-volume';

/** A fake lightmap worker speaking the split protocol: shares of `n` texels, progress, pauses. */
function fakeWorkers(n: number, log: { live: number; peak: number; made: number; terminated: number; paused: number; started: number; relayed?: number }) {
  return (): LightmapWorkerLike => {
    log.made++;
    let held = -1;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let paused = false;
    const w: LightmapWorkerLike = {
      onmessage: null,
      onerror: null,
      postMessage(m: unknown) {
        const d = m as { type?: string; hold?: boolean; id: number; index: number; count: number; shares?: Array<{ vis: Float32Array }>; meta?: { key: string } };
        const reply = (data: unknown): void => void setTimeout(() => w.onmessage?.({ data } as MessageEvent), 0);
        if (d.type === 'pause') {
          paused = (m as { on: boolean }).on;
          if (paused) log.paused++;
          return;
        }
        if (d.hold) {
          held = d.id;
          reply({ type: 'held', id: d.id });
          return;
        }
        // The other lanes get the job from the first worker over a channel.
        if (d.type === 'relay' || d.type === 'hold-from') {
          (m as { port: MessagePort }).port.close();
          log.relayed = (log.relayed ?? 0) + (d.type === 'hold-from' ? 1 : 0);
          if (d.type === 'hold-from') {
            held = 1;
            reply({ type: 'held', id: 1 });
          }
          return;
        }
        if (d.type === 'share') {
          log.started++;
          log.live++;
          log.peak = Math.max(log.peak, log.live);
          const k = Math.ceil((n - d.index) / d.count);
          const tick = (left: number): void => {
            timer = setTimeout(() => {
              if (paused) return tick(left);
              if (left > 0) {
                w.onmessage?.({ data: { type: 'progress', id: d.id, index: d.index, value: 1 - left / 3 } } as MessageEvent);
                return tick(left - 1);
              }
              log.live--;
              const vis = new Float32Array(k).fill(d.index);
              w.onmessage?.({ data: { type: 'share', id: d.id, index: d.index, count: d.count, vis, bounce: new Float32Array(k * 3 * 3), bad: new Uint8Array(k), rays: k } } as MessageEvent);
            }, 1);
          };
          tick(3);
          return;
        }
        if (d.type === 'finish') {
          const order = d.shares!.map((s) => s.vis[0] ?? -1);
          reply({ type: 'file', id: held, bytes: new TextEncoder().encode(JSON.stringify({ key: d.meta!.key, order })), texels: n, rays: n, image: 'webp' });
        }
      },
      terminate() {
        log.terminated++;
        if (timer) clearTimeout(timer);
      },
    };
    return w;
  };
}

const job = { key: `lm5-${'a'.repeat(32)}`, quality: 'high', triCounts: [2], request: { sunKeys: [] } as never };

describe('the publish bake split over workers', () => {
  it('cuts the job into shares, runs them on bake tokens of the scheduler and finishes from all of them in order', async () => {
    const log: { live: number; peak: number; made: number; terminated: number; paused: number; started: number; relayed?: number } = { live: 0, peak: 0, made: 0, terminated: 0, paused: 0, started: 0 };
    const scheduler = new WorkerScheduler({ budget: 4 });
    const seen: number[] = [];
    const r = await bakeLightmapSplit(job, { lanes: 4, shares: 10, scheduler, createWorker: fakeWorkers(100, log), onProgress: (p) => seen.push(p.fraction) });
    const out = JSON.parse(new TextDecoder().decode(r.bytes)) as { key: string; order: number[] };
    expect(out.key).toBe(job.key);
    expect(out.order).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(r.shares).toBe(10);
    // The bake class holds at most the budget less one (a raycast or a cell in view never waits for it).
    expect(log.peak).toBeLessThanOrEqual(3);
    expect(log.peak).toBeGreaterThan(1);
    expect(log.terminated).toBe(log.made);
    expect(seen.at(-1)).toBe(1);
    // One worker got the job; every other one its copy from that worker, not from the page.
    expect(log.relayed).toBe(log.made - 1);
    expect(scheduler.snapshot().running).toBe(0);
    expect(MAX_SUN_KEYS).toBeGreaterThan(0);
  });

  it('parks while the scheduler pauses the bake, and stops every worker when cancelled', async () => {
    const log: { live: number; peak: number; made: number; terminated: number; paused: number; started: number; relayed?: number } = { live: 0, peak: 0, made: 0, terminated: 0, paused: 0, started: 0 };
    const scheduler = new WorkerScheduler({ budget: 3 });
    const ctrl = new AbortController();
    const p = bakeLightmapSplit(job, { lanes: 2, shares: 400, scheduler, createWorker: fakeWorkers(4000, log), signal: ctrl.signal });
    await new Promise((r) => setTimeout(r, 30));
    // While the view moves the bake holds back: its lanes give their tokens back between shares (or park mid-share).
    const before = log.started;
    expect(before).toBeGreaterThan(0);
    scheduler.holdPause('view', 400, ['bake']);
    await new Promise((r) => setTimeout(r, 60));
    const during = log.started;
    await new Promise((r) => setTimeout(r, 250));
    expect(log.started).toBe(during);
    expect(scheduler.snapshot().classes.bake.running).toBe(0);
    await new Promise((r) => setTimeout(r, 300));
    expect(log.started).toBeGreaterThan(during);
    ctrl.abort();
    await expect(p).rejects.toThrow();
    expect(log.terminated).toBe(log.made);
    expect(scheduler.snapshot().running).toBe(0);
  });
});

describe('the publish bake sized by memory', () => {
  // A house's job: 25 k trace triangles, a 19 k-probe volume of 18 parts, 50 k receiver triangles, 15 sun keys, a 1024² atlas.
  const keys = Array.from({ length: 15 }, () => [0, 1, 0] as [number, number, number]);
  const r = { maxSize: 1024, sunKeys: keys, positions: new Float32Array(25_000 * 9), albedo: new Float32Array(75_000), field: new Float32Array(19_008 * 220), codes: new Float32Array(38_016), meshes: [{ positions: new Float32Array(150_000 * 3), normals: new Float32Array(150_000 * 3), index: null }] } as never;

  it('takes the cores but two when memory allows, fewer when it does not, and one at the least', () => {
    const per = laneBytes(r, 90);
    expect(per).toBeGreaterThan(80e6);
    expect(per).toBeLessThan(250e6);
    expect(finishBytes(r)).toBeGreaterThan(300e6);
    const big = bakeLanes(r, { hardwareConcurrency: 32, deviceMemory: 8 });
    expect(big).toBeGreaterThan(2);
    expect(big).toBeLessThanOrEqual(30);
    // At most a quarter of the device's memory, the finishing worker's atlas included.
    expect(big * per + finishBytes(r)).toBeLessThanOrEqual(8 * 2 ** 30 * 0.25);
    expect(bakeLanes(r, { hardwareConcurrency: 4, deviceMemory: 8 })).toBe(2);
    expect(bakeLanes(r, { hardwareConcurrency: 32 })).toBeLessThan(big);
    expect(bakeLanes(r, { hardwareConcurrency: 32, deviceMemory: 2 })).toBe(1);
    // A large machine: the tab's cap, not the cores.
    const huge = bakeLanes(r, { hardwareConcurrency: 64, deviceMemory: 64 });
    expect(huge * per + finishBytes(r)).toBeLessThanOrEqual(3 * 2 ** 30);
  });
});
