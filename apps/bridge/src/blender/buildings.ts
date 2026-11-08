/**
 * The building pipeline behind `/api/local/blender/*` (`building_create`, `building_revise`, `building_review`): a
 * headless Blender run of `scripts/blender/building/build.py` on a brief, in a folder of its own per building under the
 * bridge's data folder (`<data>/blender/buildings/<id>/`), so a revision or a review finds the last build. The kit, the
 * brief fields and the QA report are in `docs/BLENDER-HARNESS.md` ("Buildings").
 *
 * Like the character pipeline it is a separate Blender process, not the MCP session; it runs code, so its plan shows
 * the exact command and brief and it needs the studio's confirmation like every Python action.
 */
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BridgeError } from '../errors';

/** The pipeline's entry script in this checkout (absent from an installed CLI without the repository). */
export function defaultBuildingScript(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../../../scripts/blender/building/build.py');
}

/** Longest a build may run (its QA iterations, the stills and the albedo bake). */
export const BUILDING_TIMEOUT_MS = 20 * 60_000;

/** One building build's files. */
export interface BuildingJob {
  id: string;
  dir: string;
  brief: string;
  report: string;
  glb: string;
  stills: string;
  /** The exact command line (shown in the confirmation dialog). */
  argv: string[];
}

/** The folder and command of a building's build. `revise`: rebuild from the last report with notes. */
export function buildingJob(root: string, blender: string, script: string, id: string, opts: { revise?: boolean; review?: boolean } = {}): BuildingJob {
  const dir = join(root, 'buildings', id);
  const job: BuildingJob = { id, dir, brief: join(dir, 'brief.json'), report: join(dir, 'report.json'), glb: join(dir, `${id}.glb`), stills: join(dir, 'stills.png'), argv: [] };
  job.argv = [blender, '-b', '--factory-startup', '-P', script, '--', '--brief', job.brief, '--out', dir];
  if (opts.revise) job.argv.push('--revise', job.report);
  if (opts.review) job.argv.push('--review');
  return job;
}

/** The plan's text: what will run, then the brief it reads. */
export function buildingPlanText(job: BuildingJob, brief: unknown, notes?: string): string {
  const quote = (a: string): string => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, "'\\''")}'`);
  return [
    '# Runs the building pipeline in a separate, headless Blender:',
    job.argv.map(quote).join(' '),
    ...(notes ? ['', '# Revision notes:', ...notes.split('\n').map((l) => `#   ${l}`)] : []),
    '',
    '# brief.json:',
    JSON.stringify(brief, null, 2),
  ].join('\n');
}

/** The parts of the report the agent reads first (the full report is in the building's folder). */
export function summarizeBuildingReport(report: Record<string, unknown>): string {
  const lines: string[] = [];
  const pass = report['passed'];
  lines.push(`QA ${pass === true ? 'passed' : pass === false ? 'FAILED' : 'unknown'}${typeof report['iterations'] === 'number' ? ` after ${report['iterations']} iteration(s)` : ''}.`);
  for (const key of ['tier', 'triangles', 'budget', 'materials', 'bytes', 'lods', 'windows', 'balconies', 'height_m', 'interpenetration']) {
    if (report[key] !== undefined) lines.push(`${key}: ${JSON.stringify(report[key]).slice(0, 400)}`);
  }
  const issues = report['issues'];
  if (Array.isArray(issues) && issues.length > 0) lines.push(`issues: ${issues.slice(0, 12).map((i) => (typeof i === 'string' ? i : JSON.stringify(i))).join('; ').slice(0, 1500)}`);
  return lines.join('\n');
}

/** Read the build's outputs: the report, the stills sheet and (when built) the GLB. */
export async function readBuildingOutputs(job: BuildingJob, withGlb: boolean, maxGlb: number): Promise<{ report: Record<string, unknown>; image: string | null; glb: Uint8Array | null }> {
  if (!existsSync(job.report)) throw new BridgeError('backend_error', 'The building pipeline wrote no report.');
  const report = JSON.parse(await readFile(job.report, 'utf8')) as Record<string, unknown>;
  let image: string | null = null;
  if (existsSync(job.stills)) {
    const s = await stat(job.stills);
    if (s.size > 0 && s.size < 16 * 1024 * 1024) image = `data:image/png;base64,${(await readFile(job.stills)).toString('base64')}`;
  }
  let glb: Uint8Array | null = null;
  if (withGlb) {
    if (!existsSync(job.glb)) throw new BridgeError('backend_error', 'The building pipeline wrote no model.');
    const s = await stat(job.glb);
    if (s.size === 0 || s.size > maxGlb) throw new BridgeError('too_large', `The building model is ${Math.round(s.size / 1048576)} MiB (max ${Math.round(maxGlb / 1048576)}).`);
    glb = new Uint8Array(await readFile(job.glb));
  }
  return { report, image, glb };
}
