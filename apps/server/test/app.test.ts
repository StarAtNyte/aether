import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createLogger } from '../src/logger';
import { cleanupDirs, jsonInit, live, makeApp, makeConfig, okProvider } from './helpers';

afterAll(cleanupDirs);

describe('GET /api/health', () => {
  it('reports mock mode when no provider is configured', async () => {
    const app = makeApp(makeConfig());
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, mode: 'mock', providers: ['mock'], byok: false, local: false, imageTo3d: false, assetImport: true });
  });

  it('reports live mode and provider names', async () => {
    const app = makeApp(makeConfig(), { llm: live(okProvider()), providers: ['anthropic', 'openai'] });
    expect(await (await app.request('/api/health')).json()).toEqual({ ok: true, mode: 'live', providers: ['anthropic', 'openai'], byok: false, local: false, imageTo3d: false, assetImport: true });
  });

  it('is never rate limited (platform health checks)', async () => {
    const app = makeApp(makeConfig({ RATE_LIMIT_API_BURST: '1', RATE_LIMIT_API_PER_MIN: '1' }));
    for (let i = 0; i < 5; i++) expect((await app.request('/api/health')).status).toBe(200);
  });

  it('never leaks API keys', async () => {
    const app = makeApp(makeConfig({ ANTHROPIC_API_KEY: 'sk-ant-supersecretvalue123' }), { llm: live(okProvider()) });
    const text = await (await app.request('/api/health')).text();
    expect(text).not.toContain('supersecret');
  });
});

describe('security headers', () => {
  it('sets CSP, nosniff, referrer policy, COOP and frame denial', async () => {
    const res = await makeApp(makeConfig()).request('/api/health');
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(csp).toContain("worker-src 'self' blob:");
    expect(csp).toContain("img-src 'self' data: blob:");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(res.headers.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-request-id')).toMatch(/.+/);
  });

  it('adds HSTS only in production', async () => {
    const dev = await makeApp(makeConfig()).request('/api/health');
    expect(dev.headers.get('strict-transport-security')).toBeNull();
    const prod = await makeApp(makeConfig({ NODE_ENV: 'production', SERVE_STATIC: 'false' })).request('/api/health');
    expect(prod.headers.get('strict-transport-security')).toContain('max-age=');
  });

  it('echoes a sane incoming request id and replaces a hostile one', async () => {
    const app = makeApp(makeConfig());
    const ok = await app.request('/api/health', { headers: { 'X-Request-Id': 'abc-123' } });
    expect(ok.headers.get('x-request-id')).toBe('abc-123');
    const bad = await app.request('/api/health', { headers: { 'X-Request-Id': 'x'.repeat(500) } });
    expect(bad.headers.get('x-request-id')).not.toBe('x'.repeat(500));
  });
});

describe('CORS', () => {
  const config = makeConfig({ ALLOWED_ORIGINS: 'http://localhost:5173, https://aether.example.com/' });

  it('allows allowlisted origins (trailing slash normalized)', async () => {
    const res = await makeApp(config).request('/api/health', { headers: { Origin: 'https://aether.example.com' } });
    expect(res.headers.get('access-control-allow-origin')).toBe('https://aether.example.com');
  });

  it('answers preflight for allowlisted origins', async () => {
    const res = await makeApp(config).request('/api/llm', {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
  });

  it('does not allow other origins', async () => {
    const res = await makeApp(config).request('/api/health', { headers: { Origin: 'https://evil.example' } });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('rejects state-changing requests from foreign origins', async () => {
    const res = await makeApp(config).request('/api/worlds', jsonInit('PUT', {}, { Origin: 'https://evil.example' }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'origin-not-allowed' });
  });

  it('allows same-host origins (studio served by this server)', async () => {
    const res = await makeApp(config).request('http://visitor.example.com/api/llm', jsonInit('POST', {}, { Origin: 'https://visitor.example.com', Host: 'visitor.example.com' }));
    expect(res.status).toBe(503); // reached the route (mock mode)
  });
});

describe('rate limiting', () => {
  it('returns 429 with Retry-After once the API burst is spent', async () => {
    const app = makeApp(makeConfig({ RATE_LIMIT_API_BURST: '3', RATE_LIMIT_API_PER_MIN: '60' }));
    const id = '0'.repeat(64);
    for (let i = 0; i < 3; i++) expect((await app.request(`/api/generators/${id}`)).status).toBe(404);
    const res = await app.request(`/api/generators/${id}`);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    expect(await res.json()).toMatchObject({ error: 'rate-limited' });
  });

  it('uses a separate, stricter bucket for /api/llm', async () => {
    const app = makeApp(makeConfig({ RATE_LIMIT_LLM_BURST: '2', RATE_LIMIT_LLM_PER_MIN: '20' }));
    expect((await app.request('/api/llm', jsonInit('POST', {}))).status).toBe(503);
    expect((await app.request('/api/llm', jsonInit('POST', {}))).status).toBe(503);
    expect((await app.request('/api/llm', jsonInit('POST', {}))).status).toBe(429);
    // Other API routes still work.
    expect((await app.request(`/api/generators/${'a'.repeat(64)}`)).status).toBe(404);
  });

  it('keys buckets per client and refills over time', async () => {
    let now = 1_000_000;
    let ip = '198.51.100.1';
    const app = makeApp(makeConfig({ RATE_LIMIT_LLM_BURST: '1', RATE_LIMIT_LLM_PER_MIN: '60' }), { now: () => now, clientIp: () => ip });
    expect((await app.request('/api/llm', jsonInit('POST', {}))).status).toBe(503);
    expect((await app.request('/api/llm', jsonInit('POST', {}))).status).toBe(429);
    ip = '198.51.100.2';
    expect((await app.request('/api/llm', jsonInit('POST', {}))).status).toBe(503);
    ip = '198.51.100.1';
    now += 1_000;
    expect((await app.request('/api/llm', jsonInit('POST', {}))).status).toBe(503);
  });
});

describe('errors and fallbacks', () => {
  it('returns JSON 404 for unknown routes', async () => {
    const res = await makeApp(makeConfig()).request('/api/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not-found', message: 'Route not found.' });
  });

  it('never leaks stack traces or secrets from unhandled errors', async () => {
    const lines: string[] = [];
    const logger = createLogger({ level: 'debug', sink: (l) => lines.push(l), secrets: ['sk-live-hidden-0001'] });
    const config = makeConfig({ OPENAI_API_KEY: 'sk-live-hidden-0001' });
    const app = makeApp(config, { logger });
    app.get('/api/boom', () => {
      throw new Error('kaput with key sk-live-hidden-0001');
    });
    const res = await app.request('/api/boom');
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).not.toContain('kaput');
    expect(body).not.toContain('at ');
    expect(JSON.parse(body)).toEqual({ error: 'internal', message: 'Internal server error.' });
    expect(lines.join('\n')).toContain('unhandled error');
    expect(lines.join('\n')).not.toContain('sk-live-hidden-0001');
  });
});

describe('static studio hosting', () => {
  function staticApp() {
    const config = makeConfig({ SERVE_STATIC: 'true', NODE_ENV: 'production' });
    const dist = join(config.dataDir, 'dist');
    mkdirSync(join(dist, 'assets'), { recursive: true });
    writeFileSync(join(dist, 'index.html'), '<!doctype html><title>Aether</title>');
    writeFileSync(join(dist, 'assets', 'app-abc123.js'), 'console.info(1)');
    return makeApp({ ...config, staticDir: dist });
  }

  it('serves hashed assets with immutable caching', async () => {
    const res = await staticApp().request('/assets/app-abc123.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  });

  it('serves index.html with no-cache, and a real 404 page for unknown pages (the studio routes by hash)', async () => {
    const app = staticApp();
    const root = await app.request('/');
    expect(root.status).toBe(200);
    expect(root.headers.get('cache-control')).toBe('no-cache');
    expect(await root.text()).toContain('<title>Aether</title>');
    const unknown = await app.request('/play/abc', { headers: { Accept: 'text/html' } });
    expect(unknown.status).toBe(404);
    expect(unknown.headers.get('content-type')).toContain('text/html');
    expect(unknown.headers.get('cache-control')).toBe('no-store');
    expect(await unknown.text()).toContain('Page not found');
  });

  it('does not SPA-fallback API routes or non-HTML requests', async () => {
    const app = staticApp();
    expect((await app.request('/api/unknown', { headers: { Accept: 'text/html' } })).status).toBe(404);
    expect((await app.request('/assets/missing.js')).status).toBe(404);
  });

  it('does not serve files outside the dist directory', async () => {
    const app = staticApp();
    for (const p of ['/../../package.json', '/..%2f..%2fpackage.json', '/%2e%2e/%2e%2e/package.json']) {
      const res = await app.request(p);
      expect(await res.text()).not.toContain('"name"');
    }
  });
});
