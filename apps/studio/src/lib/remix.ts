/**
 * "Remix" suggestions shown under the latest agent turn: one-tap follow-up
 * prompts chosen from the current environment (never suggest what the world
 * already is). Each carries the sky preset it leads to, so the chip can
 * preview the new world's colors before it is pressed.
 */
import type { Environment } from '@aether/core';

/** One follow-up prompt chip. */
export interface RemixSuggestion {
  /** Chip label and the prompt that is sent. */
  prompt: string;
  /** Sky preset the world will have afterwards (for the color preview). */
  sky: Environment['sky'];
}

/** Maximum number of chips shown at once. */
export const MAX_REMIXES = 3;

/** Follow-up prompts for a world with this environment (at most {@link MAX_REMIXES}). */
export function remixSuggestions(env: Pick<Environment, 'sky' | 'weather' | 'gravity'>): RemixSuggestion[] {
  const out: RemixSuggestion[] = [];
  const sky = env.sky;
  if (sky === 'space' || sky === 'studio') {
    out.push({ prompt: 'Make it night', sky: 'night' });
  } else if (sky === 'night') {
    out.push({ prompt: 'Make it sunrise', sky: 'dawn' });
  } else {
    out.push({ prompt: 'Make it night', sky: 'night' });
    if (sky !== 'sunset') out.push({ prompt: 'Make it sunset', sky: 'sunset' });
  }
  if (sky !== 'space' && env.weather !== 'rain' && env.weather !== 'snow') out.push({ prompt: 'Make it snow', sky });
  const gy = env.gravity[1];
  if (gy < -5) out.push({ prompt: 'Low gravity', sky });
  return out.slice(0, MAX_REMIXES);
}

/**
 * The follow-up chips under a finished turn: one chip per prompt (the first refine chip and the remix of the sky can
 * be the same words), at most three without a selection, and none for a world with nothing in it.
 */
export function followUpChips<T extends { prompt: string }>(all: readonly T[], selectionCount: number, entityCount: number): T[] {
  if (entityCount === 0) return [];
  const unique = all.filter((c, i) => all.findIndex((o) => o.prompt.toLowerCase() === c.prompt.toLowerCase()) === i);
  return selectionCount > 0 ? unique : unique.slice(0, 3);
}
