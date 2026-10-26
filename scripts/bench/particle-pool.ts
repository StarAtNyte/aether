/** Run with Node 24: npx tsx scripts/bench/particle-pool.ts. Baseline is the checked-in pool. */
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { ParticlePool, SeededRandom } from '../../packages/render/src/vfx/pool';
import { VFX_PRESETS } from '../../packages/render/src/vfx/presets';

const temporary = await mkdtemp(join(tmpdir(), 'aether-particle-'));
try {
  const file = join(temporary, 'baseline.ts');
  await writeFile(file, execFileSync('git', ['show', 'HEAD:packages/render/src/vfx/pool.ts']));
  const baseline = await import(pathToFileURL(file).href) as typeof import('../../packages/render/src/vfx/pool');
  function measure(Pool: typeof ParticlePool, Random: typeof SeededRandom, moving: boolean) {
    const pool = new Pool(4096), random = new Random(987);
    const options = { scale: 1.5, tint: null, floorY: 0.25 };
    const layer = VFX_PRESETS.sparks.layers[0]!;
    const run = (count: number) => {
      const start = performance.now();
      const batch = moving ? 1 : 100;
      for (let i = 0; i < count; i += batch) {
        const angle = i * 0.01;
        pool.at[3] = Math.sin(angle); pool.at[4] = Math.cos(angle); pool.at[5] = 0;
        pool.at[6] = i / 60;
        if (batch > 1 && 'writeMany' in pool) pool.writeMany(layer, random, options, batch);
        else for (let j = 0; j < batch; j++) pool.write(layer, random, options);
      }
      return performance.now() - start;
    };
    run(100_000);
    const times = Array.from({ length: 5 }, () => run(300_000)).sort((a, b) => a - b);
    const hash = createHash('sha256');
    for (const a of [pool.origin, pool.velocity, pool.shape, pool.color0, pool.color1, pool.motion]) hash.update(new Uint8Array(a.buffer));
    return { medianMs: times[2]!, hash: hash.digest('hex') };
  }
  for (const moving of [false, true]) {
    const before = measure(baseline.ParticlePool, baseline.SeededRandom, moving);
    const after = measure(ParticlePool, SeededRandom, moving);
    if (before.hash !== after.hash) throw new Error('Particle data changed');
    console.log(JSON.stringify({ direction: moving ? 'changes every particle' : 'shared by 100 particles', before, after, ratio: after.medianMs / before.medianMs }));
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
