/**
 * The object stage of the compare loop: the inventory of what the photo shows (two seats, reconciled), then each round the
 * per-object judgement of the objects that changed (plus their neighbours, and everything at a first look and every few
 * rounds), the differences the failing aspects become, the relations of the layout, and the best state of each object.
 *
 * The models look and judge (objects.ts holds the prompts and the panel); this file sequences the calls, draws the paired
 * crops and writes the books. Nothing here passes or fails an object by a number.
 */
import type { PerceptionReport } from './perception/perceive';
import { seedInventory } from './perception/seed';
import type { Entity, WorldDoc } from '@aether/core';
import type { ReviewPose } from '@aether/arch';
import type { AgentEvent, AgentHost, ContentBlock, PhotoObjectView } from '../types';
import { cropBox } from './closer';
import { DifferenceLedger } from './differences';
import { padBox } from './kit';
import {
  ASPECTS,
  INVENTORY_SEED,
  INVENTORY_SYSTEM,
  INVENTORY_TOOL,
  INVENTORY_TOOL_NAME,
  OBJECTS_PER_REQUEST,
  ObjectLedger,
  aspectDifference,
  inventoryText,
  objectTableText,
  objectViews,
  openAspects,
  countsLine,
  OBJECT_ROUNDS_DEFAULT,
  PLATEAU_ROUNDS,
  parseInventory,
  reconcileInventories,
  runObjectPanel,
  runRelationPanel,
  selectObjects,
  type Aspect,
  type Box,
  type CompleteFn,
  type Current,
  type InventoryItem,
  type ObjectBatch,
  type ObjectRec,
} from './objects';
import { autoLink, boxSignature, builtPiecesText, evidenceMap, knownEntityIds, projectBuilt, projectedBox, repairEvidence, residualLine, residualOf, suggestCorrection, type Projection } from './objects-evidence';
import { restorePatches } from './revert';
import { compareObjects, type Measured } from './objects-measure';
import type { Raster } from './score';

export interface StageDeps {
  complete: CompleteFn;
  /** Judges per look (at least one). */
  judges: number;
  photoUrl: string;
  /** Pixel size of the photo (for the error in pixels). */
  px: { w: number; h: number };
  compose: AgentHost['composeImages'] | undefined;
  /** The render from the photo camera with numbered boxes drawn on it (null: the host cannot). */
  boxesShot: ((pose: ReviewPose, marks: Array<{ n: number; box: Box }>) => Promise<string | null>) | undefined;
  getWorld(): WorldDoc;
  applyPatches(patches: unknown[], message: string): { errors: unknown[]; applied: unknown[] };
  signal?: AbortSignal;
  /** Most object rounds in this run (default {@link OBJECT_ROUNDS_DEFAULT}). */
  maxRounds?: number;
  /** Measure the nouns of the inventory (perception layer); null when it is unavailable. */
  perceive?: (labels: string[]) => Promise<PerceptionReport | null>;
  /** The perception report of the run (masks, measured colours), for the measured comparison each round; null: none. */
  report?: () => PerceptionReport | null;
  /** Library models that look like the crop of a perceived or inventory object (one line), for objects whose type or presence is off; null: none. */
  like?: (object: string) => Promise<string | null>;
}

export interface RoundInput {
  round: number;
  /** The world as it was rendered. */
  world: WorldDoc;
  /** The plain render from the photo camera. */
  render: string;
  /** That render decoded small (null: change is told from the projected boxes alone). */
  raster: Raster | null;
  /** The photo camera of this render (null: no evidence is drawn from the scene). */
  pose: ReviewPose | null;
  aspect: number;
  diffs: DifferenceLedger | null;
  /** Changes whenever the photo camera or the light moved: everything is judged again. */
  lookKey: string;
}

export interface RoundResult {
  judged: number;
  full: boolean;
  /** Fewer aspects fail than before this round's judgement. */
  gain: boolean;
  /** Objects put back to their best state because a change made them worse. */
  reverted: string[];
  /** Objects that got worse and could not be put back (no linked piece). */
  worse: string[];
  calls: number;
  /** The measured comparison of this round (absent without a perception report). */
  measured?: Measured['counts'] & { surfaces: Array<{ surface: string; deltaE: number | null }> };
}

const aborted = (s?: AbortSignal): void => {
  if (s?.aborted) throw new Error('aborted');
};

export class ObjectStage {
  ledger: ObjectLedger;
  private lastLook: string | null = null;
  private evidence = new Map<string, string>();
  private lastReverted: string[] = [];
  /** The photo camera of the latest judged render, and the residual (pixels) each linked object had when last measured. */
  private pose: ReviewPose | null = null;
  private aspect = 1.5;
  private resid = new Map<string, number>();
  private measured: Measured | null = null;
  /** Rounds in a row in which every object the judges still fault measures close or match. */
  private closeStreak = 0;
  private likeLines = new Map<string, string>();
  /** Object rounds, model calls and time in this run of the loop (a continued run starts again). */
  private rounds = 0;
  private calls = 0;
  private readonly started = Date.now();

  get cap(): number {
    const c = this.deps.maxRounds ?? OBJECT_ROUNDS_DEFAULT;
    return Number.isFinite(c) ? Math.max(1, Math.min(200, Math.floor(c))) : OBJECT_ROUNDS_DEFAULT;
  }

  /** Why the loop should end now with objects still off (null: go on). */
  stopCheck(): string | null {
    if (!this.ready || this.open() === 0) return null;
    if (this.rounds >= this.cap) return `reached the limit of ${this.cap} object rounds`;
    if (this.closeStreak >= 2) return 'every object the judges still fault measures close (mask IoU above 0.6, colour deltaE under 10) for 2 rounds in a row: the judges and the measurements disagree, and the measurements are the finer instrument for a small difference';
    if (this.ledger.plateau()) return `the last ${PLATEAU_ROUNDS} rounds raised neither the pass rate nor lowered the open count`;
    return null;
  }

  /** Mark every object still off with the reason; the best state of each stays in the room. */
  finalizeStop(reason: string): number {
    return this.ledger.markStopped(reason);
  }

  /** A line on the budget used so far, with a warning when the cap is near. */
  budgetLine(): string {
    const min = Math.round((Date.now() - this.started) / 6000) / 10;
    const left = this.cap - this.rounds;
    return `object round ${this.rounds} of ${this.cap}, ${this.calls} model calls, ${min} min so far${left <= 2 ? ` (${left <= 0 ? 'last round' : `${left} round${left === 1 ? '' : 's'} left`} before the loop stops)` : ''}`;
  }

  constructor(private readonly deps: StageDeps, ledger?: ObjectLedger | null) {
    this.ledger = ledger ?? new ObjectLedger();
  }

  /** The inventory exists (made now, or restored from a saved run). */
  get ready(): boolean {
    return this.ledger.size > 0;
  }

  open(): number {
    return this.ledger.openCount();
  }

  /** Keys of the failing aspects (for the stall detector). */
  openKeys(): string[] {
    return [...this.ledger.list().flatMap((r) => openAspects(r).map((a) => `${r.item.id}:${a}`)), ...[...this.ledger.relations.values()].filter((r) => r.state === 'fail' && !r.waived).map((r) => r.id)];
  }

  views(): PhotoObjectView[] {
    return objectViews(this.ledger);
  }

  private measuredSummary(): { measured?: NonNullable<RoundResult['measured']> } {
    return this.measured ? { measured: { ...this.measured.counts, surfaces: this.measured.surfaces.map((x) => ({ surface: x.surface, deltaE: x.deltaE })) } } : {};
  }

  /** Put the measured hints (and the look-alike library models) next to each object's evidence. */
  private mergeMeasured(): void {
    if (!this.measured) return;
    for (const m of this.measured.rows) {
      const bits = [`measured: ${m.verdict}${m.iou !== null ? `, mask IoU ${m.iou}` : ''}${m.deltaE !== null ? `, colour deltaE ${m.deltaE}` : ''}${m.hint ? `. ${m.hint}` : ''}`];
      const like = this.likeLines.get(m.id);
      if (like) bits.push(like);
      const prev = this.evidence.get(m.id) ?? '';
      this.evidence.set(m.id, `${prev.replace(/ ?measured: [^\n]*$/s, '')}${prev ? ' ' : ''}${bits.join(' ')}`.trim());
    }
    for (const [id, like] of this.likeLines) if (!this.measured.rows.some((m) => m.id === id)) this.evidence.set(id, `${this.evidence.get(id) ?? ''} ${like}`.trim());
  }

  /** The table the fixing model reads. */
  text(): string {
    const t = objectTableText(this.ledger, { evidence: this.evidence }) + (this.measured ? `\n${this.measured.text}` : '');
    const back = this.lastReverted.length > 0 ? `\nPut back to their best state before this round because the last change made them worse: ${this.lastReverted.join(', ')}. The pictures below were taken before they were put back.` : '';
    return t + back;
  }

  // ------------------------------------------------------------------------------------------------------------ inventory

  /** Two seats list the photo, one told what is built and one blind; the lists are reconciled into the ledger. */
  async *inventory(summary: string): AsyncGenerator<AgentEvent, boolean> {
    const world = this.deps.getWorld();
    const known = knownEntityIds(world);
    const built = builtPiecesText(world);
    yield { type: 'status', text: 'Listing every object in the photo…' };
    const ask = async (seat: number, withBuilt: boolean): Promise<{ items: InventoryItem[]; skipped: number } | null> => {
      const content: ContentBlock[] = [{ type: 'text', text: inventoryText(withBuilt ? built : '', summary) }, { type: 'text', text: 'Image 1: the PHOTO' }, { type: 'image', dataUrl: this.deps.photoUrl }];
      const messages: Array<{ role: 'user' | 'assistant'; content: ContentBlock[] }> = [{ role: 'user', content }];
      for (let attempt = 0; attempt < 2; attempt++) {
        this.calls++;
        const res = await this.deps.complete({ role: 'critic', system: INVENTORY_SYSTEM, messages, tools: [INVENTORY_TOOL], maxTokens: 12000, temperature: 0, seed: INVENTORY_SEED + seat });
        const call = res.content.find((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use' && b.name === INVENTORY_TOOL_NAME);
        const parsed = call ? parseInventory(call.input, withBuilt ? known : undefined) : null;
        if (parsed && parsed.items.length > 0) return parsed;
        messages.push({ role: 'assistant', content: res.content.length > 0 ? res.content : [{ type: 'text', text: '(no answer)' }] }, { role: 'user', content: call ? [{ type: 'tool_result', toolUseId: call.id, content: 'No valid objects: each needs kind, category, label and a box [x0,y0,x1,y1] in 0..1.', isError: true }] : [{ type: 'text', text: 'Call report_inventory now with every object you can see.' }] });
      }
      return null;
    };
    const [a, b] = await Promise.allSettled([ask(0, true), ask(1, false)]);
    aborted(this.deps.signal);
    const first = a.status === 'fulfilled' ? a.value : null;
    const blind = b.status === 'fulfilled' ? b.value : null;
    if (!first && !blind) {
      const err = a.status === 'rejected' ? a.reason : b.status === 'rejected' ? b.reason : null;
      if (err && /aborted/i.test(String(err instanceof Error ? err.message : err))) throw err;
      yield { type: 'photo', phase: 'round', text: 'No object inventory could be made (the assistant gave no usable list); the room is judged by the checklist alone.' };
      return false;
    }
    const lead = first ?? blind;
    if (!lead) return false;
    let items: InventoryItem[];
    let notes: string[] = [];
    let line: string;
    if (first && blind) {
      const rec = reconcileInventories(first.items, blind.items);
      items = rec.items;
      notes = rec.notes;
      line = `Inventory of the photo: ${items.length} objects. Two independent lists were reconciled: ${rec.both} objects in both, ${rec.onlyPrimary.length} only in the first, ${rec.onlyBlind.length} only in the blind list (flagged, to be checked in the room).`;
    } else {
      items = lead.items.map((i) => ({ ...i, seen: first ? ('primary' as const) : ('blind' as const) }));
      line = `Inventory of the photo: ${items.length} objects (${first ? 'the second, blind list failed' : 'only the blind list answered'}).`;
    }
    if (this.deps.perceive) {
      const rep = await this.deps.perceive([...new Set(items.map((i) => i.kind))].slice(0, 30)).catch(() => null);
      aborted(this.deps.signal);
      if (rep && rep.objects.length > 0) {
        const seeded = seedInventory(items, rep);
        items = seeded.items;
        line = `${line} ${seeded.line}`;
        if (seeded.added.length > 0) notes = [...notes, `Found by measurement only (check that they exist in the room): ${seeded.added.join(', ')}.`];
      }
    }
    this.ledger.load(items, notes);
    yield { type: 'photo', phase: 'round', text: `${line}${lead.skipped > 0 ? ` ${lead.skipped} entries were not valid and are left out.` : ''}`, objects: this.views() };
    return true;
  }

  // ------------------------------------------------------------------------------------------------------------ one round

  /** Judge the objects that need it on this render, record the results, revert what got worse, and write the differences. */
  async *round(inp: RoundInput): AsyncGenerator<AgentEvent, RoundResult> {
    const { ledger } = this;
    const empty: RoundResult = { judged: 0, full: false, gain: false, reverted: [], worse: [], calls: 0 };
    this.lastReverted = [];
    this.rounds++;
    const proj = inp.pose ? projectBuilt(inp.world, inp.pose, inp.aspect) : null;
    this.pose = inp.pose;
    this.aspect = inp.aspect;
    if (proj) autoLink(ledger, proj);
    this.evidence = proj ? evidenceMap(inp.world, ledger, proj, this.deps.px) : new Map();
    this.resid = new Map();
    if (proj) for (const r of ledger.list()) { const x = residualOf(r.item, proj, this.deps.px); if (x) this.resid.set(r.item.id, x.errPx); }
    this.measured = null;
    const report = this.deps.report?.() ?? null;
    if (report && inp.pose && inp.raster) {
      try {
        this.measured = compareObjects({ world: inp.world, pose: inp.pose, aspect: inp.aspect, report, ledger, render: inp.raster, px: this.deps.px });
      } catch { this.measured = null; }
    }
    if (this.measured) {
      yield { type: 'photo', phase: 'round', round: inp.round, text: this.measured.line };
      this.mergeMeasured();
      const openIds = ledger.list().filter((r) => openAspects(r).length > 0).map((r) => r.item.id);
      const verdictOf = new Map(this.measured.rows.map((m) => [m.id, m.verdict]));
      const allClose = openIds.length > 0 && openIds.every((id) => { const v = verdictOf.get(id); return v === 'match' || v === 'close'; });
      this.closeStreak = allClose ? this.closeStreak + 1 : 0;
      if (this.deps.like) {
        this.likeLines = new Map();
        for (const r of ledger.list().filter((x) => openAspects(x).some((a) => a === 'type' || a === 'present')).slice(0, 4)) {
          const l = await this.deps.like(r.item.measured?.id ?? r.item.id).catch(() => null);
          if (l) this.likeLines.set(r.item.id, l);
        }
        this.mergeMeasured();
      }
    }
    const now = new Map<string, Current>();
    for (const r of ledger.list()) now.set(r.item.id, { sig: inp.raster ? boxSignature(inp.raster, r.item.box) : null, proj: proj ? projectedBox(r.item, proj) : null });
    const force = this.lastLook !== null && this.lastLook !== inp.lookKey;
    this.lastLook = inp.lookKey;
    const sel = selectObjects(ledger, now, inp.round, { force });
    if (sel.ids.length === 0) {
      if (proj) this.evidence = repairEvidence(inp.world, ledger, proj, this.deps.px);
      this.mergeMeasured();
      ledger.noteRound(inp.round);
      return { ...empty, ...this.measuredSummary() };
    }
    const openBefore = ledger.openCount();
    const order = ledger.list().map((r) => r.item.id);
    const boxes = this.deps.boxesShot && inp.pose ? await this.deps.boxesShot(inp.pose, ledger.list().map((r, i) => ({ n: i + 1, box: r.item.box }))).catch(() => null) : null;
    let calls = 0;
    const judged: string[] = [];
    const regressed: string[] = [];
    const ids = sel.ids;
    for (let at = 0; at < ids.length; at += OBJECTS_PER_REQUEST) {
      aborted(this.deps.signal);
      const part = ids.slice(at, at + OBJECTS_PER_REQUEST);
      const recs = part.map((id) => ledger.get(id)).filter((r): r is ObjectRec => r !== undefined);
      const pairs = await Promise.all(recs.map((r) => this.pair(r.item.box, inp.render)));
      const batch: ObjectBatch = {
        items: recs.map((r) => ({ item: r.item, n: order.indexOf(r.item.id) + 1, evidence: this.evidence.get(r.item.id) ?? '' })),
        photo: this.deps.photoUrl,
        boxes,
        render: inp.render,
        pairs,
      };
      const out = await runObjectPanel(this.deps.complete, batch, Math.max(1, this.deps.judges));
      calls += out.calls;
      for (const [id, agg] of out.results) {
        const rec = ledger.get(id) as ObjectRec;
        const c = now.get(id) as Current;
        const ents: Record<string, unknown> = {};
        for (const e of rec.item.entities) if (inp.world.entities[e]) ents[e] = JSON.parse(JSON.stringify(inp.world.entities[e]));
        const res = ledger.apply(id, agg, inp.round, { sig: c.sig, proj: c.proj, entities: ents });
        for (const a of res?.gaveUp ?? []) inp.diffs?.waive(`obj-${id}-${a}`, (ledger.get(id) as ObjectRec).waived[a] ?? 'no improvement after repeated attempts');
        judged.push(id);
        if (res?.regressed) regressed.push(id);
      }
    }
    // A change that made an object worse is undone for that object (its linked pieces go back to their best state).
    const reverted: string[] = [];
    const worse: string[] = [];
    const linked = regressed.filter((id) => {
      const rec = ledger.get(id) as ObjectRec;
      return rec.best !== null && Object.keys(rec.best.entities).length > 0;
    });
    worse.push(...regressed.filter((id) => !linked.includes(id)));
    if (linked.length > 0) {
      const cur = this.deps.getWorld();
      const ents: Record<string, Entity> = { ...cur.entities };
      for (const id of linked) for (const [eid, e] of Object.entries((ledger.get(id) as ObjectRec).best!.entities)) ents[eid] = e as Entity;
      const patches = restorePatches(cur, { ...cur, entities: ents } as WorldDoc);
      if (patches.length === 0 || this.deps.applyPatches(patches, `Put ${linked.length} object${linked.length === 1 ? '' : 's'} back to their best state`).errors.length === 0) {
        for (const id of linked) {
          ledger.markReverted(id);
          reverted.push(id);
        }
      } else worse.push(...linked);
    }
    this.lastReverted = reverted.map((id) => (ledger.get(id) as ObjectRec).item.label);
    // The failing aspects are differences of the ledger; the passing ones close theirs.
    if (inp.diffs) for (const id of judged) this.syncDifferences(ledger.get(id) as ObjectRec, inp.diffs);
    // The layout relations that involve a judged object.
    const touched = new Set(judged);
    const rels = [...ledger.relations.values()].filter((r) => !r.waived && (sel.full || r.items.some((i) => touched.has(i))) && r.items.every((i) => ledger.get(i)?.waived['all'] === undefined)).slice(0, 40);
    if (rels.length > 0 && judged.length > 0) {
      aborted(this.deps.signal);
      try {
        const ev = rels.flatMap((r) => r.items.slice(0, 2)).filter((v, i, a) => a.indexOf(v) === i).slice(0, 12).map((id) => this.evidence.get(id) ? `${ledger.get(id)?.item.label}: ${this.evidence.get(id)}` : '').filter((l) => l.length > 0).join('\n');
        const out = await runRelationPanel(this.deps.complete, { photo: this.deps.photoUrl, render: inp.render, boxes, relations: rels, evidence: ev, judges: Math.max(1, this.deps.judges) });
        calls += out.calls;
        for (const r of rels) {
          const got = out.results.get(r.id);
          if (!got) continue;
          const rec = ledger.relations.get(r.id) as typeof r;
          rec.state = got.ok ? 'pass' : 'fail';
          rec.note = got.note;
          rec.round = inp.round;
          if (inp.diffs) {
            if (got.ok) inp.diffs.resolve(rec.id);
            else inp.diffs.upsert({ id: rec.id, kind: 'position', cause: 'geometry', where: rec.text.slice(0, 80), what: `layout: ${rec.text}${rec.note ? ` (${rec.note})` : ''}`, size: 3 });
          }
        }
      } catch (e) {
        if (this.deps.signal?.aborted) throw e;
      }
    }
    if (sel.full) ledger.swept = inp.round;
    // For the objects whose position or size fails: the measured offset and the correction the box suggests (the table the model reads).
    const after = this.deps.getWorld();
    const projNow = inp.pose ? projectBuilt(after, inp.pose, inp.aspect) : null;
    if (projNow) {
      this.evidence = repairEvidence(after, ledger, projNow, this.deps.px);
      this.mergeMeasured();
      this.resid = new Map();
      for (const r of ledger.list()) { const x = residualOf(r.item, projNow, this.deps.px); if (x) this.resid.set(r.item.id, x.errPx); }
    }
    this.calls += calls;
    ledger.noteRound(inp.round);
    const result: RoundResult = { judged: judged.length, full: sel.full, gain: ledger.openCount() < openBefore, reverted, worse, calls, ...this.measuredSummary() };
    yield {
      type: 'photo',
      phase: 'round',
      round: inp.round,
      text: `Objects: judged ${judged.length}${sel.full ? ' (all)' : ` (${sel.changed.length} changed plus neighbours)`}; ${ledger.passingObjects()} of ${ledger.size} objects have nothing off (${countsLine(ledger)}); ${ledger.openCount()} aspect${ledger.openCount() === 1 ? '' : 's'} open; ${this.budgetLine()}${reverted.length > 0 ? `; put back to their best: ${reverted.join(', ')}` : ''}${worse.length > 0 ? `; got worse with no piece to put back: ${worse.join(', ')}` : ''}.`,
      objects: this.views(),
    };
    return result;
  }

  /** The linked pieces of every object as documents, to tell after an edit which objects it touched. */
  snapshotLinked(world: WorldDoc): Map<string, string> {
    const out = new Map<string, string>();
    for (const r of this.ledger.list()) if (r.item.entities.length > 0) out.set(r.item.id, JSON.stringify(r.item.entities.map((e) => world.entities[e] ?? null)));
    return out;
  }

  /**
   * Closed-loop feedback inside the round: after an edit, the objects whose pieces changed are projected through the same photo
   * camera again, and the model is told at once whether each moved the right way (the residual before and after) and what is still
   * suggested. Only the changed objects are recomputed. Advisory: the judges decide at the next look.
   */
  afterEdit(before: Map<string, string>): string {
    if (!this.pose) return '';
    const world = this.deps.getWorld();
    const proj = projectBuilt(world, this.pose, this.aspect);
    const lines: string[] = [];
    for (const r of this.ledger.list()) {
      const was = before.get(r.item.id);
      if (was === undefined || r.item.entities.length === 0) continue;
      const now = JSON.stringify(r.item.entities.map((e) => world.entities[e] ?? null));
      if (now === was) continue;
      const res = residualOf(r.item, proj, this.deps.px);
      const prev = this.resid.get(r.item.id);
      if (!res) {
        lines.push(`- ${residualLine(r.item, null)}`);
        continue;
      }
      const verdict = prev === undefined ? '' : res.errPx < prev - 3 ? ` - closer (was ${prev} px, now ${res.errPx} px)` : res.errPx > prev + 3 ? ` - FURTHER (was ${prev} px, now ${res.errPx} px): undo or try the other direction` : ` - about the same (${prev} px)`;
      this.resid.set(r.item.id, res.errPx);
      const sug = res.errPx > 12 || res.sw < 0.85 || res.sw > 1.18 || res.sh < 0.85 || res.sh > 1.18 ? suggestCorrection(world, r.item, proj, this.deps.px) : '';
      lines.push(`- ${residualLine(r.item, res)}${verdict}${sug ? `. Still ${sug.replace('suggested correction (advisory, unprojected through the photo camera at the piece\'s own depth): ', 'suggested: ')}` : '. Within a few pixels of the photo box'}`);
    }
    return lines.length === 0 ? '' : `Residual after this edit (measured through the photo camera, advisory; the judges decide at the next look):\n${lines.slice(0, 8).join('\n')}`;
  }

  private async pair(box: Box, render: string): Promise<string | null> {
    if (!this.deps.compose) return null;
    const b = cropBox(padBox(box, 0.05));
    return (await this.deps.compose([{ dataUrl: this.deps.photoUrl, box: b }, { dataUrl: render, box: b }], { maxSide: 720 }).catch(() => null)) ?? null;
  }

  /** The aspects of an object as differences: failing ones open (or stay open), passing ones close. */
  private syncDifferences(rec: ObjectRec, diffs: DifferenceLedger): void {
    const open = new Set(openAspects(rec));
    for (const a of ASPECTS) {
      const id = `obj-${rec.item.id}-${a}`;
      const st = rec.aspects[a];
      if (st.state === 'fail' && rec.waived[a] === undefined && rec.waived['all'] === undefined) {
        const d = aspectDifference(a);
        const size = a === 'present' ? 5 : 5 - Math.min(3, st.score ?? 1);
        diffs.upsert({ id, kind: d.kind, cause: d.cause, where: rec.item.label, what: `${rec.item.label}: ${a} ${a === 'present' ? 'missing in the render' : 'differs'}${rec.fix ? ` - ${rec.fix}` : ''}${st.note ? ` (${st.note})` : ''}`, size });
      } else if (!open.has(a)) diffs.resolve(id);
    }
  }
}
