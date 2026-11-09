/**
 * Add a finished film to the app's Stories section: one command.
 *
 *   npx tsx scripts/stories/add-film.ts --slug=morning-kitchen --title="Morning Kitchen" --web=~/.local/share/aether/demo/blender-real-shot/web
 *
 * The web folder holds one .mp4, one .webm, one .webp poster (1280x720) and the one-sentence description
 * (description.txt, or pass --description="..."). The script
 *   1. checks the sizes (poster <= 60 KB, each video <= 6 MB) and that the poster is a WebP;
 *   2. copies the three files to apps/studio/public/stories/<slug>/ (poster.webp, <slug>.mp4, <slug>.webm);
 *   3. reads the duration with ffprobe (or --seconds=N);
 *   4. adds the entry to apps/studio/src/showcase/manifest.ts, after Cloudwatch Harbour;
 *   5. runs the showcase, featured and film tests (skip with --no-test).
 * Then run `npm run typecheck`, commit the four paths and push main; Vercel deploys it.
 *
 * Options: --credit="..." --note="..." --after=<slug> --seconds=N --root=<repo root> --no-test.
 * The hosted files are cached as immutable for a year (vercel.json): to replace a clip, use a new slug or file names.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MB = 1024 * 1024;
const LIMITS = { poster: 60 * 1024, mp4: 6 * MB, webm: 6 * MB };

function fail(msg: string): never {
  console.error(`add-film: ${msg}`);
  process.exit(1);
}

const args = new Map<string, string>();
for (const a of process.argv.slice(2)) {
  const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
  if (!m) fail(`unknown argument ${a}`);
  args.set(m[1]!, m[2] ?? 'true');
}
const slug = args.get('slug') ?? '';
const title = args.get('title') ?? '';
const webArg = args.get('web') ?? '';
if (!/^[a-z0-9]+(?:-[a-z0-9]+){0,7}$/.test(slug)) fail('--slug=<kebab-case-slug> is required');
if (!title.trim()) fail('--title="..." is required');
if (!webArg) fail('--web=<folder with the mp4, webm, webp and description> is required');

const root = resolve(args.get('root') ?? fileURLToPath(new URL('../../', import.meta.url)));
const web = resolve(webArg.replace(/^~(?=\/|$)/, homedir()));
if (!existsSync(web) || !statSync(web).isDirectory()) fail(`not a folder: ${web}`);
const manifestPath = join(root, 'apps/studio/src/showcase/manifest.ts');
if (!existsSync(manifestPath)) fail(`no manifest at ${manifestPath}`);

/** The one file with this extension (a poster.webp or <slug>.mp4 wins when there are several). */
function pick(ext: string, preferred: string): string {
  const all = readdirSync(web).filter((f) => f.toLowerCase().endsWith(`.${ext}`));
  const file = all.includes(preferred) ? preferred : all[0];
  if (!file) fail(`no .${ext} in ${web}`);
  if (all.length > 1 && !all.includes(preferred)) fail(`several .${ext} files in ${web} (${all.join(', ')}): name one ${preferred}`);
  return join(web, file);
}
const src = { poster: pick('webp', 'poster.webp'), mp4: pick('mp4', `${slug}.mp4`), webm: pick('webm', `${slug}.webm`) };

for (const k of ['poster', 'mp4', 'webm'] as const) {
  const size = statSync(src[k]).size;
  if (size > LIMITS[k]) fail(`${src[k]} is ${(size / 1024).toFixed(0)} KB, over the ${(LIMITS[k] / 1024).toFixed(0)} KB limit`);
}
if (readFileSync(src.poster).subarray(8, 12).toString('latin1') !== 'WEBP') fail(`${src.poster} is not a WebP`);

let description = (args.get('description') ?? '').trim();
if (!description) {
  const f = ['description.txt', 'description.md', 'description'].map((n) => join(web, n)).find((p) => existsSync(p)) ?? readdirSync(web).filter((n) => n.endsWith('.txt')).map((n) => join(web, n))[0];
  if (f) description = readFileSync(f, 'utf8').replace(/\s+/g, ' ').trim();
}
if (description.length < 20) fail('no description: put one sentence in description.txt or pass --description="..."');

let seconds = Number(args.get('seconds') ?? '');
if (!(seconds > 0)) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src.mp4], { encoding: 'utf8' });
  seconds = Math.round(Number(r.stdout.trim()));
}
if (!(seconds > 0)) fail('could not read the duration: pass --seconds=N');

let manifest = readFileSync(manifestPath, 'utf8');
if (manifest.includes(`slug: '${slug}'`)) fail(`the manifest already has slug ${slug}`);
const after = args.get('after') ?? 'cloudwatch-harbour';
const lines = manifest.split('\n');
const at = lines.findIndex((l) => l.includes(`{ slug: '${after}'`));
if (at < 0) fail(`no manifest entry '${after}' to insert after (pass --after=<slug>)`);

const q = (s: string): string => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const credit = args.get('credit') ?? "Made by Aether: Blender and Cycles, driven through Aether's Blender harness";
const note = args.get('note') ?? 'A real render on a local GPU. Procedural, no outside assets.';
const base = `/stories/${slug}`;
const entry = `  { slug: ${q(slug)}, title: ${q(title.trim())}, kind: 'story', curation: 'candidate', origin: 'film', description: ${q(description)}, prompt: '', film: { poster: '${base}/poster.webp', mp4: '${base}/${slug}.mp4', webm: '${base}/${slug}.webm', seconds: ${seconds}, credit: ${q(credit)}, note: ${q(note)} } },`;
lines.splice(at + 1, 0, entry);
manifest = lines.join('\n');

const dest = join(root, 'apps/studio/public/stories', slug);
mkdirSync(dest, { recursive: true });
copyFileSync(src.poster, join(dest, 'poster.webp'));
copyFileSync(src.mp4, join(dest, `${slug}.mp4`));
copyFileSync(src.webm, join(dest, `${slug}.webm`));
writeFileSync(manifestPath, manifest);
console.log(`add-film: copied 3 files to ${dest}; added '${title.trim()}' (${seconds} s) to the manifest after ${after}`);

if (args.has('no-test')) process.exit(0);
const t = spawnSync('npx', ['vitest', 'run', 'apps/studio/test/showcase.test.ts', 'apps/studio/test/featured.test.ts', 'apps/studio/test/film.test.ts'], { cwd: root, stdio: 'inherit' });
if (t.status !== 0) fail('tests failed (files and manifest entry are in place: fix or revert them)');
console.log(`add-film: tests pass. Next: npm run typecheck, then commit apps/studio/public/stories/${slug} and the manifest, and push main.`);
