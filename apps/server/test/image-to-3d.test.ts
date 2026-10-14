import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createTrellisProvider, isAllowedEndpoint, type ImageTo3DProvider } from '@aether/assets';
import type { AppEnv } from '../src/app-env';
import { registerImageTo3dRoutes } from '../src/routes/image-to-3d';
import { triangleGlb, pngHeader } from '../../../packages/assets/test/fixtures';

const logger = { debug() {}, info() {}, warn() {}, error() {} } as never;

describe('image-to-3D provider (TRELLIS wrapper)', () => {
  it('only talks to loopback over http, anything else over https without credentials', () => {
    expect(isAllowedEndpoint('http://127.0.0.1:8000/generate')).toBe(true);
    expect(isAllowedEndpoint('http://localhost:8000')).toBe(true);
    expect(isAllowedEndpoint('https://me--trellis.modal.run/generate')).toBe(true);
    expect(isAllowedEndpoint('http://192.168.1.5:8000')).toBe(false);
    expect(isAllowedEndpoint('https://user:pw@example.com')).toBe(false);
    expect(isAllowedEndpoint('file:///etc/passwd')).toBe(false);
    expect(() => createTrellisProvider({ endpoint: 'http://evil.example' })).toThrow();
  });

  it('posts the image as JSON and returns a validated, sanitised GLB', async () => {
    let body: Record<string, unknown> = {};
    let auth = '';
    const fake = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body)) as Record<string, unknown>;
      auth = new Headers(init.headers).get('authorization') ?? '';
      return new Response(triangleGlb({ translate: [2, 2, 2] }) as Uint8Array<ArrayBuffer>, { headers: { 'content-type': 'model/gltf-binary' } });
    }) as unknown as typeof fetch;
    const p = createTrellisProvider({ endpoint: 'http://127.0.0.1:8000/gen', token: 'secret', fetch: fake });
    const r = await p.generate(pngHeader(64, 64), { seed: 7 });
    expect(body).toMatchObject({ mime: 'image/png', seed: 7, format: 'glb' });
    expect(auth).toBe('Bearer secret');
    expect(r.report.triangles).toBe(1);
    await expect(p.generate(new Uint8Array([1, 2, 3]))).rejects.toThrow('reference image rejected');
  });

  it('rejects hostile or oversized results', async () => {
    const evil = (async () => new Response(new Uint8Array([1, 2, 3, 4]))) as unknown as typeof fetch;
    await expect(createTrellisProvider({ endpoint: 'https://x.example', fetch: evil }).generate(pngHeader(8, 8))).rejects.toThrow('rejected');
    const big = (async () => new Response(new Uint8Array(4096))) as unknown as typeof fetch;
    await expect(createTrellisProvider({ endpoint: 'https://x.example', fetch: big, maxOutputBytes: 1024 }).generate(pngHeader(8, 8))).rejects.toThrow('too large');
    const down = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
    await expect(createTrellisProvider({ endpoint: 'https://x.example', fetch: down }).generate(pngHeader(8, 8))).rejects.toThrow('500');
  });
});

describe('POST /api/image-to-3d', () => {
  function app(provider: ImageTo3DProvider): Hono<AppEnv> {
    const a = new Hono<AppEnv>();
    registerImageTo3dRoutes(a, { provider, logger });
    return a;
  }
  const ok: ImageTo3DProvider = { id: 'fake', generate: async () => ({ glb: triangleGlb(), report: { size: [1, 1, 0], triangles: 1, nodes: 1, meshes: 1, materials: 0, textures: 0, animations: [], skinned: false } }) };

  it('returns a GLB for an image', async () => {
    const res = await app(ok).request('/api/image-to-3d', { method: 'POST', headers: { 'content-type': 'image/png' }, body: pngHeader(8, 8) as Uint8Array<ArrayBuffer> });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('model/gltf-binary');
    expect(new Uint8Array(await res.arrayBuffer()).byteLength).toBeGreaterThan(20);
  });

  it('refuses non-images, oversize bodies and hides upstream errors', async () => {
    expect((await app(ok).request('/api/image-to-3d', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' })).status).toBe(415);
    expect((await app(ok).request('/api/image-to-3d', { method: 'POST', headers: { 'content-type': 'image/png', 'content-length': String(64 * 1024 * 1024) }, body: 'x' })).status).toBe(413);
    const failing: ImageTo3DProvider = { id: 'f', generate: async () => { throw new Error('secret upstream detail'); } };
    const res = await app(failing).request('/api/image-to-3d', { method: 'POST', headers: { 'content-type': 'image/png' }, body: pngHeader(8, 8) as Uint8Array<ArrayBuffer> });
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain('secret');
  });
});
