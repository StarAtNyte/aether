/**
 * Push cooked packages to the hosted dataset (scripts/lib/cook-upload.ts: the `<id>/` files first, the manifest last;
 * ids already complete there are skipped), or cook and push every template.
 *
 *   npx tsx scripts/cook-upload.ts [--out=cooked] <slug> [<slug> …]       upload packages already cooked into --out
 *   npx tsx scripts/cook-upload.ts --readme                               upload the dataset card (scripts/cook-dataset/README.md)
 *   STATIC_DIR=<dist> GEN_GPU=intel npx tsx scripts/cook-upload.ts --all [--only=a,b] [--force] [--retry-failed] [--clean] [--no-scope] [--tiers=…]
 *   npx tsx scripts/cook-upload.ts --all --dry-run [--only=a,b] [--gen=…] list the templates whose hosted package is stale
 *
 * `--all` takes every template in apps/studio/src/showcase/manifest.ts, one at a time, and skips a template whose package on
 * the dataset is current: its manifest names this tree's generator code version and the IR hash of the template's world
 * (what the player checks, cook/cooked.ts). `--dry-run` only lists the stale ones (no dist, cook or token needed); its last
 * line is `stale: <slug>,<slug>,…` (empty when none). Each cook runs as its own capped
 * process (`systemd-run --user --scope -p MemoryMax=8000M -p MemorySwapMax=0 nice -n 10`, unless `--no-scope`), then
 * its package is uploaded. Progress is kept in `<out>/.cook-all-state.json`: a rerun skips templates already uploaded
 * from the same world file by the same generator code, and templates that failed unless `--retry-failed`. `--clean`
 * deletes a package's local copy once it is uploaded. The dist must be built from this tree (the generator code version
 * is checked against it), and its cooked base does not matter (cooking runs live).
 *
 * The write token comes from ~/.config/aether/hf-write.token, else `HF_TOKEN`; it is passed to the `hf` CLI as `HF_TOKEN`
 * through its environment only and never printed.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DDC_CODE_VERSION } from '../packages/render/src/geometry/ddc';
import { worldIrHash } from '../packages/render/src/cook/format';
import { BAKED_LIGHT_VERSION } from '../packages/render/src/environment/relight';
import { MAX_IMPORT_BYTES } from '../apps/studio/src/config';
import { parseWorldImport } from '../apps/studio/src/lib/worldIO';
import { SHOWCASE } from '../apps/studio/src/showcase/manifest';
import { generationCodeVersion } from './vite/gen-version';
import { COOKED_REPO, hfCliOps, readLocalPackage, uploadPackage } from './lib/cook-upload';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const flag = (k: string): string | undefined => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const has = (k: string): boolean => args.includes(`--${k}`);
const OUT = resolve(flag('out') ?? join(ROOT, 'cooked'));
const T0 = Date.now();
const log = (s: string): void => void process.stdout.write(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${s}\n`);

interface SlugState {
  status: 'uploaded' | 'failed';
  id?: string;
  genVersion: string;
  worldSha: string;
  at: string;
  error?: string;
}

/** The generator code version a dist built from this tree carries (ddc.ts `DDC_CODE_VERSION` with the build hash). */
async function expectedGenVersion(): Promise<string> {
  return DDC_CODE_VERSION.replace(/^dev(?=\.)/, await generationCodeVersion());
}

/** Throw unless the dist's bundles carry this tree's generator code hash (a stale dist would cook packages no build reads). */
function checkDist(dist: string, gen: string): void {
  const hash = gen.split('.')[0] ?? '';
  const dir = join(dist, 'assets');
  if (!existsSync(dir)) throw new Error(`${dist} has no assets/ folder: build the studio first`);
  for (const f of readdirSync(dir)) if (f.endsWith('.js') && readFileSync(join(dir, f), 'utf8').includes(hash)) return;
  throw new Error(`${dist} was not built from this tree (no bundle carries generator code ${hash}): rebuild it`);
}

/** IR hash of a template's world as the player computes it (parsed as an import, cook/format.ts `worldIrHash`). */
async function templateIrHash(slug: string): Promise<string> {
  const r = parseWorldImport(readFileSync(join(ROOT, 'apps/studio/public/templates/worlds', `${slug}.json`), 'utf8'), MAX_IMPORT_BYTES);
  if (!r.ok) throw new Error(`${slug}: ${r.error}`);
  return worldIrHash(r.world);
}

/** Whether a template's world has a building (its cook bakes light), and whether it turned baked light off. */
function templateBakes(slug: string): boolean {
  const r = parseWorldImport(readFileSync(join(ROOT, 'apps/studio/public/templates/worlds', `${slug}.json`), 'utf8'), MAX_IMPORT_BYTES);
  if (!r.ok) return false;
  return r.world.environment.lightBake?.quality !== 'off' && Object.values(r.world.entities).some((e) => e.arch !== undefined);
}

/** Why the dataset's package of `slug` is stale for this tree (null: current). */
async function staleReason(slug: string, gen: string, read: (slug: string) => Promise<{ genVersion?: unknown; irHash?: unknown; lightmap?: unknown } | null>): Promise<string | null> {
  const m = await read(slug);
  if (!m) return 'no package on the dataset';
  if (m.genVersion !== gen) return `generator code ${String(m.genVersion)}, this tree ${gen}`;
  const ir = await templateIrHash(slug);
  if (m.irHash !== ir) return `world changed (IR ${String(m.irHash).slice(0, 12)}…, now ${ir.slice(0, 12)}…)`;
  // A building's package ships baked light of this tree's format (a viewer never bakes; another format is not read).
  const light = (m.lightmap ?? null) as { version?: unknown } | null;
  if (templateBakes(slug) && light?.version !== BAKED_LIGHT_VERSION) return `baked light ${light ? String(light.version ?? 'unversioned') : 'missing'}, this tree ${BAKED_LIGHT_VERSION}`;
  return null;
}

const worldSha = (slug: string): string => createHash('sha256').update(readFileSync(join(ROOT, 'apps/studio/public/templates/worlds', `${slug}.json`))).digest('hex');

/** Run one cook as its own process (capped scope unless --no-scope). */
function cookOne(slug: string): Promise<void> {
  const tsx = join(ROOT, 'node_modules/.bin/tsx');
  const cookArgs = [existsSync(tsx) ? tsx : 'tsx', join(ROOT, 'scripts/cook.ts'), `--out=${OUT}`, ...(flag('tiers') ? [`--tiers=${flag('tiers')}`] : []), slug];
  const scoped = !has('no-scope') && spawnSync('systemd-run', ['--version'], { stdio: 'ignore' }).status === 0;
  const [cmd, ...rest] = scoped
    ? ['systemd-run', '--user', '--scope', '--quiet', '-p', 'MemoryMax=8000M', '-p', 'MemorySwapMax=0', 'nice', '-n', '10', ...cookArgs]
    : ['nice', '-n', '10', ...cookArgs];
  return new Promise((res, rej) => {
    // The cook never needs the token: it is not passed on.
    const env = { ...process.env };
    delete env['HF_TOKEN'];
    const child = spawn(cmd!, rest, { cwd: ROOT, env, stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('error', rej);
    child.on('close', (code, signal) => (code === 0 ? res() : rej(new Error(`cook exited with ${code ?? signal}`))));
  });
}

/** `--all --dry-run`: list the templates whose hosted package is stale. */
async function dryRun(): Promise<number> {
  // --gen=<version>: check against another build's version (what a deployment of it would find stale).
  const gen = flag('gen') ?? (await expectedGenVersion());
  const only = flag('only')?.split(',').filter(Boolean);
  const slugs = SHOWCASE.map((e) => e.slug).filter((s) => !only || only.includes(s));
  const ops = hfCliOps({ log });
  const stale: string[] = [];
  log(`generator code ${gen}; checking ${slugs.length} templates on ${COOKED_REPO}`);
  for (const slug of slugs) {
    const why = await staleReason(slug, gen, (s) => ops.readManifest(s));
    if (why) {
      stale.push(slug);
      log(`stale ${slug}: ${why}`);
    } else log(`current ${slug}`);
  }
  log(`${stale.length} of ${slugs.length} templates stale`);
  process.stdout.write(`stale: ${stale.join(',')}\n`);
  return 0;
}

async function all(): Promise<number> {
  if (has('dry-run')) return dryRun();
  const dist = process.env['STATIC_DIR'];
  if (!dist) throw new Error('--all needs STATIC_DIR=<dist> (the build that serves the packages)');
  const gen = await expectedGenVersion();
  checkDist(resolve(dist), gen);
  const only = flag('only')?.split(',').filter(Boolean);
  const slugs = SHOWCASE.map((e) => e.slug).filter((s) => !only || only.includes(s));
  const stateFile = join(OUT, '.cook-all-state.json');
  const state: Record<string, SlugState> = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {};
  const save = (): void => writeFileSync(stateFile, JSON.stringify(state, null, 1));
  const ops = hfCliOps({ log });
  let failed = 0;
  log(`cook and upload ${slugs.length} templates to ${COOKED_REPO} (generator code ${gen})`);
  for (const [i, slug] of slugs.entries()) {
    const sha = worldSha(slug);
    const prev = state[slug];
    // The dataset decides: a package there that this build would read is never cooked again (another run uploaded it).
    // `--force` cooks the listed templates even when current: a change the version does not cover (the opening view).
    const found = await staleReason(slug, gen, (s) => ops.readManifest(s)).catch((e: unknown) => `could not check (${e instanceof Error ? e.message : String(e)})`);
    const why = found ?? (has('force') ? 'forced' : null);
    if (why === null) {
      log(`[${i + 1}/${slugs.length}] ${slug}: current on the dataset, skipped`);
      continue;
    }
    const same = prev && prev.genVersion === gen && prev.worldSha === sha;
    // A package this run's state calls uploaded is skipped only when the dataset could not be read: once the dataset
    // calls it stale (say its baked light is missing), the state is out of date, and the template is cooked again.
    if (same && prev.status === 'uploaded' && why.startsWith('could not check')) {
      log(`[${i + 1}/${slugs.length}] ${slug}: done (${prev.id}), skipped`);
      continue;
    }
    if (same && prev.status === 'failed' && !has('retry-failed')) {
      log(`[${i + 1}/${slugs.length}] ${slug}: failed before (${prev.error ?? ''}), skipped (--retry-failed to try again)`);
      failed++;
      continue;
    }
    log(`[${i + 1}/${slugs.length}] ${slug}: cooking`);
    try {
      await cookOne(slug);
      const local = readLocalPackage(OUT, slug);
      if (local.manifest.genVersion !== gen) throw new Error(`cooked with generator code ${local.manifest.genVersion}, expected ${gen}`);
      const r = await uploadPackage(OUT, slug, ops, log);
      state[slug] = { status: 'uploaded', id: r.id, genVersion: gen, worldSha: sha, at: new Date().toISOString() };
      if (has('clean')) rmSync(join(OUT, slug), { recursive: true, force: true });
    } catch (e) {
      failed++;
      const error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
      log(`${slug}: FAILED ${error}`);
      state[slug] = { status: 'failed', genVersion: gen, worldSha: sha, at: new Date().toISOString(), error };
    }
    save();
  }
  log(`${slugs.length - failed} of ${slugs.length} templates on the dataset${failed ? `, ${failed} failed (see ${stateFile})` : ''}`);
  return failed ? 1 : 0;
}

async function main(): Promise<number> {
  if (has('readme')) {
    await hfCliOps({ log }).uploadFile(join(ROOT, 'scripts/cook-dataset/README.md'), 'README.md', 'Dataset card');
    log('README.md uploaded');
    return 0;
  }
  if (has('all')) return all();
  const slugs = args.filter((a) => !a.startsWith('--'));
  if (slugs.length === 0) throw new Error('usage: scripts/cook-upload.ts [--out=cooked] <slug> … | --all | --readme');
  const ops = hfCliOps({ log });
  for (const slug of slugs) {
    const r = await uploadPackage(OUT, slug, ops, log);
    log(`${slug}: ${r.id} ${r.files ? 'files uploaded' : 'files already there'}, ${r.manifest ? 'manifest uploaded' : 'manifest unchanged'}`);
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
