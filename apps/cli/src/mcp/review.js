import { drawMarksRgba } from '@aether/agent';
import { encodePng } from './png';
import { renderStill } from './raster';
import { buildScene } from './scene';
/** The document with ceilings and roofs hidden (plan views from above). */
export function withoutTops(world) {
    const entities = { ...world.entities };
    for (const e of Object.values(world.entities)) {
        const role = e.arch?.role;
        if (role === 'ceiling' || role === 'roof')
            entities[e.id] = { ...e, visible: false };
        // Ceiling fittings would float once the ceiling is gone.
        else if (e.tags.includes('mount-ceiling'))
            entities[e.id] = { ...e, visible: false };
    }
    return { ...world, entities };
}
/** Nudge a straight-down camera so the renderer's fixed up vector stays defined (north stays up). */
function nonDegenerate(from, to) {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const dz = to[2] - from[2];
    const len = Math.hypot(dx, dy, dz) || 1;
    return Math.abs(dy) / len > 0.999 ? [from[0], from[1], from[2] + len * 0.03] : from;
}
/**
 * The environment of review renders: the document's, with the ambient light and exposure lifted. The
 * software renderer has no bounced light, so a room with one small window would otherwise be near black.
 */
export function reviewEnvironment(world) {
    const env = world.environment;
    return { ...env, sky: 'studio', ambientIntensity: 0.6, exposure: 1.25 };
}
/** Render the requested views; views that fail are left out. */
export async function captureReviewHeadless(world, views, opts = {}) {
    const width = Math.max(240, Math.min(1024, Math.round(opts.width ?? 640)));
    const maxTriangles = opts.maxTriangles ?? 1_500_000;
    const scenes = new Map();
    const sceneFor = async (hideTops) => {
        const have = scenes.get(hideTops);
        if (have)
            return have;
        const built = await buildScene(hideTops ? withoutTops(world) : world, { maxTriangles, ...(opts.sandbox ? { sandbox: opts.sandbox } : {}), ...(opts.signal ? { signal: opts.signal } : {}) });
        scenes.set(hideTops, built);
        return built;
    };
    const out = [];
    for (const v of views) {
        if (opts.signal?.aborted)
            break;
        try {
            const height = Math.round(width / Math.max(0.5, Math.min(3, v.aspect)));
            const scene = await sceneFor(v.hideTops);
            const from = v.hideTops ? nonDegenerate(v.pose.position, v.pose.target) : v.pose.position;
            const still = renderStill(scene, { ...reviewEnvironment(world), ...(opts.environment ?? {}) }, { width, height, from, lookAt: v.pose.target, fovDeg: v.pose.fov });
            drawMarksRgba(still.rgba, still.width, still.height, v.marks);
            out.push({ name: v.name, dataUrl: `data:image/png;base64,${encodePng(still.rgba, still.width, still.height).toString('base64')}` });
        }
        catch (e) {
            if (opts.signal?.aborted)
                throw e;
        }
    }
    return out;
}
