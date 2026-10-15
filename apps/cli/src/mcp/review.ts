/**
 * Headless review renders: the AI's corner, wall and plan views of a
 * building, drawn by the deterministic software renderer with the numbered
 * marks on top. No GPU and no browser, so the CLI, the MCP server and the
 * evaluation harness can let a vision model look at what it built.
 *
 * It is a proof-of-look (flat sun and sky light, no bounced light), good
 * enough to judge layout, scale, clutter and what covers what; the studio
 * renders the same poses with the real renderer.
 */
import type { Entity, EntityId, WorldDoc } from '@aether/core';
import { drawMarksRgba, type ReviewViewRequest } from '@aether/agent';
import type { SandboxRunner } from '@aether/procgen';
import { encodePng } from './png';
import { renderStill } from './raster';
import { buildScene, type Scene } from './scene';

/** Options of {@link captureReviewHeadless}. */
export interface HeadlessReviewOptions {
  sandbox?: SandboxRunner;
  /** Image width in pixels (default 640); the height follows each view's aspect. */
  width?: number;
  maxTriangles?: number;
  signal?: AbortSignal;
  /** Overrides of the review environment (the photo flow lifts the light to the exposure of a photograph). */
  environment?: Partial<WorldDoc['environment']>;
}

/** The document with ceilings and roofs hidden (plan views from above). */
export function withoutTops(world: WorldDoc): WorldDoc {
  const entities: Record<EntityId, Entity> = { ...world.entities };
  for (const e of Object.values(world.entities)) {
    const role = e.arch?.role;
    if (role === 'ceiling' || role === 'roof') entities[e.id] = { ...e, visible: false };
    // Ceiling fittings would float once the ceiling is gone.
    else if (e.tags.includes('mount-ceiling')) entities[e.id] = { ...e, visible: false };
  }
  return { ...world, entities };
}

/** Nudge a straight-down camera so the renderer's fixed up vector stays defined (north stays up). */
function nonDegenerate(from: [number, number, number], to: [number, number, number]): [number, number, number] {
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
export function reviewEnvironment(world: WorldDoc): WorldDoc['environment'] {
  const env = world.environment;
  return { ...env, sky: 'studio', ambientIntensity: 0.6, exposure: 1.25 };
}

/** Render the requested views; views that fail are left out. */
export async function captureReviewHeadless(world: WorldDoc, views: readonly ReviewViewRequest[], opts: HeadlessReviewOptions = {}): Promise<Array<{ name: string; dataUrl: string }>> {
  const width = Math.max(240, Math.min(1024, Math.round(opts.width ?? 640)));
  const maxTriangles = opts.maxTriangles ?? 1_500_000;
  const scenes = new Map<boolean, Scene>();
  const sceneFor = async (hideTops: boolean): Promise<Scene> => {
    const have = scenes.get(hideTops);
    if (have) return have;
    const built = await buildScene(hideTops ? withoutTops(world) : world, { maxTriangles, ...(opts.sandbox ? { sandbox: opts.sandbox } : {}), ...(opts.signal ? { signal: opts.signal } : {}) });
    scenes.set(hideTops, built);
    return built;
  };
  const out: Array<{ name: string; dataUrl: string }> = [];
  for (const v of views) {
    if (opts.signal?.aborted) break;
    try {
      const height = Math.round(width / Math.max(0.5, Math.min(3, v.aspect)));
      const scene = await sceneFor(v.hideTops);
      const from = v.hideTops ? nonDegenerate(v.pose.position, v.pose.target) : v.pose.position;
      const still = renderStill(scene, { ...reviewEnvironment(world), ...(opts.environment ?? {}) }, { width, height, from, lookAt: v.pose.target, fovDeg: v.pose.fov });
      drawMarksRgba(still.rgba, still.width, still.height, v.marks);
      out.push({ name: v.name, dataUrl: `data:image/png;base64,${encodePng(still.rgba, still.width, still.height).toString('base64')}` });
    } catch (e) {
      if (opts.signal?.aborted) throw e;
    }
  }
  return out;
}
