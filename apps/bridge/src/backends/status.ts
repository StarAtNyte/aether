/**
 * Backend discovery: is each CLI installed, is the user signed in with their
 * subscription, which models does it offer. Results are cached briefly so a
 * status poll never spawns more than a few short-lived processes.
 */
import { tmpdir } from 'node:os';
import type { BridgeBackendStatus, BridgeEffort, BridgeModel } from '@aether/agent';
import { BRIDGE_EFFORTS, MODEL_ID_RE } from '@aether/agent';
import { runProcess, type SpawnFn } from '../process';
import { restrictedEnv } from '../sandbox';
import { CLAUDE_DEFAULT_MODEL, CLAUDE_MODELS } from './claude';

const PROBE_TIMEOUT_MS = 20_000;

/** Fallback Codex models when the catalog cannot be read (kept current by hand). */
export const CODEX_FALLBACK_MODELS: readonly BridgeModel[] = [
  { id: 'gpt-6.1-sol', label: 'GPT-6.1-Sol', efforts: ['low', 'medium', 'high'], vision: true },
  { id: 'gpt-6-luna', label: 'GPT-6-Luna', efforts: ['low', 'medium', 'high'], vision: true },
  { id: 'gpt-6-astra', label: 'GPT-6-Astra', efforts: ['low', 'medium', 'high'], vision: true },
];

/** Probe dependencies (injectable for tests). */
export interface ProbeDeps {
  codexCommand: string | null;
  claudeCommand: string | null;
  spawn?: SpawnFn;
  env?: NodeJS.ProcessEnv;
}

async function run(command: string, args: string[], deps: ProbeDeps): Promise<{ ok: boolean; out: string; missing: boolean }> {
  const r = await runProcess(command, args, { cwd: tmpdir(), env: restrictedEnv(deps.env), timeoutMs: PROBE_TIMEOUT_MS, maxStdout: 4 * 1024 * 1024, ...(deps.spawn ? { spawn: deps.spawn } : {}) });
  if (r.spawnError) return { ok: false, out: '', missing: r.spawnError.code === 'ENOENT' };
  return { ok: r.code === 0 && !r.stopped, out: `${r.stdout}\n${r.stderr}`, missing: false };
}

/** Parse `codex debug models` JSON into the UI model list (listed models only). */
export function parseCodexModels(text: string): BridgeModel[] {
  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    return [];
  }
  const list = typeof body === 'object' && body !== null && Array.isArray((body as { models?: unknown }).models) ? (body as { models: unknown[] }).models : [];
  const out: BridgeModel[] = [];
  for (const m of list) {
    if (typeof m !== 'object' || m === null) continue;
    const r = m as Record<string, unknown>;
    const id = r['slug'];
    if (typeof id !== 'string' || !MODEL_ID_RE.test(id) || r['visibility'] !== 'list') continue;
    const levels = Array.isArray(r['supported_reasoning_levels']) ? r['supported_reasoning_levels'].map((l) => (typeof l === 'object' && l !== null ? (l as { effort?: unknown }).effort : l)) : [];
    const efforts = BRIDGE_EFFORTS.filter((e: BridgeEffort) => levels.includes(e));
    const label = typeof r['display_name'] === 'string' ? r['display_name'].slice(0, 80) : id;
    const vision = Array.isArray(r['input_modalities']) ? r['input_modalities'].includes('image') : undefined;
    out.push({ id, label, ...(efforts.length > 0 ? { efforts } : {}), ...(vision !== undefined ? { vision } : {}) });
    if (out.length >= 24) break;
  }
  return out;
}

/** Status of the Codex CLI. */
export async function probeCodex(deps: ProbeDeps): Promise<Omit<BridgeBackendStatus, 'busy'>> {
  const base = { id: 'codex' as const, label: 'Codex' };
  if (!deps.codexCommand) return { ...base, installed: false, loggedIn: false, detail: 'Codex CLI not found (npm i -g @openai/codex)', models: [...CODEX_FALLBACK_MODELS] };
  const login = await run(deps.codexCommand, ['login', 'status'], deps);
  if (login.missing) return { ...base, installed: false, loggedIn: false, detail: 'Codex CLI not found (npm i -g @openai/codex)', models: [...CODEX_FALLBACK_MODELS] };
  const loggedIn = login.ok && /logged in/i.test(login.out) && !/not logged in/i.test(login.out);
  const line = login.out.split('\n').map((l) => l.trim()).find((l) => /logged in/i.test(l)) ?? (loggedIn ? 'Logged in' : 'Not logged in — run "codex login"');
  let models: BridgeModel[] = [];
  if (loggedIn) {
    const cat = await run(deps.codexCommand, ['debug', 'models'], deps);
    if (cat.ok) models = parseCodexModels(cat.out.slice(0, cat.out.lastIndexOf('}') + 1));
  }
  if (models.length === 0) models = [...CODEX_FALLBACK_MODELS];
  const via = /using\s+(.+)$/i.exec(line)?.[1]?.trim();
  return { ...base, installed: true, loggedIn, detail: line.slice(0, 200), ...(loggedIn && via ? { account: via.slice(0, 120) } : {}), models, defaultModel: models[0]?.id ?? 'gpt-6.1-sol' };
}

/** Status of the Claude Code CLI. */
export async function probeClaude(deps: ProbeDeps): Promise<Omit<BridgeBackendStatus, 'busy'>> {
  const base = { id: 'claude-code' as const, label: 'Claude Code' };
  const models: BridgeModel[] = CLAUDE_MODELS.map((m) => ({ id: m.id, label: m.label, efforts: ['low', 'medium', 'high'], vision: m.vision }));
  if (!deps.claudeCommand) return { ...base, installed: false, loggedIn: false, detail: 'Claude Code CLI not found', models };
  const r = await run(deps.claudeCommand, ['auth', 'status', '--json'], deps);
  if (r.missing) return { ...base, installed: false, loggedIn: false, detail: 'Claude Code CLI not found', models };
  let loggedIn = false;
  let method = '';
  let account = '';
  try {
    const j = JSON.parse(r.out.slice(r.out.indexOf('{'), r.out.lastIndexOf('}') + 1)) as Record<string, unknown>;
    loggedIn = j['loggedIn'] === true;
    method = typeof j['authMethod'] === 'string' ? j['authMethod'] : '';
    // An API-key login would bill per token: the bridge only uses subscription logins.
    if (loggedIn && j['apiProvider'] !== undefined && j['apiProvider'] !== 'firstParty') loggedIn = false;
    const email = typeof j['email'] === 'string' && /^[^\s@]{1,64}@[^\s@]{1,100}$/.test(j['email']) ? j['email'] : '';
    const plan = typeof j['subscriptionType'] === 'string' && /^[a-z0-9_-]{1,24}$/i.test(j['subscriptionType']) ? j['subscriptionType'] : '';
    account = [email, plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : ''].filter(Boolean).join(' · ');
  } catch {
    loggedIn = false;
  }
  const detail = loggedIn ? `Logged in${method ? ` (${method.slice(0, 40)})` : ''}` : 'Not logged in — run "claude" once and sign in';
  return { ...base, installed: true, loggedIn, detail, ...(loggedIn && account ? { account: account.slice(0, 160) } : {}), models, defaultModel: CLAUDE_DEFAULT_MODEL };
}

/**
 * `codex mcp list --json` → server names; null when the list cannot be read
 * (callers must then refuse to run: an unknown MCP server could not be disabled).
 */
export async function listCodexMcpServers(deps: ProbeDeps): Promise<string[] | null> {
  if (!deps.codexCommand) return [];
  const r = await run(deps.codexCommand, ['mcp', 'list', '--json'], deps);
  if (!r.ok) return null;
  try {
    const j = JSON.parse(r.out.slice(r.out.indexOf('['), r.out.lastIndexOf(']') + 1)) as unknown;
    if (!Array.isArray(j) || j.length > 64) return null;
    const names = j.map((s) => (typeof s === 'object' && s !== null ? (s as { name?: unknown }).name : undefined));
    return names.every((n): n is string => typeof n === 'string') ? names : null;
  } catch {
    return null;
  }
}

/** Memoize an async function for `ttlMs` (failures are not cached). */
export function cached<T>(fn: () => Promise<T>, ttlMs: number, now: () => number = Date.now): () => Promise<T> {
  let value: { at: number; v: T } | null = null;
  let inflight: Promise<T> | null = null;
  return () => {
    if (value && now() - value.at < ttlMs) return Promise.resolve(value.v);
    inflight ??= fn()
      .then((v) => {
        value = { at: now(), v };
        return v;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };
}
