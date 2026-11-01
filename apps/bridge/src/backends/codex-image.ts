/**
 * Image generation through the Codex CLI's built-in image tool (`image_generation` feature, the model's `image_gen` tool), on the
 * user's own ChatGPT login: no API key, no extra service. The text backend (`codex.ts`) switches this feature off on purpose; this
 * one is a separate, equally locked-down run that keeps ONLY the image tool.
 *
 * - `codex exec --json` in a fresh empty directory, read-only sandbox, an allowlisted environment (no keys), the user's config and
 *   rules ignored (their MCP servers and skills do not load), every tool but image generation disabled;
 * - the prompt goes through stdin (never into an argument), a reference picture through `-i <file>`;
 * - Codex writes the picture to `$CODEX_HOME/generated_images/<thread id>/*.png`; the thread id comes from the `thread.started`
 *   event, and the newest picture of that folder (or of the folder tree, written after the run began) is read back, checked by its
 *   header and size, and returned. Nothing else is read.
 *
 * Without the CLI, a login or the feature, the call fails with a message the caller shows; the texture tool then falls back to the
 * photo-derived and procedural paths. Not a required part of anything.
 */
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { BridgeError } from '../errors';
import { runProcess, type SpawnFn } from '../process';
import { restrictedEnv, withTempDir } from '../sandbox';
import { classifyCliFailure } from '../errors';

/** Largest picture read back (bytes). */
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

/** What an image backend returns. */
export interface ImageResultBytes {
  /** PNG, JPEG or WebP bytes. */
  bytes: Uint8Array;
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  model: string;
}

/** What an image backend is asked. */
export interface ImageJob {
  prompt: string;
  size?: 512 | 1024;
  /** PNG / JPEG / WebP data URL. */
  reference?: string;
}

/** An image backend of the bridge. */
export interface ImageBackend {
  name: string;
  generate(job: ImageJob, signal?: AbortSignal): Promise<ImageResultBytes>;
}

/**
 * Features of the text lockdown that stay off here (image generation is the one thing switched on). `code_mode_host` stays on:
 * Codex 0.16x draws images through it and refuses with it disabled; the shell tools are off and the run is read-only in an empty folder.
 */
export const CODEX_IMAGE_DISABLED_FEATURES = [
  'shell_tool', 'unified_exec', 'unified_exec_tty', 'shell_snapshot', 'view_image', 'multi_agent', 'multi_agent_v2',
  'apps', 'plugins', 'remote_plugin', 'plugin_sharing', 'browser_use', 'browser_use_external', 'browser_use_full_cdp_access', 'in_app_browser',
  'computer_use', 'goals', 'memories', 'hooks', 'tool_suggest', 'sleep_tool', 'skill_search',
  'skill_mcp_dependency_install', 'workspace_dependencies', 'realtime_conversation', 'worktrees',
] as const;

/** The picture sniffed by header (null for anything else). */
export function sniffImage(b: Uint8Array): ImageResultBytes['mime'] | null {
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b.length > 16 && String.fromCharCode(b[0] as number, b[1] as number, b[2] as number, b[3] as number) === 'RIFF' && String.fromCharCode(b[8] as number, b[9] as number, b[10] as number, b[11] as number) === 'WEBP') return 'image/webp';
  return null;
}

/** The arguments of one image run (exported so tests can assert the lockdown). */
export function codexImageArgs(dir: string, reference?: string): string[] {
  const args = ['exec', '--json', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules', '-s', 'read-only', '-C', dir];
  for (const f of CODEX_IMAGE_DISABLED_FEATURES) args.push('--disable', f);
  args.push('--enable', 'image_generation', '-c', 'web_search="disabled"', '-c', 'approval_policy="never"');
  if (reference) args.push('-i', reference);
  // The prompt is read from stdin.
  args.push('-');
  return args;
}

/** What the model is told: draw exactly this with the image tool, touch nothing else, answer with one word. */
export function codexImagePrompt(job: ImageJob): string {
  return [
    'Use the built-in image generation tool exactly once to create ONE square image described below.',
    'Do not run commands, do not write or move files, do not browse, do not make more than one image. When the image exists, reply with the single word: done.',
    '',
    `Image to create (${job.size ?? 1024} x ${job.size ?? 1024} px if the tool lets you choose):`,
    job.prompt,
    job.reference ? '\nThe attached picture is a reference: follow its colour, pattern and scale as the prompt says.' : '',
  ].join('\n');
}

/** Thread id and any picture path found in the `--json` events. */
export function scanEvents(stdout: string): { threadId: string | null; paths: string[] } {
  let threadId: string | null = null;
  const paths: string[] = [];
  const walk = (v: unknown, depth: number): void => {
    if (depth > 8) return;
    if (typeof v === 'string') {
      if (/generated_images\/[^"\s]+\.(png|jpe?g|webp)$/i.test(v) && !paths.includes(v)) paths.push(v);
    } else if (Array.isArray(v)) for (const x of v.slice(0, 50)) walk(x, depth + 1);
    else if (typeof v === 'object' && v !== null) for (const x of Object.values(v as Record<string, unknown>).slice(0, 50)) walk(x, depth + 1);
  };
  for (const line of stdout.split('\n')) {
    if (!line.startsWith('{')) continue;
    try {
      const ev = JSON.parse(line) as { type?: unknown; thread_id?: unknown };
      if (ev.type === 'thread.started' && typeof ev.thread_id === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(ev.thread_id)) threadId = ev.thread_id;
      walk(ev, 0);
    } catch {
      /* not an event */
    }
  }
  return { threadId, paths };
}

async function newestImage(dir: string, since: number): Promise<string | null> {
  let best: { path: string; at: number } | null = null;
  const visit = async (d: string, depth: number): Promise<void> => {
    let names: string[];
    try {
      names = await readdir(d);
    } catch {
      return;
    }
    for (const n of names.slice(0, 200)) {
      const p = join(d, n);
      const st = await stat(p).catch(() => null);
      if (!st) continue;
      if (st.isDirectory() && depth < 2) await visit(p, depth + 1);
      else if (st.isFile() && /\.(png|jpe?g|webp)$/i.test(n) && st.mtimeMs >= since - 1000 && (!best || st.mtimeMs > best.at)) best = { path: p, at: st.mtimeMs };
    }
  };
  await visit(dir, 0);
  return (best as { path: string } | null)?.path ?? null;
}

/** Options of {@link createCodexImageBackend}. */
export interface CodexImageOptions {
  /** The `codex` command (default `codex` on PATH). */
  command?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  tmpRoot?: string;
  /** Where Codex keeps its files (default `$CODEX_HOME` or `~/.codex`). */
  codexHome?: string;
  spawn?: SpawnFn;
}

/** Create the Codex image backend. */
export function createCodexImageBackend(opts: CodexImageOptions = {}): ImageBackend {
  const timeoutMs = opts.timeoutMs ?? 300_000;
  return {
    name: 'Codex image tool',
    async generate(job: ImageJob, signal?: AbortSignal): Promise<ImageResultBytes> {
      const home = opts.codexHome ?? (opts.env ?? process.env)['CODEX_HOME'] ?? join(homedir(), '.codex');
      const generated = join(home, 'generated_images');
      return withTempDir(async (dir) => {
        let refPath: string | undefined;
        if (job.reference) {
          const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(job.reference);
          if (!m?.[1] || !m[2]) throw new BridgeError('invalid_request', 'The reference must be a PNG, JPEG or WebP data URL.');
          refPath = join(dir, `reference.${m[1] === 'jpeg' ? 'jpg' : m[1]}`);
          await writeFile(refPath, Buffer.from(m[2], 'base64'), { mode: 0o600 });
        }
        const started = Date.now();
        const r = await runProcess(opts.command ?? 'codex', codexImageArgs(dir, refPath), {
          cwd: dir,
          env: restrictedEnv(opts.env),
          timeoutMs,
          stdin: codexImagePrompt(job),
          maxStdout: 8 * 1024 * 1024,
          ...(signal ? { signal } : {}),
          ...(opts.spawn ? { spawn: opts.spawn } : {}),
        });
        if (r.spawnError) throw new BridgeError('cli_missing', 'The Codex CLI could not be started. Install it (npm i -g @openai/codex) and run "codex login".');
        if (r.stopped === 'timeout') throw new BridgeError('timeout', `Codex did not make the image within ${Math.round(timeoutMs / 1000)} s.`);
        if (r.stopped === 'aborted') throw new BridgeError('backend_error', 'cancelled');
        const { threadId, paths } = scanEvents(r.stdout);
        // A failure event names the real reason (usage limit, sign-in, feature off).
        const failure = /"type":"(?:turn\.failed|error)"[^\n]*"message":"([^"]{1,300})"/.exec(r.stdout)?.[1];
        let file: string | null = null;
        for (const p of paths) {
          const abs = p.startsWith('/') ? p : join(home, p.slice(p.indexOf('generated_images')));
          if (abs.startsWith(generated) && (await stat(abs).catch(() => null))?.isFile()) {
            file = abs;
            break;
          }
        }
        if (!file && threadId) file = await newestImage(join(generated, threadId), started);
        if (!file) file = await newestImage(generated, started);
        if (!file) {
          if (failure) throw classifyCliFailure('Codex', failure);
          throw new BridgeError('backend_error', r.code === 0 ? 'Codex finished without making an image (the image tool may be off for this account).' : `Codex stopped before making an image (exit ${String(r.code)}).`);
        }
        const st = await stat(file);
        if (st.size > MAX_IMAGE_BYTES) throw new BridgeError('too_large', 'The image Codex made is too large.');
        const bytes = new Uint8Array(await readFile(file));
        const mime = sniffImage(bytes);
        if (!mime) throw new BridgeError('backend_error', 'Codex produced a file that is not a PNG, JPEG or WebP image.');
        return { bytes, mime, model: 'codex-image' };
      }, opts.tmpRoot);
    },
  };
}
