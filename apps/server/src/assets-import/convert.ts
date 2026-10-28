/**
 * The real converter of the on-demand import: runs `scripts/assets/build.ts --import-one=<job>` (the library's interior
 * pipeline, the same code that built the shipped models) in a child process with a time limit, a minimal environment (no
 * keys or tokens) and a temp folder to work in. The child reads the downloaded USD only through `python -I`
 * (scripts/assets/usd2glb.py); nothing from the download is executed.
 *
 * Needs the repository's `scripts/` folder and the Python venv from `npm run assets:simready-setup`. A hosted image
 * has neither; the import is off there anyway.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ConvertInput, ConvertOutput } from './service';

/** Python of the venv made by `npm run assets:simready-setup`, or `$AETHER_USD_PYTHON`. */
export function usdPython(env: Readonly<Record<string, string | undefined>> = process.env): string {
  return env['AETHER_USD_PYTHON'] ?? env['AETHER_SIMREADY_PY'] ?? join(homedir(), '.local', 'share', 'aether', 'simready', 'venv', 'bin', 'python');
}

/** True when the tools the conversion needs exist: the Python venv and the build script. */
export function toolsMissingReason(repoRoot: string, python: string = usdPython()): string | null {
  if (!existsSync(join(repoRoot, 'scripts', 'assets', 'build.ts'))) return 'conversion tools not installed: the import needs a checkout of the repository (scripts/assets) and npm run assets:simready-setup';
  if (!existsSync(python)) return 'conversion tools not installed: run npm run assets:simready-setup';
  return null;
}

/** Child-process time limit (the job has its own, longer budget). */
const CHILD_MS = 9 * 60_000;

/** Create the converter for a repository checkout. */
export function createConverter(repoRoot: string, python: string = usdPython()): (input: ConvertInput) => Promise<ConvertOutput> {
  return async (input) => {
    const libDir = join(input.work, 'lib');
    const tiers = join(input.work, 'tiers');
    mkdirSync(libDir, { recursive: true });
    mkdirSync(tiers, { recursive: true });
    const jobFile = join(input.work, 'job.json');
    writeFileSync(jobFile, JSON.stringify({ usd: input.usd, usdSha256: input.usdSha256, row: input.row, author: input.author, licence: input.licence, archive: input.archive, pack: input.pack, work: input.work, convert: ['--resmooth=50'] }));
    input.onStage('converting');
    await new Promise<void>((resolve, reject) => {
      // Node with tsx, the script file and nothing else: the environment carries no keys.
      const child = spawn(process.execPath, ['--import', 'tsx', join(repoRoot, 'scripts', 'assets', 'build.ts'), `--import-one=${jobFile}`], {
        cwd: repoRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { PATH: process.env['PATH'] ?? '', HOME: input.work, TMPDIR: input.work, AETHER_ASSET_LIB: libDir, AETHER_TIER_CACHE: tiers, AETHER_USD_PYTHON: python, AETHER_TIER_PY: python, AETHER_ASSET_SRC: join(input.work, 'src'), AETHER_NO_MESHOPT: '1', NODE_ENV: 'production' },
      });
      let err = '';
      let out = '';
      child.stdout.on('data', (c: Buffer) => {
        out = (out + c.toString()).slice(-4000);
        if (/\bstage:optimising\b/.test(out)) input.onStage('optimising');
      });
      child.stderr.on('data', (c: Buffer) => {
        err = (err + c.toString()).slice(-2000);
      });
      const kill = (): void => void child.kill('SIGKILL');
      const timer = setTimeout(() => {
        kill();
        reject(new Error('The conversion took too long and was stopped.'));
      }, CHILD_MS);
      const onAbort = (): void => {
        kill();
        reject(new Error('The import was stopped.'));
      };
      input.signal.addEventListener('abort', onAbort, { once: true });
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(new Error(`could not start the converter: ${e.message.slice(0, 120)}`));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        input.signal.removeEventListener('abort', onAbort);
        if (code === 0) resolve();
        else reject(new Error(`the converter failed: ${(err || out).trim().split('\n').slice(-3).join(' ').slice(0, 300)}`));
      });
    });
    const result = JSON.parse(readFileSync(join(input.work, 'result.json'), 'utf8')) as { entry: ConvertOutput['entry']; files: ConvertOutput['files'] };
    return { entry: result.entry, files: result.files, libDir };
  };
}
