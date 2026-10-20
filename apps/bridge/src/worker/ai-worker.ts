/**
 * The AI worker process (one per job, so a crash or a runaway CLI never
 * takes the server down): reads one job from stdin, runs it with the user's
 * signed-in Codex / Claude Code, reports progress on stderr and prints the
 * result on stdout. Spawned with an allowlisted environment by `runner.ts`.
 *
 * - `complete`: one locked-down, tool-less completion (the same backends as
 *   the bridge), optionally resuming the project's conversation;
 * - `agentic`: a coding agent iterating in a throwaway workspace (see
 *   `agentic.ts`); only the artifact file it leaves behind is used, and the
 *   parent validates it again.
 */
import { createClaudeCodeBackend } from '../backends/claude';
import { createCodexBackend } from '../backends/codex';
import { listCodexMcpServers } from '../backends/status';
import { BridgeError } from '../errors';
import { SessionStore } from '../sessions';
import { findCliPath } from '../which';
import { runAgentic } from './agentic';
import { PROGRESS_PREFIX, WorkerJob, type WorkerResult } from './protocol';

const MAX_INPUT = 32 * 1024 * 1024;

function progress(phase: string, message: string): void {
  process.stderr.write(`${PROGRESS_PREFIX}${JSON.stringify({ phase: phase.slice(0, 48), message: message.replace(/\s+/g, ' ').slice(0, 500) })}\n`);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of process.stdin) {
    const b = typeof c === 'string' ? Buffer.from(c) : (c as Buffer);
    size += b.length;
    if (size > MAX_INPUT) throw new BridgeError('too_large', 'The job is too large.');
    chunks.push(b);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function envFor(codexHome: string | null | undefined): NodeJS.ProcessEnv {
  // The parent already restricted the environment; only the account home may change.
  return codexHome ? { ...process.env, CODEX_HOME: codexHome } : { ...process.env };
}

async function runComplete(job: Extract<WorkerJob, { kind: 'complete' }>): Promise<WorkerResult> {
  const env = envFor(job.codexHome);
  const sessions = new SessionStore();
  const key = job.request.session?.key;
  if (key && job.session) sessions.record(key, job.backend, job.request.model, job.session);
  const timeoutMs = job.timeoutMs ?? 240_000;
  progress('started', job.backend === 'codex' ? 'Codex is thinking…' : 'Claude Code is thinking…');
  const command = findCliPath(job.backend === 'codex' ? 'codex' : 'claude', { env });
  const backend =
    job.backend === 'codex'
      ? createCodexBackend({
          ...(command ? { codexPath: command } : {}),
          env,
          timeoutMs,
          sessions,
          mcpServers: () => listCodexMcpServers({ codexCommand: command, claudeCommand: null, env }),
        })
      : createClaudeCodeBackend({ command: command ?? 'claude', env, timeoutMs, sessions });
  const r = await backend.complete(job.request);
  const session = key ? sessions.peek(key, job.backend, job.request.model) : undefined;
  return {
    ok: true,
    kind: 'complete',
    text: r.text,
    ...(r.structured !== undefined ? { structured: r.structured } : {}),
    ...(r.usage ? { usage: r.usage } : {}),
    ...(r.model ? { model: r.model } : {}),
    ...(r.resumed ? { resumed: true } : {}),
    ...(session ? { session: { id: session.id, systemHash: session.systemHash, body: session.body, ...(session.dir ? { dir: session.dir } : {}) } } : {}),
  };
}

async function main(): Promise<void> {
  let result: WorkerResult;
  try {
    const parsed = WorkerJob.safeParse(JSON.parse(await readStdin()) as unknown);
    if (!parsed.success) throw new BridgeError('invalid_request', `Invalid job: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
    const job = parsed.data;
    result = job.kind === 'complete' ? await runComplete(job) : await runAgentic(job, { env: envFor(job.codexHome), progress });
  } catch (e) {
    const err = e instanceof BridgeError ? e : new BridgeError('backend_error', 'The AI worker failed.');
    result = { ok: false, code: err.code, message: err.message.slice(0, 500) };
  }
  process.stdout.write(JSON.stringify(result));
  process.exitCode = result.ok ? 0 : 1;
}

void main();
