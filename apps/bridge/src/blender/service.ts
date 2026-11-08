/**
 * Blender on this computer, for the local Aether server only
 * (`/api/local/blender/*`; never the paired bridge of hosted studios).
 *
 * - Off by default: a switch persisted in the data folder (`blender.json`).
 * - Status: `not_installed` (no Blender, add-on or uvx), `off` (switch off, or
 *   Blender not listening on 127.0.0.1:9876, or the MCP server failed),
 *   `ready` (connected and `listTools` answered). Probes are cached briefly.
 * - Actions are planned, then run once. A plan that runs Python stores its
 *   exact code; running it without `confirm` is refused
 *   (`confirmation_required`). Runs are serialized (Blender is single-threaded).
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile, rename } from 'node:fs/promises';
import { connect } from 'node:net';
import { join, resolve, sep } from 'node:path';
import {
  BLENDER_MAX_GLB_BYTES,
  BLENDER_MCP_TOOLS,
  blenderActionRunsPython,
  type BlenderAction,
  type BlenderPlan,
  type BlenderPlanRequest,
  type BlenderRunResult,
  type BlenderState,
  type BlenderStatus,
} from '@aether/agent/blender';
import { BridgeError } from '../errors';
import { detectBlender, missingDetail, type BlenderInstall } from './detect';
import { BLENDER_HOST, BLENDER_PORT, connectBlenderMcp, type BlenderMcpSession } from './mcp';
import { bakeCode, exportGlbCode, parseResult, renderCode } from './templates';
import { characterJob, characterPlanText, conceptPrompt, defaultCharacterScript, ensureJobDir, readCharacterOutputs, runCharacterProcess, runPipelineProcess, summarizeReport, writeDataUrl, type CharacterJob } from './characters';
import { BUILDING_TIMEOUT_MS, buildingJob, buildingPlanText, defaultBuildingScript, readBuildingOutputs, summarizeBuildingReport, type BuildingJob } from './buildings';
import { existsSync } from 'node:fs';
import type { CharacterBrief } from '@aether/agent/blender';

/** How long a plan may wait for its confirmation. */
export const PLAN_TTL_MS = 10 * 60_000;
const MAX_PLANS = 32;
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const MAX_TEXT = 20_000;

/** Options (fakes in tests). */
export interface BlenderServiceOptions {
  /** The bridge's data folder (`blender.json`, `out/`). */
  dataDir: string;
  port?: number;
  detect?: () => BlenderInstall;
  /** The character pipeline's entry script (default: `scripts/blender/character/build.py` of this checkout). */
  characterScript?: string;
  /** Runs a character build's Blender process (tests replace it). */
  runCharacter?: typeof runCharacterProcess;
  /** The building pipeline's entry script (default: `scripts/blender/building/build.py` of this checkout). */
  buildingScript?: string;
  /** Runs a building build's Blender process (tests replace it). */
  runBuilding?: (job: BuildingJob, signal?: AbortSignal) => Promise<{ code: number | null; log: string }>;
  /** Makes a concept sheet from a prompt when a brief comes without one (the local image backend). */
  concept?: (prompt: string, signal?: AbortSignal) => Promise<{ bytes: Uint8Array; mime: string }>;
  /** Is something listening on 127.0.0.1:port? */
  probeSocket?: (port: number) => Promise<boolean>;
  /** Start and connect the MCP server. */
  connect?: (install: BlenderInstall, port: number) => Promise<BlenderMcpSession>;
  /** Status cache lifetime (ms). */
  ttlMs?: number;
  now?: () => number;
}

/** One planned action. */
interface StoredPlan {
  action: BlenderAction;
  python: boolean;
  /** Python a confirmed run executes (exactly what the plan returned). */
  code?: string;
  /** MCP arguments of non-Python actions. */
  args?: Record<string, unknown>;
  out?: string;
  /** A character pipeline run (no MCP session: a headless Blender process). */
  character?: { job: CharacterJob; brief: Record<string, unknown> | null; sheet?: string; notes?: string; glb: boolean };
  /** A building pipeline run (a headless Blender process, like a character's). */
  building?: { job: BuildingJob; brief: Record<string, unknown> | null; glb: boolean };
  expiresAt: number;
}

/** TCP connect to 127.0.0.1:port within 1 s. */
export function probeLoopbackPort(port: number, timeoutMs = 1000): Promise<boolean> {
  return new Promise((done) => {
    const socket = connect({ host: BLENDER_HOST, port });
    const finish = (ok: boolean): void => {
      socket.removeAllListeners();
      socket.destroy();
      done(ok);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

/** Blender through its MCP server. */
export class BlenderService {
  private readonly dir: string;
  private readonly port: number;
  private readonly detect: () => BlenderInstall;
  private readonly probeSocket: (port: number) => Promise<boolean>;
  private readonly connectMcp: (install: BlenderInstall, port: number) => Promise<BlenderMcpSession>;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private session: BlenderMcpSession | null = null;
  private connecting: Promise<BlenderMcpSession> | null = null;
  private cache: { at: number; v: BlenderStatus } | null = null;
  private inflight: Promise<BlenderStatus> | null = null;
  private enabled: boolean | null = null;
  private readonly plans = new Map<string, StoredPlan>();
  private chain: Promise<unknown> = Promise.resolve();
  private readonly characterScript: string;
  private readonly runCharacter: typeof runCharacterProcess;
  private readonly concept: BlenderServiceOptions['concept'];
  private readonly buildingScript: string;
  private readonly runBuilding: NonNullable<BlenderServiceOptions['runBuilding']>;

  constructor(opts: BlenderServiceOptions) {
    this.characterScript = opts.characterScript ?? defaultCharacterScript();
    this.runCharacter = opts.runCharacter ?? runCharacterProcess;
    this.concept = opts.concept;
    this.buildingScript = opts.buildingScript ?? defaultBuildingScript();
    this.runBuilding = opts.runBuilding ?? ((job, signal) => runPipelineProcess(job, signal, BUILDING_TIMEOUT_MS));
    this.dir = resolve(opts.dataDir);
    this.port = opts.port ?? BLENDER_PORT;
    this.detect = opts.detect ?? (() => detectBlender());
    this.probeSocket = opts.probeSocket ?? ((p) => probeLoopbackPort(p));
    this.connectMcp =
      opts.connect ??
      ((install, port) => {
        if (!install.uvx) throw new BridgeError('blender_unavailable', 'uvx was not found.');
        return connectBlenderMcp({ uvx: install.uvx, port });
      });
    this.ttlMs = opts.ttlMs ?? 5_000;
    this.now = opts.now ?? Date.now;
  }

  private get settingsFile(): string {
    return join(this.dir, 'blender.json');
  }

  /** The persisted switch (off when the file is missing or unreadable). */
  async isEnabled(): Promise<boolean> {
    if (this.enabled !== null) return this.enabled;
    try {
      const v = JSON.parse(await readFile(this.settingsFile, 'utf8')) as unknown;
      this.enabled = typeof v === 'object' && v !== null && (v as { enabled?: unknown }).enabled === true;
    } catch {
      this.enabled = false;
    }
    return this.enabled;
  }

  /** Flip the switch (persisted); off closes the MCP session and drops pending plans. */
  async setEnabled(enabled: boolean): Promise<BlenderStatus> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const tmp = `${this.settingsFile}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify({ enabled })}\n`, { mode: 0o600 });
    await rename(tmp, this.settingsFile);
    this.enabled = enabled;
    if (!enabled) {
      this.plans.clear();
      await this.closeSession();
    }
    this.cache = null;
    return this.status();
  }

  /** Current status (cached for a few seconds). */
  status(): Promise<BlenderStatus> {
    if (this.cache && this.now() - this.cache.at < this.ttlMs) return Promise.resolve(this.cache.v);
    this.inflight ??= this.probe()
      .then((v) => {
        this.cache = { at: this.now(), v };
        return v;
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  /** Just the state (for the local AI status). */
  async state(): Promise<BlenderState> {
    return (await this.status()).state;
  }

  private async probe(): Promise<BlenderStatus> {
    const install = this.detect();
    const missing = missingDetail(install);
    const enabled = await this.isEnabled();
    if (missing) return { state: 'not_installed', enabled, detail: missing };
    if (!enabled) return { state: 'off', enabled, detail: 'Blender is switched off in Settings → AI connection.' };
    if (!(await this.probeSocket(this.port))) {
      await this.closeSession();
      return { state: 'off', enabled, detail: `Blender is not listening on ${BLENDER_HOST}:${this.port}. Start the MCP for Blender server in Blender's sidebar, or run blender -b --python scripts/blender/mcp-serve-headless.py.` };
    }
    try {
      const session = await this.ensureSession(install);
      const tools = await session.listTools();
      const lacking = BLENDER_MCP_TOOLS.filter((t) => !tools.includes(t));
      if (lacking.length > 0) return { state: 'off', enabled, detail: `The Blender MCP server lacks ${lacking.join(', ')}.` };
      return { state: 'ready', enabled, detail: `Connected to Blender on ${BLENDER_HOST}:${this.port}.` };
    } catch (e) {
      await this.closeSession();
      return { state: 'off', enabled, detail: `Could not start the Blender MCP server: ${e instanceof Error ? e.message.slice(0, 160) : 'error'}` };
    }
  }

  private async ensureSession(install: BlenderInstall): Promise<BlenderMcpSession> {
    if (this.session) return this.session;
    this.connecting ??= this.connectMcp(install, this.port).finally(() => {
      this.connecting = null;
    });
    this.session = await this.connecting;
    return this.session;
  }

  private async closeSession(): Promise<void> {
    const s = this.session;
    this.session = null;
    if (s) await s.close();
  }

  private outPath(id: string, ext: 'glb' | 'png'): string {
    return join(this.dir, 'out', `${id}.${ext}`);
  }

  /** Plan an action: nothing runs. Python plans carry their exact code. */
  async plan(request: BlenderPlanRequest): Promise<BlenderPlan> {
    if (!(await this.isEnabled())) throw new BridgeError('blender_unavailable', 'Blender is switched off in Settings → AI connection.');
    const now = this.now();
    for (const [id, p] of this.plans) if (p.expiresAt <= now) this.plans.delete(id);
    while (this.plans.size >= MAX_PLANS) {
      const first = this.plans.keys().next();
      if (first.done) break;
      this.plans.delete(first.value);
    }
    const planId = randomUUID();
    const expiresAt = now + PLAN_TTL_MS;
    const python = blenderActionRunsPython(request.action);
    let stored: StoredPlan;
    switch (request.action) {
      case 'get_scene_info':
      case 'look':
        stored = { action: request.action, python, args: { ...request.input }, expiresAt };
        break;
      case 'execute_blender_code':
        stored = { action: request.action, python, code: request.input.code, expiresAt };
        break;
      case 'export_glb': {
        const out = this.outPath(planId, 'glb');
        stored = { action: request.action, python, code: exportGlbCode(out, request.input), out, expiresAt };
        break;
      }
      case 'render': {
        const out = this.outPath(planId, 'png');
        stored = { action: request.action, python, code: renderCode(out, request.input), out, expiresAt };
        break;
      }
      case 'bake': {
        const out = this.outPath(planId, 'png');
        stored = { action: request.action, python, code: bakeCode(out, request.input), out, expiresAt };
        break;
      }
      case 'character_create':
      case 'character_revise':
      case 'character_review': {
        const blender = this.detect().blender;
        if (!blender) throw new BridgeError('blender_unavailable', 'Blender was not found on this computer.');
        if (!existsSync(this.characterScript)) throw new BridgeError('blender_unavailable', 'The character pipeline (scripts/blender/character/build.py) is not in this installation: run the Aether server from a checkout of the repository.');
        const id = request.action === 'character_create' ? request.input.brief.id : request.input.id;
        const base = characterJob(this.dir, blender, this.characterScript, id);
        const hadSheet = existsSync(join(base.dir, 'sheet.png'));
        if (request.action === 'character_create') {
          const sheet = request.input.sheet ?? undefined;
          const job = characterJob(this.dir, blender, this.characterScript, id, { sheet: !!sheet || !!this.concept });
          const brief = request.input.brief as Record<string, unknown>;
          stored = { action: request.action, python, code: characterPlanText(job, brief), character: { job, brief, ...(sheet ? { sheet } : {}), glb: true }, expiresAt };
        } else if (request.action === 'character_revise') {
          if (!existsSync(base.brief)) throw new BridgeError('not_found', `No character "${id}" was built here yet: create it first.`);
          const job = characterJob(this.dir, blender, this.characterScript, id, { sheet: hadSheet, revise: true });
          const prev = JSON.parse(await readFile(base.brief, 'utf8')) as Record<string, unknown>;
          const brief = { ...prev, ...(request.input.brief ?? {}), id, revision_notes: request.input.notes };
          stored = { action: request.action, python, code: characterPlanText(job, brief, request.input.notes), character: { job, brief, notes: request.input.notes, glb: true }, expiresAt };
        } else {
          if (!existsSync(base.brief)) throw new BridgeError('not_found', `No character "${id}" was built here yet: create it first.`);
          const job = characterJob(this.dir, blender, this.characterScript, id, { sheet: hadSheet, review: true });
          stored = { action: request.action, python, code: characterPlanText(job, JSON.parse(await readFile(base.brief, 'utf8'))), character: { job, brief: null, glb: false }, expiresAt };
        }
        break;
      }
      case 'building_create':
      case 'building_revise':
      case 'building_review': {
        const blender = this.detect().blender;
        if (!blender) throw new BridgeError('blender_unavailable', 'Blender was not found on this computer.');
        if (!existsSync(this.buildingScript)) throw new BridgeError('blender_unavailable', 'The building pipeline (scripts/blender/building/build.py) is not in this installation: run the Aether server from a checkout of the repository.');
        const id = request.action === 'building_create' ? request.input.brief.id : request.input.id;
        const base = buildingJob(this.dir, blender, this.buildingScript, id);
        if (request.action === 'building_create') {
          const brief = request.input.brief as Record<string, unknown>;
          stored = { action: request.action, python, code: buildingPlanText(base, brief), building: { job: base, brief, glb: true }, expiresAt };
        } else if (request.action === 'building_revise') {
          if (!existsSync(base.brief)) throw new BridgeError('not_found', `No building "${id}" was built here yet: create it first.`);
          const job = buildingJob(this.dir, blender, this.buildingScript, id, { revise: true });
          const prev = JSON.parse(await readFile(base.brief, 'utf8')) as Record<string, unknown>;
          const brief = { ...prev, ...(request.input.brief ?? {}), id, revision_notes: request.input.notes };
          stored = { action: request.action, python, code: buildingPlanText(job, brief, request.input.notes), building: { job, brief, glb: true }, expiresAt };
        } else {
          if (!existsSync(base.brief)) throw new BridgeError('not_found', `No building "${id}" was built here yet: create it first.`);
          const job = buildingJob(this.dir, blender, this.buildingScript, id, { review: true });
          stored = { action: request.action, python, code: buildingPlanText(job, JSON.parse(await readFile(base.brief, 'utf8'))), building: { job, brief: null, glb: false }, expiresAt };
        }
        break;
      }
    }
    this.plans.set(planId, stored);
    return { planId, action: stored.action, python, ...(stored.code !== undefined ? { code: stored.code } : {}), expiresAt };
  }

  /**
   * Run a plan once. Python plans need `confirm` (set only by the studio's confirmation dialog). Returns JSON for
   * every action but export_glb, which returns the GLB bytes.
   */
  async run(planId: string, confirm: boolean, signal?: AbortSignal): Promise<{ kind: 'json'; result: BlenderRunResult } | { kind: 'glb'; bytes: Uint8Array }> {
    const plan = this.plans.get(planId);
    if (!plan || plan.expiresAt <= this.now()) {
      this.plans.delete(planId);
      throw new BridgeError('not_found', 'That Blender action expired or was already run. Plan it again.');
    }
    if (plan.python && !confirm) throw new BridgeError('confirmation_required', 'This Blender action runs Python: it needs your confirmation in the studio.');
    this.plans.delete(planId);
    if (plan.building) {
      if (!(await this.isEnabled())) throw new BridgeError('blender_unavailable', 'Blender is switched off in Settings → AI connection.');
      const job = this.chain.then(() => this.executeBuilding(plan, signal));
      this.chain = job.catch(() => undefined);
      return job;
    }
    if (plan.character) {
      // A headless Blender process of its own: the switch must be on, but no MCP session is needed.
      if (!(await this.isEnabled())) throw new BridgeError('blender_unavailable', 'Blender is switched off in Settings → AI connection.');
      const job = this.chain.then(() => this.executeCharacter(plan, signal));
      this.chain = job.catch(() => undefined);
      return job;
    }
    const status = await this.status();
    if (status.state !== 'ready') throw new BridgeError('blender_unavailable', status.detail);
    const job = this.chain.then(() => this.execute(plan, signal)).catch(async (e: unknown) => {
      if (e instanceof BridgeError || signal?.aborted) throw e;
      // The MCP server or Blender went away: reconnect on the next probe.
      this.cache = null;
      await this.closeSession();
      throw new BridgeError('backend_error', `Blender failed: ${e instanceof Error ? e.message.slice(0, 300) : 'error'}`);
    });
    this.chain = job.catch(() => undefined);
    return job;
  }

  private async execute(plan: StoredPlan, signal?: AbortSignal): Promise<{ kind: 'json'; result: BlenderRunResult } | { kind: 'glb'; bytes: Uint8Array }> {
    const session = await this.ensureSession(this.detect());
    const clip = (t: string): string => (t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT - 20)}\n… (truncated)` : t);
    if (!plan.python) {
      const r = await session.callTool(plan.action, plan.args ?? {}, { ...(signal ? { signal } : {}), timeoutMs: 120_000 });
      const png = r.images.find((i) => i.mimeType === 'image/png');
      if (r.isError) throw new BridgeError('backend_error', clip(r.text || 'Blender reported an error.').slice(0, 500));
      return { kind: 'json', result: { text: clip(r.text || (png ? 'Picture attached.' : '')), ...(png ? { image: `data:image/png;base64,${png.data}` } : {}) } };
    }
    if (plan.out) await mkdir(join(this.dir, 'out'), { recursive: true, mode: 0o700 });
    try {
      const r = await session.callTool('execute_blender_code', { code: plan.code ?? '' }, { ...(signal ? { signal } : {}), timeoutMs: 15 * 60_000 });
      if (plan.action === 'execute_blender_code') {
        const failed = r.isError || /^Error executing code/.test(r.text);
        return { kind: 'json', result: { text: clip(failed ? r.text : r.text.replace(/^Code executed successfully:\s?/, '') || 'Done (nothing printed).') } };
      }
      const res = parseResult(r.text);
      if (!res || r.isError) throw new BridgeError('backend_error', `Blender did not finish the ${plan.action}: ${r.text.slice(-400)}`);
      const out = plan.out!;
      if (!resolve(out).startsWith(join(this.dir, 'out') + sep)) throw new BridgeError('backend_error', 'unexpected output path');
      const size = (await stat(out)).size;
      if (plan.action === 'export_glb') {
        if (size === 0 || size > BLENDER_MAX_GLB_BYTES) throw new BridgeError('too_large', `The exported model is ${Math.round(size / 1048576)} MiB (max ${BLENDER_MAX_GLB_BYTES / 1048576}).`);
        return { kind: 'glb', bytes: new Uint8Array(await readFile(out)) };
      }
      if (size === 0 || size > MAX_IMAGE_BYTES) throw new BridgeError('too_large', 'The picture Blender wrote is empty or too large.');
      const png = await readFile(out);
      const text = plan.action === 'render' ? 'Cycles render of the scene camera.' : `Cycles bake of ${typeof res['image'] === 'string' ? res['image'] : 'the object'} (kept in the .blend as an image; save the file in Blender to keep it).`;
      return { kind: 'json', result: { text, image: `data:image/png;base64,${png.toString('base64')}` } };
    } finally {
      if (plan.out) await rm(plan.out, { force: true }).catch(() => undefined);
    }
  }

  /** Run a character build (or review) and gather its report, turnaround and model. */
  private async executeCharacter(plan: StoredPlan, signal?: AbortSignal): Promise<{ kind: 'json'; result: BlenderRunResult }> {
    const c = plan.character!;
    const job = c.job;
    await ensureJobDir(job);
    if (c.brief) await writeFile(job.brief, `${JSON.stringify(c.brief, null, 2)}\n`, { mode: 0o600 });
    if (job.sheet && c.sheet) await writeDataUrl(job.sheet, c.sheet);
    else if (job.sheet && plan.action === 'character_create' && !existsSync(job.sheet) && this.concept && c.brief) {
      // No sheet sent: make one from the brief (the concept step of the method).
      const img = await this.concept(conceptPrompt(c.brief as CharacterBrief), signal);
      await writeFile(job.sheet, img.bytes);
    }
    if (job.sheet && !existsSync(job.sheet)) job.argv.splice(job.argv.indexOf('--sheet'), 2);
    const run = await this.runCharacter(job, signal);
    if (signal?.aborted) throw new BridgeError('backend_error', 'The character build was stopped.');
    if (!existsSync(job.report)) throw new BridgeError('backend_error', `The character pipeline failed (exit ${run.code}): ${run.log.slice(-600)}`);
    const out = await readCharacterOutputs(job, c.glb, BLENDER_MAX_GLB_BYTES);
    const text = `${plan.action === 'character_review' ? 'Review' : 'Built'} character "${job.id}".\n${summarizeReport(out.report)}\nFiles: ${job.dir}`;
    return {
      kind: 'json',
      result: {
        text: text.slice(0, 20_000),
        ...(out.image ? { image: out.image } : {}),
        ...(out.glb ? { glb: `data:model/gltf-binary;base64,${Buffer.from(out.glb).toString('base64')}` } : {}),
      },
    };
  }

  /** Run a building build (or review) and gather its report, stills and model. */
  private async executeBuilding(plan: StoredPlan, signal?: AbortSignal): Promise<{ kind: 'json'; result: BlenderRunResult }> {
    const b = plan.building!;
    const job = b.job;
    await mkdir(job.dir, { recursive: true, mode: 0o700 });
    if (b.brief) await writeFile(job.brief, `${JSON.stringify(b.brief, null, 2)}\n`, { mode: 0o600 });
    const run = await this.runBuilding(job, signal);
    if (signal?.aborted) throw new BridgeError('backend_error', 'The building build was stopped.');
    if (!existsSync(job.report)) throw new BridgeError('backend_error', `The building pipeline failed (exit ${run.code}): ${run.log.slice(-600)}`);
    const out = await readBuildingOutputs(job, b.glb, BLENDER_MAX_GLB_BYTES);
    const text = `${plan.action === 'building_review' ? 'Review' : 'Built'} building "${job.id}".\n${summarizeBuildingReport(out.report)}\nFiles: ${job.dir}`;
    return {
      kind: 'json',
      result: {
        text: text.slice(0, 20_000),
        ...(out.image ? { image: out.image } : {}),
        ...(out.glb ? { glb: `data:model/gltf-binary;base64,${Buffer.from(out.glb).toString('base64')}` } : {}),
      },
    };
  }

  /** Stop the MCP server. */
  async dispose(): Promise<void> {
    this.plans.clear();
    await this.closeSession();
  }
}
