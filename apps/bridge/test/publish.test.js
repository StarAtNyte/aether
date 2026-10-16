/**
 * Publishing through the bridge (hosted studios paired with the local app):
 * token required, CORS for the paired origin, binary zip uploads with a cap,
 * errors mapped to bridge codes, absent publishing → not_found.
 */
import { createServer, request as httpRequest } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { Pairing } from '../src/pairing';
import { createBridgeHandler } from '../src/server';
const ORIGIN = 'https://studio.example.org';
const idle = { name: 'Idle', strictSchema: false, complete: async () => ({ text: '{}' }) };
let server = null;
afterEach(async () => {
    const s = server;
    server = null;
    if (s)
        await new Promise((r) => s.close(() => r()));
});
async function start(publish) {
    const pairing = new Pairing();
    let port = 0;
    const handler = createBridgeHandler({ config: { origins: [ORIGIN], maxBodyBytes: 1024 * 1024, maxWaiting: 2 }, port: () => port, pairing, backends: { codex: idle, 'claude-code': idle }, status: async () => [], ...(publish ? { publish } : {}) });
    server = createServer(handler);
    await new Promise((r) => server?.listen(0, '127.0.0.1', r));
    port = (server?.address()).port;
    return { port, pairing };
}
function call(port, method, path, opts = {}) {
    return new Promise((resolve, reject) => {
        const req = httpRequest({ host: '127.0.0.1', port, method, path, headers: { host: `127.0.0.1:${port}`, origin: ORIGIN, ...opts.headers } }, (res) => {
            let text = '';
            res.on('data', (c) => (text += c.toString()));
            res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : null, headers: res.headers }));
        });
        req.on('error', reject);
        if (opts.body !== undefined)
            req.write(opts.body);
        req.end();
    });
}
async function token(port, pairing) {
    const r = await call(port, 'POST', '/v1/pair', { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: pairing.currentCode }) });
    return r.body.token;
}
function fakePublish(log) {
    const err = (status, message) => Object.assign(new Error(message), { status });
    return {
        maxBuildBytes: 1000,
        targets: async (fresh) => (log.push(`targets ${fresh}`), { targets: [{ id: 'netlify', signedIn: true }] }),
        builds: async () => ({ builds: [] }),
        addBuild: async (zip) => (log.push(`build ${zip.byteLength}`), { build: { id: 'aaaaaaaaaaaa' }, url: null }),
        deploy: async (body) => {
            const b = body;
            if (b.target === 'busy')
                throw err(409, 'A deploy is already running.');
            if (b.target === 'bad')
                throw err(400, 'The deploy request is not valid.');
            if (b.target === 'boom')
                throw new Error('secret internal detail');
            return { job: { id: 'bbbbbbbbbbbb', state: 'running' } };
        },
        job: (id) => (id === 'bbbbbbbbbbbb' ? { id, state: 'done', url: 'https://x.netlify.app/' } : null),
        cancel: (id) => id === 'bbbbbbbbbbbb',
        lan: () => ({ on: false, build: null, urls: [], until: null }),
        setLan: async (body) => ({ on: body.on, build: null, urls: [], until: null }),
    };
}
describe('bridge publishing', () => {
    it('requires the pairing token and answers not_found when the app does not publish', async () => {
        const plain = await start();
        expect((await call(plain.port, 'GET', '/v1/publish/targets')).status).toBe(401);
        const t = await token(plain.port, plain.pairing);
        const r = await call(plain.port, 'GET', '/v1/publish/targets', { headers: { authorization: `Bearer ${t}` } });
        expect(r.status).toBe(404);
        expect(JSON.stringify(r.body)).toMatch(/aether start --origin/);
    });
    it('serves targets, uploads zips under a cap, deploys, follows and cancels jobs, toggles LAN sharing', async () => {
        const log = [];
        const { port, pairing } = await start(fakePublish(log));
        const auth = { authorization: `Bearer ${await token(port, pairing)}` };
        const targets = await call(port, 'GET', '/v1/publish/targets?fresh=1', { headers: auth });
        expect(targets.status).toBe(200);
        expect(targets.headers['access-control-allow-origin']).toBe(ORIGIN);
        expect(log).toContain('targets true');
        expect((await call(port, 'POST', '/v1/publish/builds', { headers: { ...auth, 'content-type': 'application/json' }, body: '{}' })).status).toBe(400);
        const up = await call(port, 'POST', '/v1/publish/builds', { headers: { ...auth, 'content-type': 'application/zip' }, body: new Uint8Array(500) });
        expect(up.status).toBe(201);
        expect(log).toContain('build 500');
        expect((await call(port, 'POST', '/v1/publish/builds', { headers: { ...auth, 'content-type': 'application/zip' }, body: new Uint8Array(1500) })).status).toBe(413);
        const dep = await call(port, 'POST', '/v1/publish/deploy', { headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ target: 'netlify' }) });
        expect(dep.status).toBe(202);
        expect((await call(port, 'POST', '/v1/publish/deploy', { headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ target: 'busy' }) })).status).toBe(429);
        expect((await call(port, 'POST', '/v1/publish/deploy', { headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ target: 'bad' }) })).status).toBe(400);
        const boom = await call(port, 'POST', '/v1/publish/deploy', { headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ target: 'boom' }) });
        expect(boom.status).toBe(502);
        expect(JSON.stringify(boom.body)).not.toMatch(/secret internal/);
        expect((await call(port, 'GET', '/v1/publish/jobs/bbbbbbbbbbbb', { headers: auth })).body.job.url).toBe('https://x.netlify.app/');
        expect((await call(port, 'GET', '/v1/publish/jobs/zzzzzzzzzzzz', { headers: auth })).status).toBe(404);
        expect((await call(port, 'GET', '/v1/publish/jobs/../../x', { headers: auth })).status).toBe(404);
        expect((await call(port, 'DELETE', '/v1/publish/jobs/bbbbbbbbbbbb', { headers: auth })).status).toBe(200);
        expect((await call(port, 'POST', '/v1/publish/lan', { headers: { ...auth, 'content-type': 'application/json' }, body: '{"on":true}' })).body.on).toBe(true);
        expect((await call(port, 'GET', '/v1/publish/nope', { headers: auth })).status).toBe(404);
    });
});
