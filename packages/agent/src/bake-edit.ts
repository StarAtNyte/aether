/**
 * Baked interior light as an edit: the `bake_light` tool. The assistant looks at renders of a room or house and decides
 * whether its light needs a bake: corners and the floor under furniture that read flat, the same smooth value on every wall,
 * no sense of light reaching the back of the room. The tool stores the decision in the World IR (`environment.lightBake`) by
 * an ordinary patch, so it is one undo step, shows in a diff and survives saving and sharing. The renderer does the work: it
 * path-traces a lightmap in a worker, shows a "baking" status the user can cancel, caches the result by content and keeps the
 * probe volume (then nothing) underneath if the bake cannot run.
 *
 * Nothing here judges the result: the assistant looks at the next renders and decides whether to bake again at another
 * quality, or turn it off.
 */
import { z } from 'zod';
import type { Patch, WorldDoc } from '@aether/core';

export const BAKE_QUALITIES = ['off', 'low', 'medium', 'high'] as const;

/** Input of the `bake_light` tool. */
export const BakeLightInput = z.object({
  /** off: probe volume only; low 256 px / 24 rays; medium 512 px / 48; high 1024 px / 96. */
  quality: z.enum(BAKE_QUALITIES),
  /** Rays per texel (8..512), overriding the quality's. More rays: smoother, slower. */
  samples: z.number().int().min(8).max(512).optional(),
  /** Why, in a sentence: shown in the history. */
  message: z.string().max(200).optional(),
});
export type BakeLightInput = z.infer<typeof BakeLightInput>;

const ATLAS: Record<Exclude<BakeLightInput['quality'], 'off'>, { px: number; rays: number }> = { low: { px: 256, rays: 24 }, medium: { px: 512, rays: 48 }, high: { px: 1024, rays: 96 } };

/** What the world currently asks for, in words. */
export function bakeText(world: WorldDoc): string {
  const b = world.environment.lightBake;
  if (!b) return 'baked light: automatic (the renderer bakes a medium lightmap of a building on its own where the machine can afford it)';
  if (b.quality === 'off') return 'baked light: off (probe volume only)';
  const a = ATLAS[b.quality];
  return `baked light: ${b.quality} (up to ${a.px} px atlas, ${b.samples ?? a.rays} rays per texel)`;
}

/** Patches and words for a `bake_light` call. */
export function bakePatches(world: WorldDoc, input: BakeLightInput): { patches: Patch[]; summary: string } {
  const cur = world.environment.lightBake;
  if (cur && cur.quality === input.quality && (cur.samples ?? null) === (input.samples ?? null)) return { patches: [], summary: `Nothing changed: ${bakeText(world)}.` };
  // `samples: null` drops an earlier override (the merge rules delete a field set to null).
  const value = input.quality === 'off' ? { quality: 'off', samples: null } : { quality: input.quality, samples: input.samples ?? null };
  const patches: Patch[] = [{ op: 'setEnvironment', set: { lightBake: value } as never }];
  if (input.quality === 'off') return { patches, summary: 'Baked light set to off: buildings keep the probe volume light only.' };
  const a = ATLAS[input.quality];
  const rays = input.samples ?? a.rays;
  return {
    patches,
    summary: `Baked light set to ${input.quality} (up to ${a.px} px atlas, ${rays} rays per texel). The renderer path-traces it in the background once the light volume is up (seconds to about a minute; the room shows the probe light meanwhile and the editor shows a cancellable "baking" status), then applies it to walls, floors, ceilings and furniture; it also falls back to the probe light if baking cannot run on this machine. Look at the next renders to judge it: dynamic lamps, doors and the sun's direct light stay live. Moving a wall or furniture bakes again.`,
  };
}
