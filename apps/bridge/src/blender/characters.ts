/**
 * The character pipeline behind `/api/local/blender/*` (`character_create`, `character_revise`, `character_review`):
 * a headless Blender run of `scripts/blender/character/build.py` on a brief (and a concept sheet), in a folder of its
 * own per character under the bridge's data folder, so a revision or a review finds the last build. The method, the
 * brief fields and the QA report are in `docs/BLENDER-HARNESS.md`.
 *
 * The run is a separate Blender process (`blender -b --factory-startup -P …`), not the MCP session: building a
 * character from nothing needs no scene open in the user's Blender. It still runs code, so its plan shows the exact
 * command and brief, and it needs the studio's confirmation like every Python action.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CharacterBrief } from '@aether/agent/blender';
import { BridgeError } from '../errors';

/** The pipeline's entry script in this checkout (absent from an installed CLI without the repository). */
export function defaultCharacterScript(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../../../scripts/blender/character/build.py');
}

/** Longest a build may run (a full build with its QA iterations). */
export const CHARACTER_TIMEOUT_MS = 40 * 60_000;

/** One character build's files. */
export interface CharacterJob {
  id: string;
  dir: string;
  brief: string;
  sheet: string | null;
  report: string;
  glb: string;
  turnaround: string;
  /** The exact command line (shown in the confirmation dialog). */
  argv: string[];
}

/** The folder and command of a character's build. `revise`: rebuild from the last report with notes. */
export function characterJob(root: string, blender: string, script: string, id: string, opts: { sheet?: boolean; revise?: boolean; review?: boolean } = {}): CharacterJob {
  const dir = join(root, 'characters', id);
  const job: CharacterJob = {
    id,
    dir,
    brief: join(dir, 'brief.json'),
    sheet: opts.sheet ? join(dir, 'sheet.png') : null,
    report: join(dir, 'report.json'),
    glb: join(dir, `${id}.glb`),
    turnaround: join(dir, 'turnaround.png'),
    argv: [],
  };
  job.argv = [blender, '-b', '--factory-startup', '-P', script, '--', '--brief', job.brief, '--out', dir];
  if (job.sheet) job.argv.push('--sheet', job.sheet);
  if (opts.revise) job.argv.push('--revise', job.report);
  if (opts.review) job.argv.push('--review');
  return job;
}

/** The plan's text: what will run, then the brief it reads. */
export function characterPlanText(job: CharacterJob, brief: unknown, notes?: string): string {
  const quote = (a: string): string => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, "'\\''")}'`);
  return [
    '# Runs the character pipeline in a separate, headless Blender:',
    job.argv.map(quote).join(' '),
    ...(notes ? ['', '# Revision notes:', ...notes.split('\n').map((l) => `#   ${l}`)] : []),
    '',
    '# brief.json:',
    JSON.stringify(brief, null, 2),
  ].join('\n');
}

/** A concept-sheet prompt from a brief (when the caller sent no sheet and an image backend is there). */
export function conceptPrompt(brief: CharacterBrief): string {
  const parts = [
    `Character model sheet of ${brief.name}, an ORIGINAL ${brief.style === 'anime' ? 'anime-style' : 'realistic'} character${brief.age ? ` aged ${brief.age}` : ''}${brief.gender ? ` (${brief.gender})` : ''}.`,
    'Front view and left side profile at the same scale on one baseline, full body, relaxed neutral pose with the arms slightly away from the body, flat light-grey background, clean model-sheet linework and flat colour, believable proportions' + (brief.head_ratio ? `, about ${brief.head_ratio} heads tall` : '') + '.',
    brief.build ? `Build: ${brief.build}.` : '',
    brief.skin ? `Skin: ${brief.skin}.` : '',
    brief.eyes ? `Eyes: ${brief.eyes}.` : '',
    brief.hair ? `Hair: ${JSON.stringify(brief.hair)}.` : '',
    brief.outfit ? `Outfit: ${brief.outfit.map((o) => JSON.stringify(o)).join('; ')}.` : '',
    brief.notes ? `Notes: ${brief.notes}` : '',
    'Must not resemble any existing character, franchise, studio or artist. No logos, no text.',
  ];
  return parts.filter(Boolean).join(' ').slice(0, 3800);
}

/** Write a data-URL image to `path`. */
export async function writeDataUrl(path: string, dataUrl: string): Promise<void> {
  const comma = dataUrl.indexOf(',');
  await writeFile(path, Buffer.from(dataUrl.slice(comma + 1), 'base64'));
}

/** Run a job's Blender process to its end (killed on abort or timeout). */
export function runCharacterProcess(job: CharacterJob, signal?: AbortSignal, timeoutMs = CHARACTER_TIMEOUT_MS): Promise<{ code: number | null; log: string }> {
  return runPipelineProcess(job, signal, timeoutMs);
}

/** Run a pipeline's headless Blender (a character's or a building's) in its folder to its end (killed on abort or timeout). */
export function runPipelineProcess(job: { argv: string[]; dir: string }, signal?: AbortSignal, timeoutMs = CHARACTER_TIMEOUT_MS): Promise<{ code: number | null; log: string }> {
  return new Promise((done, fail) => {
    const [cmd, ...args] = job.argv as [string, ...string[]];
    const child = spawn(cmd, args, { cwd: job.dir, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
    let log = '';
    const keep = (b: Buffer): void => {
      log = (log + b.toString('utf8')).slice(-20_000);
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    const kill = (): void => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 3000).unref();
    };
    const timer = setTimeout(kill, timeoutMs);
    signal?.addEventListener('abort', kill, { once: true });
    child.on('error', (e) => {
      clearTimeout(timer);
      fail(new BridgeError('blender_unavailable', `Blender could not be started: ${e.message.slice(0, 160)}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', kill);
      done({ code, log });
    });
  });
}

/** The parts of the report the agent reads first (the full report is in the character's folder). */
export function summarizeReport(report: Record<string, unknown>): string {
  const lines: string[] = [];
  const pass = report['passed'];
  lines.push(`QA ${pass === true ? 'passed' : pass === false ? 'FAILED' : 'unknown'}${typeof report['iterations'] === 'number' ? ` after ${report['iterations']} iteration(s)` : ''}.`);
  for (const key of ['triangles', 'bytes', 'lods', 'clips', 'silhouette_iou', 'proportions', 'palette', 'interpenetration', 'weights', 'topology']) {
    if (report[key] !== undefined) lines.push(`${key}: ${JSON.stringify(report[key]).slice(0, 400)}`);
  }
  const issues = report['issues'];
  if (Array.isArray(issues) && issues.length > 0) lines.push(`issues: ${issues.slice(0, 12).map((i) => (typeof i === 'string' ? i : JSON.stringify(i))).join('; ').slice(0, 1500)}`);
  return lines.join('\n');
}

/** Read the build's outputs: the report, the turnaround picture and (when built) the GLB. */
export async function readCharacterOutputs(job: CharacterJob, withGlb: boolean, maxGlb: number): Promise<{ report: Record<string, unknown>; image: string | null; glb: Uint8Array | null }> {
  if (!existsSync(job.report)) throw new BridgeError('backend_error', 'The character pipeline wrote no report.');
  const report = JSON.parse(await readFile(job.report, 'utf8')) as Record<string, unknown>;
  let image: string | null = null;
  if (existsSync(job.turnaround)) {
    const s = await stat(job.turnaround);
    if (s.size > 0 && s.size < 16 * 1024 * 1024) image = `data:image/png;base64,${(await readFile(job.turnaround)).toString('base64')}`;
  }
  let glb: Uint8Array | null = null;
  if (withGlb) {
    if (!existsSync(job.glb)) throw new BridgeError('backend_error', 'The character pipeline wrote no model.');
    const s = await stat(job.glb);
    if (s.size === 0 || s.size > maxGlb) throw new BridgeError('too_large', `The character model is ${Math.round(s.size / 1048576)} MiB (max ${Math.round(maxGlb / 1048576)}).`);
    glb = new Uint8Array(await readFile(job.glb));
  }
  return { report, image, glb };
}

/** Make the character's folder. */
export async function ensureJobDir(job: CharacterJob): Promise<void> {
  await mkdir(job.dir, { recursive: true, mode: 0o700 });
}
