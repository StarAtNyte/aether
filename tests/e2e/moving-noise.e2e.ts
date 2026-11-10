/**
 * Regression test of the picture's noise in the editor's living-room scene (cutaway walls, default automatic tier): a fixed
 * camera path is rendered to lossless PNG frames (scripts/shadow-noise-probe.ts), then
 *  - the dots along shadow edges (isolated lit pixels from an under-sampled blocker search) must stay rare,
 *  - a smooth wall patch must not flicker between frames of a held view (temporal noise),
 *  - the wall's columns must carry no periodic stripe (column spectrum peak),
 *  - dragging the time of day across the day must never leave the viewport flat (scripts/sun-drag-probe.ts).
 * Needs a GPU for soft shadows (`GEN_GPU=intel`): the software rasteriser uses plain PCF and is skipped.
 *
 * Run: `npm run build && GEN_GPU=intel npx tsx tests/e2e/moving-noise.e2e.ts`
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPO_ROOT } from './support/env';

if (!process.env['GEN_GPU'] && process.env['AETHER_E2E_GPU'] !== '1') {
  process.stdout.write('moving-noise: no hardware GPU selected (set GEN_GPU=intel); skipped\n');
  process.exit(0);
}

const run = (script: string, args: string[]): string => execFileSync(process.execPath, ['--import', 'tsx', script, ...args], { cwd: REPO_ROOT, encoding: 'utf8', env: process.env, timeout: 600_000 });
const dir = mkdtempSync(join(tmpdir(), 'aether-noise-'));
let failed = 0;
const check = (name: string, ok: boolean, detail: string): void => {
  process.stdout.write(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${detail}\n`);
  if (!ok) failed++;
};
try {
  run('scripts/shadow-noise-probe.ts', [`--out=${dir}`, '--tier=auto', '--hour=10.5', '--size=1920x1000', '--frames=4', '--step=0.2']);
  const line = execFileSync('python3', ['scripts/shadow-noise-metrics.py', dir], { cwd: REPO_ROOT, encoding: 'utf8' });
  const num = (key: string): number => Number(new RegExp(`${key}\\s+([0-9.]+)`).exec(line)?.[1] ?? NaN);
  const speck = num('speck');
  const wall = num('tnoise\\(wall\\)');
  const cols = num('cols');
  check('shadow-edge dots', speck < 2.5, `${speck}% of rug pixels (limit 2.5, 3 blocker taps gave 5)`);
  check('temporal noise on a smooth wall', wall < 0.5, `${wall} levels between held frames (limit 0.5)`);
  check('stripes on the wall', cols < 9, `column spectrum peak ${cols} x mean (limit 9)`);
  run('scripts/sun-drag-probe.ts', [`--out=${join(dir, 'drag')}`, '--tier=auto', '--sweeps=1']);
  const drag = JSON.parse(readFileSync(join(dir, 'drag', 'report.json'), 'utf8')) as { frames: number; blankFrames: number };
  // The first sampled frame of the page reads before anything was drawn: at most two such samples.
  check('blank viewport while dragging the sun', drag.blankFrames <= 2, `${drag.blankFrames} flat of ${drag.frames} sampled frames`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
process.exit(failed === 0 ? 0 : 1);
