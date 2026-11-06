/**
 * `@aether/agent/blender` — Blender on this computer, through the local Aether
 * server (`/api/local/blender/*`): the wire contract, a client, the agent's
 * Blender tools and the runner that executes them. A separate entry so hosts
 * load it only when Blender is ready (it never reaches a first page load).
 *
 * Every action is planned first (nothing runs); a plan that runs Python
 * carries its exact code, which the host shows in a confirmation dialog. Only
 * the host's `confirm` callback can make a run carry `confirm: true`: the
 * model's tool inputs are strict and have no such field.
 */
import type { z } from 'zod';
import {
  BLENDER_MAX_GLB_BYTES,
  BLENDER_PLAN_ID_RE,
  BlenderInputs,
  BlenderPlanSchema,
  BlenderRunResultSchema,
  BlenderStatusSchema,
  type BlenderAction,
  type BlenderPlan,
  type BlenderPlanRequest,
  type BlenderRunResult,
  type BlenderStatus,
} from './bridge/blender-protocol';
import type { HostToolRunner, ToolDef } from './types';

export * from './bridge/blender-protocol';

/** Base path of the Blender routes on the local server. */
export const BLENDER_BASE = '/api/local/blender';
const OFFLINE = 'Blender is not available (the Aether server is not running on this computer)';

/**
 * A failed Blender request. `code` is the server's error code (`confirmation_required`, `blender_unavailable`, …),
 * `offline`, `aborted`, `timeout` or `invalid_response`. Self-contained (no bridge client), so this entry stays one
 * small chunk of its own.
 */
export class BlenderApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 0,
  ) {
    super(message);
    this.name = 'BlenderApiError';
  }
}

function parse<T>(schema: z.ZodType<T>, body: unknown, what: string): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new BlenderApiError('invalid_response', `malformed ${what}`);
  return r.data;
}

async function errorOf(res: Response): Promise<BlenderApiError> {
  const body = (await res.json().catch(() => null)) as { error?: { code?: unknown; message?: unknown } } | null;
  const code = typeof body?.error?.code === 'string' ? body.error.code.slice(0, 40) : 'server';
  const message = typeof body?.error?.message === 'string' ? body.error.message.slice(0, 500) : `Blender request failed (${res.status})`;
  return new BlenderApiError(code, message, res.status);
}

/** Client of `/api/local/blender/*`. */
export interface BlenderApi {
  status(signal?: AbortSignal): Promise<BlenderStatus>;
  setEnabled(enabled: boolean): Promise<BlenderStatus>;
  /** Plan an action (nothing runs). */
  plan(request: BlenderPlanRequest, signal?: AbortSignal): Promise<BlenderPlan>;
  /** Run a plan; `confirm` only from the user's confirmation. */
  run(planId: string, confirm: boolean, signal?: AbortSignal): Promise<BlenderRunResult>;
  /** Run an export_glb plan: the GLB bytes. */
  runExport(planId: string, confirm: boolean, signal?: AbortSignal): Promise<Uint8Array>;
}

/** Create the Blender client (same origin by default). */
export function createBlenderApi(opts: { base?: string; fetch?: typeof fetch } = {}): BlenderApi {
  const base = (opts.base ?? BLENDER_BASE).replace(/\/+$/, '');
  const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const send = async (method: 'GET' | 'POST', path: string, body: unknown, timeoutMs: number, signal: AbortSignal | undefined, accept = 'application/json'): Promise<Response> => {
    const timeout = AbortSignal.timeout(timeoutMs);
    const sig = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, { method, headers: { accept, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, signal: sig, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    } catch {
      if (signal?.aborted) throw new BlenderApiError('aborted', 'request aborted');
      if (timeout.aborted) throw new BlenderApiError('timeout', `Blender did not answer within ${Math.round(timeoutMs / 1000)} s`);
      throw new BlenderApiError('offline', OFFLINE);
    }
    if (!res.ok) throw await errorOf(res);
    return res;
  };
  const json = async (method: 'GET' | 'POST', path: string, body?: unknown, timeoutMs = 15_000, signal?: AbortSignal): Promise<unknown> => (await send(method, path, body, timeoutMs, signal)).json().catch(() => undefined);
  const runBody = (planId: string, confirm: boolean): { planId: string; confirm?: true } => {
    if (!BLENDER_PLAN_ID_RE.test(planId)) throw new BlenderApiError('invalid_request', 'invalid plan id');
    return { planId, ...(confirm ? { confirm: true as const } : {}) };
  };
  return {
    async status(signal) {
      return parse(BlenderStatusSchema, await json('GET', '/status', undefined, 20_000, signal), 'Blender status');
    },
    async setEnabled(enabled) {
      return parse(BlenderStatusSchema, await json('POST', '/settings', { enabled }, 30_000), 'Blender status');
    },
    async plan(request, signal) {
      return parse(BlenderPlanSchema, await json('POST', '/plan', request, 15_000, signal), 'Blender plan');
    },
    async run(planId, confirm, signal) {
      return parse(BlenderRunResultSchema, await json('POST', '/run', runBody(planId, confirm), 15 * 60_000, signal), 'Blender result');
    },
    async runExport(planId, confirm, signal) {
      const res = await send('POST', '/run', runBody(planId, confirm), 15 * 60_000, signal, 'model/gltf-binary');
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength === 0 || bytes.byteLength > BLENDER_MAX_GLB_BYTES) throw new BlenderApiError('invalid_response', 'the exported model is empty or too large');
      return bytes;
    },
  };
}

/** What the host does around a Blender action. */
export interface BlenderHostDeps {
  api: BlenderApi;
  /**
   * Ask the user to allow a Python action, showing `code` exactly. Resolves true to run it. This is the only source of
   * the run's `confirm` flag.
   */
  confirm(request: { action: BlenderAction; code: string }): Promise<boolean>;
  /** Store exported GLB bytes as a user asset (the dropped-.glb path). */
  importGlb(bytes: Uint8Array, name: string): Promise<{ ok: true; id: string; summary: string } | { ok: false; error: string }>;
}

/** Outcome of one Blender action. */
export type BlenderActionOutcome =
  | { ok: true; text: string; image?: string; asset?: { id: string; summary: string } }
  | { ok: false; declined?: true; text: string };

/** Plan, confirm (Python actions), run. Never throws for expected failures. */
export async function runBlenderAction(deps: BlenderHostDeps, request: BlenderPlanRequest, signal?: AbortSignal): Promise<BlenderActionOutcome> {
  try {
    const plan = await deps.api.plan(request, signal);
    let confirmed = false;
    if (plan.python) {
      if (plan.code === undefined) return { ok: false, text: 'The server sent a Python plan without its code; nothing ran.' };
      confirmed = await deps.confirm({ action: plan.action, code: plan.code });
      if (!confirmed) return { ok: false, declined: true, text: 'The user did not allow this to run in Blender. Do not retry it unless they ask.' };
    }
    if (plan.action === 'export_glb') {
      const bytes = await deps.api.runExport(plan.planId, confirmed, signal);
      const name = request.action === 'export_glb' ? (request.input.name ?? 'Blender export') : 'Blender export';
      const r = await deps.importGlb(bytes, name);
      if (!r.ok) return { ok: false, text: `The exported model was refused: ${r.error}` };
      return { ok: true, text: `Imported from Blender as user asset "${r.id}" (${r.summary}). Place it with apply_patches: an entity with shape {"kind":"asset","id":"${r.id}"}.`, asset: { id: r.id, summary: r.summary } };
    }
    const out = await deps.api.run(plan.planId, confirmed, signal);
    return { ok: true, text: out.text, ...(out.image ? { image: out.image } : {}) };
  } catch (e) {
    if (signal?.aborted) throw e;
    return { ok: false, text: e instanceof Error ? e.message.slice(0, 500) : 'Blender failed' };
  }
}

const objectList = { type: 'array', items: { type: 'string', maxLength: 120 }, maxItems: 16 } as const;

/** The agent's Blender tools (name → action). */
export const BLENDER_TOOL_ACTIONS: Readonly<Record<string, BlenderAction>> = {
  blender_scene_info: 'get_scene_info',
  blender_look: 'look',
  blender_python: 'execute_blender_code',
  blender_export_asset: 'export_glb',
  blender_render: 'render',
  blender_bake: 'bake',
};

/** Tool definitions offered while Blender is ready. */
export const BLENDER_TOOLS: readonly ToolDef[] = [
  {
    name: 'blender_scene_info',
    description: "Facts about the scene open in the user's Blender (this computer): objects, positions, sizes. Text only.",
    inputSchema: { type: 'object', additionalProperties: false, properties: { query: { type: 'string', maxLength: 80, description: 'Name filter' }, root: { type: 'string', maxLength: 120, description: 'List this object’s hierarchy' }, limit: { type: 'integer', minimum: 1, maximum: 100 } } },
  },
  {
    name: 'blender_look',
    description: "A picture of the user's Blender scene (viewport, camera, or the target from several angles).",
    inputSchema: { type: 'object', additionalProperties: false, properties: { mode: { type: 'string', enum: ['viewport', 'camera', 'angles'] }, target: objectList, shading: { type: 'string', enum: ['solid', 'material', 'rendered', 'wireframe', 'xray'] }, max_size: { type: 'integer', minimum: 128, maximum: 1024 } } },
  },
  {
    name: 'blender_python',
    description: "Run Python (bpy) in the user's Blender to model or edit there. The user sees the code and must allow it; print what you need to know. Small steps.",
    inputSchema: { type: 'object', additionalProperties: false, required: ['code'], properties: { code: { type: 'string', maxLength: 20000 } } },
  },
  {
    name: 'blender_export_asset',
    description: 'Export the Blender scene (or the selection) as a GLB and import it into this project as a user asset; the result gives the asset id to place with apply_patches. The user must allow it.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { name: { type: 'string', maxLength: 64 }, selection_only: { type: 'boolean' } } },
  },
  {
    name: 'blender_render',
    description: "Render the Blender scene's camera with Cycles and see the picture. The user must allow it.",
    inputSchema: { type: 'object', additionalProperties: false, properties: { width: { type: 'integer', minimum: 64, maximum: 2048 }, height: { type: 'integer', minimum: 64, maximum: 2048 }, samples: { type: 'integer', minimum: 1, maximum: 1024 } } },
  },
  {
    name: 'blender_bake',
    description: 'Bake lighting or a pass of one mesh object in Blender with Cycles into a texture (UVs are made if missing) and see it. The user must allow it.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['object'], properties: { object: { type: 'string', maxLength: 120 }, type: { type: 'string', enum: ['COMBINED', 'DIFFUSE', 'AO', 'SHADOW', 'EMIT', 'ROUGHNESS', 'NORMAL', 'GLOSSY'] }, size: { type: 'integer', minimum: 64, maximum: 4096 }, samples: { type: 'integer', minimum: 1, maximum: 1024 } } },
  },
];

/** The agent's Blender tools over a host (see `AgentOptions.blender`). */
export function createBlenderToolRunner(deps: BlenderHostDeps): HostToolRunner {
  return {
    tools: BLENDER_TOOLS,
    async run(name, input, signal) {
      const action = BLENDER_TOOL_ACTIONS[name];
      if (!action) return { text: `Unknown Blender tool "${name.slice(0, 40)}".`, isError: true };
      const parsed = BlenderInputs[action].safeParse(input ?? {});
      if (!parsed.success) return { text: `Invalid ${name} input: ${parsed.error.issues.slice(0, 4).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`, isError: true };
      const out = await runBlenderAction(deps, { action, input: parsed.data } as BlenderPlanRequest, signal);
      return out.ok ? { text: out.text, ...(out.image ? { image: out.image } : {}) } : { text: out.text, isError: true };
    },
  };
}
