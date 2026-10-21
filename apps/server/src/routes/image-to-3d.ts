/**
 * `POST /api/image-to-3d` — optional image → GLB through a user-run
 * TRELLIS.2 wrapper (see docs/IMAGE_TO_3D.md). Only registered when
 * `AETHER_IMAGE_TO_3D_URL` is set; OFF by default, no paid service is used.
 *
 * Request: raw image bytes (PNG / JPEG / WebP, ≤ 12 MB, validated by
 * header). Response: a validated, sanitised GLB (`model/gltf-binary`).
 * Upstream errors never leak details (they are logged, scrubbed).
 */
import type { Hono } from 'hono';
import type { ImageTo3DProvider } from '@aether/assets';
import type { AppEnv } from '../app-env';
import { fail } from '../http';
import { jsonBodyLimit } from '../middleware';
import type { Logger } from '../logger';

/** Largest accepted reference image. */
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

/**
 * Logged once when the route is turned on. The wrapper behind the URL is the user's own, and the published
 * wrappers depend on libraries that are not licensed for commercial use (docs/IMAGE_TO_3D.md, Licences).
 */
export const IMAGE_TO_3D_LICENCE_NOTICE =
  'image-to-3D is on (AETHER_IMAGE_TO_3D_URL). Check the licences of the wrapper you run: TRELLIS.2 exports through nvdiffrast and nvdiffrec (NVIDIA, research or evaluation only), TripoSG reference scripts use diso (CC BY-NC 4.0) and RMBG-1.4 (non-commercial). See docs/IMAGE_TO_3D.md.';

/** Register the route. */
export function registerImageTo3dRoutes(app: Hono<AppEnv>, deps: { provider: ImageTo3DProvider; logger: Logger; shutdownSignal?: AbortSignal }): void {
  deps.logger.warn(IMAGE_TO_3D_LICENCE_NOTICE, { provider: deps.provider.id });
  let busy = false;
  // Streams are cut at the cap even without a Content-Length header.
  app.use('/api/image-to-3d', jsonBodyLimit(MAX_IMAGE_BYTES));
  app.post('/api/image-to-3d', async (c) => {
    const type = (c.req.header('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    if (!/^image\/(png|jpeg|webp)$/.test(type)) return fail(c, 415, 'unsupported-media-type', 'Send a PNG, JPEG or WebP image.');
    const declared = Number(c.req.header('content-length') ?? '0');
    if (declared > MAX_IMAGE_BYTES) return fail(c, 413, 'payload-too-large', 'The image is too large (limit 12 MB).');
    // One generation at a time: the GPU behind the wrapper is the user's own.
    if (busy) return fail(c, 429, 'busy', 'An image is already being converted; try again shortly.');
    busy = true;
    try {
      const body = new Uint8Array(await c.req.arrayBuffer());
      if (body.byteLength === 0 || body.byteLength > MAX_IMAGE_BYTES) return fail(c, 413, 'payload-too-large', 'The image is empty or too large (limit 12 MB).');
      const { glb } = await deps.provider.generate(body, deps.shutdownSignal ? { signal: deps.shutdownSignal } : {});
      return c.body(glb as Uint8Array<ArrayBuffer>, 200, { 'content-type': 'model/gltf-binary', 'cache-control': 'no-store' });
    } catch (err) {
      deps.logger.warn('image-to-3d failed', { reqId: c.get('requestId'), error: err instanceof Error ? err.message.slice(0, 200) : 'error' });
      return fail(c, 502, 'upstream-error', 'The image-to-3D service could not produce a model.');
    } finally {
      busy = false;
    }
  });
}
