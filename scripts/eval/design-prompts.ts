/**
 * Prompts of the AI-first design evaluation: rooms and houses of different
 * size, style and difficulty. Each has a stable id (the fixture file name).
 */
export interface DesignPrompt {
  id: string;
  kind: 'room' | 'house';
  prompt: string;
}

export const DESIGN_PROMPTS: readonly DesignPrompt[] = Object.freeze([
  { id: 'bedroom-window', kind: 'room', prompt: 'A bedroom with a window, a door, a double bed, curtains and pictures on the wall.' },
  { id: 'bedroom-scandi', kind: 'room', prompt: 'A calm scandinavian bedroom for two with a bed under a picture, two nightstands, a wardrobe and a reading chair by the window.' },
  { id: 'bedroom-kids', kind: 'room', prompt: "A child's bedroom with a single bed, a desk by the window, a toy shelf and a play rug." },
  { id: 'bedroom-small', kind: 'room', prompt: 'A tiny 2.5 by 3 metre bedroom with a bed, a small wardrobe and one window.' },
  { id: 'master-suite', kind: 'room', prompt: 'A master bedroom with an ensuite bathroom, a walk-in wardrobe and a window seat.' },
  { id: 'living-sofa', kind: 'room', prompt: 'A living room with a sofa facing a TV wall, a coffee table, an armchair, a bookshelf and a big window.' },
  { id: 'living-fireplace', kind: 'room', prompt: 'A cosy living room with a fireplace, two armchairs, a sofa, a rug and floor lamps.' },
  { id: 'living-open', kind: 'room', prompt: 'An open-plan living, dining and kitchen room, 8 by 5 metres, with two windows and a door to the garden.' },
  { id: 'dining', kind: 'room', prompt: 'A formal dining room with a long table for six, a sideboard and a pendant light.' },
  { id: 'kitchen-galley', kind: 'room', prompt: 'A galley kitchen with counters on both sides, a window at the end and a door at the other end.' },
  { id: 'kitchen-island', kind: 'room', prompt: 'A modern kitchen with an island, bar stools, a fridge and a window above the sink.' },
  { id: 'bathroom', kind: 'room', prompt: 'A bathroom with a bath, a toilet, a basin with a mirror and a frosted window.' },
  { id: 'bathroom-shower', kind: 'room', prompt: 'A small bathroom with a walk-in shower, a toilet and a vanity.' },
  { id: 'home-office', kind: 'room', prompt: 'A home office with a desk facing the window, a chair, a bookshelf and a sofa bed.' },
  { id: 'study-library', kind: 'room', prompt: 'A study with floor-to-ceiling bookshelves, a leather armchair, a desk and a lamp.' },
  { id: 'nursery', kind: 'room', prompt: 'A nursery with a cot, a changing table, a rocking chair and soft lighting.' },
  { id: 'hallway', kind: 'room', prompt: 'A narrow entrance hall with a front door, a console table, a mirror and a coat rack.' },
  { id: 'studio-flat', kind: 'room', prompt: 'A 30 square metre studio flat with a sleeping area, a small kitchen and a sofa, in an industrial style.' },
  { id: 'cafe', kind: 'room', prompt: 'A small cafe with a counter, six tables with chairs, a window onto the street and pendant lights.' },
  { id: 'meeting-room', kind: 'room', prompt: 'A meeting room with a long table for eight, chairs, a whiteboard and a window.' },
  { id: 'open-office', kind: 'room', prompt: 'A small open office with six desks, a meeting corner and plants.' },
  { id: 'japandi-lounge', kind: 'room', prompt: 'A japandi lounge with low furniture, a rug, a plant, paper lamps and a wide window.' },
  { id: 'classic-parlour', kind: 'room', prompt: 'A classic parlour with a fireplace, two sofas facing each other, a chandelier-like pendant and tall windows.' },
  { id: 'loft', kind: 'room', prompt: 'An industrial loft with a high ceiling, a big window wall, a sofa area and a dining table.' },
  { id: 'gym', kind: 'room', prompt: 'A home gym with a mirror wall, a bench, a rug and a window.' },
  { id: 'laundry', kind: 'room', prompt: 'A laundry room with a washer, a dryer, a counter and a window.' },
  { id: 'reading-nook', kind: 'room', prompt: 'A reading nook with an armchair, a floor lamp, a bookshelf and a small side table by a window.' },
  { id: 'guest-room', kind: 'room', prompt: 'A guest room with a sofa bed, a desk, a wardrobe and a picture above the bed.' },
  { id: 'teen-room', kind: 'room', prompt: "A teenager's room with a bed, a desk with a chair, a bookshelf, a beanbag and posters." },
  { id: 'apartment-1br', kind: 'house', prompt: 'A one-bedroom apartment with a living room, a kitchen, a bathroom and a bedroom, all furnished.' },
  { id: 'apartment-2br', kind: 'house', prompt: 'A modern two-bedroom apartment with an open living and kitchen area, a bathroom and an entrance hall.' },
  { id: 'apartment-3br-classic', kind: 'house', prompt: 'A three-bedroom classic apartment with two bathrooms, a living room and a separate kitchen.' },
  { id: 'cottage', kind: 'house', prompt: 'A small cottage with a living room with fireplace, a kitchen, one bedroom and a bathroom.' },
  { id: 'villa-two-storey', kind: 'house', prompt: 'A two-storey villa: living, dining and kitchen downstairs, three bedrooms and two bathrooms upstairs, with stairs.' },
  { id: 'family-house', kind: 'house', prompt: 'A family house with a hall, a living room, a kitchen with dining area, a study, and two bedrooms.' },
  { id: 'townhouse', kind: 'house', prompt: 'A narrow three-storey townhouse with a kitchen and dining on the ground floor, a living room above and bedrooms at the top.' },
  { id: 'bungalow', kind: 'house', prompt: 'A single-storey bungalow with a living room, a kitchen, two bedrooms, a bathroom and a hall.' },
  { id: 'office-floor', kind: 'house', prompt: 'An office floor with a reception, two meeting rooms, an open office area and a kitchenette.' },
  { id: 'cafe-bakery', kind: 'house', prompt: 'A bakery cafe with a seating room, a counter area, a kitchen at the back and a toilet.' },
  { id: 'granny-flat', kind: 'house', prompt: 'A granny flat with a bedroom, a bathroom, and a combined living and kitchen room, with step-free doors.' },
  { id: 'scandi-house', kind: 'house', prompt: 'A scandinavian house with a light living room, an open kitchen, two bedrooms, a bathroom and a mudroom entry.' },
  { id: 'japandi-flat', kind: 'house', prompt: 'A japandi apartment with a tatami-style bedroom, a minimal living room, a kitchen and a bathroom.' },
  { id: 'loft-two-level', kind: 'house', prompt: 'A two-level industrial loft with a living area below and a sleeping gallery above reached by stairs.' },
  { id: 'shop-flat', kind: 'house', prompt: 'A small shop with a sales room, a storage room and a toilet, and a shop window onto the street.' },
  { id: 'broken-fix', kind: 'room', prompt: 'A bedroom with a window, a door, a double bed, curtains and pictures on the wall, placed so that nothing covers the door or the window.' },
]);
