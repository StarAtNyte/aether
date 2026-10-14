/**
 * Offline planner for real-life architecture: apartments, houses, villas,
 * offices, cafés and single rooms become `build_architecture` plans (the
 * same tool a connected model uses), and simple edits of an existing
 * building ("make it scandinavian", "marble floors", "a gable roof",
 * "remove the tv") become plan ops. Deterministic; plans are chosen so the
 * compiled interiors pass the `navigable` check (rooms reachable, doors
 * swing free, furniture grounded without overlaps).
 */
import type { PatchInput } from '@aether/core';
import type { MockPlan } from './planner';

/** Interior styles of @aether/arch plans. */
type Style = 'modern' | 'scandinavian' | 'industrial' | 'japandi' | 'classic';
type Rect = [number, number, number, number];
type Room = { id: string; type: string; rect: Rect; name?: string; items?: Array<Record<string, unknown>>; omit?: string[]; floor?: Record<string, unknown> };
type Door = { between: [string, string]; kind?: 'swing' | 'sliding' | 'opening'; width?: number; side?: 'north' | 'south' | 'east' | 'west'; main?: boolean };
type Level = { name?: string; height: number; rooms: Room[]; doors: Door[]; stairs?: Array<Record<string, unknown>> };
type Plan = { id: string; name: string; style: Style; levels: Level[]; roof?: Record<string, unknown>; site?: Record<string, unknown> };

/** Requests that describe a building or an interior (checked after block worlds). */
const ARCH_REQUEST =
  /\b(apartments?|flats?|penthouse|loft|condo|villa|mansion|bungalow|townhouse|duplex|floor ?plans?|interiors?|archviz|living ?rooms?|bedrooms?|bathrooms?|kitchens?|home office|office (floor|space|interior|layout)|meeting rooms?|co-?working|caf[eé]s?|coffee (shop|house)|restaurant|two[- ]stor(e)?y|(modern|contemporary|minimalist|family|suburban|scandinavian|japandi|industrial|classic|luxury|beach|lake) (house|home|villa|cabin))\b/;
/** Requests that look like a building but belong to other planners. */
const NOT_ARCH = /\b(haunted|block|blocky|voxel|minecraft|pixel|lego|village|town|castle|ruins?|space ?station|spaceship|dungeon|game|collect|race|maze)\b/;

const STYLE_WORDS: ReadonlyArray<[RegExp, Style]> = [
  [/\bscandi(navian)?|nordic|hygge\b/, 'scandinavian'],
  [/\bjapandi|japanese|zen|wabi\b/, 'japandi'],
  [/\bindustrial|warehouse|brick loft|exposed\b/, 'industrial'],
  [/\bclassic|traditional|victorian|parisian|haussmann|elegant\b/, 'classic'],
  [/\bmodern|contemporary|minimal(ist)?\b/, 'modern'],
];

const FINISH_WORDS: ReadonlyArray<[RegExp, string]> = [
  [/\bherringbone\b/, 'herringbone'],
  [/\bmarble\b/, 'marble'],
  [/\bterrazzo\b/, 'terrazzo'],
  [/\bwalnut\b/, 'walnut'],
  [/\bash\b/, 'ash'],
  [/\boak|wood(en)?\b/, 'oak'],
  [/\bconcrete\b/, 'concrete'],
  [/\btiles?d?\b/, 'tile'],
  [/\bcarpet(ed)?\b/, 'carpet'],
  [/\bstone\b/, 'stone'],
];

const COLORS: Readonly<Record<string, string>> = Object.freeze({
  white: '#f2f0eb', cream: '#efe6d2', beige: '#e3d6bf', grey: '#b9b7b2', gray: '#b9b7b2', sage: '#b7c2a8', green: '#9fb59a', olive: '#8f9466',
  blue: '#9fb4c8', navy: '#2f3d55', terracotta: '#c9805d', pink: '#e7c4bf', yellow: '#eed9a2', black: '#2b2b2d', charcoal: '#3d3f42', brown: '#8a6a52',
});

const ITEM_WORDS: ReadonlyArray<[RegExp, string]> = [
  [/\bfireplace\b/, 'fireplace'], [/\bplants?\b/, 'plant'], [/\bbook ?(shelf|shelves|case)\b/, 'bookshelf'], [/\btv|television\b/, 'tv'], [/\brugs?\b/, 'rug'],
  [/\bsofa|couch\b/, 'sofa'], [/\barm ?chairs?\b/, 'armchair'], [/\bdesk\b/, 'desk'], [/\bmirror\b/, 'mirror'], [/\b(art|painting|picture)s?\b/, 'art'],
  [/\bfloor ?lamp\b/, 'floor-lamp'], [/\bpendant\b/, 'pendant'], [/\bcurtains?\b/, 'curtain'], [/\bwardrobe\b/, 'wardrobe'], [/\bisland\b/, 'island'], [/\bbath ?tub\b/, 'bathtub'],
];

function styleOf(text: string, fallback: Style): Style {
  for (const [re, s] of STYLE_WORDS) if (re.test(text)) return s;
  return fallback;
}

function count(text: string, noun: RegExp, fallback: number, min: number, max: number): number {
  const words: Record<string, number> = { one: 1, single: 1, two: 2, three: 3, four: 4, five: 5 };
  const m = new RegExp(`\\b(\\d+|one|single|two|three|four|five)[- ]${noun.source}`).exec(text);
  if (!m) return fallback;
  const raw = m[1] as string;
  const n = /^\d+$/.test(raw) ? Number(raw) : (words[raw] ?? fallback);
  return Math.max(min, Math.min(max, n));
}

/** Apartment with `beds` bedrooms: living + kitchen in front, a hall spine, bedrooms and a bathroom behind. */
function apartment(style: Style, beds: number, name: string): Plan {
  const bedW = 3.6;
  const bathW = 2.6;
  const width = Math.max(10, beds * bedW + bathW);
  const back: Room[] = [];
  let x = 0;
  for (let i = 0; i < beds; i++) {
    const w = i === 0 ? bedW + (width - beds * bedW - bathW) : bedW;
    back.push({ id: i === 0 ? 'master' : `bed${i + 1}`, type: i === beds - 1 && beds >= 3 ? 'kids' : 'bedroom', name: i === 0 ? 'Main bedroom' : `Bedroom ${i + 1}`, rect: [x, 6.6, x + w, 10.6] });
    x += w;
    if (i === 0) {
      back.push({ id: 'bath', type: 'bathroom', rect: [x, 6.6, x + bathW, 10.6] });
      x += bathW;
    }
  }
  const kitchenW = 4;
  return {
    id: 'apartment',
    name,
    style,
    levels: [{
      name: 'Apartment',
      height: 2.9,
      rooms: [
        { id: 'living', type: 'living', rect: [0, 0, width - kitchenW, 5] },
        { id: 'kitchen', type: 'kitchen', rect: [width - kitchenW, 0, width, 5] },
        { id: 'hall', type: 'hall', rect: [0, 5, width, 6.6] },
        ...back,
      ],
      doors: [
        { between: ['hall', 'outside'], side: 'east', main: true, width: 1 },
        { between: ['hall', 'living'], kind: 'opening', width: 1.6 },
        { between: ['living', 'kitchen'], kind: 'opening', width: 2.2 },
        ...back.map((r): Door => ({ between: ['hall', r.id], ...(r.type === 'bathroom' ? { width: 0.8 } : {}) })),
      ],
    }],
  };
}

/** Studio / loft: one open-plan room with a bathroom. */
function loft(style: Style): Plan {
  return {
    id: 'loft',
    name: style === 'industrial' ? 'Industrial loft' : 'Studio loft',
    style,
    levels: [{
      height: 3.4,
      rooms: [
        { id: 'studio', type: 'living', name: 'Open-plan living', rect: [0, 0, 9, 7], items: [{ kind: 'bed', against: 'north' }] },
        { id: 'kitchen', type: 'kitchen', rect: [9, 0, 12.4, 4.2] },
        { id: 'bath', type: 'bathroom', rect: [9, 4.2, 12.4, 7] },
      ],
      doors: [
        { between: ['studio', 'outside'], side: 'south', main: true, width: 1 },
        { between: ['studio', 'kitchen'], kind: 'opening', width: 2 },
        { between: ['studio', 'bath'], width: 0.8 },
      ],
    }],
  };
}

/** A single furnished room (living room, bedroom, kitchen, office …) with an entry. */
function singleRoom(style: Style, type: string, name: string, items: Array<Record<string, unknown>>): Plan {
  const size: Record<string, [number, number]> = { living: [7, 5.6], bedroom: [4.6, 4.2], kitchen: [5, 4], bathroom: [3.2, 2.8], office: [4.4, 3.8], dining: [5.2, 4.2], kids: [4.2, 3.8] };
  const [w, d] = size[type] ?? [6, 5];
  return {
    id: 'home',
    name,
    style,
    levels: [{
      height: 2.9,
      rooms: [{ id: 'room', type, name, rect: [0, 0, w, d], items }],
      doors: [{ between: ['room', 'outside'], side: 'south', main: true, width: 1 }],
    }],
  };
}

/** Café: dining room with a counter, a kitchen and a washroom. */
function cafe(style: Style): Plan {
  return {
    id: 'cafe',
    name: 'Corner café',
    style,
    levels: [{
      height: 3.4,
      rooms: [
        { id: 'cafe', type: 'cafe', name: 'Café', rect: [0, 0, 9, 7] },
        { id: 'kitchen', type: 'kitchen', name: 'Back kitchen', rect: [9, 0, 12, 4] },
        { id: 'wc', type: 'bathroom', name: 'Washroom', rect: [9, 4, 12, 7] },
      ],
      doors: [
        { between: ['cafe', 'outside'], side: 'south', main: true, width: 1.2, kind: 'swing' },
        { between: ['cafe', 'kitchen'], width: 0.9 },
        { between: ['cafe', 'wc'], width: 0.8 },
      ],
    }],
  };
}

/** Office floor: open office, two meeting rooms, lobby, break room and washroom. */
function office(style: Style): Plan {
  return {
    id: 'office',
    name: 'Office floor',
    style,
    levels: [{
      name: 'Office floor',
      height: 3.4,
      rooms: [
        { id: 'open', type: 'open-office', name: 'Open office', rect: [0, 0, 14, 8] },
        { id: 'meet1', type: 'meeting', name: 'Meeting room A', rect: [14, 0, 19, 4] },
        { id: 'meet2', type: 'meeting', name: 'Meeting room B', rect: [14, 4, 19, 8] },
        { id: 'lobby', type: 'lobby', name: 'Reception', rect: [0, 8, 6, 11.5] },
        { id: 'break', type: 'kitchen', name: 'Break room', rect: [6, 8, 11, 11.5] },
        { id: 'wc', type: 'bathroom', name: 'Washroom', rect: [11, 8, 14, 11.5] },
      ],
      doors: [
        { between: ['lobby', 'outside'], side: 'south', main: true, width: 1.4, kind: 'sliding' },
        { between: ['lobby', 'open'], kind: 'opening', width: 2 },
        { between: ['open', 'meet1'], kind: 'sliding', width: 1 },
        { between: ['open', 'meet2'], kind: 'sliding', width: 1 },
        { between: ['open', 'break'], kind: 'opening', width: 1.6 },
        { between: ['open', 'wc'], width: 0.9 },
      ],
    }],
  };
}

/** Two-storey villa with a stair, terrace and pool. */
function villa(style: Style, pool: boolean, roof: string): Plan {
  return {
    id: 'villa',
    name: pool ? 'Villa with a pool' : 'Two-storey house',
    style,
    levels: [
      {
        name: 'Ground floor',
        height: 3.1,
        rooms: [
          { id: 'living', type: 'living', rect: [0, 0, 8, 6] },
          { id: 'kitchen', type: 'kitchen', rect: [8, 0, 12, 6] },
        ],
        doors: [
          { between: ['living', 'outside'], side: 'south', main: true, width: 1.1 },
          { between: ['living', 'kitchen'], kind: 'opening', width: 2 },
        ],
        stairs: [{ at: [0.5, 1.2], heading: 'east', width: 1 }],
      },
      {
        name: 'Upper floor',
        height: 2.9,
        rooms: [
          { id: 'landing', type: 'hall', name: 'Landing', rect: [0, 0, 6, 3] },
          { id: 'master', type: 'bedroom', name: 'Main bedroom', rect: [0, 3, 6, 6] },
          { id: 'bath', type: 'bathroom', rect: [6, 0, 9, 6] },
        ],
        doors: [{ between: ['landing', 'master'] }, { between: ['landing', 'bath'] }],
      },
    ],
    roof: { shape: roof, pitch: 30 },
    ...(pool ? { site: { terrace: [[-2, 6], [14, 6], [14, 14], [-2, 14]], pool: { at: [6, 10.5], width: 7, length: 3 } } } : {}),
  };
}

/** Recognise a building request and choose its plan. */
function choosePlan(text: string): { plan: Plan; blurb: string } | null {
  const style = (fallback: Style): Style => styleOf(text, fallback);
  if (/\boffice|meeting rooms?|co-?working|workspace\b/.test(text) && !/\bhome office\b/.test(text)) return { plan: office(style('modern')), blurb: 'an office floor with an open office, two meeting rooms, reception, break room and washroom' };
  if (/\bcaf[eé]s?|coffee (shop|house)|restaurant|bistro\b/.test(text)) return { plan: cafe(style('industrial')), blurb: 'a café with a counter, tables, a back kitchen and a washroom' };
  if (/\bvilla|mansion|two[- ]stor(e)?y|duplex|(beach|lake|family|modern|contemporary|luxury|suburban) (house|home)\b|\bhouse with\b/.test(text)) {
    const pool = /\bpool\b/.test(text) || /\bvilla\b/.test(text);
    const roof = /\bgable|pitched|cottage\b/.test(text) ? 'gable' : /\bhip(ped)?\b/.test(text) ? 'hip' : /\bshed|mono-?pitch\b/.test(text) ? 'shed' : 'flat';
    return { plan: villa(style('modern'), pool, roof), blurb: `a two-storey ${pool ? 'villa with a terrace and pool' : 'house'}: open living and kitchen downstairs, a stair up to the main bedroom and bathroom` };
  }
  if (/\bloft|studio apartment|studio flat\b/.test(text)) return { plan: loft(style('industrial')), blurb: 'an open-plan loft with a kitchen and bathroom' };
  if (/\bapartments?|flats?|penthouse|condo|townhouse|bungalow|floor ?plans?|archviz|interiors?\b/.test(text) && !/\b(living|bed|bath)rooms?\b.*\bonly\b/.test(text)) {
    const beds = count(text, /bed(room)?s?/, 2, 1, 4);
    const name = `${['One', 'Two', 'Three', 'Four'][beds - 1]}-bedroom apartment`;
    return { plan: apartment(style('modern'), beds, name), blurb: `a ${beds}-bedroom apartment: living room, kitchen, hall, ${beds} bedroom${beds > 1 ? 's' : ''} and a bathroom` };
  }
  const items: Array<Record<string, unknown>> = [];
  if (/\bfireplace\b/.test(text)) items.push({ kind: 'fireplace', against: 'north' });
  if (/\bliving ?rooms?|lounge\b/.test(text)) return { plan: singleRoom(style('scandinavian'), 'living', 'Living room', items), blurb: `a furnished living room${items.length ? ' with a fireplace' : ''}` };
  if (/\bbedrooms?\b/.test(text)) return { plan: singleRoom(style('japandi'), 'bedroom', 'Bedroom', items), blurb: 'a furnished bedroom' };
  if (/\bkitchens?\b/.test(text)) return { plan: singleRoom(style('modern'), 'kitchen', 'Kitchen', items), blurb: 'a fitted kitchen' };
  if (/\bbathrooms?\b/.test(text)) return { plan: singleRoom(style('modern'), 'bathroom', 'Bathroom', items), blurb: 'a bathroom' };
  if (/\bhome office|study\b/.test(text)) return { plan: singleRoom(style('scandinavian'), 'office', 'Home office', items), blurb: 'a home office' };
  return null;
}

/** Environment of an architecture scene: warm afternoon light through the windows. */
function environment(text: string): PatchInput[] {
  const night = /\bnight|evening|dusk\b/.test(text);
  const sunset = /\bsunset|golden hour\b/.test(text);
  const sky = night ? 'night' : sunset ? 'sunset' : 'day';
  const time = night ? 21.5 : sunset ? 17.6 : 15.2;
  return [
    { op: 'clear', keepEnvironment: false },
    { op: 'setEnvironment', set: { sky, timeOfDay: time, weather: 'clear', fog: { color: night ? '#1b2333' : '#dfe7ef', density: 0.004 }, bloom: night ? 1 : 0.35, ground: { material: { preset: 'grass', color: '#7c9a5a' }, size: 160 } } },
  ];
}

/** Building id from the world summary (`arch building` entity line), if any. */
export function summaryBuilding(summary: string): { id: string; rooms: Array<{ id: string; type: string }> } | null {
  const lines = summary.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const m = /^\s*([a-z][a-z0-9-]{0,63}) \|.*\| arch building\b/.exec(line);
    if (!m) continue;
    const digest = lines[i + 1] ?? '';
    const rooms = [...digest.matchAll(/([a-z][a-z0-9-]*)\(([a-z-]+) "/g)].map((r) => ({ id: r[1] as string, type: r[2] as string }));
    return { id: m[1] as string, rooms };
  }
  return null;
}

/** Room types named in an edit ("in the living room", "bedroom floors"). */
function roomsNamed(text: string, rooms: ReadonlyArray<{ id: string; type: string }>): string[] {
  const types: Array<[RegExp, string[]]> = [
    [/\bliving ?rooms?|lounge\b/, ['living']], [/\bbed ?rooms?\b/, ['bedroom', 'kids']], [/\bkitchens?\b/, ['kitchen']], [/\bbath ?rooms?|washrooms?\b/, ['bathroom']],
    [/\bhall(way)?s?|landing\b/, ['hall', 'entry', 'lobby']], [/\boffices?|study\b/, ['office', 'open-office']], [/\bmeeting rooms?\b/, ['meeting']], [/\bcaf[eé]\b/, ['cafe']],
  ];
  const want = types.filter(([re]) => re.test(text)).flatMap(([, t]) => t);
  return rooms.filter((r) => want.includes(r.type)).map((r) => r.id);
}

/** Plan ops for an edit of an existing building, or null when the request is not an architecture edit. */
function editOps(text: string, building: { id: string; rooms: Array<{ id: string; type: string }> }): { ops: Array<Record<string, unknown>>; done: string[] } | null {
  const ops: Array<Record<string, unknown>> = [];
  const done: string[] = [];
  const b = building.id;
  const targeted = roomsNamed(text, building.rooms);
  for (const [re, s] of STYLE_WORDS) {
    if (re.test(text) && /\b(style|make it|restyle|turn it|change it|furnish|decorate|redo)\b/.test(text)) {
      ops.push({ op: 'set_style', building: b, style: s });
      done.push(`restyled ${s}`);
      break;
    }
  }
  const roof = /\b(gable|hip(ped)?|shed|flat|pitched)\b.*\broof\b|\broof\b.*\b(gable|hip(ped)?|shed|flat|pitched)\b/.exec(text);
  if (roof) {
    const shape = /gable|pitched/.test(roof[0]) ? 'gable' : /hip/.test(roof[0]) ? 'hip' : /shed/.test(roof[0]) ? 'shed' : 'flat';
    ops.push({ op: 'set_roof', building: b, roof: { shape } });
    done.push(`${shape} roof`);
  }
  if (/\bfloors?|flooring|parquet\b/.test(text)) {
    const fin = FINISH_WORDS.find(([re]) => re.test(text));
    if (fin) {
      const rooms = targeted.length > 0 ? targeted : [undefined];
      for (const room of rooms) ops.push({ op: 'set_material', building: b, target: 'floor', ...(room ? { room } : {}), material: { finish: fin[1] } });
      done.push(`${fin[1]} floors`);
    }
  }
  const paint = /\b(paint|walls?)\b/.test(text) ? Object.keys(COLORS).find((c) => new RegExp(`\\b${c}\\b`).test(text)) : undefined;
  if (paint) {
    const rooms = targeted.length > 0 ? targeted : [undefined];
    for (const room of rooms) ops.push({ op: 'set_material', building: b, target: 'walls', ...(room ? { room } : {}), material: { color: COLORS[paint] } });
    done.push(`${paint} walls`);
  }
  if (/\b(brick|stone|concrete|wood(en)?|timber) (facade|exterior|outside)\b|\bexterior\b.*\b(brick|stone|concrete|wood)\b/.test(text)) {
    const fin = /brick/.test(text) ? 'brick' : /stone/.test(text) ? 'stone' : /concrete/.test(text) ? 'concrete' : 'decking';
    ops.push({ op: 'set_material', building: b, target: 'exterior', material: { finish: fin } });
    done.push(`${fin} exterior`);
  }
  const remove = /\b(remove|delete|take out|get rid of|no)\b/.test(text);
  const add = /\b(add|put|place|give|want)\b/.test(text);
  if (remove || add) {
    for (const [re, kind] of ITEM_WORDS) {
      if (!re.test(text)) continue;
      const rooms = targeted.length > 0 ? targeted : remove ? building.rooms.map((r) => r.id) : building.rooms.filter((r) => r.type === 'living' || r.type === 'cafe' || r.type === 'open-office').map((r) => r.id).slice(0, 1);
      for (const room of rooms) ops.push(remove ? { op: 'remove_item', building: b, room, kind } : { op: 'place_item', building: b, room, item: { kind } });
      if (rooms.length > 0) done.push(`${remove ? 'removed' : 'added'} ${kind}`);
    }
  }
  return ops.length > 0 ? { ops, done } : null;
}

/**
 * Plan an architecture request, or null when it is not one. `summary` is the
 * current world summary (edits apply to the building it lists).
 */
export function planArch(request: string, summary: string): MockPlan | null {
  const text = request.toLowerCase();
  const building = summaryBuilding(summary);
  const describesNew = /\b(build|create|make|design|generate|give me|show me|i want|new|an?|the)\b/.test(text) && ARCH_REQUEST.test(text) && !NOT_ARCH.test(text);
  if (building && !(describesNew && /\b(build|create|design|generate|new|another|instead)\b/.test(text))) {
    const edit = editOps(text, building);
    if (edit) {
      return {
        plan: `Plan: edit building ${building.id} (${edit.done.join(', ')}).`,
        patches: [],
        arch: { ops: edit.ops, message: `Edit ${building.id}: ${edit.done.join(', ')}`.slice(0, 120) },
        message: `Done — ${edit.done.join('; ')}. The building was re-compiled and re-checked.`,
      };
    }
    if (!describesNew) return null;
  }
  if (!ARCH_REQUEST.test(text) || NOT_ARCH.test(text)) return null;
  const chosen = choosePlan(text);
  if (!chosen) return null;
  const { plan, blurb } = chosen;
  const name = plan.name;
  return {
    plan: `Plan: ${plan.style} ${name.toLowerCase()} — ${plan.levels.length} level(s), ${plan.levels.reduce((n, l) => n + l.rooms.length, 0)} rooms, compiled with build_architecture and checked for walkability.`,
    patches: [...environment(text), { op: 'setMeta', name, description: request.slice(0, 200) }],
    arch: { ops: [{ op: 'create_building', plan }], message: name },
    message: `Built ${blurb} in a ${plan.style} style. Walk in with WASD, press E at doors and light switches, 1–4 for the time of day, R to swap materials; use the Architecture bar for floor plan, cutaway, exploded and section views.`,
  };
}
