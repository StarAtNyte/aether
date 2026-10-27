/**
 * Seed and reconcile the two-seat object inventory with the perception report. Matched objects keep the seats' entry and
 * gain what was measured (colour in words and hex, size and place in metres) with `source: measured`. A perceived object
 * no seat listed is added, flagged `seen: 'measured'`, so the object judge looks for it in the room: the judges decide whether
 * it is real (the detector can be wrong), nothing here fails or passes anything. Advisory by design.
 */
import { MAX_INVENTORY, nameSimilarity, type InventoryItem, type ObjectCategory } from '../objects';
import { normLabel, type PerceivedObject, type PerceptionReport } from './perceive';

const iou = (a: readonly number[], b: readonly number[]): number => {
  const w = Math.min(a[2] as number, b[2] as number) - Math.max(a[0] as number, b[0] as number);
  const h = Math.min(a[3] as number, b[3] as number) - Math.max(a[1] as number, b[1] as number);
  if (w <= 0 || h <= 0) return 0;
  const i = w * h;
  return i / (((a[2] as number) - (a[0] as number)) * ((a[3] as number) - (a[1] as number)) + ((b[2] as number) - (b[0] as number)) * ((b[3] as number) - (b[1] as number)) - i);
};

const CATEGORY: [RegExp, ObjectCategory][] = [
  [/(curtain|rug|carpet|towel|pillow|cushion|blanket|throw|bedding)/, 'textile'],
  [/(plant|flower|tree)/, 'plant'],
  [/(lamp|light|sconce|window|door|radiator|vent|switch|detector)/, 'fixture'],
  [/(painting|picture|frame|mirror|poster|clock|vase)/, 'decor'],
  [/(book|bottle|cup|remote|phone|laptop|bag|luggage|suitcase|backpack|box)/, 'small'],
];
export const categoryOf = (label: string): ObjectCategory => CATEGORY.find(([re]) => re.test(label))?.[1] ?? 'furniture';

/** One line of the measured facts, for the `look`/`size` of an item. */
export function measuredLine(o: PerceivedObject): string {
  const a = o.appearance;
  const p = o.placement;
  return [
    a ? `${a.colour.name} ${a.colour.hex}${a.pattern.kind === 'plain' ? '' : `, ${a.pattern.kind}`}, ${a.finish}` : '',
    p ? `${p.kind}, visible size ${p.size.w} x ${p.size.h} m, ${p.y.low}-${p.y.high} m above the floor${p.against.length > 0 ? `, against the ${p.against.map((x) => x.wall).join('/')} wall` : ''}` : '',
  ].filter(Boolean).join('; ');
}

export interface Seeded {
  items: InventoryItem[];
  /** Perceived objects no seat listed (added, flagged). */
  added: string[];
  /** Seat objects a perceived object was matched to. */
  matched: number;
  line: string;
}

export function seedInventory(items: readonly InventoryItem[], rep: PerceptionReport, opt: { minConfidence?: number; maxAdded?: number } = {}): Seeded {
  const minConf = opt.minConfidence ?? 0.3;
  const maxAdd = opt.maxAdded ?? 8;
  const out = items.map((i) => ({ ...i }));
  const used = new Set(out.map((i) => i.id));
  const taken = new Set<number>();
  let matched = 0;
  const added: string[] = [];
  const ranked = rep.objects.slice().sort((a, b) => b.confidence - a.confidence);
  for (const o of ranked) {
    let best = -1;
    let bs = 0;
    out.forEach((it, i) => {
      if (taken.has(i) || it.seen === 'measured') return;
      const ov = iou(it.box, o.box);
      const nm = nameSimilarity({ ...it, kind: it.kind, label: it.label }, { ...it, kind: o.label, label: o.label });
      const s = ov >= 0.3 && (nm >= 0.4 || ov >= 0.6) ? ov + nm * 0.5 : 0;
      if (s > bs) { bs = s; best = i; }
    });
    if (best >= 0) {
      taken.add(best);
      matched++;
      const it = out[best] as InventoryItem;
      const line = measuredLine(o);
      it.measured = { id: o.id, colour: o.appearance?.colour.name ?? '', hex: o.appearance?.colour.hex ?? '', text: line };
      if (line && !/measured:/.test(it.look)) it.look = `${it.look}${it.look ? ' | ' : ''}measured: ${line}`.slice(0, 400);
      continue;
    }
    if (added.length >= maxAdd || out.length >= MAX_INVENTORY) continue;
    if (o.confidence < minConf || o.areaFraction < 0.004 || o.mask === null) continue;
    let id = `measured-${o.label.replace(/[^a-z0-9]+/g, '-')}`.slice(0, 44);
    for (let k = 2; used.has(id); k++) id = `measured-${o.label.replace(/[^a-z0-9]+/g, '-')}`.slice(0, 40) + `-${k}`;
    used.add(id);
    const line = measuredLine(o);
    out.push({
      id,
      kind: o.label,
      category: categoryOf(o.label),
      label: `${normLabel(o.label)} (found by measurement)`,
      box: o.box,
      relations: o.relations.slice(0, 4),
      size: o.placement ? `${o.placement.size.w} x ${o.placement.size.h} m visible` : '',
      look: line ? `measured: ${line}` : '',
      confidence: Math.min(0.6, o.confidence),
      occlusion: '',
      entities: [],
      linkedBy: 'none',
      seen: 'measured',
      measured: { id: o.id, colour: o.appearance?.colour.name ?? '', hex: o.appearance?.colour.hex ?? '', text: line },
    });
    added.push(`${o.label} [${o.id}]`);
  }
  const line = `Perception (measured) matched ${matched} of the ${items.length} listed objects and found ${added.length} the seats did not list${added.length > 0 ? ` (${added.join(', ')}; added to the inventory flagged, to be checked in the room)` : ''}.`;
  return { items: out, added, matched, line };
}
