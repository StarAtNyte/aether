/** Browser CPU throughput and exact data parity against the checked-in particle sampler. */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';
const repository = fileURLToPath(new URL('../../', import.meta.url));
const reference = process.env.AETHER_BENCH_BASE_REF ?? 'HEAD';
const baselineRevision = execFileSync('git', ['rev-parse', reference], { cwd: repository, encoding: 'utf8' }).trim();
const cpuRate = Number(process.env.AETHER_BENCH_CPU_RATE ?? 1);
if (!Number.isFinite(cpuRate) || cpuRate < 1 || cpuRate > 20) throw new Error('CPU rate must be between 1 and 20');
const baseline = (await transform(execFileSync('git', ['show', `${baselineRevision}:packages/render/src/vfx/pool.ts`], { cwd: repository, encoding: 'utf8' }), {
  loader: 'ts', target: 'es2022', format: 'esm',
})).code;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage();
  await page.route('**/particle-probe', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html>' }));
  await page.route('**/particle-baseline.js', route => route.fulfill({ contentType: 'text/javascript', body: baseline }));
  await page.goto(`${process.env.AETHER_BENCH_URL ?? 'http://localhost:5176'}/particle-probe`);
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
  const result = await page.evaluate(async repository => {
    const root = '/@fs' + repository;
    const before = await import('/particle-baseline.js');
    const after = await import(root + 'packages/render/src/vfx/pool.ts');
    const { VFX_PRESETS } = await import(root + 'packages/render/src/vfx/presets.ts');
    function measure(module, batch) {
      const pool = new module.ParticlePool(4096), random = new module.SeededRandom(987);
      const layer = VFX_PRESETS.sparks.layers[0], opts = { scale: 1.5, tint: null, floorY: 0.25 };
      const run = count => {
        const start = performance.now();
        for (let i = 0; i < count; i += batch) {
          const angle = i * 0.01;
          pool.at[3] = Math.sin(angle); pool.at[4] = Math.cos(angle); pool.at[5] = 0; pool.at[6] = i / 60;
          if (batch > 1 && pool.writeMany) pool.writeMany(layer, random, opts, batch);
          else for (let j = 0; j < batch; j++) pool.write(layer, random, opts);
        }
        return performance.now() - start;
      };
      run(100_000);
      const times = Array.from({ length: 7 }, () => run(300_000)).sort((a, b) => a - b);
      return { medianMs: times[3], arrays: [pool.origin, pool.velocity, pool.shape, pool.color0, pool.color1, pool.motion] };
    }
    return [1, 100].map(batch => {
      const a = measure(before, batch), b = measure(after, batch);
      let differences = 0;
      for (let i = 0; i < a.arrays.length; i++) {
        const x = new Uint32Array(a.arrays[i].buffer), y = new Uint32Array(b.arrays[i].buffer);
        for (let j = 0; j < x.length; j++) if (x[j] !== y[j]) differences++;
      }
      return { batch, beforeMs: a.medianMs, afterMs: b.medianMs, ratio: b.medianMs / a.medianMs, differences };
    });
  }, repository);
  console.log(JSON.stringify({ baselineRevision, cpuRate, result }, null, 2));
  if (result.some(r => r.differences)) process.exitCode = 1;
} finally {
  await browser.close();
}
