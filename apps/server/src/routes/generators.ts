/**
 * `GET/PUT /api/generators/:hash` — content-addressed cache of validated
 * generator defs, shared between sessions so a generator written once by the
 * coding model can be reused without another LLM call.
 *
 * The address is `sha256hex(stableStringify(GeneratorDef.parse(def)))`: the
 * hash of the canonical JSON of the *normalized* def (defaults applied,
 * unknown nested keys stripped). The server recomputes it and rejects any
 * mismatch, so a key can never point at different content.
 */
import { createHash } from 'node:crypto';
import type { Hono } from 'hono';
import { GeneratorDef, stableStringify } from '@aether/core';
import type { AppEnv } from '../app-env';
import type { JsonFileStore } from '../file-store';
import { StoreError } from '../file-store';
import type { GeneratorValidator } from '../generator-validation';
import { fail, readJsonBody, zodToIssues } from '../http';
import type { Logger } from '../logger';

/** Content hashes are lowercase SHA-256 hex digests. */
export const GENERATOR_HASH_RE = /^[0-9a-f]{64}$/;

/** Strict top-level shape: unknown keys are rejected rather than silently dropped. */
const StrictGeneratorDef = GeneratorDef.strict();

/** Compute the content address of a normalized generator def. */
export function generatorHash(def: GeneratorDef): string {
  return createHash('sha256').update(stableStringify(def), 'utf8').digest('hex');
}

/** Dependencies of the generator routes. */
export interface GeneratorRouteDeps {
  store: JsonFileStore;
  /** Optional execution check (sandbox dry run); `null` skips it. */
  validator: GeneratorValidator | null;
  logger: Logger;
}

/** Register the generator cache routes on `app`. */
export function registerGeneratorRoutes(app: Hono<AppEnv>, deps: GeneratorRouteDeps): void {
  app.get('/api/generators/:hash', async (c) => {
    const hash = c.req.param('hash');
    if (!GENERATOR_HASH_RE.test(hash)) return fail(c, 400, 'invalid-hash', 'Generator hash must be 64 lowercase hex characters.');
    const stored = await deps.store.get(hash);
    if (stored === undefined) return fail(c, 404, 'not-found', 'No generator with this hash.');
    const parsed = GeneratorDef.safeParse(stored);
    if (!parsed.success || generatorHash(parsed.data) !== hash) {
      deps.logger.error('corrupt generator in store', { reqId: c.get('requestId'), hash });
      return fail(c, 404, 'not-found', 'No generator with this hash.');
    }
    c.header('Cache-Control', 'public, max-age=31536000, immutable');
    return c.json(parsed.data, 200);
  });

  app.put('/api/generators/:hash', async (c) => {
    const hash = c.req.param('hash');
    if (!GENERATOR_HASH_RE.test(hash)) return fail(c, 400, 'invalid-hash', 'Generator hash must be 64 lowercase hex characters.');
    const body = await readJsonBody(c, { maxDepth: 16, maxNodes: 20_000 });
    if (!body.ok) return body.response;
    const parsed = StrictGeneratorDef.safeParse(body.value);
    if (!parsed.success) return fail(c, 400, 'invalid-generator', 'The generator definition is invalid.', zodToIssues(parsed.error.issues));
    const def: GeneratorDef = parsed.data;
    const actual = generatorHash(def);
    if (actual !== hash) {
      return fail(c, 400, 'hash-mismatch', `Hash does not match content (expected ${actual}).`);
    }
    if (await deps.store.has(hash)) return c.json({ hash, created: false }, 200);

    if (deps.validator) {
      const check = await deps.validator(def);
      if (!check.ok && check.unavailable) {
        c.header('Retry-After', '5');
        return fail(c, 503, 'validator-busy', 'Generator validation is busy. Please retry shortly.');
      }
      if (!check.ok) return fail(c, 422, 'generator-failed', 'The generator did not run successfully.', [{ path: 'source', message: check.error }]);
    }
    try {
      await deps.store.put(hash, def, true);
    } catch (err) {
      if (err instanceof StoreError && err.code === 'store-full') return fail(c, 507, 'storage-full', 'The generator cache is full.');
      if (err instanceof StoreError && err.code === 'too-large') return fail(c, 413, 'payload-too-large', 'The generator is too large.');
      throw err;
    }
    return c.json({ hash, created: true }, 201);
  });
}
