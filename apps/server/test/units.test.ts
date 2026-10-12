import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { pickForwardedIp } from '../src/client-ip';
import { ConfigError, loadConfig, redactConfig } from '../src/config';
import { loadEnvFile, MAX_ENV_FILE_BYTES, parseEnvFile } from '../src/env-file';
import { JsonFileStore, StoreError } from '../src/file-store';
import { planProviders } from '../src/llm/provider-plan';
import { createLogger, scrub } from '../src/logger';
import { TokenBucketLimiter } from '../src/rate-limit';
import { DailyTokenBudget } from '../src/token-budget';

const tmp = mkdtempSync(join(tmpdir(), 'aether-server-units-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('parseEnvFile', () => {
  it('parses common dotenv syntax without evaluation', () => {
    const env = parseEnvFile(
      [
        '# comment',
        'A=1',
        'export B = two ',
        'C="line\\nbreak" # trailing',
        "D='$HOME literal'",
        'E=value # comment',
        'F=',
        'not a line',
        '1BAD=x',
        '__proto__=polluted',
        'constructor=x',
      ].join('\n'),
    );
    expect({ ...env }).toEqual({ A: '1', B: 'two', C: 'line\nbreak', D: '$HOME literal', E: 'value', F: '' });
    expect(Object.getPrototypeOf(env)).toBeNull();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('handles CRLF, BOM and unterminated quotes', () => {
    expect({ ...parseEnvFile('﻿X=1\r\nY="open') }).toEqual({ X: '1', Y: 'open' });
  });
});

describe('loadEnvFile', () => {
  it('never overrides existing variables', () => {
    const file = join(tmp, '.env');
    writeFileSync(file, 'KEEP=file\nNEW=file\n');
    const target: Record<string, string | undefined> = { KEEP: 'process' };
    expect(loadEnvFile(file, target)).toEqual(['NEW']);
    expect(target).toEqual({ KEEP: 'process', NEW: 'file' });
  });

  it('ignores missing files and refuses huge ones', () => {
    expect(loadEnvFile(join(tmp, 'missing.env'), {})).toEqual([]);
    const big = join(tmp, 'big.env');
    writeFileSync(big, 'X='.padEnd(MAX_ENV_FILE_BYTES + 10, 'a'));
    expect(() => loadEnvFile(big, {})).toThrow(/too large/);
  });
});

describe('loadConfig', () => {
  it('has safe defaults (mock-capable, localhost CORS, 1 MB LLM body, 90 s timeout)', () => {
    const c = loadConfig({});
    expect(c.port).toBe(8787);
    expect(c.allowedOrigins).toEqual(['http://localhost:5173']);
    expect(c.llm.maxBodyBytes).toBe(1024 * 1024);
    expect(c.llm.timeoutMs).toBe(90_000);
    expect(c.storage.maxWorldBytes).toBe(2 * 1024 * 1024);
    expect(c.dataDir.endsWith(join('apps', 'server', 'data'))).toBe(true);
    expect(c.serveStatic).toBe(false);
    expect(c.models.anthropic.critic).toBe(c.models.anthropic.planner);
  });

  it('serves static by default in production, overridable', () => {
    expect(loadConfig({ NODE_ENV: 'production' }).serveStatic).toBe(true);
    expect(loadConfig({ NODE_ENV: 'production', SERVE_STATIC: 'off' }).serveStatic).toBe(false);
  });

  it('reports every problem without echoing values', () => {
    try {
      loadConfig({ PORT: '99999', ALLOWED_ORIGINS: 'javascript:alert(1)', AETHER_PROVIDER: 'evil', AETHER_PLANNER_MODEL: 'bad model!' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const problems = (err as ConfigError).problems.join('\n');
      expect(problems).toContain('PORT');
      expect(problems).toContain('AETHER_PROVIDER');
      expect(problems).toContain('AETHER_PLANNER_MODEL');
    }
  });

  it('rejects non-https provider base URLs except localhost', () => {
    expect(() => loadConfig({ ANTHROPIC_BASE_URL: 'http://evil.example' })).toThrow(ConfigError);
    expect(loadConfig({ ANTHROPIC_BASE_URL: 'http://localhost:9000' }).baseUrls.anthropic).toBe('http://localhost:9000');
  });

  it('redacts secrets', () => {
    const red = JSON.stringify(redactConfig(loadConfig({ ANTHROPIC_API_KEY: 'sk-ant-abcdef123456' })));
    expect(red).not.toContain('sk-ant-abcdef123456');
    expect(red).toContain('[set]');
  });
});

describe('planProviders', () => {
  it('uses mock mode without keys or when forced', () => {
    expect(planProviders(loadConfig({})).mode).toBe('mock');
    expect(planProviders(loadConfig({ AETHER_PROVIDER: 'mock', ANTHROPIC_API_KEY: 'k1234' })).mode).toBe('mock');
  });

  it('prefers the configured provider and falls back to the other key', () => {
    const both = { ANTHROPIC_API_KEY: 'a-key', OPENAI_API_KEY: 'o-key' };
    expect(planProviders(loadConfig({ ...both, AETHER_PROVIDER: 'openai' })).active?.name).toBe('openai');
    expect(planProviders(loadConfig({ ...both, AETHER_PROVIDER: 'anthropic' })).active?.name).toBe('anthropic');
    const fallback = planProviders(loadConfig({ OPENAI_API_KEY: 'o-key', AETHER_PROVIDER: 'anthropic', AETHER_OPENAI_CODER_MODEL: 'gpt-x' }));
    expect(fallback.active?.name).toBe('openai');
    expect(fallback.active?.models.coder).toBe('gpt-x');
  });
});

describe('TokenBucketLimiter', () => {
  it('allows a burst then refills at the sustained rate', () => {
    let now = 0;
    const l = new TokenBucketLimiter({ perMinute: 60, burst: 2, now: () => now });
    expect(l.take('a').allowed).toBe(true);
    expect(l.take('a').allowed).toBe(true);
    const denied = l.take('a');
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSec).toBe(1);
    now += 1000;
    expect(l.take('a').allowed).toBe(true);
  });

  it('bounds memory by evicting idle and least-recent keys', () => {
    const l = new TokenBucketLimiter({ perMinute: 1, burst: 5, maxKeys: 100, now: () => 0 });
    for (let i = 0; i < 1000; i++) l.take(`ip-${i}`);
    expect(l.size).toBeLessThanOrEqual(100);
  });

  it('handles 100k decisions quickly', () => {
    const l = new TokenBucketLimiter({ perMinute: 1000, burst: 10 });
    const t0 = performance.now();
    for (let i = 0; i < 100_000; i++) l.take(`k${i & 1023}`);
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  it('validates options', () => {
    expect(() => new TokenBucketLimiter({ perMinute: 0, burst: 1 })).toThrow(RangeError);
  });
});

describe('DailyTokenBudget', () => {
  it('counts per UTC day and ignores invalid input', () => {
    let now = Date.UTC(2026, 0, 1, 23, 0, 0);
    const b = new DailyTokenBudget(100, () => now);
    b.record(60);
    b.record(Number.NaN);
    b.record(-5);
    expect(b.status()).toMatchObject({ day: '2026-01-01', used: 60, exhausted: false, resetInSec: 3600 });
    b.record(40);
    expect(b.status().exhausted).toBe(true);
    now = Date.UTC(2026, 0, 2, 0, 0, 0);
    expect(b.status()).toMatchObject({ day: '2026-01-02', used: 0, exhausted: false });
  });
});

describe('logger', () => {
  it('scrubs configured secrets and key-like strings, and bounds length', () => {
    expect(scrub('key=sk-proj-abcdefghijkl', [])).not.toContain('abcdefghijkl');
    expect(scrub('Authorization: Bearer abc.def.ghi123', [])).not.toContain('abc.def.ghi123');
    expect(scrub('my secret hunter2hunter2', ['hunter2hunter2'])).toBe('my secret [redacted]');
    expect(scrub('x'.repeat(10_000)).length).toBeLessThanOrEqual(501);
  });

  it('writes one JSON line per event and respects levels', () => {
    const lines: string[] = [];
    const log = createLogger({ level: 'warn', sink: (l) => lines.push(l), now: () => 0, secrets: ['topsecret99'] });
    log.info('ignored');
    log.warn('hello', { path: '/x', leak: 'topsecret99' });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] as string)).toEqual({ level: 'warn', time: '1970-01-01T00:00:00.000Z', msg: 'hello', path: '/x', leak: '[redacted]' });
  });
});

describe('pickForwardedIp', () => {
  it('trusts only the configured number of proxy hops from the right', () => {
    expect(pickForwardedIp('1.1.1.1, 2.2.2.2, 3.3.3.3', 1)).toBe('3.3.3.3');
    expect(pickForwardedIp('1.1.1.1, 2.2.2.2, 3.3.3.3', 2)).toBe('2.2.2.2');
    expect(pickForwardedIp('1.1.1.1', 0)).toBeUndefined();
    expect(pickForwardedIp(undefined, 1)).toBeUndefined();
    expect(pickForwardedIp('not-an-ip<script>', 1)).toBeUndefined();
  });

  it('ignores the header when it has fewer entries than trusted hops (client-controlled)', () => {
    expect(pickForwardedIp('6.6.6.6', 2)).toBeUndefined();
    expect(pickForwardedIp('6.6.6.6, 7.7.7.7', 3)).toBeUndefined();
  });
});

describe('JsonFileStore', () => {
  it('refuses invalid keys before touching the filesystem', async () => {
    const store = new JsonFileStore({ dir: join(tmp, 'store'), keyPattern: /^[a-z]{3}$/, maxEntries: 10, maxBytes: 100 });
    await expect(store.get('../x')).rejects.toBeInstanceOf(StoreError);
    await expect(store.put('abc', { big: 'x'.repeat(200) }, true)).rejects.toMatchObject({ code: 'too-large' });
    await store.put('abc', { ok: true }, true);
    expect(await store.get('abc')).toEqual({ ok: true });
    expect(await store.size()).toBe(1);
    await store.put('abc', { ok: false }, false);
    expect(await store.size()).toBe(1);
  });

  it('enforces the entry cap under concurrent creates', async () => {
    const store = new JsonFileStore({ dir: join(tmp, 'race'), keyPattern: /^[a-z]{3}$/, maxEntries: 3, maxBytes: 100 });
    const keys = ['aaa', 'bbb', 'ccc', 'ddd', 'eee', 'fff', 'ggg', 'hhh'];
    const results = await Promise.allSettled(keys.map((k) => store.put(k, { k }, true)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    expect(await store.size()).toBe(3);
    // Re-creating an existing key does not consume an extra slot.
    const first = keys.find((_, i) => results[i]?.status === 'fulfilled') ?? 'aaa';
    await store.put(first, { again: true }, false);
    expect(await store.size()).toBe(3);
  });
});
