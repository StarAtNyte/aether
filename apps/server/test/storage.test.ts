import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createWorld, GeneratorDef } from '@aether/core';
import { loadSandboxValidator } from '../src/generator-validation';
import { silentLogger } from '../src/logger';
import { generatorHash } from '../src/routes/generators';
import { randomWorldId, WORLD_ID_RE } from '../src/routes/worlds';
import { cleanupDirs, jsonInit, makeApp, makeConfig } from './helpers';

afterAll(cleanupDirs);

const BOX_SOURCE = "const b = api.box(1, 1, 1); api.add(b, { color: '#ff8800' }); return api.build();";

function sampleDef(source = BOX_SOURCE): GeneratorDef {
  return GeneratorDef.parse({ id: 'test-box', description: 'A box', params: {}, source });
}

describe('generators cache', () => {
  it('round-trips a def under its content hash', async () => {
    const app = makeApp(makeConfig());
    const def = sampleDef();
    const hash = generatorHash(def);
    const put = await app.request(`/api/generators/${hash}`, jsonInit('PUT', def));
    expect(put.status).toBe(201);
    expect(await put.json()).toEqual({ hash, created: true });
    const get = await app.request(`/api/generators/${hash}`);
    expect(get.status).toBe(200);
    expect(get.headers.get('cache-control')).toContain('immutable');
    expect(await get.json()).toEqual(def);
    // Idempotent re-upload.
    const again = await app.request(`/api/generators/${hash}`, jsonInit('PUT', def));
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ hash, created: false });
  });

  it('hashes the normalized def (defaults applied, key order irrelevant)', async () => {
    const app = makeApp(makeConfig());
    const hash = generatorHash(sampleDef());
    const reordered = { source: BOX_SOURCE, description: 'A box', id: 'test-box' }; // params omitted → default {}
    expect((await app.request(`/api/generators/${hash}`, jsonInit('PUT', reordered))).status).toBe(201);
  });

  it('rejects a hash mismatch', async () => {
    const app = makeApp(makeConfig());
    const def = sampleDef();
    const wrong = 'f'.repeat(64);
    const res = await app.request(`/api/generators/${wrong}`, jsonInit('PUT', def));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('hash-mismatch');
    expect(body.message).toContain(generatorHash(def));
    expect((await app.request(`/api/generators/${wrong}`)).status).toBe(404);
  });

  it('rejects invalid hashes and traversal attempts', async () => {
    const app = makeApp(makeConfig());
    for (const h of ['abc', 'G'.repeat(64), 'A'.repeat(64), '..%2F..%2Fetc%2Fpasswd', `${'a'.repeat(63)}%2F`]) {
      const res = await app.request(`/api/generators/${h}`);
      expect([400, 404]).toContain(res.status);
      expect((await res.json()) as object).toHaveProperty('error');
    }
  });

  it('rejects invalid defs and unknown keys', async () => {
    const app = makeApp(makeConfig());
    for (const bad of [{ id: 'Bad Id', description: '', source: 'x' }, { ...sampleDef(), extra: 1 }, { id: 'x1', description: '', source: '' }]) {
      const res = await app.request(`/api/generators/${'0'.repeat(64)}`, jsonInit('PUT', bad));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'invalid-generator' });
    }
  });

  it('rejects oversize bodies with 413', async () => {
    const app = makeApp(makeConfig());
    const res = await app.request(`/api/generators/${'0'.repeat(64)}`, jsonInit('PUT', { id: 'big', description: 'x'.repeat(300_000), source: 'x' }));
    expect(res.status).toBe(413);
  });

  it('caps the number of stored generators', async () => {
    const app = makeApp(makeConfig({ AETHER_MAX_GENERATORS: '1' }));
    const a = sampleDef();
    const b = sampleDef(`${BOX_SOURCE} // b`);
    expect((await app.request(`/api/generators/${generatorHash(a)}`, jsonInit('PUT', a))).status).toBe(201);
    const res = await app.request(`/api/generators/${generatorHash(b)}`, jsonInit('PUT', b));
    expect(res.status).toBe(507);
  });

  it('runs the injected validator and rejects failing generators', async () => {
    const app = makeApp(makeConfig(), { generatorValidator: async () => ({ ok: false, error: 'boom' }) });
    const def = sampleDef();
    const res = await app.request(`/api/generators/${generatorHash(def)}`, jsonInit('PUT', def));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: 'generator-failed', issues: [{ path: 'source', message: 'boom' }] });
    expect((await app.request(`/api/generators/${generatorHash(def)}`)).status).toBe(404);
  });

  it('validates with the real procgen node sandbox when available', async () => {
    const validator = await loadSandboxValidator(silentLogger, 1000);
    expect(validator).not.toBeNull();
    if (!validator) return;
    expect(await validator(sampleDef())).toEqual({ ok: true });
    const evil = await validator(sampleDef("return require('fs').readFileSync('/etc/passwd', 'utf8');"));
    expect(evil.ok).toBe(false);
    const loop = await validator(sampleDef('while (true) {}'));
    expect(loop.ok).toBe(false);
    // The worker survives (or is respawned after) a failing run.
    expect(await validator(sampleDef())).toEqual({ ok: true });
    await validator.dispose();
  });

  it('kills a generator that exhausts the worker heap without affecting the server', async () => {
    const validator = await loadSandboxValidator(silentLogger, 4000, {
      resourceLimits: { maxOldGenerationSizeMb: 48, maxYoungGenerationSizeMb: 8 },
    });
    expect(validator).not.toBeNull();
    if (!validator) return;
    const hog = await validator(sampleDef('const a = []; for (;;) a.push(new Array(1e5).fill(1));'));
    expect(hog.ok).toBe(false);
    expect(await validator(sampleDef())).toEqual({ ok: true });
    await validator.dispose();
  });

  it('refuses with 503 when the validator reports it is unavailable', async () => {
    const app = makeApp(makeConfig(), { generatorValidator: async () => ({ ok: false, error: 'busy', unavailable: true }) });
    const def = sampleDef();
    const res = await app.request(`/api/generators/${generatorHash(def)}`, jsonInit('PUT', def));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'validator-busy' });
  });

  it('applies a stricter per-client limit to generator uploads', async () => {
    const app = makeApp(makeConfig({ RATE_LIMIT_GENERATOR_PUT_BURST: '2', RATE_LIMIT_GENERATOR_PUT_PER_MIN: '1' }));
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) {
      const def = sampleDef(`return api.build(); // ${i}`);
      statuses.push((await app.request(`/api/generators/${generatorHash(def)}`, jsonInit('PUT', def))).status);
    }
    expect(statuses).toEqual([201, 201, 429]);
  });

  it('treats tampered files on disk as missing', async () => {
    const config = makeConfig();
    const app = makeApp(config);
    const def = sampleDef();
    const hash = generatorHash(def);
    await app.request(`/api/generators/${hash}`, jsonInit('PUT', def));
    const file = join(config.dataDir, 'generators', `${hash}.json`);
    const { writeFileSync } = await import('node:fs');
    writeFileSync(file, JSON.stringify({ ...def, source: 'return 1;' }));
    expect((await app.request(`/api/generators/${hash}`)).status).toBe(404);
  });
});

describe('worlds share links', () => {
  const world = createWorld({ name: 'Test world' });

  it('creates with a random id and reads it back', async () => {
    const config = makeConfig();
    const app = makeApp(config);
    const res = await app.request('/api/worlds', jsonInit('PUT', world));
    expect(res.status).toBe(201);
    const { id, editToken } = (await res.json()) as { id: string; editToken: string };
    expect(id).toMatch(WORLD_ID_RE);
    expect(editToken.length).toBeGreaterThanOrEqual(32);
    expect(res.headers.get('location')).toBe(`/api/worlds/${id}`);
    const get = await app.request(`/api/worlds/${id}`);
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual(world);
    // The edit token itself is never stored, only its hash.
    const raw = readFileSync(join(config.dataDir, 'worlds', `${id}.json`), 'utf8');
    expect(raw).not.toContain(editToken);
    // No temp files left behind.
    expect(readdirSync(join(config.dataDir, 'worlds')).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  it('also accepts POST for creation and yields distinct ids', async () => {
    const app = makeApp(makeConfig());
    const a = (await (await app.request('/api/worlds', jsonInit('POST', world))).json()) as { id: string };
    const b = (await (await app.request('/api/worlds', jsonInit('POST', world))).json()) as { id: string };
    expect(a.id).not.toBe(b.id);
  });

  it('updates only with the edit token', async () => {
    const app = makeApp(makeConfig());
    const { id, editToken } = (await (await app.request('/api/worlds', jsonInit('PUT', world))).json()) as { id: string; editToken: string };
    const changed = { ...world, name: 'Changed' };
    expect((await app.request(`/api/worlds/${id}`, jsonInit('PUT', changed))).status).toBe(403);
    expect((await app.request(`/api/worlds/${id}`, jsonInit('PUT', changed, { 'X-Edit-Token': 'wrong' }))).status).toBe(403);
    expect((await app.request(`/api/worlds/${id}`, jsonInit('PUT', changed, { 'X-Edit-Token': editToken }))).status).toBe(200);
    expect(((await (await app.request(`/api/worlds/${id}`)).json()) as typeof world).name).toBe('Changed');
  });

  it('rejects invalid worlds', async () => {
    const app = makeApp(makeConfig());
    const bad = await app.request('/api/worlds', jsonInit('PUT', { version: 999, entities: 'nope' }));
    expect(bad.status).toBe(400);
    const body = (await bad.json()) as { error: string; issues: unknown[] };
    expect(body.error).toBe('invalid-world');
    expect(body.issues.length).toBeGreaterThan(0);
    const polluted = await app.request('/api/worlds', jsonInit('PUT', '{"__proto__":{"admin":true}}'));
    expect(polluted.status).toBe(400);
  });

  it('rejects worlds above 2 MB', async () => {
    const app = makeApp(makeConfig());
    const res = await app.request('/api/worlds', jsonInit('PUT', { ...world, padding: 'x'.repeat(2_200_000) }));
    expect(res.status).toBe(413);
  });

  it('rejects malformed and path-traversal ids', async () => {
    const config = makeConfig();
    const app = makeApp(config);
    for (const id of ['short', '..', '..%2F..%2Fpackage', 'abcdefghijk!', 'abcdefghijklm', '%2e%2e%2fsecrets00', 'abc%00defghij']) {
      const res = await app.request(`/api/worlds/${id}`);
      expect([400, 404]).toContain(res.status);
    }
    expect((await app.request('/api/worlds/AAAAAAAAAAAA')).status).toBe(404);
    expect(existsSync(join(config.dataDir, 'package.json'))).toBe(false);
  });

  it('caps the number of stored worlds', async () => {
    const app = makeApp(makeConfig({ AETHER_MAX_WORLDS: '2' }));
    expect((await app.request('/api/worlds', jsonInit('PUT', world))).status).toBe(201);
    expect((await app.request('/api/worlds', jsonInit('PUT', world))).status).toBe(201);
    expect((await app.request('/api/worlds', jsonInit('PUT', world))).status).toBe(507);
  });
});

describe('randomWorldId', () => {
  it('produces 12-char base62 ids with no obvious collisions', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const id = randomWorldId();
      expect(id).toMatch(WORLD_ID_RE);
      seen.add(id);
    }
    expect(seen.size).toBe(2000);
  });
});
