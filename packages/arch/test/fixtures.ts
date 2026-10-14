/** Shared building plans for arch tests. */
import type { BuildingPlanInput } from '../src/index';

/** A two-bedroom apartment: hall spine, living + kitchen, two bedrooms, bathroom. */
export const APARTMENT: BuildingPlanInput = {
  id: 'apt',
  name: 'Two-bedroom apartment',
  style: 'modern',
  levels: [
    {
      height: 2.9,
      rooms: [
        { id: 'living', type: 'living', rect: [0, 0, 6, 5] },
        { id: 'kitchen', type: 'kitchen', rect: [6, 0, 10, 5] },
        { id: 'hall', type: 'hall', rect: [0, 5, 10, 6.6] },
        { id: 'bed1', type: 'bedroom', rect: [0, 6.6, 4, 10.6] },
        { id: 'bath', type: 'bathroom', rect: [4, 6.6, 6.6, 10.6] },
        { id: 'bed2', type: 'bedroom', rect: [6.6, 6.6, 10, 10.6] },
      ],
      doors: [
        { between: ['hall', 'outside'], side: 'east', main: true, width: 1 },
        { between: ['hall', 'living'], kind: 'opening', width: 1.6 },
        { between: ['living', 'kitchen'], kind: 'opening', width: 2.2 },
        { between: ['hall', 'bed1'] },
        { between: ['hall', 'bath'], width: 0.8 },
        { between: ['hall', 'bed2'] },
      ],
    },
  ],
};

