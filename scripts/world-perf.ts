/**
 * Frame cost of a saved world (`world.json`, e.g. from scripts/brief-probe.ts, or a template file) on the integrated GPU: median and
 * 90th percentile frame interval over a slow walk, plus the renderer's draw calls and triangles.
 *
 *   GEN_GPU=intel npx tsx scripts/world-perf.ts <world.json> [--frames=150] [--warm=0] [--settle] [--tier=auto|low|medium|high|ultra] [--fixed] [--spawn]
 *
 * The walk: inside the largest room of a building when the world has one; otherwise from the player's spawn, 24 m along the
 * spawn's facing (or toward the middle of the world when the spawn has no yaw), at eye height above the spawn. `--tier` pins the
 * render tier (default: the automatic choice, governor and all). `--fixed` turns adaptive resolution off, so the numbers are the
 * cost of the tier at full resolution rather than what the governor settles on. `--spawn` walks from the spawn even when
 * the world has a building. `--warm=N` walks the same line N frames first, unmeasured, so shader links and the governor's
 * choices are over before the measured walk. `--settle` first walks it back and forth until nothing is left to prepare or link
 * and the tier has held for 15 s (at most 4 minutes), and reports how long that took and how many frames drew nothing. Without GEN_GPU the browser draws with SwiftShader (software), which approximates a machine with
 * no usable GPU. Frame intervals are paced by the display, headless too (16.7 ms at best): a scene that fits in a frame reads
 * 16.7 ms whatever it costs, so compare slow configurations, the maximum and the frames over 50 ms. `drawn` gives the intervals
 * between frames the renderer drew (frames that passed while objects were still being prepared drew nothing).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createWorld, type WorldDoc } from '@aether/core';
import { readScene } from '@aether/arch';
import { GpuRoom } from './lib/gpu-room';

const [file, ...rest] = process.argv.slice(2);
if (!file) throw new Error('usage: world-perf <world.json> [--frames=N] [--tier=T] [--fixed]');
const arg = (name: string): string | undefined => rest.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const frames = Number(arg('frames') ?? 150);
const warm = Number(arg('warm') ?? 0);
const tier = arg('tier') ?? 'auto';
const fixed = rest.includes('--fixed');
const atSpawn = rest.includes('--spawn');
const settle = rest.includes('--settle');
const raw = JSON.parse(readFileSync(resolve(file), 'utf8')) as { format?: string; world?: unknown };
const world = createWorld((raw.format === 'aether-world' && raw.world ? raw.world : raw) as never) as WorldDoc;
const building = Object.values(world.entities).find((e) => e.arch?.role === 'building' && !e.parent);
const room = [...(building ? (readScene(world, building.id)?.rooms ?? []) : [])].sort((a, b) => b.area - a.area)[0];

// The middle of where the pieces stand (robust to a few far-off entities).
const xs: number[] = [];
const zs: number[] = [];
for (const e of Object.values(world.entities)) {
  const [x, , z] = e.transform.position;
  if (Math.abs(x) < 400 && Math.abs(z) < 400) {
    xs.push(x);
    zs.push(z);
  }
}
xs.sort((a, b) => a - b);
zs.sort((a, b) => a - b);
const q = (a: number[], p: number): number => a[Math.min(a.length - 1, Math.max(0, Math.floor(a.length * p)))] as number;

let from: [number, number, number];
let to: [number, number, number];
const player = (world as unknown as { player?: { spawn?: number[]; yaw?: number } }).player;
if (room && !(atSpawn && player?.spawn)) {
  const [x0, z0, x1, z1] = room.bbox;
  const cx = (x0 + x1) / 2;
  from = [cx, 1.6, z1 - 1];
  to = [cx, 1.6, z0 + 1];
} else if (player?.spawn && player.spawn.length === 3) {
  const [sx, sy, sz] = player.spawn as [number, number, number];
  let dx: number;
  let dz: number;
  if (typeof player.yaw === 'number') {
    const yaw = (player.yaw * Math.PI) / 180;
    dx = -Math.sin(yaw);
    dz = -Math.cos(yaw);
  } else {
    dx = q(xs, 0.5) - sx;
    dz = q(zs, 0.5) - sz;
  }
  const len = Math.hypot(dx, dz) || 1;
  const eye = sy + 1.6;
  from = [sx, eye, sz];
  to = [sx + (dx / len) * 24, eye, sz + (dz / len) * 24];
} else {
  const [x0, x1, z0, z1] = [q(xs, 0.05), q(xs, 0.95), q(zs, 0.05) + 6, q(zs, 0.95) - 6];
  const cx = (x0 + x1) / 2;
  from = [cx, 1.6, z1 - 1];
  to = [cx, 1.6, z0 + 1];
}

const gpu = await GpuRoom.open({});
try {
  await gpu.load(world);
  await gpu.evaluate(
    ([t, f]) => {
      const r = window.__aether?.simulation?.renderer as unknown as { setRenderTier?: (x: string) => void; setAdaptiveResolution?: (on: boolean) => void } | undefined;
      if (t !== 'auto') r?.setRenderTier?.(t as string);
      if (f) r?.setAdaptiveResolution?.(false);
    },
    [tier, fixed] as const,
  );
  const settled = settle
    ? await gpu.evaluate(
        async ([a, b]) => {
          const r = window.__aether?.simulation?.renderer as unknown as {
            setCameraPose(x: number, y: number, z: number, yaw: number, pitch: number): void;
            render(dt: number, o?: unknown): boolean;
            preparation: { pending: number };
            programs: { pending: number };
            governor: { level: number };
            renderTier: string;
          };
          const yaw = Math.atan2(-(b[0] - a[0]), -(b[2] - a[2]));
          const draw = r.render.bind(r);
          let drew = false;
          r.render = (dt: number, o?: unknown): boolean => {
            const ok = draw(dt, o);
            if (ok) drew = true;
            return ok;
          };
          const start = performance.now();
          let quiet = 0;
          let blank = 0;
          let state = '';
          let stateAt = start;
          for (let i = 0; performance.now() - start < 240_000; i++) {
            const k = (i % 240) / 240;
            const t = k < 0.5 ? k * 2 : 2 - k * 2;
            r.setCameraPose(a[0] + (b[0] - a[0]) * t, a[1], a[2] + (b[2] - a[2]) * t, yaw, -0.05 + 0.1 * Math.sin(i / 7));
            drew = false;
            await new Promise((res) => requestAnimationFrame(() => res(null)));
            if (!drew) blank++;
            const now = performance.now();
            const s = `${r.governor.level}/${r.renderTier}`;
            if (s !== state) {
              state = s;
              stateAt = now;
            }
            quiet = r.preparation.pending > 0 || r.programs.pending > 0 ? 0 : quiet + 1;
            if (quiet > 120 && now - stateAt > 15_000) break;
          }
          r.render = draw;
          return { seconds: Math.round((performance.now() - start) / 1000), blankFrames: blank };
        },
        [[...from], [...to]] as const,
      )
    : null;
  if (warm > 0) await gpu.frameCost(from, to, warm);
  // Frames the renderer actually drew (an animation frame can pass with nothing drawn while objects coming into view still
  // prepare): the intervals between them are what the eye sees.
  await gpu.evaluate(() => {
    const rr = window.__aether?.simulation?.renderer as unknown as { render(dt: number, o?: unknown): boolean; __drawn?: number[] };
    const draw = rr.render.bind(rr);
    const drawn: number[] = [];
    rr.__drawn = drawn;
    rr.render = (dt: number, o?: unknown): boolean => {
      const ok = draw(dt, o);
      if (ok) drawn.push(performance.now());
      return ok;
    };
  }, null);
  const r = await gpu.frameCost(from, to, frames);
  const drawnFrames = await gpu.evaluate(() => {
    const t = (window.__aether?.simulation?.renderer as unknown as { __drawn?: number[] }).__drawn ?? [];
    const dts = t.slice(1).map((v, i) => v - (t[i] as number)).sort((x, y) => x - y);
    const at = (p: number): number => Math.round((dts[Math.min(dts.length - 1, Math.floor(dts.length * p))] ?? 0) * 10) / 10;
    return { count: t.length, medianMs: at(0.5), p90Ms: at(0.9) };
  }, null);
  const mem = await gpu.evaluate(() => {
    const rr = window.__aether?.simulation?.renderer as unknown as { memoryStats(): Record<string, unknown>; renderTier?: string };
    const m = rr.memoryStats();
    return { gpuTier: m['gpuTier'], gpu: m['gpu'], pixelRatio: m['pixelRatio'], drawingBuffer: m['drawingBuffer'], shadowMapSize: m['shadowMapSize'], post: m['post'], tierInEffect: rr.renderTier };
  }, null);
  process.stdout.write(`${JSON.stringify({ room: room?.key ?? 'open world', tier, fixed, from, to, ...r, drawn: drawnFrames, settled, ...mem }, (k, v) => (['textures', 'geometries'].includes(k) ? undefined : v))}\n`);
} finally {
  await gpu.close();
}
