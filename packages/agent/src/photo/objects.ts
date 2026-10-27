/**
 * The object inventory and the per-object judge of the photo flow.
 *
 * The model lists every distinct element it sees in the photograph (structure, furniture, fixtures, decor, small things,
 * plants, textiles, views), each with a box in the picture, its relations to the things around it, its relative size, its
 * colour and material and how sure it is. A second seat lists the same photo blind and the two lists are reconciled, so an
 * object only one seat saw is flagged, never dropped. Each object is then judged on its own, against the render from the
 * same camera, on five aspects (present, type, position, size, material) by a panel; the aspects that fail become
 * differences of the ledger and are repaired until they pass or the model states why they cannot.
 *
 * Code only keeps the books here: the inventory ledger (versioned, restorable), the median over the panel, the best state
 * of each object and the text the models read. Measured evidence (projected position against the box, distances) is
 * advice written next to each object; no gate passes or fails on a number.
 */
import { z } from 'zod';
import type { ContentBlock, ToolDef } from '../types';
import type { CompletionRequest, CompletionResponse } from '../types';
import { median } from './judge';

// ---------------------------------------------------------------------------------------------------------------- types

export type Box = [number, number, number, number];

export const ASPECTS = ['present', 'type', 'position', 'size', 'material'] as const;
export type Aspect = (typeof ASPECTS)[number];
/** The aspects the judges score 0..4 (presence is a yes or no). */
export const SCORED_ASPECTS = ['type', 'position', 'size', 'material'] as const;
export type ScoredAspect = (typeof SCORED_ASPECTS)[number];

export const OBJECT_CATEGORIES = ['structure', 'furniture', 'fixture', 'decor', 'small', 'plant', 'textile', 'view'] as const;
export type ObjectCategory = (typeof OBJECT_CATEGORIES)[number];

/** Most objects in one inventory. */
export const MAX_INVENTORY = 80;
/** Objects judged in one request (one paired crop each). */
export const OBJECTS_PER_REQUEST = 6;
/** An aspect passes at this median score. */
export const OBJECT_PASS = 3;
/** A full sweep of every object is made at least this often (rounds). */
export const SWEEP_EVERY = 4;

export const INVENTORY_TOOL_NAME = 'report_inventory';
export const OBJECT_JUDGE_TOOL_NAME = 'report_object_judgement';
export const RELATION_JUDGE_TOOL_NAME = 'report_relations';
export const OBJECT_REASON_TOOL_NAME = 'state_object_reason';

/** One distinct thing the photo shows. */
export interface InventoryItem {
  id: string;
  /** Free word for what it is ("bed", "pendant lamp", "curtain"). */
  kind: string;
  category: ObjectCategory;
  label: string;
  /** Where it is in the photo: x0, y0, x1, y1 in 0..1, origin top-left. */
  box: Box;
  /** Relations to its neighbours and the room ("left of the bed", "centred on the wall", "20 cm from the corner"). */
  relations: string[];
  /** Size relative to its neighbours. */
  size: string;
  /** Colour and material. */
  look: string;
  confidence: number;
  /** Why it may be hard to see ("half hidden by the curtain"); '' when clear. */
  occlusion: string;
  /** Ids of the built entities that stand for it (empty: nothing built, or not linked yet). */
  entities: string[];
  linkedBy: 'model' | 'projection' | 'none';
  /** Which seats listed it. */
  seen: 'both' | 'primary' | 'blind';
}

export type AspectState = 'pass' | 'fail' | 'na' | 'unjudged';

export interface AspectRec {
  state: AspectState;
  /** Median score (presence: 4 present, 0 absent); null when not scored. */
  score: number | null;
  note: string;
  round: number;
}

/** The best state of one object: kept so a fix that breaks it is put back. */
export interface BestRec {
  /** Aspects passing (or not applicable) then. */
  passes: number;
  round: number;
  states: Record<Aspect, AspectState>;
  /** The built entities of the object at that time (plain documents). */
  entities: Record<string, unknown>;
}

export interface ObjectRec {
  item: InventoryItem;
  aspects: Record<Aspect, AspectRec>;
  /** The latest one-line fix hint of the judges. */
  fix: string;
  /** Aspects (or "all") the fixing model gave a reason for leaving as they are. */
  waived: Record<string, string>;
  /** Coarse colours of the render crop when last judged, and the projected box of its entities: what "changed" is told from. */
  sig: number[] | null;
  proj: Box | null;
  judgedRound: number;
  best: BestRec | null;
  reverts: number;
}

export interface RelationRec {
  id: string;
  text: string;
  /** Inventory ids involved. */
  items: string[];
  state: 'pass' | 'fail' | 'unjudged';
  note: string;
  round: number;
  waived?: string;
}

export interface ObjectsSnapshot {
  version: 1;
  /** Round of the last full sweep. */
  swept: number;
  items: ObjectRec[];
  relations: RelationRec[];
  /** Notes from the reconciliation of the two inventories. */
  reconcile: string[];
}

// ---------------------------------------------------------------------------------------------------------------- geometry of boxes

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** A box in 0..1, ordered, at least 2% of the picture on each side. */
export function normBox(b: readonly number[]): Box {
  let [x0, y0, x1, y1] = b as [number, number, number, number];
  if (x1 < x0) [x0, x1] = [x1, x0];
  if (y1 < y0) [y0, y1] = [y1, y0];
  x0 = clamp01(x0);
  y0 = clamp01(y0);
  x1 = clamp01(x1);
  y1 = clamp01(y1);
  if (x1 - x0 < 0.02) {
    const m = (x0 + x1) / 2;
    x0 = clamp01(Math.min(m - 0.01, 0.98));
    x1 = Math.min(1, x0 + 0.02);
  }
  if (y1 - y0 < 0.02) {
    const m = (y0 + y1) / 2;
    y0 = clamp01(Math.min(m - 0.01, 0.98));
    y1 = Math.min(1, y0 + 0.02);
  }
  return [x0, y0, x1, y1].map((v) => Math.round(v * 1000) / 1000) as Box;
}

export function boxIou(a: Box, b: Box): number {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  if (w <= 0 || h <= 0) return 0;
  const inter = w * h;
  const u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
  return u <= 0 ? 0 : inter / u;
}

export const boxCentre = (b: Box): [number, number] => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];

/** Whether two boxes touch or overlap once each is grown by `pad`. */
export function boxesNear(a: Box, b: Box, pad = 0.04): boolean {
  return a[0] - pad < b[2] && b[0] - pad < a[2] && a[1] - pad < b[3] && b[1] - pad < a[3];
}

// ---------------------------------------------------------------------------------------------------------------- the inventory tool

const AspectNames = z.enum(ASPECTS);

export const INVENTORY_TOOL: ToolDef = {
  name: INVENTORY_TOOL_NAME,
  description:
    'List EVERY distinct element you can see in the photograph, big and small, once each: structure (each wall, the floor, the ceiling, windows, doors, curtains, beams, mouldings), furniture, fixtures and lights, decor on walls and surfaces (frames, mirrors, clocks, shelves), small items (books, cups, remotes, bottles), plants, textiles (rugs, throws, cushions), and views through windows. For each: id (short slug), kind (what it is), category, label (a few words that tell it from its neighbours), box [x0,y0,x1,y1] in 0..1 of the photo (origin top-left, the visible part), relations (up to 6 short statements about where it stands relative to the things around it and the room: "left of the bed", "centred on the wall", "about 20 cm from the corner", "on top of the desk", "above the headboard", "level with the other nightstand"), size (relative to its neighbours), look (colour and material), confidence 0..1 (how sure you are of what it is), occluded (why it is hard to see, empty when clear), and entity when a list of built pieces is given: the id of the built piece that stands for it, or "none" when nothing in the room stands for it. Do not merge different things and do not skip what is small or partly hidden. Walls: one entry per visible wall. Call once.',
  inputSchema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        maxItems: MAX_INVENTORY,
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            kind: { type: 'string' },
            category: { type: 'string', enum: [...OBJECT_CATEGORIES] },
            label: { type: 'string' },
            box: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 },
            relations: { type: 'array', items: { type: 'string' }, maxItems: 6 },
            size: { type: 'string' },
            look: { type: 'string' },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            occluded: { type: 'string' },
            entity: { type: 'string' },
          },
          required: ['kind', 'category', 'label', 'box'],
        },
      },
      summary: { type: 'string' },
    },
    required: ['items'],
    additionalProperties: false,
  },
};

const RawItem = z.object({
  id: z.string().max(60).optional(),
  kind: z.string().trim().min(1).max(60),
  category: z.preprocess((v) => (typeof v === 'string' ? v.trim().toLowerCase() : v), z.enum(OBJECT_CATEGORIES)).catch('decor'),
  label: z.string().trim().min(1).max(100),
  box: z.array(z.number().finite()).length(4),
  relations: z.array(z.string().max(140)).max(6).optional(),
  size: z.string().max(160).optional(),
  look: z.string().max(160).optional(),
  confidence: z.number().min(0).max(1).optional(),
  occluded: z.string().max(120).optional(),
  entity: z.union([z.string().max(400), z.array(z.string().max(80)).max(4)]).optional(),
});

export const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'object';

/** Parse an inventory call. Entries that are not valid are counted, not guessed at. */
export function parseInventory(input: unknown, known?: ReadonlySet<string>): { items: InventoryItem[]; skipped: number } | null {
  const p = z.object({ items: z.array(z.unknown()).max(MAX_INVENTORY), summary: z.string().optional() }).safeParse(input);
  if (!p.success) return null;
  const items: InventoryItem[] = [];
  const used = new Set<string>();
  let skipped = 0;
  for (const raw of p.data.items) {
    const r = RawItem.safeParse(raw);
    if (!r.success) {
      skipped++;
      continue;
    }
    const d = r.data;
    let id = slug(d.id && d.id.trim() ? d.id : `${d.kind}-${d.label}`);
    for (let k = 2; used.has(id); k++) id = `${slug(d.id && d.id.trim() ? d.id : `${d.kind}-${d.label}`).slice(0, 36)}-${k}`;
    used.add(id);
    const ents = (Array.isArray(d.entity) ? d.entity : typeof d.entity === 'string' ? d.entity.split(/[,;\s]+/) : []).map((e) => e.trim()).filter((e) => e.length > 0 && e.toLowerCase() !== 'none' && (!known || known.has(e)));
    items.push({
      id,
      kind: d.kind,
      category: d.category,
      label: d.label,
      box: normBox(d.box),
      relations: (d.relations ?? []).map((x) => x.trim()).filter((x) => x.length > 0),
      size: (d.size ?? '').trim(),
      look: (d.look ?? '').trim(),
      confidence: d.confidence ?? 0.7,
      occlusion: (d.occluded ?? '').trim(),
      entities: [...new Set(ents)].slice(0, 4),
      linkedBy: ents.length > 0 ? 'model' : 'none',
      seen: 'primary',
    });
  }
  return { items, skipped };
}

// ---------------------------------------------------------------------------------------------------------------- reconciling two inventories

const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'with', 'wall', 'small', 'large', 'big']);
const tokens = (s: string): string[] => s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1 && !STOP.has(t)).map((t) => t.replace(/s$/, ''));

/** How alike two objects are in name (0..1): same kind, shared words of kind and label. */
export function nameSimilarity(a: InventoryItem, b: InventoryItem): number {
  const ka = tokens(a.kind);
  const kb = tokens(b.kind);
  if (ka.length > 0 && ka.join(' ') === kb.join(' ')) return 1;
  const ta = new Set([...ka, ...tokens(a.label)]);
  const tb = new Set([...kb, ...tokens(b.label)]);
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  const base = Math.min(ta.size, tb.size);
  if (base === 0) return a.category === b.category ? 0.2 : 0;
  return Math.min(1, shared / base) * 0.9 + (a.category === b.category ? 0.1 : 0);
}

export interface Reconciled {
  items: InventoryItem[];
  /** Objects both seats listed. */
  both: number;
  /** Objects only the first seat listed (not confirmed blind). */
  onlyPrimary: string[];
  /** Objects only the blind seat listed: possibly missing from the first list and from the room. */
  onlyBlind: string[];
  notes: string[];
}

/**
 * Merge the first seat's inventory with the blind seat's. Objects are matched by overlap of their boxes and likeness of name;
 * a matched pair keeps the first seat's entry (and takes the blind seat's relations and look where the first had none).
 * Nothing is dropped: an object only one seat saw stays, flagged.
 */
export function reconcileInventories(primary: readonly InventoryItem[], blind: readonly InventoryItem[]): Reconciled {
  const pairs: Array<{ p: number; b: number; score: number }> = [];
  primary.forEach((p, i) =>
    blind.forEach((b, j) => {
      const iou = boxIou(p.box, b.box);
      const sim = nameSimilarity(p, b);
      const [px, py] = boxCentre(p.box);
      const [bx, by] = boxCentre(b.box);
      const dist = Math.hypot(px - bx, py - by);
      const ok = (iou >= 0.2 && sim >= 0.4) || (iou >= 0.5 && p.category === b.category) || (sim >= 0.9 && dist < 0.18);
      if (ok) pairs.push({ p: i, b: j, score: iou + sim * 0.8 });
    }),
  );
  pairs.sort((x, y) => y.score - x.score);
  const pTaken = new Set<number>();
  const bTaken = new Set<number>();
  const matchOf = new Map<number, number>();
  for (const m of pairs) {
    if (pTaken.has(m.p) || bTaken.has(m.b)) continue;
    pTaken.add(m.p);
    bTaken.add(m.b);
    matchOf.set(m.p, m.b);
  }
  const used = new Set(primary.map((p) => p.id));
  const out: InventoryItem[] = [];
  const onlyPrimary: string[] = [];
  const onlyBlind: string[] = [];
  const notes: string[] = [];
  primary.forEach((p, i) => {
    const j = matchOf.get(i);
    if (j === undefined) {
      out.push({ ...p, seen: 'primary' });
      onlyPrimary.push(p.id);
      return;
    }
    const b = blind[j] as InventoryItem;
    const rel = [...p.relations];
    for (const r of b.relations) if (rel.length < 6 && !rel.some((x) => x.toLowerCase() === r.toLowerCase())) rel.push(r);
    out.push({ ...p, relations: rel, look: p.look || b.look, size: p.size || b.size, occlusion: p.occlusion || b.occlusion, seen: 'both' });
    if (boxIou(p.box, b.box) < 0.35) notes.push(`${p.id}: the two seats put it in different places in the picture (overlap ${Math.round(boxIou(p.box, b.box) * 100)}%); the judges look at the first seat's box.`);
  });
  blind.forEach((b, j) => {
    if (bTaken.has(j)) return;
    let id = `blind-${b.id}`.slice(0, 50);
    for (let k = 2; used.has(id); k++) id = `blind-${b.id}`.slice(0, 44) + `-${k}`;
    used.add(id);
    out.push({ ...b, id, seen: 'blind', entities: [], linkedBy: 'none' });
    onlyBlind.push(id);
  });
  if (onlyBlind.length > 0) notes.push(`Seen by the blind seat only (check that they exist in the room): ${onlyBlind.map((id) => out.find((x) => x.id === id)?.label ?? id).join(', ')}.`);
  if (onlyPrimary.length > 0) notes.push(`Listed by the first seat only: ${onlyPrimary.map((id) => out.find((x) => x.id === id)?.label ?? id).join(', ')}.`);
  return { items: out.slice(0, MAX_INVENTORY), both: matchOf.size, onlyPrimary, onlyBlind, notes };
}

// ---------------------------------------------------------------------------------------------------------------- prompts

export const INVENTORY_SYSTEM =
  'You are a meticulous surveyor. You look at one photograph of a room and write a complete inventory of everything in it: every wall, the floor and ceiling, each window, door, curtain and beam, each piece of furniture, each light and fixture, everything hung on the walls or standing on surfaces, small items, plants, textiles and any view through a window. For each one you give its place in the picture as a box, how it relates to the things around it, its size next to its neighbours, its colour and material, and how sure you are. You list only what you can see; you never invent. You answer only by calling the report_inventory tool.';

export function inventoryText(builtPieces: string, summary: string): string {
  return [
    'INVENTORY. The image is the reference PHOTO of a room.' + (summary ? ` The room: ${summary}` : ''),
    'List every distinct element you can see, from big to small: walls (one entry per visible wall), floor, ceiling, windows, doors, curtains and blinds, beams, mouldings, furniture, lights and fixtures, anything hung on a wall (frames, mirrors, clocks, shelves, a TV), anything standing on a surface (lamps, books, vases, cups, remotes, plants, bottles), textiles (rugs, throws, cushions, bedding), plants and views through windows. Give each a box (x0,y0,x1,y1 in 0..1, origin top-left), its relations to neighbours and the room, its size next to the neighbours, its colour and material, your confidence, and why it is hard to see when it is. Add the relations that tie the layout together too: what is centred on what, what is level with what, how high lamps and pictures hang, which pieces are in a row.',
    builtPieces ? `The room has been built from an earlier reading; these are the built pieces (id, kind, place, size). For each object set "entity" to the id of the built piece that stands for it, or "none" when nothing built stands for it. Judge from the PHOTO, not from this list; a piece in this list that the photo does not show is not an object.\n${builtPieces}` : '',
    'Call report_inventory once with all of it.',
  ].filter((l) => l.length > 0).join('\n');
}

export const OBJECT_JUDGE_SYSTEM =
  'You are a meticulous, consistent reviewer of architectural reconstructions. For each listed object you compare the reference photograph with a render of the 3D room from the same camera, and you answer separately whether the object is present, whether its type is right, whether its position is right, whether its size is right, and whether its colour and material are right. You back each judgement with what you can point to in the images. You never guess: the same pictures always get the same answer from you. You answer only by calling the report_object_judgement tool.';

export const OBJECT_RUBRIC = [
  '4 = matches the photo',
  '3 = close: one minor difference (a few centimetres, a slightly different shade)',
  '2 = clearly off: recognisably the same object but visibly wrong in this aspect',
  '1 = wrong: another kind, another wall or place, another colour family',
  '0 = not there at all (for presence) or hopelessly wrong',
];

export const OBJECT_JUDGE_TOOL: ToolDef = {
  name: OBJECT_JUDGE_TOOL_NAME,
  description:
    'Judge every listed object, separately for each aspect. {verdicts:[{id, present:boolean, type:0..4, position:0..4, size:0..4, material:0..4, na?:[aspects you cannot judge, e.g. "material" when the object is hidden or too small], evidence, fix}]}. present = the object the photo shows is in the render at all. type = the kind and model are right (a round table is not a square one). position = left/right and depth order against its neighbours, offset from the walls and corner, height off the floor, orientation. size = width, height and depth against the photo and its neighbours. material = colour, finish and pattern. evidence = one sentence naming what the photo shows and what the render shows. fix = one line saying what to change ("move 0.3 m to the right", "taller by a third", "replace by a round mirror", "darker oak"). When present is false the other scores may be left out. When present is true give all four scores (an aspect you cannot judge is listed in na and may get any score).',
  inputSchema: {
    type: 'object',
    properties: {
      verdicts: {
        type: 'array',
        minItems: 1,
        maxItems: OBJECTS_PER_REQUEST + 2,
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            present: { type: 'boolean' },
            type: { type: 'integer', minimum: 0, maximum: 4 },
            position: { type: 'integer', minimum: 0, maximum: 4 },
            size: { type: 'integer', minimum: 0, maximum: 4 },
            material: { type: 'integer', minimum: 0, maximum: 4 },
            na: { type: 'array', items: { type: 'string', enum: [...SCORED_ASPECTS] } },
            evidence: { type: 'string' },
            fix: { type: 'string' },
          },
          required: ['id', 'present', 'evidence'],
        },
      },
    },
    required: ['verdicts'],
    additionalProperties: false,
  },
};

const Sc = z.preprocess((v) => (typeof v === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(v) ? Number(v) : v), z.number().finite().min(0).max(4).transform((n) => Math.round(n)));
const ObjVerdict = z.object({
  id: z.string().min(1).max(60),
  present: z.preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()),
  type: Sc.optional(),
  position: Sc.optional(),
  size: Sc.optional(),
  material: Sc.optional(),
  na: z.array(z.enum(SCORED_ASPECTS)).max(4).optional(),
  evidence: z.string().trim().min(3).max(400),
  fix: z.string().max(240).optional(),
});

/** One judge's answer for one object. */
export interface ObjectSample {
  present: boolean;
  scores: Record<ScoredAspect, number>;
  na: Set<ScoredAspect>;
  evidence: string;
  fix: string;
}

export function parseObjectJudgement(input: unknown, ids: ReadonlySet<string>): Map<string, ObjectSample> | null {
  const p = z.object({ verdicts: z.array(z.unknown()).min(1).max(OBJECTS_PER_REQUEST * 3) }).safeParse(input);
  if (!p.success) return null;
  const out = new Map<string, ObjectSample>();
  for (const raw of p.data.verdicts) {
    const v = ObjVerdict.safeParse(raw);
    if (!v.success || !ids.has(v.data.id)) continue;
    const d = v.data;
    // An absent object needs no scores for the rest; a present one needs all four (the others are dropped, and the seat is asked again).
    if (d.present && [d.type, d.position, d.size, d.material].some((x) => x === undefined) && !(d.na && d.na.length > 0)) continue;
    out.set(v.data.id, { present: v.data.present, scores: { type: d.type ?? (d.present ? 4 : 0), position: d.position ?? (d.present ? 4 : 0), size: d.size ?? (d.present ? 4 : 0), material: d.material ?? (d.present ? 4 : 0) }, na: new Set(v.data.na ?? []), evidence: v.data.evidence, fix: (v.data.fix ?? '').trim() });
  }
  return out.size > 0 ? out : null;
}

/** The panel's judgement of one object. */
export interface ObjectAggregate {
  aspects: Record<Aspect, { state: AspectState; score: number | null }>;
  evidence: string;
  fix: string;
  judges: number;
}

/** Median per aspect over the judges that answered for the object. A majority saying "cannot judge" makes the aspect not applicable. */
export function aggregateObject(samples: readonly ObjectSample[]): ObjectAggregate | null {
  if (samples.length === 0) return null;
  const n = samples.length;
  const presentVotes = samples.filter((s) => s.present).length;
  const present = presentVotes * 2 >= n;
  const aspects = {} as ObjectAggregate['aspects'];
  aspects.present = { state: present ? 'pass' : 'fail', score: present ? 4 : 0 };
  for (const a of SCORED_ASPECTS) {
    if (!present) {
      aspects[a] = { state: 'unjudged', score: null };
      continue;
    }
    const naVotes = samples.filter((s) => s.na.has(a)).length;
    if (naVotes * 2 > n) {
      aspects[a] = { state: 'na', score: null };
      continue;
    }
    const scores = samples.filter((s) => !s.na.has(a)).map((s) => s.scores[a]);
    const m = median(scores);
    aspects[a] = { state: m >= OBJECT_PASS ? 'pass' : 'fail', score: m };
  }
  // The evidence and the fix hint of the judge that agrees best with the median position score (or the first when none does).
  const mp = aspects.position.score ?? 4;
  const near = [...samples].sort((x, y) => Math.abs(x.scores.position - mp) - Math.abs(y.scores.position - mp))[0] as ObjectSample;
  const fixes = samples.map((s) => s.fix).filter((f) => f.length > 0);
  return { aspects, evidence: near.evidence, fix: near.fix || fixes[0] || '', judges: n };
}

// ---------------------------------------------------------------------------------------------------------------- relations

export const RELATION_JUDGE_TOOL: ToolDef = {
  name: RELATION_JUDGE_TOOL_NAME,
  description: 'Judge each listed layout statement against the render: does the render show the same relation as the photo? {relations:[{id, ok:boolean, note}]}. note = what the render shows instead when it is not ok ("the render has the bed 0.4 m to the left of the window centre").',
  inputSchema: {
    type: 'object',
    properties: {
      relations: { type: 'array', minItems: 1, maxItems: 40, items: { type: 'object', properties: { id: { type: 'string' }, ok: { type: 'boolean' }, note: { type: 'string' } }, required: ['id', 'ok'] } },
    },
    required: ['relations'],
    additionalProperties: false,
  },
};

export function parseRelationJudgement(input: unknown, ids: ReadonlySet<string>): Map<string, { ok: boolean; note: string }> | null {
  const p = z.object({ relations: z.array(z.unknown()).min(1).max(60) }).safeParse(input);
  if (!p.success) return null;
  const out = new Map<string, { ok: boolean; note: string }>();
  for (const raw of p.data.relations) {
    const r = z.object({ id: z.string(), ok: z.preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()), note: z.string().max(300).optional() }).safeParse(raw);
    if (r.success && ids.has(r.data.id)) out.set(r.data.id, { ok: r.data.ok, note: (r.data.note ?? '').trim() });
  }
  return out.size > 0 ? out : null;
}

/** The layout statements of an inventory: each object's relations, with the objects they name. */
export function relationsOf(items: readonly InventoryItem[], max = 40): RelationRec[] {
  const out: RelationRec[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    it.relations.forEach((text, k) => {
      const key = `${it.id}|${text.toLowerCase()}`;
      if (seen.has(key) || out.length >= max) return;
      seen.add(key);
      const lower = text.toLowerCase();
      const partners = items.filter((o) => o.id !== it.id && tokens(`${o.kind} ${o.label}`).some((t) => t.length > 2 && lower.includes(t)));
      out.push({ id: `rel-${it.id}-${k + 1}`.slice(0, 60), text: `${it.label}: ${text}`, items: [it.id, ...partners.slice(0, 3).map((p) => p.id)], state: 'unjudged', note: '', round: 0 });
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------- the ledger

const blankAspects = (): Record<Aspect, AspectRec> => Object.fromEntries(ASPECTS.map((a) => [a, { state: 'unjudged', score: null, note: '', round: 0 }])) as Record<Aspect, AspectRec>;

/** The aspects of an object that fail and are not waived. */
export function openAspects(rec: ObjectRec): Aspect[] {
  return ASPECTS.filter((a) => rec.aspects[a].state === 'fail' && rec.waived[a] === undefined && rec.waived['all'] === undefined);
}

/** Aspects that pass (or do not apply) now. */
export function passCount(states: Record<Aspect, AspectState | AspectRec>): number {
  return ASPECTS.filter((a) => {
    const s = states[a];
    const st = typeof s === 'string' ? s : s.state;
    return st === 'pass' || st === 'na';
  }).length;
}

/** How bad an object is: absent counts most, then by how far each failing aspect is from passing. */
export function severity(rec: ObjectRec): number {
  let s = 0;
  for (const a of openAspects(rec)) s += a === 'present' ? 8 : 4 - (rec.aspects[a].score ?? 0);
  return s;
}

/** Kind and repair stage of the difference an aspect becomes. */
export function aspectDifference(a: Aspect): { kind: 'missing' | 'other' | 'position' | 'proportion' | 'material'; cause: 'geometry' | 'materials'; route: string } {
  switch (a) {
    case 'present': return { kind: 'missing', cause: 'geometry', route: 'place_items / find_model (add it)' };
    case 'type': return { kind: 'other', cause: 'geometry', route: 'find_model then remove and place_items (another model or kind)' };
    case 'position': return { kind: 'position', cause: 'geometry', route: 'edit_items move (geometry)' };
    case 'size': return { kind: 'proportion', cause: 'geometry', route: 'edit_items resize (geometry)' };
    case 'material': return { kind: 'material', cause: 'materials', route: 'materials (edit_items params / make_texture)' };
  }
}

export class ObjectLedger {
  items = new Map<string, ObjectRec>();
  relations = new Map<string, RelationRec>();
  reconcile: string[] = [];
  /** Round of the last full sweep (0: none yet). */
  swept = 0;

  get size(): number {
    return this.items.size;
  }

  load(items: readonly InventoryItem[], reconcile: readonly string[] = []): void {
    for (const it of items) {
      if (this.items.has(it.id)) continue;
      this.items.set(it.id, { item: it, aspects: blankAspects(), fix: '', waived: {}, sig: null, proj: null, judgedRound: 0, best: null, reverts: 0 });
    }
    for (const r of relationsOf(items)) if (!this.relations.has(r.id)) this.relations.set(r.id, r);
    this.reconcile = [...reconcile];
  }

  list(): ObjectRec[] {
    return [...this.items.values()];
  }

  get(id: string): ObjectRec | undefined {
    return this.items.get(id);
  }

  /** Record the panel's judgement of one object. Returns what changed against its best state. */
  apply(id: string, agg: ObjectAggregate, round: number, mark: { sig: number[] | null; proj: Box | null; entities: Record<string, unknown> }): { regressed: boolean; before: number; after: number } | null {
    const rec = this.items.get(id);
    if (!rec) return null;
    const before = rec.best?.passes ?? -1;
    for (const a of ASPECTS) {
      const g = agg.aspects[a];
      const note = a === 'present' || g.state === 'pass' ? '' : agg.evidence;
      rec.aspects[a] = { state: g.state, score: g.score, note: note.slice(0, 240), round };
    }
    rec.fix = agg.fix;
    rec.sig = mark.sig;
    rec.proj = mark.proj;
    rec.judgedRound = round;
    const after = passCount(rec.aspects);
    // Aspects that pass now clear their waivers: a reason is only needed while the aspect fails.
    for (const a of ASPECTS) if (rec.aspects[a].state !== 'fail') delete rec.waived[a];
    if (rec.best === null || after >= rec.best.passes) {
      rec.best = { passes: after, round, states: Object.fromEntries(ASPECTS.map((a) => [a, rec.aspects[a].state])) as Record<Aspect, AspectState>, entities: mark.entities };
      return { regressed: false, before, after };
    }
    return { regressed: true, before, after };
  }

  /** The object was put back to its best state: its aspects are those of that state, and it is judged again next time. */
  markReverted(id: string): void {
    const rec = this.items.get(id);
    if (!rec?.best) return;
    for (const a of ASPECTS) rec.aspects[a] = { ...rec.aspects[a], state: rec.best.states[a] };
    rec.sig = null;
    rec.proj = null;
    rec.reverts++;
  }

  waive(id: string, aspect: string, reason: string): boolean {
    const rec = this.items.get(id);
    if (!rec) return false;
    const key = aspect === 'all' || (ASPECTS as readonly string[]).includes(aspect) ? aspect : 'all';
    rec.waived[key] = reason.slice(0, 240);
    return true;
  }

  /** Aspects failing and not waived, over all objects. */
  openCount(): number {
    return this.list().reduce((n, r) => n + openAspects(r).length, 0) + [...this.relations.values()].filter((r) => r.state === 'fail' && !r.waived).length;
  }

  /** Objects with every aspect passing or not applicable. */
  passingObjects(): number {
    return this.list().filter((r) => ASPECTS.every((a) => r.aspects[a].state === 'pass' || r.aspects[a].state === 'na')).length;
  }

  waivedCount(): number {
    return this.list().filter((r) => Object.keys(r.waived).length > 0).length;
  }

  /** Pass counts per aspect over the judged objects. */
  aspectTotals(): Record<Aspect, { pass: number; judged: number }> {
    const t = Object.fromEntries(ASPECTS.map((a) => [a, { pass: 0, judged: 0 }])) as Record<Aspect, { pass: number; judged: number }>;
    for (const r of this.list()) {
      for (const a of ASPECTS) {
        const s = r.aspects[a].state;
        if (s === 'unjudged') continue;
        t[a].judged++;
        if (s === 'pass' || s === 'na') t[a].pass++;
      }
    }
    return t;
  }

  snapshot(): ObjectsSnapshot {
    return { version: 1, swept: this.swept, items: this.list().map((r) => JSON.parse(JSON.stringify(r)) as ObjectRec), relations: [...this.relations.values()].map((r) => ({ ...r, items: [...r.items] })), reconcile: [...this.reconcile] };
  }

  static restore(s: unknown): ObjectLedger | null {
    if (!s || typeof s !== 'object') return null;
    const x = s as Partial<ObjectsSnapshot>;
    if (x.version !== 1 || !Array.isArray(x.items) || !Array.isArray(x.relations)) return null;
    const l = new ObjectLedger();
    for (const r of x.items) {
      const rec = r as ObjectRec;
      if (!rec?.item?.id || !rec.aspects) continue;
      l.items.set(rec.item.id, { ...rec, waived: rec.waived ?? {}, best: rec.best ?? null, reverts: rec.reverts ?? 0, sig: rec.sig ?? null, proj: rec.proj ?? null });
    }
    for (const r of x.relations) if (r && typeof (r as RelationRec).id === 'string') l.relations.set((r as RelationRec).id, r as RelationRec);
    l.swept = typeof x.swept === 'number' ? x.swept : 0;
    l.reconcile = Array.isArray(x.reconcile) ? x.reconcile.filter((n): n is string => typeof n === 'string') : [];
    return l;
  }
}

// ---------------------------------------------------------------------------------------------------------------- what to judge

/** Mean absolute difference of two signatures (0..255). */
export function sigDistance(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 255;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs((a[i] as number) - (b[i] as number));
  return s / a.length;
}

/** Signature change (0..255) from which an object counts as changed since it was last judged. */
export const SIG_TOLERANCE = 4;
/** Shift of the projected box (share of the picture) from which an object counts as moved. */
export const MOVE_TOLERANCE = 0.012;

export interface Current {
  sig: number[] | null;
  proj: Box | null;
}

/**
 * The objects to judge this round. A first look and a periodic sweep judge all of them; otherwise the objects whose render
 * changed (their crop, or the projected box of their pieces) are judged again, with their neighbours (boxes that touch, or
 * that a relation names), so a fix that disturbed a neighbour shows. Objects the model gave a reason for (all aspects) are
 * not judged again.
 */
export function selectObjects(ledger: ObjectLedger, now: ReadonlyMap<string, Current>, round: number, opts: { force?: boolean } = {}): { ids: string[]; full: boolean; changed: string[] } {
  const recs = ledger.list();
  const never = recs.some((r) => r.judgedRound === 0);
  const full = opts.force === true || never || ledger.swept === 0 || round - ledger.swept >= SWEEP_EVERY;
  const skip = (r: ObjectRec): boolean => r.waived['all'] !== undefined;
  if (full) return { ids: recs.filter((r) => !skip(r)).map((r) => r.item.id), full: true, changed: [] };
  const changed = new Set<string>();
  for (const r of recs) {
    if (skip(r)) continue;
    const c = now.get(r.item.id);
    if (!c) continue;
    const sigMoved = r.sig === null || c.sig === null || sigDistance(r.sig, c.sig) > SIG_TOLERANCE;
    const boxMoved = (r.proj === null) !== (c.proj === null) || (r.proj !== null && c.proj !== null && r.proj.some((v, i) => Math.abs(v - (c.proj as Box)[i]!) > MOVE_TOLERANCE));
    if (sigMoved || boxMoved) changed.add(r.item.id);
  }
  const ids = new Set(changed);
  for (const id of changed) {
    const a = ledger.get(id) as ObjectRec;
    for (const o of recs) {
      if (ids.has(o.item.id) || skip(o)) continue;
      const named = a.item.relations.some((t) => tokens(`${o.item.kind} ${o.item.label}`).some((w) => w.length > 2 && t.toLowerCase().includes(w))) || o.item.relations.some((t) => tokens(`${a.item.kind} ${a.item.label}`).some((w) => w.length > 2 && t.toLowerCase().includes(w)));
      if (boxesNear(a.item.box, o.item.box) && (named || a.item.category !== 'structure')) ids.add(o.item.id);
    }
  }
  return { ids: [...ids], full: false, changed: [...changed] };
}

// ---------------------------------------------------------------------------------------------------------------- the judge request

export const OBJECT_JUDGE_SEED = 5527;
export const INVENTORY_SEED = 6619;
export const RELATION_SEED = 5531;

export interface ObjectBatch {
  /** Items in this request, with the advisory evidence line of each. */
  items: Array<{ item: InventoryItem; n: number; evidence: string }>;
  photo: string;
  /** The render with the boxes of the whole inventory drawn on it, numbered (null: not drawn). */
  boxes: string | null;
  /** The plain render. */
  render: string;
  /** Per object, the photo crop beside the render crop (null: not drawn). */
  pairs: Array<string | null>;
}

export function objectJudgeText(b: ObjectBatch): string {
  return [
    'JUDGE EACH OBJECT. Image 1 is the reference PHOTO. Image 2 is the RENDER of the 3D room from the photo\'s camera' + (b.boxes ? ' with the boxes of the inventory drawn on it (numbered); each listed object is the box with its number.' : '.') + (b.pairs.some((p) => p) ? ' After them come paired crops, one per object in the order listed: the PHOTO crop on the left, the RENDER crop of the same place on the right.' : ''),
    `Score with this rubric (integers):\n${OBJECT_RUBRIC.map((r) => `- ${r}`).join('\n')}`,
    'For every object answer separately: present (is it in the render at all, where the photo has it), type (right kind and model), position (left/right and depth order against neighbours, distance from walls and corners, height off the floor, orientation), size (width, height, depth against the photo and neighbours), material (colour, finish, pattern). Give "na" for an aspect you cannot judge (hidden, too small, out of frame) and say why in the evidence. Judge shape, size, place and hue relative to the surroundings; the render is a plain preview with flatter light, so never lower a score for lighting, glare or a flat sky alone.',
    'The measured lines are advice computed from the built pieces (projected place against the photo\'s box, distances in metres); look at the pictures and decide for yourself. Give a fix: one line saying what to change.',
    `Objects:\n${b.items.map((x) => `${x.n}. id ${x.item.id}: ${x.item.label} (${x.item.kind}); photo box [${x.item.box.join(', ')}]${x.item.size ? `; size: ${x.item.size}` : ''}${x.item.look ? `; look: ${x.item.look}` : ''}${x.item.relations.length > 0 ? `; relations: ${x.item.relations.join('; ')}` : ''}${x.item.occlusion ? `; hard to see: ${x.item.occlusion}` : ''}${x.evidence ? `\n   measured (advice): ${x.evidence}` : ''}`).join('\n')}`,
    'Call report_object_judgement once with every id above.',
  ].join('\n');
}

export function objectJudgeRequest(b: ObjectBatch, k: number): CompletionRequest {
  const content: ContentBlock[] = [{ type: 'text', text: objectJudgeText(b) }, { type: 'text', text: 'Image 1: the PHOTO' }, { type: 'image', dataUrl: b.photo }, { type: 'text', text: b.boxes ? 'Image 2: the RENDER with numbered boxes' : 'Image 2: the RENDER' }, { type: 'image', dataUrl: b.boxes ?? b.render }];
  b.items.forEach((x, i) => {
    const p = b.pairs[i];
    if (p) content.push({ type: 'text', text: `Crop for object ${x.n} (${x.item.id}): PHOTO left, RENDER right` }, { type: 'image', dataUrl: p });
  });
  return { role: 'critic', system: OBJECT_JUDGE_SYSTEM, messages: [{ role: 'user', content }], tools: [OBJECT_JUDGE_TOOL], maxTokens: 6000, temperature: 0, seed: OBJECT_JUDGE_SEED + k };
}

export type CompleteFn = (req: CompletionRequest) => Promise<CompletionResponse>;

/** Ask the panel about one batch: every seat in parallel, stateless, one retry. Returns the aggregate per object id. */
export async function runObjectPanel(complete: CompleteFn, batch: ObjectBatch, judges: number): Promise<{ results: Map<string, ObjectAggregate>; calls: number; failures: string[] }> {
  const n = Math.max(1, Math.min(7, Math.floor(judges)));
  const ids = new Set(batch.items.map((x) => x.item.id));
  let calls = 0;
  const seat = async (k: number): Promise<Map<string, ObjectSample> | string> => {
    const req = objectJudgeRequest(batch, k);
    for (let attempt = 0; attempt < 2; attempt++) {
      calls++;
      const res = await complete(req);
      const call = res.content.find((c): c is Extract<ContentBlock, { type: 'tool_use' }> => c.type === 'tool_use' && c.name === OBJECT_JUDGE_TOOL_NAME);
      const got = call ? parseObjectJudgement(call.input, ids) : null;
      if (got) return got;
      req.messages = [
        ...req.messages,
        { role: 'assistant', content: res.content.length > 0 ? res.content : [{ type: 'text', text: '(no answer)' }] },
        ...(call
          ? [{ role: 'user' as const, content: [{ type: 'tool_result' as const, toolUseId: call.id, content: 'No usable verdicts: each needs an id from the list, present, type, position, size, material (integers 0..4) and evidence.', isError: true }] }]
          : [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'Call report_object_judgement now with a verdict for every listed object.' }] }]),
      ];
    }
    return 'no usable judgement';
  };
  const settled = await Promise.allSettled(Array.from({ length: n }, (_, k) => seat(k)));
  const samples: Array<Map<string, ObjectSample>> = [];
  const failures: string[] = [];
  for (const s of settled) {
    if (s.status === 'fulfilled') {
      if (typeof s.value === 'string') failures.push(s.value);
      else samples.push(s.value);
    } else failures.push(s.reason instanceof Error ? s.reason.message : String(s.reason));
  }
  if (samples.length === 0 && settled.every((s) => s.status === 'rejected')) {
    const first = settled[0];
    if (first && first.status === 'rejected') throw first.reason;
  }
  const results = new Map<string, ObjectAggregate>();
  for (const id of ids) {
    const agg = aggregateObject(samples.map((s) => s.get(id)).filter((x): x is ObjectSample => x !== undefined));
    if (agg) results.set(id, agg);
  }
  return { results, calls, failures };
}

/** Judge the layout statements against the render: a panel, majority per statement. */
export async function runRelationPanel(complete: CompleteFn, input: { photo: string; render: string; boxes: string | null; relations: readonly RelationRec[]; evidence: string; judges: number }): Promise<{ results: Map<string, { ok: boolean; note: string }>; calls: number }> {
  const n = Math.max(1, Math.min(7, Math.floor(input.judges)));
  const ids = new Set(input.relations.map((r) => r.id));
  const text = [
    'JUDGE THE LAYOUT. Image 1 is the reference PHOTO, image 2 the RENDER of the 3D room from the same camera' + (input.boxes ? ' with the inventory boxes drawn on it.' : '.'),
    'Each statement below is a relation between objects, or between an object and the room, that holds in the photo (centred, level, in a row, above, beside, a distance from a corner). For each, say whether the render shows the SAME relation. Judge relations, not colours. Say what the render shows instead when it does not.',
    input.evidence ? `Measured advice:\n${input.evidence}` : '',
    `Statements:\n${input.relations.map((r) => `- ${r.id}: ${r.text}`).join('\n')}`,
    'Call report_relations once with every id.',
  ].filter((l) => l.length > 0).join('\n');
  let calls = 0;
  const seat = async (k: number): Promise<Map<string, { ok: boolean; note: string }> | null> => {
    const req: CompletionRequest = { role: 'critic', system: OBJECT_JUDGE_SYSTEM.replace('report_object_judgement', 'report_relations'), messages: [{ role: 'user', content: [{ type: 'text', text }, { type: 'text', text: 'Image 1: the PHOTO' }, { type: 'image', dataUrl: input.photo }, { type: 'text', text: 'Image 2: the RENDER' }, { type: 'image', dataUrl: input.boxes ?? input.render }] }], tools: [RELATION_JUDGE_TOOL], maxTokens: 5000, temperature: 0, seed: RELATION_SEED + k };
    for (let attempt = 0; attempt < 2; attempt++) {
      calls++;
      const res = await complete(req);
      const call = res.content.find((c): c is Extract<ContentBlock, { type: 'tool_use' }> => c.type === 'tool_use' && c.name === RELATION_JUDGE_TOOL_NAME);
      const got = call ? parseRelationJudgement(call.input, ids) : null;
      if (got) return got;
      req.messages = [...req.messages, { role: 'assistant', content: res.content.length > 0 ? res.content : [{ type: 'text', text: '(no answer)' }] }, { role: 'user', content: [{ type: 'text', text: 'Call report_relations now with a verdict for every statement.' }] }];
    }
    return null;
  };
  const settled = await Promise.allSettled(Array.from({ length: n }, (_, k) => seat(k)));
  const samples = settled.flatMap((s) => (s.status === 'fulfilled' && s.value ? [s.value] : []));
  if (samples.length === 0 && settled.every((s) => s.status === 'rejected')) {
    const first = settled[0];
    if (first && first.status === 'rejected') throw first.reason;
  }
  const results = new Map<string, { ok: boolean; note: string }>();
  for (const id of ids) {
    const got = samples.map((s) => s.get(id)).filter((x): x is { ok: boolean; note: string } => x !== undefined);
    if (got.length === 0) continue;
    const ok = got.filter((g) => g.ok).length * 2 >= got.length;
    results.set(id, { ok, note: (got.find((g) => !g.ok)?.note ?? '').slice(0, 240) });
  }
  return { results, calls };
}

// ---------------------------------------------------------------------------------------------------------------- tool for the fixer

export const OBJECT_REASON_TOOL: ToolDef = {
  name: OBJECT_REASON_TOOL_NAME,
  description:
    'Say why an object that still fails cannot be fixed, so it stops counting as open. {reasons:[{id, aspect?: present|type|position|size|material|all, reason}]}. Use it only for a real reason: the object is hidden or cut off in the photo so the judges cannot tell, no model in the library matches it (say what you tried), the tools cannot make it, the inventory box is wrong, or a fix was tried and made another object worse. The reason is shown to the user. An object you did not give a reason for stays open and the run does not finish with it open.',
  inputSchema: {
    type: 'object',
    properties: {
      reasons: { type: 'array', minItems: 1, maxItems: 30, items: { type: 'object', properties: { id: { type: 'string' }, aspect: { type: 'string', enum: [...ASPECTS, 'all'] }, reason: { type: 'string' } }, required: ['id', 'reason'] } },
    },
    required: ['reasons'],
    additionalProperties: false,
  },
};

export function applyReasons(ledger: ObjectLedger, input: unknown, diffs?: { waive(id: string, reason: string): void }): { text: string; ok: boolean } {
  const p = z.object({ reasons: z.array(z.object({ id: z.string(), aspect: z.string().optional(), reason: z.string().trim().min(8).max(300) })).min(1).max(30) }).safeParse(input);
  if (!p.success) return { ok: false, text: 'state_object_reason needs {"reasons":[{"id": an object id, "aspect"?: present|type|position|size|material|all, "reason": at least a sentence}]}.' };
  const lines: string[] = [];
  for (const r of p.data.reasons) {
    const rel = ledger.relations.get(r.id);
    if (rel) {
      rel.waived = r.reason;
      diffs?.waive(rel.id, r.reason);
      lines.push(`${r.id}: kept as it is (${r.reason.slice(0, 80)})`);
      continue;
    }
    const aspect = r.aspect ?? 'all';
    if (!ledger.waive(r.id, aspect, r.reason)) {
      lines.push(`${r.id}: unknown object id`);
      continue;
    }
    for (const a of aspect === 'all' ? ASPECTS : [aspect]) diffs?.waive(`obj-${r.id}-${a}`, r.reason);
    lines.push(`${r.id}${aspect === 'all' ? '' : ` (${aspect})`}: reason recorded`);
  }
  return { ok: true, text: `${lines.join('\n')}\nThese objects no longer count as open; the reasons are shown to the user.` };
}

// ---------------------------------------------------------------------------------------------------------------- text

const mark = (s: AspectState): string => (s === 'pass' ? 'ok' : s === 'fail' ? 'FAIL' : s === 'na' ? 'n/a' : '--');

/** One line per object: the table the fixing model works from. */
export function objectTableText(ledger: ObjectLedger, opts: { limit?: number; evidence?: ReadonlyMap<string, string> } = {}): string {
  const recs = ledger.list();
  if (recs.length === 0) return '';
  const totals = ledger.aspectTotals();
  const head = `Per-object judgement (${recs.length} objects, independent panel, median per aspect; pass ${ASPECTS.map((a) => `${a} ${totals[a].pass}/${totals[a].judged}`).join(', ')}; ${ledger.passingObjects()} objects pass every aspect, ${ledger.openCount()} open aspects${ledger.waivedCount() > 0 ? `, ${ledger.waivedCount()} given a reason` : ''}):`;
  const bad = recs.filter((r) => openAspects(r).length > 0).sort((a, b) => severity(b) - severity(a));
  const lines = bad.slice(0, opts.limit ?? 14).map((r) => {
    const open = openAspects(r);
    const ev = opts.evidence?.get(r.item.id);
    const route = [...new Set(open.map((a) => aspectDifference(a).route))].join('; ');
    return `- ${r.item.id} [${r.item.label}${r.item.entities.length > 0 ? `; built as ${r.item.entities.join(', ')}` : '; no built piece linked'}] ${ASPECTS.map((a) => `${a}:${mark(r.aspects[a].state)}`).join(' ')}${r.fix ? ` | fix: ${r.fix}` : ''}${r.aspects[open[0] as Aspect]?.note ? ` | judges: ${r.aspects[open[0] as Aspect].note}` : ''}${ev ? ` | measured (advice): ${ev}` : ''} | repair: ${route}`;
  });
  const rel = [...ledger.relations.values()].filter((r) => r.state === 'fail' && !r.waived);
  const relLines = rel.slice(0, 8).map((r) => `- layout ${r.id}: ${r.text}${r.note ? ` | ${r.note}` : ''}`);
  const waived = recs.filter((r) => Object.keys(r.waived).length > 0).slice(0, 6).map((r) => `- ${r.item.id}: ${Object.entries(r.waived).map(([k, v]) => `${k}: ${v}`).join('; ')}`);
  const out = [head];
  if (lines.length > 0) out.push(`Still failing, worst first (fix the worst first; position and size are geometry, type is another model, material is materials; one change per object, then the next render is judged again for the changed objects and their neighbours):`, ...lines);
  if (bad.length > lines.length) out.push(`...and ${bad.length - lines.length} more objects fail; they come after these.`);
  if (relLines.length > 0) out.push('Layout relations that do not hold in the render:', ...relLines);
  if (waived.length > 0) out.push('Given a reason by you earlier:', ...waived);
  if (lines.length === 0 && relLines.length === 0) out.push('Every judged object passes.');
  return out.join('\n');
}

/** What a UI shows for one object. */
export interface ObjectView {
  id: string;
  label: string;
  kind: string;
  present: AspectState;
  type: AspectState;
  position: AspectState;
  size: AspectState;
  material: AspectState;
  /** The fix hint or the reason given; '' when it passes. */
  note: string;
  seen: 'both' | 'primary' | 'blind';
  waived?: string;
}

export function objectViews(ledger: ObjectLedger, limit = 80): ObjectView[] {
  return ledger.list().slice(0, limit).map((r) => ({
    id: r.item.id,
    label: r.item.label.slice(0, 80),
    kind: r.item.kind.slice(0, 40),
    present: r.aspects.present.state,
    type: r.aspects.type.state,
    position: r.aspects.position.state,
    size: r.aspects.size.state,
    material: r.aspects.material.state,
    note: (Object.keys(r.waived).length > 0 ? Object.values(r.waived)[0] ?? '' : openAspects(r).length > 0 ? r.fix || r.aspects[openAspects(r)[0] as Aspect].note : '').slice(0, 160),
    seen: r.item.seen,
    ...(Object.keys(r.waived).length > 0 ? { waived: Object.values(r.waived)[0] ?? '' } : {}),
  }));
}

/** One sentence for the closing message. */
export function objectsSummary(ledger: ObjectLedger): string {
  if (ledger.size === 0) return '';
  const t = ledger.aspectTotals();
  const open = ledger.list().filter((r) => openAspects(r).length > 0);
  const parts = ASPECTS.map((a) => `${a} ${t[a].pass}/${t[a].judged}`).join(', ');
  return `Object by object: ${ledger.passingObjects()} of ${ledger.size} objects pass every aspect (${parts})${ledger.waivedCount() > 0 ? `; ${ledger.waivedCount()} left as they are with a stated reason` : ''}${open.length > 0 ? `; still failing: ${open.slice(0, 6).map((r) => `${r.item.label} (${openAspects(r).join(', ')})`).join('; ')}${open.length > 6 ? `; and ${open.length - 6} more` : ''}` : ''}.`;
}

// ---------------------------------------------------------------------------------------------------------------- instructions

/** What the fixing model is told about the object table each round. */
export function objectsProcedure(round: number): string {
  return [
    'OBJECTS. The photo was inventoried object by object and a panel of independent judges rates each object on five aspects against the render (present, type, position, size, material). The table above lists what fails, worst first, with the judges\' fix hint, advisory measured evidence (projected place against the photo, distances) and the tool that repairs it.',
    'Work through the worst objects: position and size are geometry (edit_items move/resize, or design_plan for the shell), a wrong type is another model (find_model, then remove and place_items), a missing object is added (place_items), colour and finish are materials. Declare each repair (declare_repair with the object\'s obj-<id>-<aspect> difference), make one change per object, and leave objects that pass alone: a change that makes an object worse is put back for that object.',
    round > 1 ? 'The next render is judged again for the objects you changed and their neighbours (and for everything every few rounds).' : '',
    'When an object cannot be fixed (hidden or cut off in the photo, no matching model after trying find_model, a limit of the tools, or a wrong inventory box), call state_object_reason with the reason instead of leaving it: the run does not finish while an object fails without one.',
  ].filter((l) => l.length > 0).join('\n');
}

/** The reply when the model tries to finish with objects still failing and no reason given. */
export function objectsDueText(open: number): string {
  return `${open} object aspect${open === 1 ? '' : 's'} still fail${open === 1 ? 's' : ''} in the table (worst first). Fix them, or call state_object_reason for each one you cannot fix, saying why (hidden in the photo, no matching model, a limit of the tools). Then finish.`;
}
