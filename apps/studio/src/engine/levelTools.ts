/**
 * Level tools for the agent (`query_level`, `place_level_items`): the physics
 * and the walking map behind them load on first use, so the studio's first
 * paint does not pay for them.
 */
import type { LevelToolRunner } from '@aether/agent';
import type { ColliderProvider } from '@aether/physics';

/** The part of the simulation the tools need: the colliders the renderer built, once it has drawn the latest world. */
export interface ColliderSource {
  colliders: ColliderProvider;
  whenSynced(): Promise<void>;
}

/**
 * A runner that imports the measuring code the first time the assistant asks. With a simulation, the shapes made by custom
 * generators (terrain, streets, buildings) are measured with the colliders the renderer built for them; without one they are
 * placeholder boxes and every reach answer is wrong.
 */
export function levelToolsFor(source: () => ColliderSource | null): LevelToolRunner {
  return async (world, name, input) => {
    const sim = source();
    if (sim) await sim.whenSynced().catch(() => undefined);
    const { runLevelTool } = await import('@aether/playtest/level');
    const r = await runLevelTool(world, name, input, sim ? { colliders: sim.colliders } : {});
    return { ok: r.ok, text: r.text, patches: r.patches, message: r.message, ...(r.data ? { data: r.data } : {}) };
  };
}

/** The runner with no simulation behind it (tests, headless). */
export const lazyLevelTools: LevelToolRunner = levelToolsFor(() => null);
