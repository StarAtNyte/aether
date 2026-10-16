/**
 * Lazy loading of a bundled default project's files: the saved world JSON
 * (only when the template is opened) and its thumbnail (stored with the new
 * project). Both are static files of this site, yet treated as untrusted
 * input: the slug must match the manifest pattern, responses are size-capped
 * and time-limited, the world is parsed and validated like an import, and
 * the thumbnail must be a WebP image within the thumbnail budget.
 */
import { MAX_IMPORT_BYTES } from '../config';
import { templateThumbnail, templateWorldUrl } from '../lib/examples';
import { parseWorldImport } from '../lib/worldIO';
import { MAX_THUMBNAIL_BYTES } from '../projects/model';
/** Template slugs: lowercase words joined by dashes, at most 64 characters. */
const SLUG = /^(?=.{1,64}$)[a-z0-9]+(?:-[a-z0-9]+){0,7}$/;
/** Longest wait for a template file. */
export const TEMPLATE_FETCH_TIMEOUT_MS = 20_000;
/** Fetch `url` under `signal`; refuses non-OK responses and declared sizes over `maxBytes`. */
async function fetchCapped(url, maxBytes, accept, fetchImpl, signal) {
    try {
        const res = await fetchImpl(url, { signal, headers: { accept } });
        if (!res.ok)
            return { ok: false, error: `The template is unavailable (HTTP ${res.status}).` };
        const declared = Number(res.headers.get('content-length') ?? '0');
        if (Number.isFinite(declared) && declared > maxBytes)
            return { ok: false, error: 'The template file is too large.' };
        return { ok: true, res };
    }
    catch (err) {
        return { ok: false, error: signal.aborted ? 'The template took too long to load.' : `The template could not be loaded (${err instanceof Error ? err.message.slice(0, 120) : 'network error'}).` };
    }
}
/** Run `task` with an abort signal that fires after `timeoutMs` (covers the request and the body read). */
async function withDeadline(timeoutMs, task) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        return await task(ctrl.signal);
    }
    finally {
        clearTimeout(timer);
    }
}
/**
 * Read a response body, refusing more than `maxBytes` even when the server
 * sent no (or a wrong) content-length: the stream is cancelled at the cap.
 */
export async function readCapped(res, maxBytes) {
    const body = res.body;
    if (!body) {
        const buf = new Uint8Array(await res.arrayBuffer());
        return buf.length > maxBytes ? null : buf;
    }
    const reader = body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done)
            break;
        total += value.length;
        if (total > maxBytes) {
            await reader.cancel().catch(() => undefined);
            return null;
        }
        chunks.push(value);
    }
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) {
        out.set(c, o);
        o += c.length;
    }
    return out;
}
/**
 * Fetch and validate a template's saved world. Never throws: failures
 * (unknown slug, network, timeout, oversize, invalid JSON or world) come
 * back as `{ ok: false, error }` so the caller can fall back to building the
 * world from its prompt.
 */
export async function loadTemplateWorld(slug, fetchImpl = (u, i) => fetch(u, i), timeoutMs = TEMPLATE_FETCH_TIMEOUT_MS) {
    if (typeof slug !== 'string' || !SLUG.test(slug))
        return { ok: false, error: 'Unknown template.' };
    return withDeadline(timeoutMs, async (signal) => {
        const got = await fetchCapped(templateWorldUrl(slug), MAX_IMPORT_BYTES, 'application/json', fetchImpl, signal);
        if (!got.ok)
            return got;
        let bytes;
        try {
            bytes = await readCapped(got.res, MAX_IMPORT_BYTES);
        }
        catch {
            return { ok: false, error: signal.aborted ? 'The template took too long to load.' : 'The template could not be read.' };
        }
        if (!bytes)
            return { ok: false, error: 'The template file is too large.' };
        return parseWorldImport(new TextDecoder().decode(bytes), MAX_IMPORT_BYTES);
    });
}
/** WebP files start with "RIFF....WEBP". */
function isWebp(bytes) {
    const tag = (o, s) => [...s].every((c, i) => bytes[o + i] === c.charCodeAt(0));
    return bytes.length >= 12 && tag(0, 'RIFF') && tag(8, 'WEBP');
}
/** Fetch a template's thumbnail as a WebP blob for the new project, or null (never throws). */
export async function loadTemplateThumbnail(slug, fetchImpl = (u, i) => fetch(u, i), timeoutMs = TEMPLATE_FETCH_TIMEOUT_MS) {
    if (typeof slug !== 'string' || !SLUG.test(slug))
        return null;
    return withDeadline(timeoutMs, async (signal) => {
        const got = await fetchCapped(templateThumbnail(slug), MAX_THUMBNAIL_BYTES, 'image/webp', fetchImpl, signal);
        if (!got.ok)
            return null;
        try {
            const bytes = await readCapped(got.res, MAX_THUMBNAIL_BYTES);
            if (!bytes || bytes.length === 0 || !isWebp(bytes))
                return null;
            return new Blob([bytes], { type: 'image/webp' });
        }
        catch {
            return null;
        }
    });
}
