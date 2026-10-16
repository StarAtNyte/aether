/**
 * Production hosting behaviour: precompressed static files, error pages,
 * HTTP timeouts, the build-time compressor, and the deployment manifests
 * (Dockerfile, fly.toml, render.yaml, docker-compose.yml, vercel.json,
 * CI workflow) staying consistent with the server.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import { errorPageHtml } from '../src/error-pages';
import { createLogger } from '../src/logger';
import { precompressDir } from '../src/precompress';
import { applyHttpTimeouts, HTTP_TIMEOUTS } from '../src/server-timeouts';
import { externalBaseUrl } from '../../../tests/e2e/support/env';
import { cleanupDirs, makeApp, makeConfig } from './helpers';
afterAll(cleanupDirs);
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
/** A static app over a temp dist with a big compressible script and its precompressed siblings. */
async function staticApp(opts = {}) {
    const config = makeConfig({ SERVE_STATIC: 'true', NODE_ENV: 'production' });
    const dist = join(config.dataDir, 'dist');
    mkdirSync(join(dist, 'assets'), { recursive: true });
    mkdirSync(join(dist, 'fonts'), { recursive: true });
    writeFileSync(join(dist, 'index.html'), `<!doctype html><title>Aether</title>${'<!-- pad -->'.repeat(200)}`);
    writeFileSync(join(dist, 'assets', 'app-abc123.js'), `export const data = ${JSON.stringify('aether '.repeat(4000))};\n`);
    writeFileSync(join(dist, 'fonts', 'inter.woff2'), Buffer.alloc(2048, 7));
    writeFileSync(join(dist, 'robots.txt'), 'User-agent: *\nAllow: /\n');
    if (opts.notFoundPage)
        writeFileSync(join(dist, '404.html'), '<!doctype html><title>Lost</title><h1>Designed 404</h1>');
    await precompressDir(dist);
    return makeApp({ ...config, staticDir: dist });
}
describe('precompressed static files', () => {
    it('sends Brotli when accepted, then gzip, then identity, with Vary', async () => {
        const app = await staticApp();
        const br = await app.request('/assets/app-abc123.js', { headers: { 'Accept-Encoding': 'gzip, deflate, br' } });
        expect(br.status).toBe(200);
        expect(br.headers.get('content-encoding')).toBe('br');
        expect(br.headers.get('vary')).toContain('Accept-Encoding');
        expect(br.headers.get('content-type')).toContain('javascript');
        expect(br.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
        expect(brotliDecompressSync(Buffer.from(await br.arrayBuffer())).toString()).toContain('aether aether');
        const gz = await app.request('/assets/app-abc123.js', { headers: { 'Accept-Encoding': 'gzip' } });
        expect(gz.headers.get('content-encoding')).toBe('gzip');
        expect(gunzipSync(Buffer.from(await gz.arrayBuffer())).toString()).toContain('aether aether');
        const plain = await app.request('/assets/app-abc123.js');
        expect(plain.headers.get('content-encoding')).toBeNull();
        expect(await plain.text()).toContain('aether aether');
    });
    it('answers byte ranges from the identity file, never a compressed sibling', async () => {
        const app = await staticApp();
        const res = await app.request('/assets/app-abc123.js', { headers: { 'Accept-Encoding': 'br, gzip', Range: 'bytes=0-5' } });
        expect(res.status).toBe(206);
        expect(res.headers.get('content-encoding')).toBeNull();
        expect(await res.text()).toBe('export');
    });
    it('never serves a compressed sibling by its own name', async () => {
        const app = await staticApp();
        for (const p of ['/assets/app-abc123.js.br', '/assets/app-abc123.js.gz'])
            expect((await app.request(p)).status).toBe(404);
    });
    it('compresses the HTML entry too, and keeps it revalidated', async () => {
        const app = await staticApp();
        const res = await app.request('/', { headers: { 'Accept-Encoding': 'br', Accept: 'text/html' } });
        expect(res.status).toBe(200);
        expect(res.headers.get('content-encoding')).toBe('br');
        expect(res.headers.get('cache-control')).toBe('no-cache');
    });
    it('caches bundled fonts as immutable and other root files as revalidated', async () => {
        const app = await staticApp();
        expect((await app.request('/fonts/inter.woff2')).headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
        expect((await app.request('/robots.txt')).headers.get('cache-control')).toBe('no-cache');
    });
});
describe('error pages', () => {
    it('serves the build’s designed 404.html for unknown pages', async () => {
        const app = await staticApp({ notFoundPage: true });
        const res = await app.request('/no/such/page', { headers: { Accept: 'text/html' } });
        expect(res.status).toBe(404);
        expect(await res.text()).toContain('Designed 404');
    });
    it('keeps JSON 404s for the API and for non-HTML requests', async () => {
        const app = await staticApp();
        const api = await app.request('/api/nope', { headers: { Accept: 'text/html' } });
        expect(api.status).toBe(404);
        expect(api.headers.get('content-type')).toContain('application/json');
        const asset = await app.request('/assets/missing.js');
        expect(asset.status).toBe(404);
        expect(asset.headers.get('content-type')).toContain('application/json');
    });
    it('answers HTML 404 pages without static hosting too (API-only server)', async () => {
        const app = makeApp(makeConfig());
        const res = await app.request('/whatever', { headers: { Accept: 'text/html' } });
        expect(res.status).toBe(404);
        expect(await res.text()).toContain('Page not found');
    });
    it('shows a 500 page to browsers and JSON to API clients, never the error text', async () => {
        const app = makeApp(makeConfig());
        // Routes registered after createApp still go through its error handler.
        app.get('/boom', () => {
            throw new Error('secret internal detail');
        });
        app.get('/api/boom', () => {
            throw new Error('secret internal detail');
        });
        const page = await app.request('/boom', { headers: { Accept: 'text/html' } });
        expect(page.status).toBe(500);
        const html = await page.text();
        expect(html).toContain('Something went wrong');
        expect(html).not.toContain('secret internal detail');
        expect(page.headers.get('cache-control')).toBe('no-store');
        const api = await app.request('/api/boom', { headers: { Accept: 'text/html' } });
        expect(api.status).toBe(500);
        expect(await api.json()).toEqual({ error: 'internal', message: 'Internal server error.' });
    });
    it('error pages carry no script and no external resource (strict CSP)', () => {
        for (const status of [404, 500, 503]) {
            const html = errorPageHtml(status);
            expect(html).not.toMatch(/<script/i);
            expect(html).not.toMatch(/(src|href)="https?:/i);
            expect(html).toContain('noindex');
        }
        // The static host's 404 page is the server's page, byte for byte (one design, two hosts).
        expect(read('apps/studio/public/404.html')).toBe(errorPageHtml(404));
    });
    it('the security headers apply to error pages', async () => {
        const res = await makeApp(makeConfig()).request('/missing', { headers: { Accept: 'text/html' } });
        expect(res.headers.get('content-security-policy')).toContain("script-src 'self'");
        expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    });
});
describe('precompressDir', () => {
    const dirs = [];
    afterAll(() => {
        for (const d of dirs)
            rmSync(d, { recursive: true, force: true });
    });
    const tmp = () => {
        const d = mkdtempSync(join(tmpdir(), 'aether-precompress-'));
        dirs.push(d);
        return d;
    };
    it('compresses text types above the size floor and skips images, tiny files and incompressible data', async () => {
        const dir = tmp();
        writeFileSync(join(dir, 'big.js'), 'let x = 1;\n'.repeat(500));
        writeFileSync(join(dir, 'tiny.css'), 'a{}');
        writeFileSync(join(dir, 'photo.webp'), Buffer.alloc(8192, 1));
        // Random bytes do not compress: no sibling may be kept.
        const noise = Buffer.alloc(8192);
        for (let i = 0; i < noise.length; i++)
            noise[i] = (i * 2654435761) >>> 24 ^ (i * 40503) & 255;
        writeFileSync(join(dir, 'noise.wasm'), noise);
        const report = await precompressDir(dir);
        expect(existsSync(join(dir, 'big.js.br'))).toBe(true);
        expect(existsSync(join(dir, 'big.js.gz'))).toBe(true);
        expect(existsSync(join(dir, 'tiny.css.br'))).toBe(false);
        expect(existsSync(join(dir, 'photo.webp.br'))).toBe(false);
        expect(report.files).toBe(2);
        expect(report.brotliBytes).toBeLessThan(report.bytes);
    });
    it('removes stale siblings when a file stops being worth compressing', async () => {
        const dir = tmp();
        writeFileSync(join(dir, 'a.json'), JSON.stringify({ v: 'x'.repeat(5000) }));
        await precompressDir(dir);
        expect(existsSync(join(dir, 'a.json.br'))).toBe(true);
        writeFileSync(join(dir, 'a.json'), '{}');
        await precompressDir(dir);
        expect(existsSync(join(dir, 'a.json.br'))).toBe(false);
        expect(existsSync(join(dir, 'a.json.gz'))).toBe(false);
    });
    it('never follows symbolic links and stops at the file cap', async () => {
        const dir = tmp();
        const outside = tmp();
        writeFileSync(join(outside, 'secret.js'), 'x'.repeat(5000));
        symlinkSync(outside, join(dir, 'link'));
        await precompressDir(dir);
        expect(existsSync(join(outside, 'secret.js.br'))).toBe(false);
        for (let i = 0; i < 5; i++)
            writeFileSync(join(dir, `f${i}.txt`), 'y');
        await expect(precompressDir(dir, { maxFiles: 3 })).rejects.toThrow(/too many files/);
    });
});
describe('access log', () => {
    it('logs health checks at debug, other requests at info, failures at warn', async () => {
        const lines = [];
        const app = makeApp(makeConfig(), { logger: createLogger({ level: 'info', sink: (l) => lines.push(l) }) });
        await app.request('/api/health');
        expect(lines).toHaveLength(0);
        await app.request('/api/worlds/zzzzzzzzzzzz');
        await app.request('/api/nope');
        expect(lines.map((l) => JSON.parse(l).level)).toContain('warn');
        expect(lines.join('\n')).not.toContain('/api/health');
    });
});
describe('e2e against a running deployment (BASE_URL)', () => {
    it('accepts AETHER_E2E_URL or BASE_URL as a plain http(s) URL', () => {
        expect(externalBaseUrl({})).toBeNull();
        expect(externalBaseUrl({ BASE_URL: 'http://127.0.0.1:8787/' })).toBe('http://127.0.0.1:8787');
        expect(externalBaseUrl({ AETHER_E2E_URL: 'https://a.example.com', BASE_URL: 'http://b' })).toBe('https://a.example.com');
        expect(externalBaseUrl({ BASE_URL: 'https://a.example.com/sub/' })).toBe('https://a.example.com/sub');
    });
    it('rejects other schemes, credentials, queries and garbage', () => {
        for (const bad of ['file:///etc/passwd', 'http://user:pw@host', 'http://host/?q=1', 'not a url', 'javascript:alert(1)']) {
            expect(() => externalBaseUrl({ BASE_URL: bad })).toThrow();
        }
    });
});
describe('HTTP timeouts', () => {
    it('outlive proxy idle timeouts and keep headers > keep-alive <= request', () => {
        const server = {};
        applyHttpTimeouts(server);
        expect(server.keepAliveTimeout).toBeGreaterThan(60_000);
        expect(server.headersTimeout).toBeGreaterThan(server.keepAliveTimeout ?? 0);
        expect(server.requestTimeout).toBeGreaterThanOrEqual(server.headersTimeout ?? 0);
    });
    it('rejects inconsistent values', () => {
        expect(() => applyHttpTimeouts({}, { ...HTTP_TIMEOUTS, headersTimeoutMs: HTTP_TIMEOUTS.keepAliveTimeoutMs })).toThrow(RangeError);
        expect(() => applyHttpTimeouts({}, { ...HTTP_TIMEOUTS, requestTimeoutMs: 1 })).toThrow(RangeError);
    });
});
describe('deployment manifests', () => {
    it('Dockerfile: multi-stage, non-root, health check on /api/health, hosted mode, no local AI', () => {
        const df = read('Dockerfile');
        expect(df.match(/^FROM /gm)?.length ?? 0).toBeGreaterThanOrEqual(2);
        expect(df).toMatch(/^USER node$/m);
        expect(df).toMatch(/^HEALTHCHECK .*\n?.*\/api\/health/m);
        expect(df).toContain('AETHER_HOSTED=1');
        expect(df).toContain('AETHER_LOCAL_AI=off');
        expect(df).toContain('scripts/precompress.ts');
        expect(df).toMatch(/npm ci [^\n]*--omit=dev/);
        // Exec form so SIGTERM reaches node (graceful shutdown).
        expect(df).toMatch(/^CMD \["node",/m);
    });
    it('.dockerignore keeps secrets, local data, git and build output out of the context', () => {
        const lines = read('.dockerignore').split('\n').map((l) => l.trim());
        for (const entry of ['**/node_modules', '**/.env', '**/.env.*', '.git', 'apps/server/data', '.private', '**/dist'])
            expect(lines).toContain(entry);
        expect(lines).toContain('!.env.example');
    });
    it('fly.toml keeps one machine running and checks /api/health', () => {
        const fly = read('fly.toml');
        expect(fly).toMatch(/internal_port\s*=\s*8787/);
        expect(fly).toMatch(/auto_stop_machines\s*=\s*['"]?off['"]?/);
        expect(fly).toMatch(/min_machines_running\s*=\s*1/);
        expect(fly).toMatch(/path\s*=\s*['"]\/api\/health['"]/);
        expect(fly).toMatch(/TRUST_PROXY_HOPS\s*=\s*['"]1['"]/);
        expect(fly).toMatch(/force_https\s*=\s*true/);
    });
    it('render.yaml is a Docker web service with a health check and trusted proxy hop', () => {
        const render = read('render.yaml');
        expect(render).toMatch(/runtime:\s*docker/);
        expect(render).toMatch(/healthCheckPath:\s*\/api\/health/);
        expect(render).toMatch(/key:\s*TRUST_PROXY_HOPS\s*\n\s*value:\s*['"]?1['"]?/);
    });
    it('docker-compose.yml restarts the service, keeps data on a volume and binds to loopback by default', () => {
        const compose = read('docker-compose.yml');
        expect(compose).toMatch(/restart:\s*unless-stopped/);
        expect(compose).toMatch(/\/data/);
        expect(compose).toMatch(/127\.0\.0\.1:\$\{AETHER_PORT:-8787\}:8787/);
        expect(compose).toMatch(/mem_limit:/);
    });
    it('no deployment config sets an owner-paid model key or turns on local AI', () => {
        for (const file of ['Dockerfile', 'fly.toml', 'render.yaml', 'docker-compose.yml']) {
            const text = read(file);
            expect(text).not.toMatch(/(ANTHROPIC|OPENAI)_API_KEY\s*[:=]\s*['"]?sk-/);
            expect(text).not.toMatch(/AETHER_LOCAL_AI\s*[:=]\s*['"]?on/);
        }
    });
    it('vercel.json serves the 404 page for unknown paths instead of the app, and keeps /play', () => {
        const vercel = JSON.parse(read('vercel.json'));
        expect(vercel.rewrites).toContainEqual({ source: '/play', destination: '/play.html' });
        expect(vercel.rewrites.some((r) => r.destination === '/index.html')).toBe(false);
        expect(existsSync(join(ROOT, 'apps/studio/public/404.html'))).toBe(true);
    });
    it('CI runs typecheck, tests, build, smoke and both e2e browsers', () => {
        const ci = read('.github/workflows/ci.yml');
        for (const step of ['npm ci', 'npm run typecheck', 'npm test', 'npm run build', 'npm run smoke', 'npm run e2e', 'playwright install'])
            expect(ci).toContain(step);
        expect(ci).toMatch(/cache:\s*npm/);
        expect(ci).toMatch(/firefox/);
    });
});
