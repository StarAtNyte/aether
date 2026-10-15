/**
 * The world summary a model reads: the core summary plus, for each
 * parametric building, its walls with their doors and windows, the pieces
 * hanging on them (pictures, curtains, mirrors …) and any placement problem
 * with a ready fix. Without it a model cannot tell which wall a curtain is on
 * or what it overlaps.
 */
import { summarizeWorld, type SummaryOptions, type WorldDoc } from '@aether/core';
import { describeWallPlacements } from '@aether/arch';

/** Summary options plus `compact` (small-context providers get placement problems only). */
export interface ModelSummaryOptions extends Omit<SummaryOptions, 'buildingDetail'> {
  compact?: boolean;
}

/** Summarize `world` for a model (see module docs). */
export function summarizeWorldForModel(world: WorldDoc, opts: ModelSummaryOptions = {}): string {
  const { compact, ...rest } = opts;
  return summarizeWorld(world, { ...rest, buildingDetail: (w, id) => describeWallPlacements(w, id, { compact: compact === true }) });
}
