/**
 * Which model answers `create_world` and `edit`.
 *
 *  - `offline`: the built-in offline planner (no model, no network): fast,
 *    deterministic, covers the template library and the common prompts.
 *  - `local`:   the Aether server running on this computer (`aether start`),
 *    which uses the user's own Codex / Claude Code login. Only loopback
 *    URLs are ever contacted.
 *  - `auto`:    `local` when that server is running and a backend is signed
 *    in, otherwise `offline`.
 */
import { createLocalAiApi, createLocalProvider, createMockProvider } from '@aether/agent';
import { GENERATOR_LIBRARY } from '@aether/procgen';
import { ToolError } from './errors';
import { inspect } from '../server';
import { readSecret, statePaths } from '../state';
import { ADMIN_HEADER } from '../system';
/** The offline planner. */
export function offlineProvider() {
    return { provider: createMockProvider({ library: GENERATOR_LIBRARY }), kind: 'offline', label: 'offline planner' };
}
/**
 * A `fetch` that only talks to `http://127.0.0.1:<port>/api/local/…` and
 * proves itself with the install secret. Anything else is refused: the MCP
 * server never reaches the internet.
 */
export function loopbackFetch(port, secret, inner = fetch) {
    const prefix = `http://127.0.0.1:${port}/api/local/`;
    return (async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (!url.startsWith(prefix))
            throw new ToolError('unavailable', 'Only the local Aether server may be contacted.');
        const headers = new Headers(init?.headers);
        headers.set(ADMIN_HEADER, secret);
        return inner(input, { ...init, headers, redirect: 'error' });
    });
}
/** Resolve the provider for one request (re-checked each time: logging in later just works). */
export async function resolveProvider(mode, env) {
    if (mode === 'offline')
        return offlineProvider();
    const unavailable = (why) => {
        if (mode === 'local')
            throw new ToolError('unavailable', `${why} Start it with "aether start" and sign in with "aether login", or run the MCP server with --provider offline.`);
        return offlineProvider();
    };
    const paths = statePaths(env.stateDir);
    let found;
    try {
        found = await inspect(paths);
    }
    catch {
        found = null;
    }
    if (found?.state !== 'running')
        return unavailable('The local Aether server is not running.');
    const secret = readSecret(paths.secret);
    if (!secret)
        return unavailable('The local Aether server has no session secret.');
    const doFetch = loopbackFetch(found.rec.port, secret, env.fetch);
    const base = `http://127.0.0.1:${found.rec.port}/api/local`;
    try {
        const status = await createLocalAiApi({ base, fetch: doFetch }).status(AbortSignal.timeout(8_000));
        const backend = status.backends.find((b) => b.loggedIn && b.id === 'codex') ?? status.backends.find((b) => b.loggedIn);
        if (!backend)
            return unavailable('No AI account is signed in on this computer.');
        return { provider: createLocalProvider({ backend: backend.id, base, fetch: doFetch }), kind: 'local', label: `local ${backend.id}` };
    }
    catch {
        return unavailable('The local Aether server did not answer.');
    }
}
