/**
 * Studio client of the local app's publishing API: the local library of
 * builds, deploys to the user's own hosting through their signed-in CLIs,
 * and LAN sharing. Two transports reach the same services:
 *
 * - `local`: the studio served by the local app (`/api/local/publish/*`,
 *   same origin, session cookie; see `apps/server/src/routes/publish.ts`);
 * - `bridge`: a hosted copy of the studio paired with the local app's bridge
 *   (`http://127.0.0.1:<port>/v1/publish/*`, bearer pairing token).
 *
 * The hosted static site itself has no server and never deploys anything.
 * Every response is validated.
 */
import { z } from 'zod';

const Target = z.object({
  id: z.enum(['netlify', 'vercel', 'github', 'itch']),
  label: z.string().max(40),
  bin: z.string().max(20),
  installed: z.boolean(),
  signedIn: z.boolean(),
  account: z.string().max(100).optional(),
  hint: z.string().max(200).optional(),
});
export type HostTarget = z.infer<typeof Target>;
export type HostId = HostTarget['id'];

const DeployEvent = z.object({ seq: z.number().int(), at: z.number(), kind: z.enum(['step', 'log', 'done', 'error']), text: z.string().max(500), url: z.string().max(500).optional() });
export type DeployEvent = z.infer<typeof DeployEvent>;

const Job = z.object({
  id: z.string().regex(/^[a-z0-9]{12}$/),
  state: z.enum(['running', 'done', 'error', 'cancelled']),
  step: z.number().int(),
  steps: z.number().int(),
  url: z.string().max(500).nullable(),
  error: z.string().max(500).nullable(),
  events: z.array(DeployEvent).max(1000),
});
export type DeployJob = z.infer<typeof Job>;

const Lan = z.object({ on: z.boolean(), build: z.string().nullable(), urls: z.array(z.string().max(300)).max(32), until: z.number().nullable() });
export type LanState = z.infer<typeof Lan>;

const Build = z.object({ id: z.string().regex(/^[a-z0-9]{12}$/), title: z.string().max(120), createdAt: z.number(), bytes: z.number(), files: z.number() });
export type LibraryBuild = z.infer<typeof Build>;

/** Public URLs a deploy may report (anything else is not shown as a link). */
export function isPublicHostUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && /(\.netlify\.app|\.vercel\.app|\.github\.io|\.itch\.io)$/i.test(u.hostname);
  } catch {
    return false;
  }
}

/** How publishing requests reach the local app. */
export type PublishTransport = { kind: 'local' } | { kind: 'bridge'; url: string; token: string };

const LOCAL: PublishTransport = { kind: 'local' };

/** URL and request options of a publishing endpoint (`path` relative to the publish root). */
export function endpoint(t: PublishTransport, path: string, init: RequestInit = {}): { url: string; init: RequestInit } {
  if (t.kind === 'local') return { url: `/api/local/publish${path}`, init: { ...init, credentials: 'same-origin' } };
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${t.token}`);
  return { url: `${t.url.replace(/\/+$/, '')}/v1/publish${path}`, init: { ...init, headers, mode: 'cors', credentials: 'omit' } };
}

/** The error message of a server (`{ message }`) or bridge (`{ error: { message } }`) answer. */
function errorText(body: unknown, status: number): string {
  if (typeof body === 'object' && body !== null) {
    const b = body as { message?: unknown; error?: unknown };
    if (typeof b.message === 'string') return b.message;
    if (typeof b.error === 'object' && b.error !== null && typeof (b.error as { message?: unknown }).message === 'string') return (b.error as { message: string }).message;
  }
  return `The local app answered ${status}.`;
}

async function call<T>(path: string, schema: z.ZodType<T>, init: RequestInit = {}, timeoutMs = 30_000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const outer = init.signal;
  const onAbort = (): void => ctrl.abort();
  outer?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch(path, { credentials: 'same-origin', ...init, signal: ctrl.signal });
    const body = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) throw new Error(errorText(body, res.status).slice(0, 300));
    return schema.parse(body);
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', onAbort);
  }
}

/** True when this studio runs in the local app (publishing to hosting and LAN sharing are possible). */
export async function localPublishing(): Promise<boolean> {
  try {
    const r = await call('/api/health', z.object({ local: z.boolean().optional() }).passthrough(), {}, 4000);
    return r.local === true;
  } catch {
    return false;
  }
}

/** Hosting targets and whether their CLIs are signed in. */
export async function hostTargets(fresh = false, t: PublishTransport = LOCAL): Promise<HostTarget[]> {
  const e = endpoint(t, `/targets${fresh ? '?fresh=1' : ''}`);
  return (await call(e.url, z.object({ targets: z.array(Target).max(8) }), e.init, 60_000)).targets;
}

/** Add a build zip to the local library (`url`: its page on the local app, null through the bridge). */
export async function uploadBuild(zip: Uint8Array, signal?: AbortSignal, t: PublishTransport = LOCAL): Promise<{ id: string; url: string | null }> {
  const e = endpoint(t, '/builds', { method: 'POST', headers: { 'content-type': 'application/zip' }, body: zip as Uint8Array<ArrayBuffer>, ...(signal ? { signal } : {}) });
  const r = await call(e.url, z.object({ build: Build, url: z.string().regex(/^\/published\/[a-z0-9]{12}\/$/).nullable() }), e.init, 10 * 60_000);
  return { id: r.build.id, url: r.url };
}

/** The builds in the local library. */
export async function libraryBuilds(t: PublishTransport = LOCAL): Promise<LibraryBuild[]> {
  const e = endpoint(t, '/builds');
  return (await call(e.url, z.object({ builds: z.array(Build).max(1000) }), e.init)).builds;
}

/** Start a deploy. */
export async function startDeploy(req: { build: string; target: HostId; name?: string; itch?: string }, t: PublishTransport = LOCAL): Promise<DeployJob> {
  const e = endpoint(t, '/deploy', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req) });
  return (await call(e.url, z.object({ job: Job }), e.init)).job;
}

/** Cancel a running deploy. */
export async function cancelDeploy(id: string, t: PublishTransport = LOCAL): Promise<void> {
  const e = endpoint(t, `/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' });
  await call(e.url, z.object({ ok: z.literal(true) }), e.init).catch(() => undefined);
}

/** Follow a deploy until it ends, reporting each new event. */
export async function followDeploy(id: string, onEvent: (e: DeployEvent, job: DeployJob) => void, signal?: AbortSignal, t: PublishTransport = LOCAL): Promise<DeployJob> {
  let seen = 0;
  for (;;) {
    const e = endpoint(t, `/jobs/${encodeURIComponent(id)}`, signal ? { signal } : {});
    const job = (await call(e.url, z.object({ job: Job }), e.init)).job;
    for (const ev of job.events) {
      if (ev.seq > seen) {
        seen = ev.seq;
        onEvent(ev, job);
      }
    }
    if (job.state !== 'running') return job;
    if (signal?.aborted) throw new DOMException('cancelled', 'AbortError');
    await new Promise((r) => setTimeout(r, 500));
  }
}

/** LAN share status. */
export async function lanStatus(t: PublishTransport = LOCAL): Promise<LanState> {
  const e = endpoint(t, '/lan');
  return call(e.url, Lan, e.init);
}

/** Turn LAN sharing of `build` on, or off. */
export async function setLan(on: boolean, build?: string, t: PublishTransport = LOCAL): Promise<LanState> {
  const e = endpoint(t, '/lan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(on ? { on, build } : { on }) });
  return call(e.url, Lan, e.init);
}

/** A site / repository name from a title ("Coin Island!" → "coin-island"). */
export function siteSlug(title: string): string {
  const s = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/, '');
  return s || 'aether-game';
}
