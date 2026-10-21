/**
 * The itemised checklist a render is judged against, built from the description BEFORE anything is built,
 * and the arithmetic of the verdicts: a pass rate, and whether a structural item (the shell, a window, the
 * main piece of furniture) failed. The judge is a vision model looking at the photo and a render from the
 * photo's own camera side by side; this module only holds the list and counts the answers.
 */
import { z } from 'zod';
import { furnitureByKind } from '../furniture/index';
import { MAX_PHOTO_ITEMS, MAX_PHOTO_OPENINGS, type RoomDescription } from './description';

/** Group of a checklist entry. */
export type ChecklistCategory = 'shell' | 'opening' | 'furniture' | 'decor' | 'lighting' | 'material';

/** One thing the render must show. */
export interface ChecklistItem {
  /** Stable id: `shell-size`, `opening-<id>`, `item-<id>`, `light`, … */
  id: string;
  category: ChecklistCategory;
  /** What to look for, in words a judge can test against the picture. */
  text: string;
  /** A failure here fails the room however many other items pass. */
  structural: boolean;
  /** The piece or opening this entry is about (the handle the tools know it by). */
  target?: string;
}

const MAIN_KINDS: ReadonlySet<string> = new Set(['bed', 'sofa', 'desk', 'dining-table', 'kitchen', 'island', 'wardrobe', 'bathtub']);
const LIGHT_KINDS: ReadonlySet<string> = new Set(['floor-lamp', 'table-lamp', 'pendant', 'ceiling-light', 'sconce']);

function where(it: RoomDescription['items'][number]): string {
  if (it.on) return `standing on ${it.on}`;
  if (it.above) return `hung above ${it.above}`;
  if (it.opening) return `at window ${it.opening}`;
  if (it.wall && it.along !== undefined) return `${it.wall} wall, ${Math.round(it.along * 100) / 100} m from its left corner${it.bottom !== undefined ? `, bottom at ${Math.round(it.bottom * 100) / 100} m` : ''}`;
  if (it.at) return `on the floor at ${it.at[0]}, ${it.at[1]}`;
  return 'in the room';
}

function colourNote(it: RoomDescription['items'][number]): string {
  const cols = Object.entries(it.params)
    .filter(([k, v]) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) && !/^(mat|border)/i.test(k))
    .slice(0, 3);
  return cols.length > 0 ? ` (${cols.map(([k, v]) => `${k} ${String(v)}`).join(', ')})` : '';
}

/** The checklist of a description, in judging order: shell, openings, furniture, decor, lighting, materials. */
export function buildChecklist(d: RoomDescription): ChecklistItem[] {
  const out: ChecklistItem[] = [];
  const w = Math.round(d.footprint.width * 100) / 100;
  const dp = Math.round(d.footprint.depth * 100) / 100;
  out.push({ id: 'shell-size', category: 'shell', structural: true, text: `Room proportions: about ${w} m wide by ${dp} m deep, ceiling ${d.footprint.ceiling} m, seen from where the photo was taken` });
  const wallColors = (['north', 'south', 'east', 'west'] as const).flatMap((k) => {
    const f = d.walls[k];
    return f?.color && f.visible !== false ? [`${k} ${f.color}`] : [];
  });
  out.push({ id: 'wall-colour', category: 'material', structural: false, text: `Wall colour and finish${wallColors.length > 0 ? ` (${wallColors.join(', ')})` : ''}` });
  out.push({ id: 'floor', category: 'material', structural: false, text: `Floor: ${d.floor.material}${d.floor.color ? ` ${d.floor.color}` : ''}${d.floor.note ? `, ${d.floor.note}` : ''}` });
  const v = d.ceiling.vault;
  if (v) out.push({ id: 'vault', category: 'shell', structural: false, text: `Vaulted ceiling rising to a ridge about ${Math.round((d.footprint.ceiling + v.rise) * 10) / 10} m (walls ${d.footprint.ceiling} m at the eaves)${v.trusses ? `, ${Math.round(v.trusses)} exposed timber trusses` : ''}` });
  if (d.ceiling.cornice && !v) {
    out.push({ id: 'cornice', category: 'decor', structural: false, text: `Ceiling cornice / crown moulding along the walls, about ${Math.round(d.ceiling.cornice.height * 100)} cm deep${d.ceiling.cornice.color ? `, ${d.ceiling.cornice.color}` : ''}`, target: 'cornice-north' });
  }
  for (const o of d.openings) {
    if (!o.visible) continue;
    out.push({
      id: `opening-${o.id}`,
      category: 'opening',
      structural: o.kind === 'window',
      target: o.id,
      text: `${o.kind} ${o.id} on the ${o.wall} wall, centre ${Math.round(o.along * 100) / 100} m from its left corner, ${o.width} m wide${o.height ? `, ${o.height} m tall` : ''}${o.sill !== undefined ? `, bottom at ${o.sill} m` : ''}${o.note ? `; ${o.note}` : ''}`,
    });
  }
  const floorItems = d.items.filter((i) => i.visible && furnitureByKind(i.kind)?.mount === 'floor' && i.kind !== 'rug');
  const mainId = floorItems.find((i) => MAIN_KINDS.has(i.kind))?.id;
  for (const it of d.items) {
    if (!it.visible || it.kind === 'cornice') continue;
    const def = furnitureByKind(it.kind);
    if (!def) continue;
    const category: ChecklistCategory = LIGHT_KINDS.has(it.kind) ? 'lighting' : def.mount === 'floor' && it.kind !== 'rug' ? 'furniture' : 'decor';
    out.push({ id: `item-${it.id}`, category, structural: it.id === mainId, target: it.id, text: `${it.label || it.kind} (${it.kind} ${it.id}): ${where(it)}${colourNote(it)}` });
  }
  out.push({
    id: 'light',
    category: 'lighting',
    structural: false,
    text: `Light: ${d.light.brightness >= 0.65 ? 'bright' : d.light.brightness <= 0.35 ? 'dim' : 'moderate'}, ${d.light.warmth}${d.light.from !== 'none' ? `, coming in through the ${d.light.from} window` : ', from lamps'}${d.light.note ? `; ${d.light.note}` : ''}`,
  });
  return out;
}

/**
 * Longest checklist {@link buildChecklist} can produce: shell size, wall colour, floor, vault or cornice, the
 * light, and one entry per opening and item a description may hold.
 */
export const MAX_CHECKLIST_ITEMS = 5 + MAX_PHOTO_OPENINGS + MAX_PHOTO_ITEMS;

/**
 * Most verdicts one judging call may report: the whole checklist plus room for a few repeated ids (the last
 * verdict of an id wins). The tool schemas advertise it and the parsers enforce it, so the two always agree.
 */
export const MAX_VERDICTS = 120;

/** The judge's answer for one checklist entry. */
export const ItemVerdict = z.object({
  id: z.string().min(1).max(60),
  pass: z.boolean(),
  /** What differs when it fails: concrete and short ("curtain is shorter than in the photo"). */
  note: z.string().max(240).default(''),
});
export type ItemVerdict = z.infer<typeof ItemVerdict>;

/** Pass rate and failures of a judged checklist. */
export interface Scoreboard {
  total: number;
  passed: number;
  /** passed / total (1 when the list is empty). */
  rate: number;
  /** Entries the judge did not answer count as failures. */
  failing: Array<ChecklistItem & { note: string }>;
  /** A structural entry failed. */
  structuralFailed: boolean;
}

/** Count verdicts against the checklist. Unknown ids are ignored; the last verdict of an id wins. */
export function scoreVerdicts(list: readonly ChecklistItem[], verdicts: readonly ItemVerdict[]): Scoreboard {
  const byId = new Map<string, ItemVerdict>();
  for (const v of verdicts) byId.set(v.id, v);
  let passed = 0;
  const failing: Scoreboard['failing'] = [];
  for (const item of list) {
    const v = byId.get(item.id);
    if (v?.pass) passed++;
    else failing.push({ ...item, note: v ? v.note : 'not judged' });
  }
  const total = list.length;
  return { total, passed, rate: total === 0 ? 1 : passed / total, failing, structuralFailed: failing.some((f) => f.structural) };
}

/** A one-line summary of a scoreboard ("31/36 pass (86%); failing: curtain-left, floor"). */
export function scoreLine(s: Scoreboard): string {
  return `${s.passed}/${s.total} pass (${Math.round(s.rate * 100)}%)${s.failing.length > 0 ? `; failing: ${s.failing.slice(0, 8).map((f) => f.id).join(', ')}${s.failing.length > 8 ? ', …' : ''}` : ''}`;
}
