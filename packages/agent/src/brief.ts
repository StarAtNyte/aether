/**
 * The generation brief: the first step of a world built from a text prompt.
 *
 * Without it a general prompt ("make a cinema hall") comes out minimal: the model builds the shortest thing that answers the
 * words. The brief makes the model first write down, from its own knowledge, what makes this kind of space recognisable
 * (zones, the elements with realistic counts and sizes, materials, light) and how elaborate the user wants it. The build then
 * uses it as a checklist and the review compares the result with it.
 *
 * The model decides everything here. Code only keeps the books: it validates the shape of the brief, words it for the
 * conversation, and counts pieces as advisory evidence. No count is a gate, and no word list decides how elaborate a request
 * is: that is the model's statement (`elaboration`, with a one-line reason from the prompt's wording).
 */
import { z } from 'zod';
import type { Entity, WorldDoc } from '@aether/core';
import { REVIEW_ASPECT, type ReviewSnapshot } from './review';
import type { ReviewViewRequest, ToolDef } from './types';

export const BRIEF_TOOL_NAME = 'submit_brief';
export const REFERENCE_TOOL_NAME = 'look_closer';

export const ELABORATIONS = ['elaborate', 'moderate', 'minimal'] as const;
export type Elaboration = (typeof ELABORATIONS)[number];

const short = (n: number) => z.string().trim().min(1).max(n);

const BriefElement = z.object({
  name: short(60),
  /** Realistic count for this world's size (rows of seats: how many seats in all). */
  count: z.number().int().min(1).max(5000),
  /** Size in metres, or any short dimension note ("12 m wide, 5 m tall"). */
  size: z.string().trim().max(80).optional(),
  note: z.string().trim().max(160).optional(),
  /** Words that appear in the names, ids or tags of the pieces that stand for this element (for the advisory piece count). */
  find: z.array(short(30)).max(6).optional(),
  /**
   * How the pieces get placed, chosen by the model: a one-call layout (`tier` raked seating, `grid` blocks, `perimeter` seats
   * around tables (with their covers and candles), `around` the walls of a room, `wall` hung along a wall, `along` down a line, `row` along a polyline, `scatter` a loose spread) or `single`
   * for one-offs. The checklist repeats it so a count of 40 never becomes 40 hand-placed pieces.
   */
  how: z.enum(['tier', 'grid', 'perimeter', 'around', 'wall', 'along', 'row', 'scatter', 'single']).optional(),
});

export const BriefSchema = z.object({
  elaboration: z.enum(ELABORATIONS),
  elaboration_reason: short(200),
  kind: short(80),
  summary: short(400),
  /** Overall size in words and metres ("about 24 m by 16 m, 9 m tall"). */
  scale: short(120),
  zones: z.array(z.object({ name: short(60), purpose: short(160), size: z.string().trim().max(60).optional() })).min(1).max(14),
  elements: z.array(BriefElement).min(1).max(60),
  materials: z.array(short(80)).max(14),
  lighting: short(300),
  richness: z.object({ kinds: z.number().int().min(1).max(400), pieces: z.number().int().min(1).max(20000), note: z.string().trim().max(200).optional(), /** How the counts follow from the floor area, the wall length and the spacing of the pieces. */ basis: z.string().trim().max(900).optional() }),
  reference: z.object({ generate: z.boolean(), reason: short(240), prompt: z.string().trim().max(600).optional() }),
});
export type Brief = z.infer<typeof BriefSchema>;
export type BriefElementT = z.infer<typeof BriefElement>;

export const BRIEF_TOOL: ToolDef = {
  name: BRIEF_TOOL_NAME,
  description:
    'Write the brief for the world before anything is built. {elaboration: "elaborate"|"moderate"|"minimal", elaboration_reason (one line, from the wording of the request), kind (what kind of space or world), summary, scale ("about 24 m by 16 m, 9 m tall"), zones:[{name, purpose, size?}], elements:[{name, count, size?, note?, find?:[words that appear in the names or tags of the pieces standing for it], how?: tier|grid|perimeter|around|wall|along|row|scatter|single (the one-call layout that places it)}], materials:[...], lighting (mood and sources), richness:{kinds (distinct kinds of things), pieces (total pieces), note?, basis (the arithmetic behind the counts: area, wall length, spacing)}, reference:{generate (true only when you want a reference image), reason, prompt? (what the image shows)}}.',
  inputSchema: {
    type: 'object',
    properties: {
      elaboration: { type: 'string', enum: [...ELABORATIONS] },
      elaboration_reason: { type: 'string' },
      kind: { type: 'string' },
      summary: { type: 'string' },
      scale: { type: 'string' },
      zones: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, purpose: { type: 'string' }, size: { type: 'string' } }, required: ['name', 'purpose'] } },
      elements: {
        type: 'array',
        items: {
          type: 'object',
          properties: { name: { type: 'string' }, count: { type: 'integer' }, size: { type: 'string' }, note: { type: 'string' }, find: { type: 'array', items: { type: 'string' } }, how: { type: 'string', enum: ['tier', 'grid', 'perimeter', 'around', 'wall', 'along', 'row', 'scatter', 'single'] } },
          required: ['name', 'count'],
        },
      },
      materials: { type: 'array', items: { type: 'string' } },
      lighting: { type: 'string' },
      richness: { type: 'object', properties: { kinds: { type: 'integer' }, pieces: { type: 'integer' }, note: { type: 'string' }, basis: { type: 'string' } }, required: ['kinds', 'pieces'] },
      reference: { type: 'object', properties: { generate: { type: 'boolean' }, reason: { type: 'string' }, prompt: { type: 'string' } }, required: ['generate', 'reason'] },
    },
    required: ['elaboration', 'elaboration_reason', 'kind', 'summary', 'scale', 'zones', 'elements', 'materials', 'lighting', 'richness', 'reference'],
    additionalProperties: false,
  },
};

/** `look_closer` for the planner when a reference image was generated: crops of it, to pull details. */
export const REFERENCE_TOOL: ToolDef = {
  name: REFERENCE_TOOL_NAME,
  description:
    'Study the generated reference image of this space (an AI-made picture for ideas, not a photograph of a real place and not something to copy exactly). {regions:[{box:[x0,y0,x1,y1] in 0..1 (origin top-left), note?}] (up to 4)} returns a crop of each box; {whole:true} returns the whole picture. Look for details worth building: fittings, materials, spacing, light. Read-only.',
  inputSchema: {
    type: 'object',
    properties: {
      regions: { type: 'array', maxItems: 4, items: { type: 'object', properties: { box: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 }, note: { type: 'string' } }, required: ['box'] } },
      whole: { type: 'boolean' },
    },
    additionalProperties: false,
  },
};

export const ReferenceLook = z.object({
  regions: z.array(z.object({ box: z.tuple([z.number(), z.number(), z.number(), z.number()]), note: z.string().max(120).optional() })).max(4).optional(),
  whole: z.boolean().optional(),
});

/** The instruction for the brief call. `webSearch`: the provider can search the web (ideas in text only). */
export function briefSystem(opts: { webSearch?: boolean } = {}): string {
  return [
    'You are the first step of a 3D world builder. Before anything is built you write the BRIEF: what this world must contain to be recognisable and rich, so the build is not the shortest thing that answers the words. Call submit_brief once.',
    '',
    'Write it from your own knowledge of the kind of space or world.' + (opts.webSearch ? ' You may search the web for ideas; use text only, and never copy or keep pictures from the web.' : ''),
    '',
    'First state how elaborate the user wants it (elaboration) with a one-line reason taken from their wording:',
    '- "elaborate" is the DEFAULT for a general prompt ("make a cinema hall", "make a museum", "a village"): a full-scale, detailed, lived-in result with everything that makes the place recognisable.',
    '- "minimal" only when the user states a small scale or asks for simplicity (a tiny cabin, a small room, simple, minimal, just a box): keep it small and sparse, with only the few things that matter.',
    '- "moderate" when the wording points between the two (a modest shop, a quick sketch of a street).',
    'Judge this from the meaning of the request, not from single words. The richness target follows your statement.',
    '',
    'Then give: kind, summary, scale (real metres, sized as the real kind of place would be at the requested size), zones (areas and what each is for), elements (what makes this kind of space recognisable, each with a realistic COUNT and size; for repeated things give the total, e.g. seats, and say rows in note), materials, lighting mood and sources, and the richness target: roughly how many distinct kinds of things and how many pieces, scaled to the world size (an elaborate furnished room of 4 x 5 m is tens of pieces, a hall or a house hundreds, a village or harbour a few hundred more than that with scatter counted; a minimal one is a handful of kinds). Counts are your estimate, not a quota.',
    'Give each kind of thing its own element (a painting and its wall label are two elements, a table and its chairs are two, a column and its pilaster two) so the counts can be read, and for each element give `find`: words that appear in the names or tags of the pieces you will place for it and of no other element, so the pieces can be counted later. And give `how`, the one-call layout that places it, so a large count is one call and not that many pieces by hand: tier (raked seats), grid (blocks: desks, pews, stacks, stalls), perimeter (chairs, table settings and candles around and on tables), around (columns, pilasters, planters, sconces on every wall of a room), wall (paintings with their wall labels, posters, acoustic panels, sconces hung along a wall), along (cases, statues, stanchions, lamps, stools down a line), grid (also ceiling baffles over a hall), row (trees, posts along a path), scatter (loose spread), single (one-offs: screen, stage, counter).',
    '',
    'COUNTS FOLLOW THE SIZE, NOT ENTHUSIASM. Work each count out from the floor area, the wall length and the spacing a real place keeps, and write the arithmetic in richness.basis (for example "gallery 20 x 30 m: 100 m of wall at 2.5 m per painting is 40 paintings in one row at eye height; 16 cases, one per 35 m2 of floor; 1.8 m aisles between them"). Typical pitches: one painting or poster per 2.5 to 3 m of wall in one row at eye height (a second row only where the wall is taller than 4 m), a table of four per 5 to 6 m2 of dining floor, a seat per 0.55 m of row, a column per 4 to 6 m of colonnade, a stanchion per 1.5 to 2 m of rope line, a plant per 6 to 10 m of wall, a pendant per 3 m of ceiling. Keep circulation: aisles of 1.2 m or more, nothing blocking a door. Too many is as wrong as too few: a 20 x 30 m museum has 20 to 40 paintings, not 150. For a big hall the counts are in the tens to low hundreds of the main pieces, not thousands.',
    'If a thing you want has no matching part or model, say so in that element\'s note ("no statue part: crafting one") and name the substitute: the nearest sensible piece that still reads as the thing, or one crafted from primitives. Never stand in a different kind of object for it (a tree is not a statue, a street lamp is not a stanchion, a bench is not a pew). Crafted parts exist for statue, bust, rope-stanchion, plaque, place-setting, candle, column, pilaster, ceiling-baffle, planter, cinema-seat, pew, vitrine and more: find_model lists them.',
    'An enclosed building (hall, restaurant, museum, church, gym, clinic, shop, school) is also seen from outside: include one element named "Exterior facade" (count 1, find: facade, canopy, sign, forecourt, entrance) whose note says what the front has: an entrance with a canopy or door surround, a lit sign with the name, the window rhythm, a roofline cornice, a base plinth, paving at the forecourt, planters and lamps. A plain box with trees is not an exterior.',
    '',
    'Example of the level of detail for a cinema hall (elaborate): tiered stepped floor, 8 to 14 rows of seats with aisle steps and floor lights, a screen about 12 m wide, projection booth and beam, acoustic wall panels, curtains, exit signs, ceiling baffles, wall sconces, a lobby with a concession counter, posters, carpet. Do the same kind of thinking for a library, restaurant, church, gym, clinic, school, museum, airport lounge, and for outdoor or game worlds (village, harbour, forest camp, sci-fi corridor).',
    '',
    'Finally decide whether to look at a generated reference image (reference.generate). Do it for an elaborate request of a specific, visually distinctive space you are unsure about (a cathedral, an airport, a museum, a cinema hall). Skip it for simple or minimal requests and for things you already know well. Give the reason either way; when generating, write `prompt`: what the picture shows (one wide interior or exterior view, realistic, no text).',
  ].join('\n');
}

/** What the brief call is shown. */
export function briefRequestText(request: string): string {
  return `<request>\n${request.replace(/<\/?request>/gi, '')}\n</request>\nWrite the brief for this request.`;
}

/** Validate a submit_brief input; the message names what to fix. */
export function parseBrief(input: unknown): { ok: true; brief: Brief } | { ok: false; error: string } {
  const r = BriefSchema.safeParse(input);
  if (r.success) return { ok: true, brief: r.data };
  return { ok: false, error: `submit_brief refused: ${r.error.issues.slice(0, 6).map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')}` };
}

/** The brief as the build's checklist (the model reads it at the start of the build and in the review). */
export function briefChecklistText(b: Brief, notes?: string): string {
  const lines = [
    `BRIEF for this world (your own plan; build to it, in order of importance). Elaboration: ${b.elaboration}, because ${b.elaboration_reason}.`,
    `Kind: ${b.kind}. ${b.summary}`,
    `Scale: ${b.scale}.`,
    `Zones: ${b.zones.map((z) => `${z.name}${z.size ? ` (${z.size})` : ''}: ${z.purpose}`).join('; ')}.`,
    'Elements (count, size):',
    ...b.elements.map((e) => `- ${e.name}: ${e.count}${e.size ? `, ${e.size}` : ''}${e.note ? `; ${e.note}` : ''}${e.how && e.how !== 'single' ? ` [place with shape_land ${e.how}]` : ''}`),
    `Materials: ${b.materials.join('; ') || 'as fits'}.`,
    `Lighting: ${b.lighting}`,
    `Richness target: about ${b.richness.kinds} distinct kinds and ${b.richness.pieces} pieces${b.richness.note ? ` (${b.richness.note})` : ''}${b.richness.basis ? `. Basis: ${b.richness.basis}` : ''}. Estimates for the size of this world, not a quota.`,
  ];
  if (notes?.trim()) lines.push(`The user added to the plan: ${notes.trim().slice(0, 1000)}`);
  lines.push(
    b.elaboration === 'minimal'
      ? 'The user wants it small and simple: keep it sparse and do not add extras beyond what they asked.'
      : [
          'Build the elements at their counts, and build each as the real object. Pick pieces with find_model where it has them: crafted parts with real detail exist for many venue pieces (furn-cinema-seat, furn-tier-steps, furn-cinema-screen, furn-stage, furn-speaker, furn-acoustic-panel, furn-step-light, furn-lectern, furn-pew, furn-altar, furn-library-stack, furn-vitrine, furn-reception-desk, furn-school-desk, furn-blackboard, furn-market-stall, furn-bus-stop, furn-hospital-bed, furn-treadmill, furn-weight-bench, furn-statue (figure, bust or abstract on a plinth), furn-rope-stanchion, furn-plaque (wall label), furn-place-setting, furn-candle, furn-column (round, fluted, square or pilaster), furn-ceiling-baffle (baffle, raft or coffer), furn-planter, furn-plant, furn-table, furn-chair, furn-cane-chair, furn-bookshelf, furn-frame ...), then photographed library models; never build a seat, shelf, desk or display case from boxes when a part exists.',
          'Place every repeated element in ONE call, never one entity per piece (place_items is for the furniture of one room, 40 a call): shape_land {op:"tier"} raked seating on a stepped floor (rows, seatsPerRow, aisles; the sightline is solved); {op:"grid"} blocks with aisles (pews, desks, library stacks, market stalls); {op:"perimeter", at:[every table centre], table:{of:"furn-table"}, long:2, settings:{of:"furn-place-setting"}, centre:{of:"furn-candle"}} the table, its seats, a cover (plate, glasses, cutlery) at every seat and a candle in the middle of every table at every position (14 tables of 4 is one call: 56 seats, 56 covers, 14 candles); {op:"wall", from, to, count, y, variants:[...], labels:{of:"furn-plaque", y:1.25}} paintings, posters, acoustic panels, sconces hung along a wall, each with a wall label beside it when you give labels (32 paintings on four walls is four calls; variants give different subjects and frames; one row at eye height, not several); {op:"along", from, to, count, of:"furn-vitrine"} cases, statues (furn-statue), lamps, stools down a line, a rope line (furn-rope-stanchion with spacing 1.6: the rope reaches the next post by itself); {op:"around", rect:[x0,z0,x1,z1], of:"furn-column", params:{variant:"pilaster"}, spacing:4} the same piece on all four walls of a room (columns or pilasters round a hall, planters, sconces); ceiling baffles or coffers are {op:"grid", of:"furn-ceiling-baffle", y:<ceiling height>, cols, rows} over a hall; {op:"row"} trees and posts along a path. They work inside a building too: use the world coordinates of the room from query_scene or your plan. One-offs (screen, stage, counter, altar, booth window) go in with apply_patches as {"kind":"procedural","generator":"furn-..."} at measured positions. Give every zone its own character. Do not stop when a repeated element is short: send another call.',
          'Make the shell a real building, not boxes: an enclosed venue (hall, restaurant, museum, church, gym, clinic) is a design_plan (a room per zone, ceiling height, furnish:false for rooms you fill with the layouts above; room types hall for an auditorium, gallery or nave, lobby for a foyer, dining or cafe for a restaurant, so the checker does not ask a gallery for a desk; wall finishes such as wood-slats, panelling or plaster, a dado and skirting, a cornice, a ceiling style: coffered for a foyer or gallery, beamed for fins over an auditorium, vault for a nave; doors and windows; the exterior finish and a roof), then filled with the layouts and place_items. Acoustic panels are a wall op of furn-acoustic-panel over the wall finish. Never build walls, ceilings or trim from boxes when design_plan can.',
          'Light it for a visitor at eye height (1.6 m): a venue is dim but never near-black. The focus glows (screen, stage, altar, display cases); aisle and step lights mark the way; cove light along the top of the walls and wall washers every 3-4 m (a wall or along op with furn-sconce and light:{every, intensity} puts real lights beside the pieces); a soft fill so walls, seats and floor read; emissive meshes alone light nothing. State the lighting INTENT once with tune_look {intent:{key:dim|moderate|bright, text}} (a cinema is dim but readable, a cafe bright and airy) and do not set exposure by eye: the renderer measures the picture at eye height and derives the exposure from the intent, `exposure` only biases it. Then look from eye height; if it still reads dark or washed, fix the light (lamps, ambient, the surfaces), not the exposure.',
          'Outside: seen from outside a venue is never a dark box. A building made with design_plan gets a facade pass: put `exteriorWall:{finish}` in a light brick, plaster or cladding (not near-black) and `facade:{sign:"<the name of the place>", canopy:true, doorSurround:true, cornice:true, forecourt:true, lamps:true, planters:true, bench:true}` in the plan (they are on by default; set sign to the name and keep what suits the place): an entrance with a canopy and door surround, a sign with emissive lettering and a real light, a cornice at the roofline, paving at the forecourt, lamp posts, planters and a bench, and a light over the door. Windows: put them in rhythm along the facade (even spacing, same sill and head). Also site {planting, garden:true, surroundings:"estate" for land and trees round the plot}. For a free-piece world: a ground that suits it and tune_look surroundings (meadow, suburb, woodland) so the horizon is not empty. In the review look at the street-level exterior view and the three-quarter aerial as well as the eye-height views inside.',
        ].join('\n'),
  );
  return lines.join('\n');
}

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const stem = (w: string): string => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);

/** Instances a scatter stands for (1 for any other entity). */
function instancesOf(e: Entity): number {
  return e.shape.kind === 'scatter' ? Math.max(1, e.shape.points ? e.shape.points.length : e.shape.count) : 1;
}

/** Words of the crafted part an entity (or the scatter of it) stands for: furn-chair gives "chair". */
function craftedWords(e: Entity): string {
  const g = e.shape.kind === 'procedural' ? e.shape.generator : e.shape.kind === 'scatter' && e.shape.of.kind === 'procedural' ? e.shape.of.generator : '';
  return g.startsWith('furn-') ? ` ${norm(g.slice(5))} ` : '';
}

function entityText(e: Entity, id: string): string {
  const kind = e.shape.kind === 'procedural' ? e.shape.generator : e.shape.kind === 'asset' ? e.shape.id : e.shape.kind === 'scatter' && e.shape.of.kind === 'procedural' ? `scatter ${e.shape.of.generator}` : e.shape.kind;
  return norm(`${id} ${e.name} ${e.tags.join(' ')} ${kind}`);
}

interface ElementCount {
  el: BriefElementT;
  found: number;
  hitIds: string[];
}

/** Pieces found for each brief element, matched by the model's own `find` words (a scatter of 120 seats is 120 pieces). */
function countElements(world: WorldDoc, b: Brief): { ids: string[]; kinds: number; counts: ElementCount[] } {
  const ids = Object.keys(world.entities);
  const texts = ids.map((id) => ({ id, text: ` ${entityText(world.entities[id] as Entity, id)} `, crafted: craftedWords(world.entities[id] as Entity) }));
  const kinds = new Set<string>();
  for (const id of ids) {
    const e = world.entities[id] as Entity;
    kinds.add(e.shape.kind === 'procedural' ? e.shape.generator : e.shape.kind === 'asset' ? e.shape.id : `${e.shape.kind}:${norm(e.name).replace(/\d+/g, '').trim()}`);
  }
  const counts = b.elements.map((el) => {
    const words = (el.find && el.find.length > 0 ? el.find : [el.name]).map((w) => norm(w)).filter(Boolean);
    // A phrase matches when all its words are in the names, ids or tags, or when its last word is the crafted part the piece is
    // ("dining chair" finds furn-chair pieces whatever they were named): the model's wording of an element rarely equals its ids.
    const hitIds = texts
      .filter((t) => words.some((w) => w.split(' ').every((p) => t.text.includes(` ${p} `) || t.text.includes(` ${stem(p)}`)) || (t.crafted !== '' && t.crafted.includes(` ${stem(w.split(' ').pop() as string)} `))))
      .map((t) => t.id);
    return { el, hitIds, found: hitIds.reduce((n, id) => n + instancesOf(world.entities[id] as Entity), 0) };
  });
  return { ids, kinds: kinds.size, counts };
}

/** Advisory evidence for the richness review: piece counts against each brief element. Never a gate. */
export function richnessEvidence(world: WorldDoc, b: Brief): string {
  const { ids, kinds, counts } = countElements(world, b);
  const lines = [`Advisory piece counts (evidence for your judgement, not a pass mark): ${ids.length} entities in the world, about ${kinds} distinct kinds; the brief aimed at about ${b.richness.pieces} pieces and ${b.richness.kinds} kinds.`];
  for (const { el, found, hitIds } of counts) {
    const mark = found === 0 ? 'NONE FOUND' : found < el.count * 0.5 ? 'sparse' : found > Math.max(el.count * 1.6, el.count + 6) ? 'OVER: more than the brief, check for clutter, overlaps and blocked circulation' : 'ok';
    const grouped = found !== hitIds.length ? ` in ${hitIds.length} entit${hitIds.length === 1 ? 'y' : 'ies'}` : '';
    lines.push(`- ${el.name}: brief ${el.count}, found ${found}${grouped} (${mark})${hitIds.length > 0 ? `, e.g. ${hitIds.slice(0, 3).join(', ')}` : ''}${mark !== 'ok' && !mark.startsWith('OVER') && el.how && el.how !== 'single' ? `; place the rest with shape_land ${el.how}` : ''}`);
  }
  const total = counts.reduce((n, c) => n + c.found, 0);
  if (total > b.richness.pieces * 1.6 && total > b.richness.pieces + 20) lines.push(`The elements add up to about ${total} pieces against a target of about ${b.richness.pieces}: look for over-filling (pieces overlapping, stacked at several heights, crowding walls and aisles, circulation under 1.2 m) and remove or thin out what only clutters.`);
  lines.push('A count is only a hint: pieces may be named differently, or one repeated piece may stand for several, or a name may match more than one element. You judge, both ways: too few and too many.');
  return lines.join('\n');
}

/**
 * What the advisory counts say is still short (under half the brief's count, or none found) and what changed since: the review asks
 * the model once per distinct set to build it or to say why not, so a model that stops early is sent back, and one that gives a reason is
 * not asked again.
 */
export function richnessShortfalls(world: WorldDoc, b: Brief): { key: string; text: string } | null {
  if (b.elaboration === 'minimal') return null;
  const short = countElements(world, b).counts.filter(({ el, found }) => found < el.count * 0.5);
  if (short.length === 0) return null;
  return {
    key: `short:${short.map(({ el, found }) => `${el.name}=${found}`).join('|')}`,
    text: short.map(({ el, found }) => `${el.name} (brief ${el.count}, found ${found}${el.how && el.how !== 'single' ? `, place with shape_land ${el.how}` : ''})`).join('; '),
  };
}

/** The richness review turn, shown with the renders: compare the result with the brief and fix what is missing or sparse. */
export function richnessReviewText(b: Brief, world: WorldDoc, round: number, notes?: string): string {
  return [
    'RICHNESS REVIEW. Compare what is built with your brief.',
    briefChecklistText(b, notes),
    richnessEvidence(world, b),
    round === 1 ? 'Look at the renders (eye height inside, the overview, and for a building the street-level exterior and the three-quarter aerial). Call inspect {groups:true} to read the groups of repeated things. List what is missing or sparse against the brief (zones empty, elements absent, rows too few, bare walls, no light fittings, floor and ceiling plain, an exterior that is a plain box) AND what is over-filled (pieces overlapping or stacked, walls crowded, circulation blocked, repeated pieces at several heights: remove them), and any stand-in of the wrong kind (a bench for a pew, a tree for a statue: replace it with the right crafted part or one made of primitives). Then fix the largest gaps with small patches (shape_land tier / grid / row blocks, find_model parts, edit_items). Call finish when the world is as rich as the brief said it should be, or say plainly what you left out and why.' : 'Look again against the brief: what is still missing or sparse? Fix the largest gaps with small patches, or call finish when it is as rich as the brief said.',
    b.elaboration === 'minimal' ? 'The brief is minimal on purpose: do not add extras; only fix what is broken or missing from the few things asked.' : 'The brief asked for an elaborate result unless it says otherwise; do not approve a sparse one.',
  ].join('\n\n');
}

/** Serializable view of a brief for the run record and the chat. */
export interface BriefView {
  brief: Brief;
  /** True when the user may edit the plan before the build starts. */
  editable: boolean;
  /** The reference image decision, recorded whether or not an image was made. */
  reference: ReferenceRecord;
  /** The user's notes added to the plan, when they edited it. */
  notes?: string;
}

export interface ReferenceRecord {
  decision: 'generated' | 'skipped' | 'unavailable' | 'failed';
  reason: string;
  /** The prompt the image was made from. */
  prompt?: string;
  /** "generated reference": an AI-made picture for ideas; never a real photograph, and never stored in the project. */
  provenance?: 'generated reference';
  via?: string;
  model?: string;
}

/** Sentinel in `ReviewSnapshot.buildings` that marks a review of a world that is neither a building nor a playable level. */
export const RICHNESS_SUBJECT = 'world';

/** Where the pieces of a world stand (2nd to 98th percentile, so a far outlier does not stretch it). */
function bounds(world: WorldDoc): { x0: number; x1: number; z0: number; z1: number } | null {
  const xs: number[] = [];
  const zs: number[] = [];
  for (const e of Object.values(world.entities)) {
    const [x, , z] = e.transform.position;
    if (Number.isFinite(x) && Number.isFinite(z) && Math.abs(x) < 500 && Math.abs(z) < 500) {
      xs.push(x);
      zs.push(z);
    }
  }
  if (xs.length === 0) return null;
  xs.sort((a, b) => a - b);
  zs.sort((a, b) => a - b);
  const q = (a: number[], p: number): number => a[Math.min(a.length - 1, Math.max(0, Math.floor(a.length * p)))] as number;
  return { x0: q(xs, 0.02), x1: q(xs, 0.98), z0: q(zs, 0.02), z1: q(zs, 0.98) };
}

/**
 * The review of a world built from a brief that has no building plan and no playable level to measure (a village or hall made
 * of free pieces): no findings, only views to look at (an overview and three at eye height) so the model can compare the
 * result with its brief. Advisory counts come from {@link richnessEvidence}.
 */
export function richnessSnapshot(world: WorldDoc, opts: { maxViews: number; withViews: boolean }): ReviewSnapshot {
  const views: ReviewViewRequest[] = [];
  const b = opts.withViews ? bounds(world) : null;
  if (b) {
    const cx = (b.x0 + b.x1) / 2;
    const cz = (b.z0 + b.z1) / 2;
    const r = Math.max(6, b.x1 - b.x0, b.z1 - b.z0);
    const mk = (name: string, label: string, position: [number, number, number], target: [number, number, number], fov: number, hideTops: boolean): ReviewViewRequest => ({ name, label, kind: 'corner', pose: { position, target, up: [0, 1, 0], fov }, hideTops, aspect: REVIEW_ASPECT, marks: [] });
    views.push(
      mk('overview', 'overview from above and outside (roofs hidden)', [cx + r * 0.7, r * 0.9, b.z1 + r * 0.7], [cx, 0.5, cz], 55, true),
      mk('eye-near', 'eye height, 1.6 m, from the near end looking across', [cx, 1.6, b.z0 + 0.8], [cx, 1.5, b.z1], 70, false),
      mk('eye-far', 'eye height, 1.6 m, from the far end looking back', [cx, 1.6, b.z1 - 0.8], [cx, 1.5, b.z0], 70, false),
      mk('eye-side', 'eye height, 1.6 m, from the side', [b.x0 + 0.8, 1.6, cz], [b.x1, 1.5, cz], 70, false),
    );
  }
  return { buildings: [RICHNESS_SUBJECT], findings: [], score: 100, keys: new Set(), views: views.slice(0, Math.max(1, opts.maxViews)), legend: '', advice: '' };
}

/** The opening of a richness-only review turn (the brief comparison itself follows it). */
export function richnessOnlyTurnText(round: number, opts: { hasImages: boolean; lastEdited: boolean }): string {
  return [
    `REVIEW round ${round}. ${opts.lastEdited ? 'You changed the world; this is how it looks now.' : 'Look at the world as a critical designer before it is shown to the user.'}`,
    'There is no automatic checker for this kind of world: you are the judge, from the images and the brief below.',
    opts.hasImages ? 'The images are an overview and views at eye height (1.6 m), the way a visitor sees it.' : 'No renders could be shown this round; use query_scene and inspect to read the world.',
    'Fix what is missing, sparse, floating or crossing with apply_patches, place_items, edit_items or place_level_items, whichever the world was built with; make the smallest change that works.',
  ].join('\n');
}
