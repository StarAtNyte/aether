/**
 * The publish bake on this computer (docs/LIGHTING-BAKE.md, "Bake at publish"): the studio's cooked publish sends the page's
 * lightmap bake job (`.lbjob`, render `encodeBakeJob`) and gets the `.lmap` back, baked by scripts/blender-bake.ts as the Node
 * cook bakes it: Cycles on the GPU when Blender is there and a GPU has room, else the CPU baker on several threads. Only in a
 * checkout (the script and tsx must be there); the routes are loopback-only (`routes/local.ts`).
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Largest job accepted (a house's job is tens of megabytes). */
export const MAX_BAKE_JOB_BYTES = 256 * 1024 * 1024;
/** Longest bake (ms). */
const BAKE_TIMEOUT_MS = 60 * 60 * 1000;
/** Default Blender of this machine (scripts/blender-bake.ts `DEFAULT_BLENDER`). */
const BLENDER = process.env['AETHER_BLENDER'] ?? '/home/at-office/tools/blender-4.2.3-linux-x64/blender';

export interface LocalBaker {
  /** Bakers this computer offers, best first. */
  bakers: string[];
  /** Bake a job; the `.lmap` bytes and the baker that made them, or null when every baker failed. */
  bake(job: Uint8Array, signal?: AbortSignal): Promise<{ bytes: Uint8Array; baker: string } | null>;
}

/** The checkout this server runs from (where scripts/blender-bake.ts is), or null. */
function checkout(): string | null {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'scripts', 'blender-bake.ts'))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

/** The local baker, or null when this server does not run from a checkout with the bake script and tsx. */
export function localBaker(log: (s: string) => void = () => undefined): LocalBaker | null {
  const root = checkout();
  if (!root) return null;
  let tsx: string;
  try {
    tsx = createRequire(join(root, 'package.json')).resolve('tsx');
  } catch {
    return null;
  }
  const script = join(root, 'scripts', 'blender-bake.ts');
  const bakers = [...(existsSync(BLENDER) ? ['cycles-gpu'] : []), 'cpu-threads'];
  const run = (jobPath: string, out: string, key: string, extra: string[], signal?: AbortSignal): Promise<string | null> =>
    new Promise((ok) => {
      // Under a memory cap and at low priority, as the cook runs it; plain node where systemd-run is not there.
      const node = [process.execPath, '--import', pathToFileURL(tsx).href, script, `--job=${jobPath}`, `--out=${out}`, ...extra];
      const viaScope = existsSync('/usr/bin/systemd-run') || existsSync('/bin/systemd-run');
      const p = viaScope ? spawn('systemd-run', ['--user', '--scope', '--quiet', '-p', 'MemoryMax=12G', 'nice', '-n', '10', ...node], { stdio: ['ignore', 'pipe', 'pipe'] }) : spawn(node[0]!, node.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] });
      let device = '';
      const timer = setTimeout(() => p.kill('SIGTERM'), BAKE_TIMEOUT_MS);
      const onAbort = (): void => void p.kill('SIGTERM');
      signal?.addEventListener('abort', onAbort, { once: true });
      p.stdout.on('data', (b: Buffer) => {
        for (const l of b.toString().split('\n')) {
          if (!l.startsWith('RESULT ')) continue;
          try {
            device = String((JSON.parse(l.slice(7)) as { device?: unknown }).device ?? '');
          } catch {
            /* not a result line */
          }
        }
      });
      p.stderr.on('data', (b: Buffer) => b.toString().split('\n').filter((l) => l.startsWith('[blender-bake]')).forEach((l) => log(l.trim().slice(0, 300))));
      p.on('error', () => ok(null));
      p.on('close', (code) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        ok(code === 0 && existsSync(join(out, `${key}.lmap`)) ? device || 'local' : null);
      });
    });
  return {
    bakers,
    async bake(job, signal) {
      if (job.byteLength < 16 || job.byteLength > MAX_BAKE_JOB_BYTES) return null;
      const dv = new DataView(job.buffer, job.byteOffset, job.byteLength);
      if (dv.getUint32(0, true) !== 0x4a4c4541) return null;
      const headLen = dv.getUint32(4, true);
      if (8 + headLen > job.byteLength) return null;
      let key: string;
      try {
        key = String((JSON.parse(new TextDecoder().decode(job.subarray(8, 8 + headLen))) as { key?: unknown }).key ?? '');
      } catch {
        return null;
      }
      if (!/^lm\d+-[0-9a-f]{32}$/.test(key)) return null;
      const dir = mkdtempSync(join(tmpdir(), 'aether-local-bake-'));
      try {
        const jobPath = resolve(dir, 'job.lbjob');
        writeFileSync(jobPath, job);
        // Cycles on the GPU only (on the CPU it is slower than the CPU baker's threads), then the threaded CPU bake.
        let baker = bakers.includes('cycles-gpu') ? await run(jobPath, dir, key, [`--blender=${BLENDER}`, '--device=GPU'], signal) : null;
        if (!baker && !signal?.aborted) baker = await run(jobPath, dir, key, ['--cpu'], signal);
        if (!baker) return null;
        return { bytes: new Uint8Array(readFileSync(join(dir, `${key}.lmap`))), baker };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}
