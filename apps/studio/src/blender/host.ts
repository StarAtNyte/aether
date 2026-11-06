/**
 * Blender for this studio page: the client of the local server's
 * `/api/local/blender/*`, the confirmation gate (one per page) and the
 * agent's tool runner. Loaded only when the local server reports Blender
 * ready; never on a hosted page.
 */
import { createBlenderApi, createBlenderToolRunner, runBlenderAction, type BlenderActionOutcome, type BlenderHostDeps, type BlenderPlanRequest } from '@aether/agent/blender';
import type { HostToolRunner } from '@aether/agent';
import type { UserAssetMeta } from '@aether/assets';
import { BlenderGate } from './gate';

/** Where exported models go (the studio's asset controller). */
export interface GlbImporter {
  importGlb(bytes: Uint8Array, name: string): Promise<{ ok: true; meta: UserAssetMeta } | { ok: false; error: string }>;
}

let gate: BlenderGate | null = null;

/** The page's gate (the dialog module loads on the first question). */
export function blenderGate(): BlenderGate {
  gate ??= new BlenderGate(async (request) => (await import('./ConfirmDialog')).askBlenderConfirm(request));
  return gate;
}

/** Host dependencies over the studio's assets. */
export function blenderHost(assets: GlbImporter, fetchImpl?: typeof fetch): BlenderHostDeps {
  const g = blenderGate();
  return {
    api: createBlenderApi(fetchImpl ? { fetch: fetchImpl } : {}),
    confirm: (r) => g.confirm(r),
    async importGlb(bytes, name) {
      const r = await assets.importGlb(bytes, name);
      if (!r.ok) return r;
      return { ok: true, id: r.meta.id, summary: `${r.meta.name}, ${(r.meta.triangles ?? 0).toLocaleString('en-US')} triangles` };
    },
  };
}

/** The agent's Blender tools. */
export function studioBlenderRunner(assets: GlbImporter): HostToolRunner {
  return createBlenderToolRunner(blenderHost(assets));
}

/** Run one action from the UI (plan, confirm, run). */
export function runStudioBlenderAction(assets: GlbImporter, request: BlenderPlanRequest, signal?: AbortSignal): Promise<BlenderActionOutcome> {
  return runBlenderAction(blenderHost(assets), request, signal);
}
