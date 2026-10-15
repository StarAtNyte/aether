/**
 * Level tools for the agent (`query_level`, `place_level_items`): the physics
 * and the walking map behind them load on first use, so the studio's first
 * paint does not pay for them.
 */
import type { LevelToolRunner } from '@aether/agent';

/** A runner that imports the measuring code the first time the assistant asks. */
export const lazyLevelTools: LevelToolRunner = async (world, name, input) => {
  const { runLevelTool } = await import('@aether/playtest/level');
  const r = await runLevelTool(world, name, input);
  return { ok: r.ok, text: r.text, patches: r.patches, message: r.message, ...(r.data ? { data: r.data } : {}) };
};
