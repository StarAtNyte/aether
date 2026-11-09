/**
 * Contact sheets of the procedural gait (a 12-frame strip per clip, side and front, the skirt cloth blue), written when
 * GAIT_STRIPS=<dir> is set:
 *
 *   GAIT_STRIPS=out/dir BODY=kaho npx vitest run packages/render/test/gait-strips.test.ts
 */
import { it } from 'vitest';
import { loadBodyRig } from './support/rig-fixture';
import { runScenario, SCENARIOS } from './support/gait-scenarios';
import { classify, drawBody, newImage, pelvisOf, posedWorld, writePng, type View } from './support/raster';
import { gaitShape } from '../src/characters/gait';

const out = process.env['GAIT_STRIPS'];

it.skipIf(!out)('writes the walk and run strips', async () => {
  const { rig } = await loadBodyRig(process.env['BODY'] ?? 'kaho');
  const bp = classify(rig)!;
  const views: View[] = ['side', 'front'];
  const cell = 260;
  const n = 12;
  for (const [name, speed] of [['walk', 1.4], ['run', 4.5]] as const) {
    const sc = SCENARIOS.find((s) => s.name === name)!;
    rig.root.updateMatrixWorld(true);
    const shape = gaitShape(speed, rig.gait!.measures ?? { legLength: 0.75, heel: 0.06, ball: 0.13 });
    const frames: Array<{ P: Float32Array; pel: ReturnType<typeof pelvisOf> }> = [];
    const every = Math.max(1, Math.round((shape.period * 60) / n));
    let k = 0;
    runScenario(rig, sc, (r, t) => {
      if (t < 2 || frames.length >= n) return;
      if (k++ % every === 0) frames.push({ P: posedWorld(r, bp, true), pel: pelvisOf(r) });
    });
    const im = newImage(n * cell, views.length * cell);
    views.forEach((v, vi) => frames.forEach((f, i) => drawBody(im, i * cell, vi * cell, cell, cell, bp, f.P, v, { cx: f.pel.x, cy: f.pel.y - 0.15, cz: f.pel.z, half: 0.65 })));
    writePng(`${out}/strip-${name}-${process.env['BODY'] ?? 'kaho'}.png`, im);
  }
}, 120_000);
