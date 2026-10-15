/**
 * The scripted "model" of the design e2e: the design plan and the tool calls
 * a good designer would send for a bedroom, and the fix for a painting hung
 * over the window. Shared with the unit test that proves the script itself
 * is sound (so the e2e fails only when the product breaks).
 */
export const BEDROOM_PLAN = {
  id: 'bedroom-home',
  name: 'Bedroom',
  style: 'scandinavian',
  brief: 'A calm bedroom with a double bed under two pictures and a window with curtains.',
  programme: [{ room: 'bedroom', purpose: 'sleep', targetArea: 16.7 }],
  circulation: { entrance: 'bedroom', notes: 'The door is on the south wall; the path to the bed stays clear.' },
  levels: [
    {
      height: 2.8,
      rooms: [{ id: 'bedroom', type: 'bedroom', rect: [0, 0, 4.4, 3.8] }],
      openings: [
        { id: 'win-e', kind: 'window', room: 'bedroom', wall: 'east', along: 1.9, width: 1.4, height: 1.3, sill: 0.9 },
        { id: 'door-s', kind: 'door', room: 'bedroom', wall: 'south', to: 'outside', along: 3.4, width: 0.9, main: true },
      ],
    },
  ],
  furniture: [
    { id: 'bed', kind: 'bed', room: 'bedroom', intent: 'double bed centred on the north wall', relations: [{ type: 'against_wall', wall: 'north' }, { type: 'centred_on_wall', wall: 'north' }] },
    { id: 'ns-l', kind: 'nightstand', room: 'bedroom', intent: 'nightstand left of the bed', relations: [{ type: 'flanks', target: 'bed', side: 'left', gap: 0.4 }] },
    { id: 'ns-r', kind: 'nightstand', room: 'bedroom', intent: 'nightstand right of the bed', relations: [{ type: 'flanks', target: 'bed', side: 'right', gap: 0.4 }] },
    { id: 'curtains', kind: 'curtain', room: 'bedroom', intent: 'curtains framing the window', relations: [{ type: 'centred_on_opening', target: 'win-e' }] },
    { id: 'picture', kind: 'art', room: 'bedroom', intent: 'a picture centred above the bed', relations: [{ type: 'above_centred', target: 'bed', gap: 0.3 }] },
    { id: 'light', kind: 'ceiling-light', room: 'bedroom', intent: 'light in the middle of the ceiling', relations: [] },
  ],
};

export const BEDROOM_ITEMS = [
  { kind: 'bed', room: 'bedroom', id: 'bed', wall: 'north', align: 'centre' },
  { kind: 'nightstand', room: 'bedroom', id: 'ns-l', wall: 'north', t: 0.7 },
  { kind: 'nightstand', room: 'bedroom', id: 'ns-r', wall: 'north', t: 3.7 },
  { kind: 'curtain', room: 'bedroom', id: 'curtains', opening: 'win-e' },
  { kind: 'art', room: 'bedroom', id: 'picture', wall: 'north', t: 2.2, y: 1.5 },
  { kind: 'ceiling-light', room: 'bedroom', id: 'light', at: [2.2, 1.9] },
  { kind: 'rug', room: 'bedroom', id: 'rug', at: [2.2, 2.0] },
];

/** The fix of "why is the painting over the window?": hang it on the free stretch of the north wall. */
export const PAINTING_FIX = [{ op: 'move', ref: 'bedroom-home-picture', wall: 'north', t: 2.2, y: 1.5 }];
