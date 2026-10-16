import { fail } from '../http';
import { jsonBodyLimit } from '../middleware';
/** Largest accepted reference image. */
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
/** Register the route. */
export function registerImageTo3dRoutes(app, deps) {
    let busy = false;
    // Streams are cut at the cap even without a Content-Length header.
    app.use('/api/image-to-3d', jsonBodyLimit(MAX_IMAGE_BYTES));
    app.post('/api/image-to-3d', async (c) => {
        const type = (c.req.header('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
        if (!/^image\/(png|jpeg|webp)$/.test(type))
            return fail(c, 415, 'unsupported-media-type', 'Send a PNG, JPEG or WebP image.');
        const declared = Number(c.req.header('content-length') ?? '0');
        if (declared > MAX_IMAGE_BYTES)
            return fail(c, 413, 'payload-too-large', 'The image is too large (limit 12 MB).');
        // One generation at a time: the GPU behind the wrapper is the user's own.
        if (busy)
            return fail(c, 429, 'busy', 'An image is already being converted; try again shortly.');
        busy = true;
        try {
            const body = new Uint8Array(await c.req.arrayBuffer());
            if (body.byteLength === 0 || body.byteLength > MAX_IMAGE_BYTES)
                return fail(c, 413, 'payload-too-large', 'The image is empty or too large (limit 12 MB).');
            const { glb } = await deps.provider.generate(body, deps.shutdownSignal ? { signal: deps.shutdownSignal } : {});
            return c.body(glb, 200, { 'content-type': 'model/gltf-binary', 'cache-control': 'no-store' });
        }
        catch (err) {
            deps.logger.warn('image-to-3d failed', { reqId: c.get('requestId'), error: err instanceof Error ? err.message.slice(0, 200) : 'error' });
            return fail(c, 502, 'upstream-error', 'The image-to-3D service could not produce a model.');
        }
        finally {
            busy = false;
        }
    });
}
