/**
 * Evaluation of the room-from-photo flow: the real pipeline (vision analysis, build through the design tools, compare
 * and correct) on reference photographs, with software renders from the photo's camera.
 *
 *   npx tsx scripts/eval-photo.ts --photo=hotel --mode=replay            replay the recorded transcript (no model)
 *   npx tsx scripts/eval-photo.ts --photo=hotel --mode=live              run the logged-in Codex and record the transcript
 *   options: --backend=codex|claude-code --effort=low|medium|high --rounds=N --stall=N --judges=N --reads=N --reconcile=0|1 --out=DIR --force --record-fixture
 *            --rounds=N  a fixed cap of compare rounds (default: none, as on a subscription: the loop ends on agreement or a stall)
 *            --judges=N  independent judges per look (default 3; 0: the model in the conversation judges; replays always use 0,
 *            the recorded transcripts have no judge calls)
 *            --reads=N   independent reads of the photo merged into one description (default 3; replays always use 1)
 *            --reconcile=0  skip the call that settles contested pieces after merging the reads
 *            --render=software|gpu   software: the flat headless rasteriser (default). gpu: photoreal stills of the photo camera drawn by
 *            the studio on the GPU (AETHER_E2E_GPU=1 for the real card), for the judge, the measure and the montage
 *
 * Photos: hotel, twin, pd1, pd2 (redistributable, in tests/fixtures/photo) and modern (CC BY, local only: it is read
 * from the reference folder and never committed). Writes per photo into the output folder: the photo, the first
 * attempt and the final render from the photo's camera, a montage (photo | first attempt | final), the per-item
 * scoreboard and the run log.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WorldDoc } from '@aether/core';
import {
  WorldAgent,
  createRecordingProvider,
  createReplayProvider,
  TranscriptSchema,
  type AgentEvent,
  type PhotoScoreView,
  type PhotoReadsView,
  type Provider,
  type ReviewViewRequest,
} from '@aether/agent';
import { imageSize } from '../packages/agent/src/photo/image-size';
import { createNodeSandbox } from '@aether/procgen/node';
import { drawMarksRgba } from '@aether/agent';
import { encodePng } from '../apps/cli/src/mcp/png';
import { GpuRoom } from './lib/gpu-room';
import { createHeadlessProvider } from '../apps/bridge/src/headless';
import { captureReviewHeadless } from '../apps/cli/src/mcp/review';
import { initPhysics } from '@aether/physics';
import { CATALOGS, GENERATOR_DRY_RUN_MS, NodeAgentHost } from './lib/headless-world';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(ROOT, 'tests/fixtures/photo');
const LOCAL_REFS = '/home/at-office/.local/share/aether/refs/bedroom';
const DEFAULT_OUT = '/home/at-office/.local/share/aether/imageroom';

const PHOTOS: Readonly<Record<string, { file: string; prompt: string }>> = {
  hotel: { file: join(FIXTURES, 'bedroom-cc0-hotel.jpg'), prompt: 'Make this hotel bedroom in 3D' },
  twin: { file: join(FIXTURES, 'bedroom-cc0-twin.jpg'), prompt: 'Recreate this room from the photo' },
  pd1: { file: join(FIXTURES, 'bedroom-pd-1.jpg'), prompt: 'Make this bedroom in 3D' },
  pd2: { file: join(FIXTURES, 'bedroom-pd-2.jpg'), prompt: 'Make this bedroom in 3D' },
  modern: { file: join(LOCAL_REFS, 'bedroom-ccby-modern.jpg'), prompt: 'Make this bedroom in 3D' },
};

/** The software renderer has no bounced light: lift it to the exposure of a photograph so walls and fabrics read at their own tones. */
const PHOTO_LIGHT = { ambientIntensity: 1.4, exposure: 2.0 } as const;

interface Args {
  photo: string;
  mode: 'replay' | 'live';
  backend: 'codex' | 'claude-code';
  effort: 'low' | 'medium' | 'high';
  rounds: number | undefined;
  stall: number;
  reads: number;
  reconcile: boolean;
  out: string;
  force: boolean;
  render: 'software' | 'gpu';
  recordFixture: boolean;
  judges: number;
}

function parseArgs(argv: readonly string[]): Args {
  const get = (k: string): string | undefined => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  const mode = get('mode') === 'live' ? 'live' : 'replay';
  return {
    photo: get('photo') ?? 'hotel',
    mode,
    backend: get('backend') === 'claude-code' ? 'claude-code' : 'codex',
    effort: (['low', 'medium', 'high'] as const).find((e) => e === get('effort')) ?? 'medium',
    rounds: get('rounds') !== undefined ? Math.max(1, Math.min(200, Number(get('rounds')))) : undefined,
    reads: mode === 'replay' ? 1 : Math.max(1, Math.min(5, Number(get('reads') ?? 3))),
    reconcile: get('reconcile') !== '0',
    stall: Math.max(2, Math.min(8, Number(get('stall') ?? 3))),
    out: get('out') ?? DEFAULT_OUT,
    force: argv.includes('--force'),
    render: get('render') === 'gpu' ? 'gpu' : 'software',
    recordFixture: argv.includes('--record-fixture'),
    judges: mode === 'replay' ? 0 : Math.max(0, Math.min(7, Number(get('judges') ?? 3))),
  };
}

// ---------------------------------------------------------------------------
// Pictures through ffmpeg (the software path has no image decoder of its own)
// ---------------------------------------------------------------------------

/** The photo as the studio sends it: at most 1280 px on the long side, JPEG. */
function prepare(file: string): { dataUrl: string; jpeg: Buffer } {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', "scale='min(1280,iw)':'-2'", '-frames:v', '1', '-q:v', '3', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1'], { maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr.toString().slice(0, 300)}`);
  return { dataUrl: `data:image/jpeg;base64,${r.stdout.toString('base64')}`, jpeg: r.stdout };
}

function decode(dataUrl: string, maxSide: number): { width: number; height: number; data: Uint8ClampedArray } | null {
  const size = imageSize(dataUrl);
  if (!size) return null;
  const scale = Math.min(1, maxSide / Math.max(size.width, size.height));
  const w = Math.max(1, Math.round(size.width * scale));
  const h = Math.max(1, Math.round(size.height * scale));
  const input = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-vf', `scale=${w}:${h}:flags=area`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], { input, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0 || r.stdout.length < w * h * 4) return null;
  return { width: w, height: h, data: new Uint8ClampedArray(r.stdout.buffer, r.stdout.byteOffset, w * h * 4).slice() };
}

/** Host that renders with the software renderer and decodes with ffmpeg. */
class PhotoNodeHost extends NodeAgentHost {
  private readonly sb = createNodeSandbox({ timeoutMs: GENERATOR_DRY_RUN_MS });
  /** The photo-camera view of the first compare round (the first attempt) and of the latest one. */
  firstWorld: WorldDoc | null = null;
  lastView: ReviewViewRequest | null = null;
  firstView: ReviewViewRequest | null = null;
  renders = 0;

  /** Photoreal renderer for the photo camera (null: the software rasteriser draws everything). */
  gpu: GpuRoom | null = null;
  private gpuWorld: WorldDoc | null = null;

  constructor(sandbox: ConstructorParameters<typeof NodeAgentHost>[0]) {
    super(sandbox);
  }

  /** One view of the current world drawn on the GPU, with the marks of the request on top. */
  private async gpuShot(world: WorldDoc, v: ReviewViewRequest, width: number): Promise<string> {
    const gpu = this.gpu as GpuRoom;
    if (this.gpuWorld !== world) {
      await gpu.load(world);
      this.gpuWorld = world;
    }
    const height = Math.round(width / Math.max(0.5, Math.min(3, v.aspect)));
    const png = await gpu.still({ position: v.pose.position, target: v.pose.target, fov: v.pose.fov }, { width, height }, process.env['PHOTO_STILL_QUALITY'] === 'studio' ? 'studio' : 'final');
    if (v.marks.length === 0) return `data:image/png;base64,${png.toString('base64')}`;
    const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
    const rgba = decode(dataUrl, Math.max(width, height));
    if (!rgba) return dataUrl;
    drawMarksRgba(new Uint8Array(rgba.data.buffer), rgba.width, rgba.height, v.marks);
    return `data:image/png;base64,${encodePng(new Uint8Array(rgba.data.buffer), rgba.width, rgba.height).toString('base64')}`;
  }

  async captureReview(views: readonly ReviewViewRequest[], opts: { signal?: AbortSignal; size?: number } = {}): Promise<Array<{ name: string; dataUrl: string }>> {
    const cam = views.find((v) => v.name === 'photo-camera');
    if (cam) {
      this.renders++;
      this.lastView = cam;
      if (!this.firstView) {
        this.firstView = cam;
        this.firstWorld = this.getWorld();
      }
    }
    if (this.gpu) {
      const world = this.getWorld();
      const gpuViews = views.filter((v) => v.name === 'photo-camera' || v.name === 'photo-camera-clean');
      const out: Array<{ name: string; dataUrl: string }> = [];
      for (const v of gpuViews) out.push({ name: v.name, dataUrl: await this.gpuShot(world, v, opts.size ?? 960) });
      const rest = views.filter((v) => !gpuViews.includes(v));
      if (rest.length > 0) out.push(...(await captureReviewHeadless(world, rest, { sandbox: this.sb, width: opts.size ?? 800, environment: PHOTO_LIGHT, ...(opts.signal ? { signal: opts.signal } : {}) })));
      return out;
    }
    return captureReviewHeadless(this.getWorld(), views, { sandbox: this.sb, width: opts.size ?? 800, environment: PHOTO_LIGHT, ...(opts.signal ? { signal: opts.signal } : {}) });
  }

  async decodeImage(dataUrl: string, maxSide: number): Promise<{ width: number; height: number; data: Uint8ClampedArray } | null> {
    return decode(dataUrl, maxSide);
  }

  async renderClean(world: WorldDoc, view: ReviewViewRequest, width: number): Promise<Buffer> {
    if (this.gpu) return Buffer.from((await this.gpuShot(world, { ...view, marks: [] }, width)).split(',')[1] ?? '', 'base64');
    const got = await captureReviewHeadless(world, [{ ...view, marks: [] }], { sandbox: this.sb, width, environment: PHOTO_LIGHT });
    return Buffer.from((got[0]?.dataUrl ?? '').split(',')[1] ?? '', 'base64');
  }

  dispose(): void {
    this.sb.dispose();
  }
}

/** photo | first attempt | final, equal heights. */
function montage(files: readonly string[], out: string): void {
  const inputs = files.flatMap((f) => ['-i', f]);
  const scaled = files.map((_, i) => `[${i}:v]scale=-2:640[s${i}]`).join(';');
  const stack = `${files.map((_, i) => `[s${i}]`).join('')}hstack=inputs=${files.length}`;
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', `${scaled};${stack}`, '-frames:v', '1', out]);
  if (r.status !== 0) console.error(`montage failed: ${r.stderr.toString().slice(0, 300)}`);
}

// ---------------------------------------------------------------------------
// One photo
// ---------------------------------------------------------------------------

interface Report {
  photo: string;
  source: string;
  calls: number;
  ms: number;
  judges: number;
  /** How the photo was read (the reads, the consensus and the checklist it gave). */
  reads: PhotoReadsView | null;
  rounds: Array<{ round: number; passed: number; total: number; objective: number | null; judge: number | null; judgedBy: string | null; accepted: boolean | null; fidelity: PhotoScoreView['fidelity'] | null; failing: string[] }>;
  first: { passed: number; total: number; objective: number | null; judge: number | null; judgedBy: string | null } | null;
  final: { passed: number; total: number; objective: number | null; judge: number | null; judgedBy: string | null; fidelity: PhotoScoreView['fidelity'] | null; structuralFailed: boolean; failing: Array<{ id: string; note: string }> } | null;
  errors: string[];
  assumptions: number;
}

async function runPhoto(args: Args, live: Provider | null): Promise<Report> {
  const spec = PHOTOS[args.photo];
  if (!spec) throw new Error(`unknown photo ${args.photo}; choose ${Object.keys(PHOTOS).join(', ')}`);
  if (!existsSync(spec.file)) throw new Error(`missing ${spec.file}`);
  const { dataUrl, jpeg } = prepare(spec.file);
  const dir = join(args.out, args.photo);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'photo.jpg'), jpeg);
  const fixturePath = join(FIXTURES, `${args.photo}.transcript.json`);
  let provider: Provider;
  let rec: ReturnType<typeof createRecordingProvider> | null = null;
  let source: string;
  if (args.mode === 'replay') {
    if (!existsSync(fixturePath)) throw new Error(`no recorded transcript for ${args.photo} (run with --mode=live first)`);
    const t = TranscriptSchema.parse(JSON.parse(readFileSync(fixturePath, 'utf8')));
    provider = createReplayProvider(t, { name: 'replay', onExhausted: 'finish' });
    source = `replay of ${t.source}`;
  } else {
    if (!live) throw new Error('live mode needs a provider');
    rec = createRecordingProvider(live);
    provider = rec;
    source = `live ${args.backend} (${args.effort})`;
  }
  const sandbox = createNodeSandbox({ timeoutMs: GENERATOR_DRY_RUN_MS });
  const host = new PhotoNodeHost(sandbox);
  if (args.render === 'gpu') host.gpu = await GpuRoom.open({ headed: process.env['SHOT_HEADED'] === '1' });
  const agent = new WorldAgent({ provider, catalogs: CATALOGS, maxTurns: 10, maxToolCalls: 60, photo: { ...(args.rounds !== undefined ? { maxRounds: args.rounds } : {}), stallRounds: args.stall, vision: true, judges: args.judges, reads: args.reads, reconcile: args.reconcile } });
  const t0 = performance.now();
  const events: AgentEvent[] = [];
  const report: Report = { photo: args.photo, source, judges: args.judges, reads: null, calls: 0, ms: 0, rounds: [], first: null, final: null, errors: [], assumptions: 0 };
  for await (const e of agent.run(spec.prompt, host, { images: [dataUrl], photo: 'recreate' })) {
    events.push(e);
    if (e.type === 'photo') {
      console.log(`  [${args.photo}] ${e.phase}${e.round ? ` ${e.round}` : ''}: ${e.text.slice(0, 200)}`);
      if (e.assumptions) report.assumptions = e.assumptions.length;
      if (e.phase === 'described' && e.reads) report.reads = e.reads;
      if (e.phase === 'round' && e.score && e.round !== undefined && /^Round \d+:/.test(e.text)) report.rounds.push(roundRow(e.round, e.score));
      if (e.phase === 'done' && e.score) {
        report.final = { passed: e.score.passed, total: e.score.total, objective: e.score.objective ?? null, judge: e.score.judge ?? null, judgedBy: e.score.judgedBy ?? null, fidelity: e.score.fidelity ?? null, structuralFailed: e.score.structuralFailed, failing: e.score.failing.map((f) => ({ id: f.id, note: f.note })) };
      }
    } else if (e.type === 'error') {
      report.errors.push(e.text);
      console.log(`  [${args.photo}] ERROR ${e.text.slice(0, 300)}`);
    } else if (e.type === 'done') report.calls = e.usage.calls;
  }
  report.ms = Math.round(performance.now() - t0);
  const r0 = report.rounds[0];
  if (r0) report.first = { passed: r0.passed, total: r0.total, objective: r0.objective, judge: r0.judge, judgedBy: r0.judgedBy };
  // Renders for the montage: the first attempt (the room as first built) and the final room, from the photo's camera.
  const files = [join(dir, 'photo.jpg')];
  if (host.firstView && host.firstWorld) {
    await writeFile(join(dir, 'first.png'), await host.renderClean(host.firstWorld, host.firstView, 960));
    files.push(join(dir, 'first.png'));
  }
  if (host.lastView) {
    await writeFile(join(dir, 'final.png'), await host.renderClean(host.getWorld(), host.lastView, 960));
    files.push(join(dir, 'final.png'));
  }
  if (files.length > 1) montage(files, join(dir, 'montage.png'));
  await writeFile(join(dir, 'run.json'), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(join(dir, 'world.json'), `${JSON.stringify(host.getWorld())}\n`);
  // What the GPU still renderer (scripts/photo-gpu-shots.ts) needs to draw the same two rooms from the same camera.
  if (host.firstWorld) await writeFile(join(dir, 'first.world.json'), `${JSON.stringify(host.firstWorld)}\n`);
  await writeFile(join(dir, 'views.json'), `${JSON.stringify({ first: host.firstView, last: host.lastView })}\n`);
  if (rec && report.errors.length === 0 && report.final) {
    // Always kept next to the run; replaces the committed fixture only on request (a weaker run must not overwrite a good one).
    await writeFile(join(dir, 'transcript.json'), `${JSON.stringify(rec.transcript(spec.prompt, source))}\n`);
    if (args.recordFixture) {
      await mkdir(FIXTURES, { recursive: true });
      await writeFile(fixturePath, `${JSON.stringify(rec.transcript(spec.prompt, source))}\n`);
      console.log(`  recorded ${fixturePath}`);
    } else console.log(`  recorded ${join(dir, 'transcript.json')}`);
  } else if (rec) console.log('  not recorded (the run had errors or did not finish)');
  await host.gpu?.close();
  host.dispose();
  sandbox.dispose();
  return report;
}

function roundRow(round: number, s: PhotoScoreView): Report['rounds'][number] {
  return { round, passed: s.passed, total: s.total, objective: s.objective ?? null, judge: s.judge ?? null, judgedBy: s.judgedBy ?? null, accepted: s.accepted ?? null, fidelity: s.fidelity ?? null, failing: s.failing.map((f) => f.id) };
}

async function main(): Promise<void> {
  await initPhysics();
  const args = parseArgs(process.argv.slice(2));
  const live = args.mode === 'live' ? createHeadlessProvider(args.backend, { effort: args.effort, timeoutMs: 900_000 }) : null;
  const ids = args.photo === 'all' ? ['hotel', 'modern', 'pd1', 'pd2'] : args.photo.split(',');
  for (const id of ids) {
    console.log(`\n== ${id} (${args.mode})`);
    const r = await runPhoto({ ...args, photo: id }, live);
    const f = r.final;
    console.log(f ? `${id}: ${f.passed}/${f.total} items (${Math.round((f.passed / Math.max(1, f.total)) * 100)}%)${f.judge !== null ? `, judge score ${Math.round(f.judge * 100)}%` : ''}${f.objective !== null ? `, measured fidelity (advisory) ${Math.round(f.objective * 100)}%` : ''}${f.judgedBy !== null ? `, judged by ${f.judgedBy}` : ''}${r.first ? ` (first attempt ${r.first.passed}/${r.first.total}${r.first.objective !== null ? `, ${Math.round(r.first.objective * 100)}%` : ''})` : ''}; ${r.calls} model calls, ${Math.round(r.ms / 1000)} s${r.reads ? `; reads ${r.reads.items.join('/')} pieces -> ${r.reads.consensus} kept, checklist ${r.reads.checklist}` : ''}; ${r.rounds.length} rounds` : `${id}: no final score; errors: ${r.errors.join(' | ').slice(0, 300)}`);
  }
}

await main();
