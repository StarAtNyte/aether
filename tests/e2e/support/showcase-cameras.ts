/**
 * Cover cameras of the flagship showcase worlds (art-directed compositions
 * for `npm run showcase:thumbs`): eye position and look-at target in world
 * metres. Flagships without an entry use the editor's own framing.
 */
export interface CoverCamera {
  pos: readonly [number, number, number];
  target: readonly [number, number, number];
  /** Architecture view for the shot (cutaway walls, exploded storeys). */
  arch?: { walls?: 'up' | 'cutaway' | 'down'; levelMode?: 'stacked' | 'exploded' };
  /** Block worlds: heights are relative to the terrain surface under the target. */
  overGround?: boolean;
}

export const COVER_CAMERAS: Readonly<Record<string, CoverCamera>> = Object.freeze({
  'lantern-isles': { pos: [30, 23, 30], target: [-10, 29, -42] },
  'chain-reaction': { pos: [-38, 4.2, 10], target: [-22, 1.3, -3] },
  blockfall: { pos: [-38, 24, -62], target: [6, 3, -6], overGround: true },
  'kart-canyon': { pos: [31, 3.6, 142], target: [17, 2.2, 62] },
  'neon-rain-city': { pos: [4, 3.2, 42], target: [-1, 9, -40] },
  'kyoto-temple': { pos: [0.6, 2.1, 53], target: [-1.5, 2.6, 24] },
  'painterly-meadow': { pos: [66, 6.5, 26], target: [40, 2.5, -6] },
  'four-seasons-garden': { pos: [36, 20, 42], target: [0, 0.5, 0] },
  'orbital-lab': { pos: [24, 9, 27], target: [0, 3, 0] },
  'sakura-river': { pos: [31, 5.5, 229], target: [19, 2.2, 182] },
  'skyline-penthouse': { pos: [-20, 9, -25], target: [2, 2, 2], arch: { walls: 'cutaway' } },
  'dusk-lake-house': { pos: [30, 13, 38], target: [6, 4.5, 4], arch: { levelMode: 'exploded' } },
  'hollow-gate': { pos: [10, 2.8, 0.5], target: [-1.5, 1.9, -11] },
});
