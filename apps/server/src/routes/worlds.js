/**
 * World share links.
 *
 * - `PUT /api/worlds` (or `POST`) stores a validated `WorldDoc` under a fresh
 *   server-generated 12-character base62 id and returns `{ id, editToken }`.
 * - `GET /api/worlds/:id` returns the stored world.
 * - `PUT /api/worlds/:id` replaces it, but only with the matching
 *   `X-Edit-Token` returned at creation, so anyone holding a share link can
 *   view a world but not overwrite it. Only the token's SHA-256 is stored.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { validateWorld } from '@aether/core';
import { StoreError } from '../file-store';
import { fail, readJsonBody } from '../http';
/** World ids: exactly 12 base62 characters. */
export const WORLD_ID_RE = /^[0-9A-Za-z]{12}$/;
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
/** Largest multiple of 62 below 256: bytes ≥ this are rejected to avoid modulo bias. */
const UNBIASED_LIMIT = 248;
const ID_LENGTH = 12;
const MAX_ID_ATTEMPTS = 5;
/** Generate a cryptographically random, unbiased base62 id. */
export function randomWorldId() {
    let out = '';
    while (out.length < ID_LENGTH) {
        for (const byte of randomBytes(ID_LENGTH * 2)) {
            if (byte >= UNBIASED_LIMIT)
                continue;
            out += BASE62[byte % 62];
            if (out.length === ID_LENGTH)
                break;
        }
    }
    return out;
}
function sha256(text) {
    return createHash('sha256').update(text, 'utf8').digest();
}
function asRecord(value) {
    if (typeof value !== 'object' || value === null)
        return null;
    const r = value;
    if (r.v !== 1 || typeof r.editTokenSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(r.editTokenSha256))
        return null;
    if (typeof r.world !== 'object' || r.world === null)
        return null;
    return r;
}
/** Register the world share-link routes on `app`. */
export function registerWorldRoutes(app, deps) {
    const readWorld = async (c) => {
        const body = await readJsonBody(c);
        if (!body.ok)
            return body;
        const result = validateWorld(body.value);
        if (!result.ok)
            return { ok: false, response: fail(c, 400, 'invalid-world', 'The world document is invalid.', result.issues) };
        if (Buffer.byteLength(JSON.stringify(result.world), 'utf8') > deps.maxWorldBytes) {
            return { ok: false, response: fail(c, 413, 'payload-too-large', `World exceeds ${deps.maxWorldBytes} bytes.`) };
        }
        return { ok: true, world: result.world };
    };
    const storeFailure = (c, err) => {
        if (err instanceof StoreError && err.code === 'store-full')
            return fail(c, 507, 'storage-full', 'World storage is full.');
        if (err instanceof StoreError && err.code === 'too-large')
            return fail(c, 413, 'payload-too-large', 'The world is too large.');
        throw err;
    };
    const create = async (c) => {
        const parsed = await readWorld(c);
        if (!parsed.ok)
            return parsed.response;
        let id = '';
        for (let attempt = 0; attempt < MAX_ID_ATTEMPTS && id === ''; attempt++) {
            const candidate = randomWorldId();
            if (!(await deps.store.has(candidate)))
                id = candidate;
        }
        if (id === '')
            return fail(c, 503, 'id-exhausted', 'Could not allocate a world id. Please retry.');
        const editToken = randomBytes(24).toString('base64url');
        const record = { v: 1, editTokenSha256: sha256(editToken).toString('hex'), world: parsed.world };
        try {
            await deps.store.put(id, record, true);
        }
        catch (err) {
            return storeFailure(c, err);
        }
        c.header('Location', `/api/worlds/${id}`);
        return c.json({ id, editToken }, 201);
    };
    app.put('/api/worlds', create);
    app.post('/api/worlds', create);
    app.get('/api/worlds/:id', async (c) => {
        const id = c.req.param('id');
        if (!WORLD_ID_RE.test(id))
            return fail(c, 400, 'invalid-id', 'World ids are 12 base62 characters.');
        const record = asRecord(await deps.store.get(id));
        if (!record)
            return fail(c, 404, 'not-found', 'No world with this id.');
        c.header('Cache-Control', 'no-cache');
        return c.json(record.world, 200);
    });
    app.put('/api/worlds/:id', async (c) => {
        const id = c.req.param('id');
        if (!WORLD_ID_RE.test(id))
            return fail(c, 400, 'invalid-id', 'World ids are 12 base62 characters.');
        const token = c.req.header('x-edit-token') ?? '';
        const record = asRecord(await deps.store.get(id));
        if (!record)
            return fail(c, 404, 'not-found', 'No world with this id.');
        const expected = Buffer.from(record.editTokenSha256, 'hex');
        if (token.length === 0 || token.length > 128 || !timingSafeEqual(sha256(token), expected)) {
            return fail(c, 403, 'forbidden', 'A valid X-Edit-Token header is required to update this world.');
        }
        const parsed = await readWorld(c);
        if (!parsed.ok)
            return parsed.response;
        try {
            await deps.store.put(id, { ...record, world: parsed.world }, false);
        }
        catch (err) {
            return storeFailure(c, err);
        }
        return c.json({ id }, 200);
    });
}
