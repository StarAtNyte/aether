/** Browser animation CPU cost and pose parity versus a selected repository revision. */
import { chromium, firefox } from 'playwright';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';
const repository = fileURLToPath(new URL('../../', import.meta.url));
const reference = process.env.AETHER_BENCH_BASE_REF ?? 'HEAD';
const revision = execFileSync('git', ['rev-parse', reference], { cwd: repository, encoding: 'utf8' }).trim();
const baselineFile = process.env.AETHER_BENCH_BASE_FILE;
const source = baselineFile ? await readFile(baselineFile, 'utf8') : execFileSync('git', ['show', `${revision}:packages/render/src/sync/asset-animator.ts`], { cwd: repository, encoding: 'utf8' });
const root = '/@fs' + repository;
const baseline = (await transform(source, { loader: 'ts', format: 'esm', target: 'es2022' })).code
  .replace(/from ["']three["']/g, `from ${JSON.stringify(root + 'node_modules/three/build/three.module.js')}`);
const cpuRate = Number(process.env.AETHER_BENCH_CPU_RATE ?? 1);
const heap = process.env.AETHER_BENCH_HEAP === '1';
const warmFrames = Number(process.env.AETHER_BENCH_WARM ?? 2000);
if (!Number.isInteger(warmFrames) || warmFrames < 0 || warmFrames > 100000) throw new Error('Warm frames must be an integer between 0 and 100000');
const engine = process.env.AETHER_BENCH_BROWSER ?? 'chromium';
if (!['chromium', 'firefox'].includes(engine)) throw new Error('Browser must be chromium or firefox');
if (!Number.isFinite(cpuRate) || cpuRate < 1 || cpuRate > 20) throw new Error('CPU rate must be between 1 and 20');
if (engine === 'firefox' && (heap || cpuRate !== 1)) throw new Error('Heap sampling and CPU throttling require Chromium');
const browser = await (engine === 'firefox' ? firefox.launch() : chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }));
try {
  const page = await browser.newPage();
  await page.route('**/animation-probe', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html>' }));
  await page.route('**/animation-baseline.js', route => route.fulfill({ contentType: 'text/javascript', body: baseline }));
  await page.goto(`${process.env.AETHER_BENCH_URL ?? 'http://localhost:5176'}/animation-probe`);
  const session = engine === 'chromium' ? await page.context().newCDPSession(page) : null;
  if (session) await session.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
  if (heap) await page.exposeBinding('__startHeap', async () => {
    await session.send('HeapProfiler.enable');
    await session.send('HeapProfiler.startSampling', { samplingInterval: 128, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
  });
  if (heap) await page.exposeBinding('__stopHeap', async () => {
    const { profile } = await session.send('HeapProfiler.stopSampling');
    let bytes = 0;
    const walk = node => {
      if (/animation-baseline\.js|sync\/asset-animator\.ts/.test(node.callFrame.url)) bytes += node.selfSize;
      for (const child of node.children) walk(child);
    };
    walk(profile.head);
    return bytes;
  });
  const result = await page.evaluate(async ({ root, heap, warmFrames }) => {
    const T = await import(root + 'node_modules/three/build/three.module.js');
    const before = await import('/animation-baseline.js');
    const after = await import(root + 'packages/render/src/sync/asset-animator.ts');
    async function measure(module, lod) {
      const animator = new module.AssetAnimator(), parents = [], roots = [];
      for (let i = 0; i < 32; i++) {
        const parent = new T.Group(), actor = new T.Group();
        actor.animations = ['idle', 'walk', 'run'].map((name, n) => new T.AnimationClip(name, 1, [new T.NumberKeyframeTrack('.position[y]', [0, 0.5, 1], [0, (n + 1) * 0.1, 0])]));
        parent.add(actor);
        animator.add(`actor-${i}`, actor, parent, { idle: 'idle', walk: 'walk', run: 'run' }, i % 3 ? undefined : 'walk');
        parents.push(parent); roots.push(actor);
      }
      let time = 0, frame = 0;
      const eye = { x: 0, y: 0, z: 0 };
      const run = count => {
        const start = performance.now();
        for (let f = 0; f < count; f++) {
          const dt = 0.012 + (++frame % 7) * 0.001;
          time += dt;
          for (let i = 0; i < parents.length; i++) {
            parents[i].position.set(Math.sin(time + i) * 3, 0, lod ? [5, 80, 200][i % 3] : 5);
            parents[i].updateMatrixWorld();
          }
          animator.update(dt, lod ? eye : undefined);
        }
        return performance.now() - start;
      };
      run(warmFrames);
      if (heap) await window.__startHeap();
      const times = Array.from({ length: 5 }, () => run(2000)).sort((a, b) => a - b);
      const bytesPerFrame = heap ? (await window.__stopHeap()) / 10000 : null;
      const pose = [];
      for (let i = 0; i < roots.length; i++) {
        pose.push(...roots[i].position.toArray(), ...roots[i].quaternion.toArray(), animator.list[i].mixer.time);
      }
      if (!pose.every(Number.isFinite) || !roots.some(actor => actor.position.y !== 0) || animator.list.some(item => item.mixer.time <= 0)) {
        throw new Error('Animation probe did not produce valid animated poses');
      }
      animator.clear();
      return { medianMs: times[2], pose, bytesPerFrame };
    }
    const results = [];
    for (const lod of [false, true]) {
      const a = await measure(before, lod), b = await measure(after, lod);
      let differences = 0;
      for (let i = 0; i < a.pose.length; i++) if (!Object.is(a.pose[i], b.pose[i])) differences++;
      results.push({ lod, beforeMs: a.medianMs, afterMs: b.medianMs, ratio: b.medianMs / a.medianMs, differences, beforeBytesPerFrame: a.bytesPerFrame, afterBytesPerFrame: b.bytesPerFrame });
    }
    return results;
  }, { root, heap, warmFrames });
  console.log(JSON.stringify({ baseline: baselineFile ?? revision, browser: engine, cpuRate, heap, warmFrames, result }, null, 2));
  if (result.some(r => r.differences)) process.exitCode = 1;
} finally {
  await browser.close();
}
