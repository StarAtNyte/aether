/**
 * Creates the Python environment the SimReady conversion needs, outside the repository:
 *
 *   npm run assets:simready-setup            # ~/.local/share/aether/simready/venv
 *
 * Packages: usd-core (reads OpenUSD), numpy, pillow (texture reduction), huggingface_hub (optional, for tooling that
 * lists datasets). Python is a dev / local-app tool only: it is never part of the repository's runtime, tests or CI, and
 * the studio works without it (importing on demand then says the tools are not installed).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const venv = resolve(process.env['AETHER_USD_VENV'] ?? join(homedir(), '.local', 'share', 'aether', 'simready', 'venv'));
const py = join(venv, 'bin', 'python');

function run(cmd: string, args: string[]): void {
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`failed: ${cmd} ${args.join(' ')}`);
    process.exit(1);
  }
}

if (!existsSync(py)) {
  mkdirSync(dirname(venv), { recursive: true });
  run('python3', ['-m', 'venv', venv]);
}
run(py, ['-I', '-m', 'pip', 'install', '--upgrade', 'pip']);
run(py, ['-I', '-m', 'pip', 'install', 'usd-core', 'numpy', 'pillow', 'huggingface_hub']);
run(py, ['-I', '-c', 'import pxr, numpy, PIL; print("ok: usd-core, numpy, pillow")']);
console.log(`conversion tools ready: ${py}\nAether finds them there; set AETHER_USD_PYTHON to use another interpreter.`);
