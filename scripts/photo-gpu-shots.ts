/**
 * Photoreal montages of finished room-from-photo runs: for each run folder written by `scripts/eval-photo.ts`
 * (photo.jpg, first.world.json, world.json, views.json) draw the first attempt and the final room from the photo's camera
 * on the GPU, and write `photo | first attempt | final` next to the run, plus a one-page scoreboard of the run.
 *
 *   AETHER_E2E_GPU=1 npx tsx scripts/photo-gpu-shots.ts <runDir> <outDir> [--quality=studio|final] [--width=1280]
 *
 * `runDir` holds one folder per photo. Output: `<outDir>/<photo>/{photo.jpg,first.png,final.png,montage.png,scoreboard.json}`
 * and `<outDir>/scoreboard.md` for all photos.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { WorldDoc } from '@aether/core';
import { GpuRoom } from './lib/gpu-room';

const [runDirArg, outDirArg, ...flags] = process.argv.slice(2);
if (!runDirArg || !outDirArg) throw new Error('usage: photo-gpu-shots <runDir> <outDir> [--quality=studio|final] [--width=N]');
const runDir = resolve(runDirArg);
const outDir = resolve(outDirArg);
const flag = (k: string): string | undefined => flags.find((f) => f.startsWith(`--${k}=`))?.slice(k.length + 3);
const quality = flag('quality') === 'studio' ? 'studio' : 'final';
const width = Math.max(480, Math.min(1920, Number(flag('width') ?? 1280)));

interface View {
  name: string;
  aspect: number;
  pose: { position: [number, number, number]; target: [number, number, number]; fov: number };
}
interface Run {
  photo: string;
  source: string;
  calls: number;
  ms: number;
  first: { passed: number; total: number; objective: number | null } | null;
  final: { passed: number; total: number; objective: number | null; structuralFailed: boolean; failing: Array<{ id: string; note: string }> } | null;
}

function montage(files: readonly string[], out: string): void {
  const inputs = files.flatMap((f) => ['-i', f]);
  const scaled = files.map((_, i) => `[${i}:v]scale=-2:640[s${i}]`).join(';');
  const stack = `${files.map((_, i) => `[s${i}]`).join('')}hstack=inputs=${files.length}`;
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', `${scaled};${stack}`, '-frames:v', '1', out]);
  if (r.status !== 0) console.error(`montage failed: ${r.stderr.toString().slice(0, 300)}`);
}

const pct = (n: number): string => `${Math.round(n * 100)}%`;

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  const photos = readdirSync(runDir, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(runDir, d.name, 'run.json'))).map((d) => d.name);
  const gpu = await GpuRoom.open({ headed: process.env['SHOT_HEADED'] === '1' });
  const rows: string[] = [];
  try {
    for (const name of photos) {
      const src = join(runDir, name);
      const dst = join(outDir, name);
      mkdirSync(dst, { recursive: true });
      const run = JSON.parse(readFileSync(join(src, 'run.json'), 'utf8')) as Run;
      const views = JSON.parse(readFileSync(join(src, 'views.json'), 'utf8')) as { first: View | null; last: View | null };
      copyFileSync(join(src, 'photo.jpg'), join(dst, 'photo.jpg'));
      const files = [join(dst, 'photo.jpg')];
      const draw = async (worldFile: string, view: View | null, out: string): Promise<void> => {
        if (!view || !existsSync(worldFile)) return;
        const world = JSON.parse(readFileSync(worldFile, 'utf8')) as WorldDoc;
        await gpu.load(world);
        const height = Math.round(width / Math.max(0.5, Math.min(3, view.aspect)));
        writeFileSync(out, await gpu.still(view.pose, { width, height }, quality));
        files.push(out);
        console.log(`  ${name}: ${out}`);
      };
      await draw(join(src, 'first.world.json'), views.first, join(dst, 'first.png'));
      await draw(join(src, 'world.json'), views.last, join(dst, 'final.png'));
      if (files.length > 1) montage(files, join(dst, 'montage.png'));
      writeFileSync(join(dst, 'scoreboard.json'), `${JSON.stringify(run, null, 2)}\n`);
      const f = run.final;
      const first = run.first;
      rows.push(
        `| ${name} | ${first ? `${first.passed}/${first.total}` : '-'} | ${f ? `${f.passed}/${f.total} (${pct(f.passed / Math.max(1, f.total))})` : '-'} | ${f ? (f.structuralFailed ? 'yes' : 'no') : '-'} | ${f?.objective != null ? pct(f.objective) : '-'} | ${run.calls} | ${Math.round(run.ms / 1000)} s | ${f ? f.failing.map((x) => x.id).join(', ') || '-' : '-'} |`,
      );
    }
  } finally {
    await gpu.close();
  }
  writeFileSync(join(outDir, 'scoreboard.md'), ['| photo | first attempt | final | structural failure | measured agreement | model calls | time | still failing |', '|---|---|---|---|---|---|---|---|', ...rows, ''].join('\n'));
}

await main();
