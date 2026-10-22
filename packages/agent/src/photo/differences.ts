/**
 * The differences ledger of a compare: what still differs between the reference and the render, written by the
 * model that looked at both, ranked by how big each gap is, and followed from round to round.
 *
 * The model writes the list (`report_differences`); this class only keeps it honest: the largest gaps come first, a
 * gap that the model fixed must be confirmed on the NEXT render (it reports each earlier id again with what it now
 * sees: fixed, smaller, same or worse), a gap that did not shrink after an edit is pointed out, an earlier gap that is
 * not mentioned stays counted as open, and what is still open at the end is listed in plain words. Nothing here
 * judges the picture; it is bookkeeping for the model's own judgements.
 */
import { z } from 'zod';
import type { ToolDef } from '../types';

export const DIFFERENCES_TOOL_NAME = 'report_differences';

/** The kinds of difference the model sorts what it sees into. */
export const DIFF_KINDS = ['proportion', 'position', 'colour', 'material', 'lighting', 'missing', 'extra', 'scale', 'other'] as const;
export type DiffKind = (typeof DIFF_KINDS)[number];
/** What a difference came to since it was last reported. */
export const DIFF_STATUSES = ['fixed', 'smaller', 'same', 'worse'] as const;
export type DiffStatus = 'open' | (typeof DIFF_STATUSES)[number];

/** Most differences in one report. */
export const MAX_DIFFERENCES = 30;

const Entry = z.object({
  id: z.string().min(1).max(40),
  kind: z.enum(DIFF_KINDS).optional(),
  where: z.string().max(80).default(''),
  what: z.string().min(1).max(300),
  size: z.number().min(0).max(5).default(3),
  status: z.enum(DIFF_STATUSES).optional(),
});
const Input = z.object({ differences: z.array(z.unknown()).max(MAX_DIFFERENCES), summary: z.string().max(400).optional() });

/** The tool the model lists differences through. Detail lives here, not in the system prompt. */
export const DIFFERENCES_TOOL: ToolDef = {
  name: DIFFERENCES_TOOL_NAME,
  description:
    'Write down what still differs between the reference and the render, from what you SEE in the side-by-side image, the zoomed crops of each region and the colour readout (the readout is measured advice, your eyes decide). One entry per concrete difference: kind (proportion, position, colour, material, lighting, missing, extra, scale), where (wall, piece or region), what (one sentence with the amount: "headboard 0.3 m too narrow", "wall reads cooler and 15% darker"), size 1..5 (5 = obvious at first glance, 1 = only in a crop). List EVERYTHING you can see, then fix the LARGEST first and make one change per difference. From the second round on, send the whole list again: keep each earlier id and add status for it, judged on the NEW render only ("fixed", "smaller", "same", "worse"), and add new entries for anything new. An earlier id you leave out stays counted as open. Call this once per round, before fixing; an empty list means nothing differs.',
  inputSchema: {
    type: 'object',
    properties: {
      differences: {
        type: 'array',
        maxItems: MAX_DIFFERENCES,
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Short stable slug, reused in later rounds ("bed-width").' },
            kind: { type: 'string', enum: [...DIFF_KINDS] },
            where: { type: 'string' },
            what: { type: 'string' },
            size: { type: 'number', minimum: 0, maximum: 5 },
            status: { type: 'string', enum: [...DIFF_STATUSES], description: 'Earlier ids only: what this difference came to on the new render.' },
          },
          required: ['id', 'what'],
        },
      },
      summary: { type: 'string', description: 'One sentence: how close the render is overall.' },
    },
    required: ['differences'],
    additionalProperties: false,
  },
};

/** One difference as the ledger keeps it. */
export interface Difference {
  id: string;
  kind: DiffKind;
  where: string;
  what: string;
  /** 1..5 as last reported (0 once fixed). */
  size: number;
  status: DiffStatus;
  /** Rounds it has been reported open. */
  rounds: number;
  /** The round it was first reported in. */
  since: number;
  /** Who found it: the model that fixes, or the independent check at the end. */
  source: 'model' | 'independent';
}

/** What `record` says back. */
export type Recorded = { ok: true; text: string; open: number; ranked: Difference[] } | { ok: false; error: string };

/** The ledger. Plain data in, plain data out: a snapshot can be restored when a round is rolled back. */
export class DifferenceLedger {
  private entries = new Map<string, Difference>();
  private round = 0;
  private edited = false;
  /** The largest open difference at the last report (to check that it shrank after an edit). */
  private topId: string | null = null;

  /** The model changed the room since the last report. */
  markEdited(): void {
    this.edited = true;
  }

  /** The room was put back (a round rolled back): the edits since the last report no longer count. */
  clearEdited(): void {
    this.edited = false;
  }

  /** Record one report (the model's whole list for this round). */
  record(raw: unknown, source: Difference['source'] = 'model'): Recorded {
    const p = Input.safeParse(raw);
    if (!p.success) return { ok: false, error: `report_differences needs {"differences":[{"id","kind","where","what","size":1..5,"status"?}]} with at most ${MAX_DIFFERENCES} entries.` };
    this.round++;
    const seen = new Set<string>();
    const notes: string[] = [];
    const bad: string[] = [];
    for (const r of p.data.differences) {
      const e = Entry.safeParse(r);
      if (!e.success) {
        bad.push(typeof (r as { id?: unknown })?.id === 'string' ? (r as { id: string }).id : '?');
        continue;
      }
      const d = e.data;
      seen.add(d.id);
      const prev = this.entries.get(d.id);
      if (prev && d.status) {
        const done = d.status === 'fixed';
        this.entries.set(d.id, { ...prev, kind: d.kind ?? prev.kind, where: d.where || prev.where, what: d.what, size: done ? 0 : Math.round(d.size), status: d.status, rounds: done ? prev.rounds : prev.rounds + 1 });
        if (this.edited && d.status === 'same' && prev.id === this.topId) notes.push(`"${prev.id}" (the largest last round) did not shrink although you changed the room: that fix did not work. Look at it again and try a different change, or say it cannot be done with the tools.`);
        if (d.status === 'worse') notes.push(`"${d.id}" got worse: undo what you changed for it (the previous values are in the last edit results) before trying something else.`);
      } else if (prev && !d.status) {
        // Reported again without a status: treated as unchanged, and the model is told how to confirm.
        this.entries.set(d.id, { ...prev, kind: d.kind ?? prev.kind, where: d.where || prev.where, what: d.what, size: Math.round(d.size), status: prev.status === 'fixed' ? 'open' : prev.status, rounds: prev.rounds + 1 });
        if (this.round > 1) notes.push(`"${d.id}" was reported again without a status: say whether it is fixed, smaller, same or worse on this render.`);
      } else {
        this.entries.set(d.id, { id: d.id, kind: d.kind ?? 'other', where: d.where, what: d.what, size: Math.round(d.size), status: 'open', rounds: 1, since: this.round, source });
      }
    }
    const missing = [...this.entries.values()].filter((d) => !seen.has(d.id) && d.status !== 'fixed' && d.source === source);
    if (missing.length > 0) notes.push(`Not mentioned this time, so still counted as open: ${missing.map((m) => m.id).join(', ')}. Report them with a status.`);
    if (bad.length > 0) notes.push(`Skipped invalid entries: ${bad.slice(0, 5).join(', ')}.`);
    this.edited = false;
    const ranked = this.ranked();
    this.topId = ranked[0]?.id ?? null;
    const lines = ranked.length === 0
      ? ['No open differences recorded. If the render and the reference still differ anywhere, list it.']
      : [`Recorded. ${ranked.length} open, largest first (fix in this order, one change per difference, then the next render must show the exact gap smaller):`, ...ranked.slice(0, 12).map((d, i) => `${i + 1}. ${d.id} [${d.kind}, size ${d.size}${d.rounds > 1 ? `, open ${d.rounds} rounds` : ''}] ${d.where ? `${d.where}: ` : ''}${d.what}`)];
    return { ok: true, text: [...lines, ...notes].join('\n'), open: ranked.length, ranked };
  }

  /** Open differences, largest first (older first among equals). */
  ranked(): Difference[] {
    return [...this.entries.values()].filter((d) => d.status !== 'fixed').sort((a, b) => b.size - a.size || b.rounds - a.rounds || a.since - b.since);
  }

  /** Everything still open, in words, for the closing message ('' when nothing is). */
  unresolvedText(limit = 6): string {
    const r = this.ranked();
    if (r.length === 0) return '';
    return `${r.length} difference${r.length === 1 ? '' : 's'} from the reference ${r.length === 1 ? 'is' : 'are'} still open, largest first: ${r.slice(0, limit).map((d) => `${d.id} (${d.kind}${d.where ? `, ${d.where}` : ''}: ${d.what.slice(0, 90)})`).join('; ')}${r.length > limit ? `; and ${r.length - limit} smaller` : ''}.`;
  }

  /** The list as the next round shows it to the model. */
  roundText(): string {
    const r = this.ranked();
    if (r.length === 0) return '';
    return `Your differences list from the last round (largest first). Look at the new render and crops, then call report_differences with every id again and its status on THIS render:\n${r.slice(0, 15).map((d, i) => `${i + 1}. ${d.id} [${d.kind}, size ${d.size}] ${d.where ? `${d.where}: ` : ''}${d.what}`).join('\n')}`;
  }

  snapshot(): { entries: Difference[]; round: number; topId: string | null } {
    return { entries: [...this.entries.values()].map((d) => ({ ...d })), round: this.round, topId: this.topId };
  }

  restore(s: { entries: Difference[]; round: number; topId: string | null }): void {
    this.entries = new Map(s.entries.map((d) => [d.id, { ...d }]));
    this.round = s.round;
    this.topId = s.topId;
    this.edited = false;
  }
}

/** The view a UI shows of the list. */
export interface DifferenceView {
  id: string;
  kind: string;
  where: string;
  what: string;
  size: number;
  status: string;
  rounds: number;
  source: 'model' | 'independent';
}

export function differenceViews(ds: readonly Difference[], limit = 20): DifferenceView[] {
  return ds.slice(0, limit).map((d) => ({ id: d.id, kind: d.kind, where: d.where.slice(0, 80), what: d.what.slice(0, 200), size: d.size, status: d.status, rounds: d.rounds, source: d.source }));
}
