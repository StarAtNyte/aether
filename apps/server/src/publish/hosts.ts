/**
 * Hosting publishers: the user's own Netlify, Vercel, GitHub Pages and
 * itch.io accounts, reached through the CLIs they installed and logged in
 * to (never our credentials). This module is pure: which programs exist,
 * how to ask them whether they are signed in, the exact argument arrays of
 * every deploy step, and how to read the public URL back from their output.
 * `jobs.ts` runs the steps (argument arrays, restricted environment,
 * timeouts, no shell).
 */
import { z } from 'zod';

/** Hosting targets. */
export const HOST_IDS = ['netlify', 'vercel', 'github', 'itch'] as const;
export type HostId = (typeof HOST_IDS)[number];

/** What the studio sends to deploy a build. */
export const DeployRequest = z
  .object({
    build: z.string().regex(/^[a-z0-9]{12}$/),
    target: z.enum(HOST_IDS),
    /** Site / project / repository name (lowercase slug). */
    name: z
      .string()
      .regex(/^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/)
      .optional(),
    /** itch.io: `user/game` (the game page must exist, kind HTML). */
    itch: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-]{1,64}$/)
      .optional(),
    /** itch.io channel (default `html5`). */
    channel: z
      .string()
      .regex(/^[a-z0-9-]{1,32}$/)
      .optional(),
  })
  .strict();
export type DeployRequest = z.infer<typeof DeployRequest>;

/** One CLI invocation of a deploy. */
export interface DeployStep {
  label: string;
  bin: string;
  args: string[];
  /** Run in the build directory (default) or its parent. */
  cwd?: 'build' | 'parent';
  /** May fail without failing the deploy (e.g. "already exists"). */
  optional?: boolean;
  /** Write this file (relative to the job's scratch dir) before running (JSON inputs for `gh api`). */
  input?: { file: string; json: unknown };
  /** Read a value from stdout for later steps. */
  capture?: (stdout: string) => Record<string, string>;
  timeoutMs?: number;
}

/** Status of a target on this machine. */
export interface HostStatus {
  id: HostId;
  label: string;
  bin: string;
  installed: boolean;
  signedIn: boolean;
  /** Account name when the CLI reports one. */
  account?: string;
  /** What to do when not ready. */
  hint?: string;
}

/** Static facts about each CLI. */
export const HOSTS: Readonly<Record<HostId, { label: string; bin: string; install: string; login: string }>> = {
  netlify: { label: 'Netlify', bin: 'netlify', install: 'npm i -g netlify-cli', login: 'netlify login' },
  vercel: { label: 'Vercel', bin: 'vercel', install: 'npm i -g vercel', login: 'vercel login' },
  github: { label: 'GitHub Pages', bin: 'gh', install: 'https://cli.github.com', login: 'gh auth login' },
  itch: { label: 'itch.io', bin: 'butler', install: 'https://itch.io/docs/butler/', login: 'butler login' },
};

/** Arguments of the "who am I" probe of each CLI. */
export function statusArgs(id: HostId): string[] {
  switch (id) {
    case 'netlify':
      return ['status', '--json'];
    case 'vercel':
      return ['whoami'];
    case 'github':
      return ['api', 'user', '--jq', '.login'];
    case 'itch':
      return ['status'];
  }
}

const ACCOUNT_RE = /^[A-Za-z0-9][A-Za-z0-9 ._@+-]{0,80}$/;

/** Interpret a status probe (exit code + output). */
export function parseStatus(id: HostId, code: number | null, stdout: string, stderr: string): { signedIn: boolean; account?: string } {
  const out = stdout.trim();
  if (code !== 0) return { signedIn: false };
  if (/not logged in|log in|login required|no credentials|not authenticated/i.test(`${out}\n${stderr}`)) return { signedIn: false };
  switch (id) {
    case 'netlify': {
      try {
        const j = JSON.parse(out) as { account?: { Name?: unknown; Email?: unknown } };
        const name = typeof j.account?.Name === 'string' ? j.account.Name : typeof j.account?.Email === 'string' ? j.account.Email : '';
        return j.account ? { signedIn: true, ...(ACCOUNT_RE.test(name) ? { account: name } : {}) } : { signedIn: false };
      } catch {
        return { signedIn: false };
      }
    }
    case 'vercel':
    case 'github': {
      const name = out.split(/\r?\n/).filter((l) => l.trim() !== '').pop()?.trim() ?? '';
      return ACCOUNT_RE.test(name) ? { signedIn: true, account: name } : { signedIn: false };
    }
    case 'itch':
      return { signedIn: true };
  }
}

/** `{ [key]: value }` when `value` matches `re`, else `{}` (captured step outputs are validated). */
function captured(key: string, value: string, re: RegExp): Record<string, string> {
  const out: Record<string, string> = {};
  if (re.test(value)) out[key] = value;
  return out;
}

/** First https URL in `text` matching `host` (null when none). */
export function findUrl(text: string, host: RegExp): string | null {
  for (const m of text.matchAll(/https:\/\/[A-Za-z0-9.-]+(?::\d+)?(?:\/[A-Za-z0-9._~%/-]*)?/g)) {
    try {
      const u = new URL(m[0]);
      if (host.test(u.hostname)) return u.toString();
    } catch {
      /* not a URL */
    }
  }
  return null;
}

/** Netlify JSON output → the site URL. */
export function netlifyUrl(stdout: string): string | null {
  const start = stdout.indexOf('{');
  if (start >= 0) {
    try {
      const j = JSON.parse(stdout.slice(start)) as Record<string, unknown>;
      for (const k of ['ssl_url', 'url', 'deploy_url']) {
        const v = j[k];
        if (typeof v === 'string' && /^https:\/\/[a-z0-9.-]+\.netlify\.app(\/|$)/i.test(v)) {
          try {
            return new URL(v).toString();
          } catch {
            /* not a URL */
          }
        }
      }
    } catch {
      /* fall through */
    }
  }
  return findUrl(stdout, /\.netlify\.app$/i);
}

/** Vercel output → the production URL (the last vercel.app URL it prints). */
export function vercelUrl(stdout: string): string | null {
  let last: string | null = null;
  for (const line of stdout.split(/\r?\n/)) {
    const u = findUrl(line, /\.vercel\.app$/i);
    if (u) last = u;
  }
  return last;
}

/** The public URL of a deploy, from its outputs and captured values. */
export function deployedUrl(id: HostId, outputs: string, vars: Record<string, string>, req: DeployRequest): string | null {
  switch (id) {
    case 'netlify':
      return netlifyUrl(outputs);
    case 'vercel':
      return vercelUrl(outputs);
    case 'github':
      return vars['owner'] ? `https://${vars['owner'].toLowerCase()}.github.io/${req.name ?? ''}/` : null;
    case 'itch': {
      const [user, game] = (req.itch ?? '').split('/');
      return user && game ? `https://${user.toLowerCase()}.itch.io/${game}` : null;
    }
  }
}

/**
 * The steps of a deploy. `files` are the build's files (relative paths),
 * needed by GitHub's Git Data API upload; `blobFile(i)` names the JSON
 * input of file `i`.
 */
export function deploySteps(req: DeployRequest, files: readonly string[], fileB64: (path: string) => string, version: string): DeployStep[] {
  const name = req.name ?? 'aether-game';
  switch (req.target) {
    case 'netlify':
      return [
        {
          label: 'Creating the Netlify site',
          bin: 'netlify',
          args: ['sites:create', '--name', name, '--json'],
          capture: (stdout) => {
            const start = stdout.indexOf('{');
            try {
              const j = JSON.parse(stdout.slice(Math.max(0, start))) as { id?: unknown };
              return captured('site', typeof j.id === 'string' ? j.id : '', /^[a-f0-9-]{8,64}$/i);
            } catch {
              return {};
            }
          },
          optional: true,
        },
        { label: 'Deploying to Netlify', bin: 'netlify', args: ['deploy', '--prod', '--dir', '.', '--site', '{site|name}', '--json'], timeoutMs: 15 * 60_000 },
      ];
    case 'vercel':
      return [{ label: 'Deploying to Vercel', bin: 'vercel', args: ['deploy', '.', '--prod', '--yes'], timeoutMs: 15 * 60_000 }];
    case 'itch':
      return [{ label: 'Pushing to itch.io', bin: 'butler', args: ['push', '.', `${req.itch ?? ''}:${req.channel ?? 'html5'}`, '--userversion', version], timeoutMs: 20 * 60_000 }];
    case 'github': {
      const steps: DeployStep[] = [
        { label: 'Reading your GitHub account', bin: 'gh', args: ['api', 'user', '--jq', '.login'], capture: (out) => captured('owner', out.trim(), /^[A-Za-z0-9-]{1,39}$/) },
        { label: `Creating the repository ${name}`, bin: 'gh', args: ['repo', 'create', name, '--public', '--add-readme', '--description', 'A game made with Aether'], optional: true },
      ];
      const tree: Array<{ path: string; mode: string; type: string; sha: string }> = [];
      files.forEach((f, i) => {
        steps.push({
          label: `Uploading ${f}`,
          bin: 'gh',
          args: ['api', '-X', 'POST', 'repos/{owner}/' + name + '/git/blobs', '--input', `blob-${i}.json`, '--jq', '.sha'],
          input: { file: `blob-${i}.json`, json: { content: fileB64(f), encoding: 'base64' } },
          capture: (out) => captured(`blob${i}`, out.trim(), /^[a-f0-9]{40}$/),
        });
        tree.push({ path: f, mode: '100644', type: 'blob', sha: `{blob${i}}` });
      });
      steps.push(
        { label: 'Writing the file tree', bin: 'gh', args: ['api', '-X', 'POST', 'repos/{owner}/' + name + '/git/trees', '--input', 'tree.json', '--jq', '.sha'], input: { file: 'tree.json', json: { tree } }, capture: (out) => captured('tree', out.trim(), /^[a-f0-9]{40}$/) },
        {
          label: 'Committing',
          bin: 'gh',
          args: ['api', '-X', 'POST', 'repos/{owner}/' + name + '/git/commits', '--input', 'commit.json', '--jq', '.sha'],
          input: { file: 'commit.json', json: { message: `Publish ${version}`, tree: '{tree}', parents: [] } },
          capture: (out) => captured('commit', out.trim(), /^[a-f0-9]{40}$/),
        },
        { label: 'Updating the gh-pages branch', bin: 'gh', args: ['api', '-X', 'PATCH', 'repos/{owner}/' + name + '/git/refs/heads/gh-pages', '--input', 'ref.json'], input: { file: 'ref.json', json: { sha: '{commit}', force: true } }, optional: true, capture: () => ({ refUpdated: '1' }) },
        { label: 'Creating the gh-pages branch', bin: 'gh', args: ['api', '-X', 'POST', 'repos/{owner}/' + name + '/git/refs', '--input', 'newref.json'], input: { file: 'newref.json', json: { ref: 'refs/heads/gh-pages', sha: '{commit}' } }, optional: true },
        { label: 'Turning on GitHub Pages', bin: 'gh', args: ['api', '-X', 'POST', 'repos/{owner}/' + name + '/pages', '--input', 'pages.json'], input: { file: 'pages.json', json: { source: { branch: 'gh-pages', path: '/' } } }, optional: true },
      );
      return steps;
    }
  }
}

/**
 * Replace `{var}` / `{a|b}` placeholders in a step's arguments and JSON
 * input with captured values (`a`, else the request's `b`). Values are
 * whole arguments — never shell-interpreted.
 */
export function substitute<T>(value: T, vars: Record<string, string>, req: DeployRequest): T {
  const one = (s: string): string =>
    s.replace(/\{([a-z0-9]+)(?:\|([a-z]+))?\}/gi, (m, a: string, b?: string) => {
      if (vars[a] !== undefined) return vars[a] as string;
      if (b === 'name' && req.name) return req.name;
      return m;
    });
  if (typeof value === 'string') return one(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => substitute(v, vars, req)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = substitute(v, vars, req);
    return out as T;
  }
  return value;
}
