/**
 * The staged harness of a photo-to-room run (see docs/PHOTO_TO_ROOM_HARNESS.md).
 *
 * Bookkeeping only. The model looks and judges: it gives the stage verdicts (`stage_gate`), says which class of cause it is
 * repairing (`declare_repair`) and writes the assumptions; this file keeps the stage states, refuses a repair that skips the
 * order camera, geometry, materials, lighting, keeps the assumptions ledger and builds the provenance record. Deterministic
 * measures never pass or fail a gate here.
 */
import { z } from 'zod';
import type { PhotoCamera } from '@aether/arch/photo';
import type { PhotoStageView, ToolDef } from '../types';
import { CAUSES, type Cause, type Difference } from './differences';

// ---------------------------------------------------------------------------------------------------------------- stages

export const STAGES = [
  { id: 'capability', title: 'Check what this run can do' },
  { id: 'evidence', title: 'Read the photo and list what is assumed' },
  { id: 'camera', title: 'Solve the camera and framing' },
  { id: 'shell', title: 'Build the room shell' },
  { id: 'furniture', title: 'Place furniture and decor' },
  { id: 'materials', title: 'Materials and finishes' },
  { id: 'lighting', title: 'Light' },
  { id: 'repair', title: 'Compare and repair' },
  { id: 'crosscheck', title: 'Independent cross-check' },
  { id: 'delivery', title: 'Verify, record and deliver' },
] as const;
export type StageId = (typeof STAGES)[number]['id'];
export const STAGE_IDS: readonly StageId[] = STAGES.map((s) => s.id);

export type StageStatus = 'pending' | 'active' | 'passed' | 'failed' | 'blocked' | 'skipped';

/** The stages the model gives a verdict on through `stage_gate`. The rest are settled by the loop's own outcome. */
export const MODEL_GATED: readonly StageId[] = ['evidence', 'camera', 'shell', 'furniture', 'materials', 'lighting'];

export const GATE_TOOL_NAME = 'stage_gate';

export const GATE_TOOL: ToolDef = {
  name: GATE_TOOL_NAME,
  description:
    'Give your verdict on stages of the rebuild, from what you SEE in the photo and the render (measured numbers are advice, your eyes decide). {gates:[{stage, verdict:"pass"|"fail"|"blocked", evidence, blocker?}]}. Stages: evidence (what the photo shows is described, the rest is a listed assumption), camera (horizon, wall edges and big silhouettes land where the photo has them), shell (room proportion, openings), furniture (nothing large missing or invented, positions believable), materials (hue, lightness, gloss, pattern scale of the main surfaces), lighting (direction, warmth, brightness of lit against shaded). "evidence" is one sentence naming what you looked at and what you found; a pass without it is refused. "blocked" is only for something you cannot go on without; name it in blocker. Call it on the first render for all six, then again for any stage whose verdict changed.',
  inputSchema: {
    type: 'object',
    properties: {
      gates: {
        type: 'array',
        maxItems: 8,
        items: {
          type: 'object',
          properties: {
            stage: { type: 'string', enum: [...MODEL_GATED] },
            verdict: { type: 'string', enum: ['pass', 'fail', 'blocked'] },
            evidence: { type: 'string' },
            blocker: { type: 'string' },
          },
          required: ['stage', 'verdict', 'evidence'],
        },
      },
    },
    required: ['gates'],
    additionalProperties: false,
  },
};

const GateInput = z.object({
  gates: z
    .array(
      z.object({
        stage: z.enum(MODEL_GATED as unknown as [StageId, ...StageId[]]),
        verdict: z.enum(['pass', 'fail', 'blocked']),
        evidence: z.string().max(400).default(''),
        blocker: z.string().max(300).optional(),
      }),
    )
    .min(1)
    .max(8),
});

interface StageState {
  status: StageStatus;
  /** The model's evidence for the verdict, or the reason of a skip / block. */
  note: string;
  /** Verdicts given (a gate may be re-judged after a repair). */
  verdicts: number;
}

export interface StageSnapshot {
  stages: Record<StageId, StageState>;
}

export class StageMachine {
  private st: Record<StageId, StageState>;

  constructor() {
    this.st = Object.fromEntries(STAGE_IDS.map((id) => [id, { status: 'pending', note: '', verdicts: 0 }])) as Record<StageId, StageState>;
  }

  status(id: StageId): StageStatus {
    return this.st[id].status;
  }

  note(id: StageId): string {
    return this.st[id].note;
  }

  begin(id: StageId, note = ''): void {
    const s = this.st[id];
    if (s.status === 'pending' || s.status === 'failed') this.st[id] = { ...s, status: 'active', note: note || s.note };
  }

  pass(id: StageId, note: string): void {
    this.st[id] = { status: 'passed', note: note.slice(0, 300), verdicts: this.st[id].verdicts + 1 };
  }

  fail(id: StageId, note: string): void {
    this.st[id] = { status: 'failed', note: note.slice(0, 300), verdicts: this.st[id].verdicts + 1 };
  }

  block(id: StageId, note: string): void {
    this.st[id] = { status: 'blocked', note: note.slice(0, 300), verdicts: this.st[id].verdicts + 1 };
  }

  /** Back to pending (a continued run repeats the stages after the build). */
  reset(id: StageId): void {
    this.st[id] = { status: 'pending', note: '', verdicts: this.st[id].verdicts };
  }

  skip(id: StageId, reason: string): void {
    if (this.st[id].status === 'pending' || this.st[id].status === 'active') this.st[id] = { status: 'skipped', note: reason.slice(0, 300), verdicts: this.st[id].verdicts };
  }

  /** The first stage that is blocked (the run reports it and goes no further), if any. */
  blocker(): { stage: StageId; text: string } | null {
    for (const id of STAGE_IDS) if (this.st[id].status === 'blocked') return { stage: id, text: this.st[id].note };
    return null;
  }

  /**
   * Apply the model's `stage_gate` call. A pass needs evidence, a block needs a blocker, a stage the run has not reached is
   * refused. Returns the reply for the model and the stages that changed.
   */
  gate(raw: unknown): { ok: boolean; text: string; changed: StageId[] } {
    const p = GateInput.safeParse(raw);
    if (!p.success) return { ok: false, text: `stage_gate needs {"gates":[{"stage": one of ${MODEL_GATED.join(', ')}, "verdict":"pass"|"fail"|"blocked", "evidence": one sentence}]}.`, changed: [] };
    const changed: StageId[] = [];
    const lines: string[] = [];
    for (const g of p.data.gates) {
      const cur = this.st[g.stage].status;
      if (cur === 'pending' || cur === 'skipped') {
        lines.push(`${g.stage}: not judged, the run has not reached this stage${cur === 'skipped' ? ' (it was skipped)' : ''}.`);
        continue;
      }
      const ev = g.evidence.trim();
      if (g.verdict === 'pass') {
        if (ev.length < 12) {
          lines.push(`${g.stage}: a pass needs evidence (what you looked at and what you found); not recorded.`);
          continue;
        }
        this.pass(g.stage, ev);
      } else if (g.verdict === 'fail') this.fail(g.stage, ev || 'does not match the photo yet');
      else {
        const b = (g.blocker ?? ev).trim();
        if (b.length < 8) {
          lines.push(`${g.stage}: a block needs the blocker named; not recorded.`);
          continue;
        }
        this.block(g.stage, b);
      }
      changed.push(g.stage);
      lines.push(`${g.stage}: ${this.st[g.stage].status}.`);
    }
    return { ok: changed.length > 0, text: lines.join('\n') || 'Nothing recorded.', changed };
  }

  views(): PhotoStageView[] {
    return STAGES.map((s) => ({ id: s.id, title: s.title, status: this.st[s.id].status, ...(this.st[s.id].note ? { note: this.st[s.id].note } : {}) }));
  }

  /** Stages the model never passed, in words for the closing message ('' when all that were reached passed). */
  unfinishedText(): string {
    const open = STAGES.filter((s) => this.st[s.id].status === 'pending' || this.st[s.id].status === 'active' || this.st[s.id].status === 'failed').map((s) => `${s.id} (${this.st[s.id].status})`);
    return open.length === 0 ? '' : `Stages without a passing verdict: ${open.join(', ')}.`;
  }

  snapshot(): StageSnapshot {
    return { stages: Object.fromEntries(STAGE_IDS.map((id) => [id, { ...this.st[id] }])) as Record<StageId, StageState> };
  }

  static restore(s: StageSnapshot): StageMachine {
    const m = new StageMachine();
    for (const id of STAGE_IDS) if (s.stages?.[id]) m.st[id] = { ...m.st[id], ...s.stages[id] };
    return m;
  }
}

// ---------------------------------------------------------------------------------------------------------- repair order

export const REPAIR_TOOL_NAME = 'declare_repair';

export const REPAIR_TOOL: ToolDef = {
  name: REPAIR_TOOL_NAME,
  description:
    'Say what you are about to repair BEFORE you edit. {difference: an open id from your differences list, cause: "camera"|"geometry"|"materials"|"lighting" (must be the cause class that difference has in the list), why: one sentence}. Causes are repaired in this order: camera (set_photo_camera: field of view, eye height, heading, pitch, position), then geometry (design_plan, place_items, edit_items on size, position, missing or extra pieces), then materials (finishes, colours, make_texture), then lighting (tune_look, finish). While a difference of size 3 or more is open in an earlier class you cannot repair a later one. The edit tools you use afterwards must fit the cause you declared.',
  inputSchema: {
    type: 'object',
    properties: {
      difference: { type: 'string' },
      cause: { type: 'string', enum: [...CAUSES] },
      why: { type: 'string' },
    },
    required: ['difference', 'cause'],
    additionalProperties: false,
  },
};

const RepairInput = z.object({ difference: z.string().min(1).max(40), cause: z.enum(CAUSES), why: z.string().max(300).optional() });

export const CAMERA_TOOL_NAME = 'set_photo_camera';

export const CAMERA_TOOL: ToolDef = {
  name: CAMERA_TOOL_NAME,
  description:
    'Move the camera the render is taken from, when the framing differs from the photo (horizon too high or low, the room too wide or narrow in the picture, a wall that should not show). Any of: {fov (horizontal degrees, 30..110), height (eye height in metres, 0.5..2.1), heading (degrees, 0 = north, 90 = east), pitch (degrees, up positive, -40..40), x, z (metres in the room)}. The host then fits the camera to the pieces as before; send only what you want to change. Cause class: camera.',
  inputSchema: {
    type: 'object',
    properties: { fov: { type: 'number' }, height: { type: 'number' }, heading: { type: 'number' }, pitch: { type: 'number' }, x: { type: 'number' }, z: { type: 'number' } },
    additionalProperties: false,
  },
};

const CameraInput = z.object({ fov: z.number().min(30).max(110).optional(), height: z.number().min(0.5).max(2.1).optional(), heading: z.number().optional(), pitch: z.number().min(-40).max(40).optional(), x: z.number().optional(), z: z.number().optional() }).strict();

/** The camera after the model's change, or the reason it is refused. */
export function applyCameraChange(cam: PhotoCamera, raw: unknown): { ok: true; camera: PhotoCamera; text: string } | { ok: false; text: string } {
  const p = CameraInput.safeParse(raw);
  if (!p.success) return { ok: false, text: 'set_photo_camera takes any of fov (30..110), height (0.5..2.1), heading, pitch (-40..40), x, z.' };
  const keys = Object.keys(p.data) as Array<keyof typeof p.data>;
  if (keys.length === 0) return { ok: false, text: 'set_photo_camera: send at least one of fov, height, heading, pitch, x, z.' };
  const camera: PhotoCamera = { ...cam };
  const said: string[] = [];
  for (const k of keys) {
    const v = p.data[k];
    if (v === undefined) continue;
    const before = cam[k as keyof PhotoCamera];
    (camera as unknown as Record<string, number>)[k] = k === 'heading' ? ((v % 360) + 360) % 360 : v;
    said.push(`${k} ${typeof before === 'number' ? Math.round(before * 100) / 100 : '?'} to ${Math.round((camera as unknown as Record<string, number>)[k]! * 100) / 100}`);
  }
  return { ok: true, camera, text: `Camera: ${said.join(', ')}. The next render is taken from it (after the usual fit to the pieces).` };
}

/** The cause class an edit tool call works on. */
export function causeOfTool(name: string, input: unknown): Cause | null {
  switch (name) {
    case CAMERA_TOOL_NAME:
      return 'camera';
    case 'make_texture':
      return 'materials';
    case 'tune_look':
      return 'lighting';
    case 'place_items':
    case 'design_plan':
      return 'geometry';
    case 'edit_items': {
      // An edit is materials when every edit in it only changes colour / finish / material; anything else is geometry.
      const edits = (input as { edits?: unknown } | null)?.edits;
      if (!Array.isArray(edits) || edits.length === 0) return 'geometry';
      const mat = (e: unknown): boolean => {
        const o = (e ?? {}) as Record<string, unknown>;
        const op = String(o['op'] ?? o['action'] ?? '');
        if (/finish|colou?r|material|texture|paint|tint/i.test(op)) return true;
        const keys = Object.keys(o).filter((k) => !['id', 'op', 'action', 'target', 'ids', 'note'].includes(k));
        return keys.length > 0 && keys.every((k) => /finish|colou?r|material|texture|tint|gloss|rough/i.test(k));
      };
      return edits.every(mat) ? 'materials' : 'geometry';
    }
    default:
      return null;
  }
}

/** Size from which an open difference blocks repairs of a later class. */
export const BLOCKING_SIZE = 3;

/** The repair order guard of one round. */
export class RepairGuard {
  private declared: { id: string; cause: Cause } | null = null;
  /** Declarations made over the run, for the record. */
  readonly log: Array<{ round: number; difference: string; cause: Cause; why: string }> = [];
  private round = 0;

  newRound(round: number): void {
    this.round = round;
    this.declared = null;
  }

  /** Earliest class with an open difference big enough to block the later classes. */
  static earliestBlocking(open: readonly Difference[]): Cause | null {
    for (const c of CAUSES) if (open.some((d) => d.cause === c && d.size >= BLOCKING_SIZE)) return c;
    return null;
  }

  /** Open differences in repair order: class first (camera to lighting), then size. */
  static repairOrder(open: readonly Difference[]): Difference[] {
    return [...open].sort((a, b) => CAUSES.indexOf(a.cause) - CAUSES.indexOf(b.cause) || b.size - a.size);
  }

  declare(raw: unknown, open: readonly Difference[]): { ok: boolean; text: string } {
    const p = RepairInput.safeParse(raw);
    if (!p.success) return { ok: false, text: 'declare_repair needs {"difference": an open id, "cause": "camera"|"geometry"|"materials"|"lighting", "why"?}.' };
    const d = open.find((x) => x.id === p.data.difference);
    if (!d) return { ok: false, text: `declare_repair: "${p.data.difference}" is not an open difference. Open: ${open.slice(0, 10).map((x) => x.id).join(', ') || 'none'}. Report the difference first (report_differences).` };
    if (d.cause !== p.data.cause) return { ok: false, text: `declare_repair: you listed "${d.id}" as a ${d.cause} difference. Declare ${d.cause}, or report it again next round with the cause it really has.` };
    const first = RepairGuard.earliestBlocking(open);
    if (first && CAUSES.indexOf(p.data.cause) > CAUSES.indexOf(first)) {
      const next = RepairGuard.repairOrder(open).find((x) => x.cause === first && x.size >= BLOCKING_SIZE);
      return { ok: false, text: `Repair order: ${first} comes before ${p.data.cause}. "${next?.id}" (${first}, size ${next?.size}) is still open: a wrong ${first} would make the ${p.data.cause} look wrong too. Fix that one first.` };
    }
    this.declared = { id: d.id, cause: p.data.cause };
    this.log.push({ round: this.round, difference: d.id, cause: p.data.cause, why: (p.data.why ?? '').slice(0, 200) });
    return { ok: true, text: `Declared: repairing "${d.id}" as ${p.data.cause}. Use ${p.data.cause} tools now.` };
  }

  /** Refusal text if an edit tool may not run now, else null. */
  allow(tool: string, input: unknown): string | null {
    const cause = causeOfTool(tool, input);
    if (cause === null) return null;
    if (!this.declared) return `Say what you repair first: call declare_repair {difference, cause, why} (a ${cause} repair), then edit. Causes go in order camera, geometry, materials, lighting.`;
    if (cause !== this.declared.cause) return `You declared a ${this.declared.cause} repair for "${this.declared.id}" but ${tool} is a ${cause} tool. Declare the ${cause} repair first (declare_repair), or use a ${this.declared.cause} tool.`;
    return null;
  }

  get current(): { id: string; cause: Cause } | null {
    return this.declared;
  }
}

// -------------------------------------------------------------------------------------------------- assumptions ledger

export type BlockerKind = 'capability' | 'evidence' | 'contradiction';

export interface LedgerAssumption {
  id: string;
  text: string;
  /** 0..1: how sure the run is. */
  confidence: number;
  /** The stage that made it. */
  stage: StageId;
  /** A prompt that changes it; empty when none. */
  adjust: string;
  /** Hidden surfaces and single-view limits are marked so the record can list them apart. */
  kind: 'scale' | 'hidden' | 'view' | 'material' | 'other';
}

export interface Blocker {
  kind: BlockerKind;
  text: string;
  unblock: string;
  stage: StageId;
}

/**
 * What the run assumed, with confidence. It does not ask about assumptions: it records the conservative one. Only a
 * material blocker (a different room would be built without it) is put to the user.
 */
export class AssumptionsLedger {
  private items = new Map<string, LedgerAssumption>();
  private blockers: Blocker[] = [];

  add(a: Omit<LedgerAssumption, 'confidence'> & { confidence: number }): void {
    this.items.set(a.id, { ...a, confidence: Math.max(0, Math.min(1, Math.round(a.confidence * 100) / 100)), text: a.text.slice(0, 300), adjust: a.adjust.slice(0, 160) });
  }

  /** Classify the text of an assumption by what it is about. */
  static kindOf(text: string): LedgerAssumption['kind'] {
    if (/\b(metre|meter|\bm\b|scale|wide|deep|depth|height|ceiling)\b/i.test(text)) return 'scale';
    if (/\b(behind|hidden|out of (the )?(frame|view)|back of|not visible|cannot see|occlu)/i.test(text)) return 'hidden';
    if (/\b(single|one (view|photo)|angle|outside the (frame|picture))/i.test(text)) return 'view';
    if (/\b(material|finish|wood|stone|fabric|colour|color|texture|paint)/i.test(text)) return 'material';
    return 'other';
  }

  /** Raise a blocker; only a material one is allowed to reach the user. */
  block(b: Blocker): void {
    if (!this.blockers.some((x) => x.kind === b.kind && x.text === b.text)) this.blockers.push(b);
  }

  get asks(): readonly Blocker[] {
    return this.blockers;
  }

  list(): LedgerAssumption[] {
    return [...this.items.values()].sort((a, b) => a.confidence - b.confidence);
  }

  /** The least certain assumptions (the ones worth a look first). */
  weakest(n: number): LedgerAssumption[] {
    return this.list().slice(0, n);
  }

  snapshot(): { items: LedgerAssumption[]; blockers: Blocker[] } {
    return { items: [...this.items.values()], blockers: [...this.blockers] };
  }

  static restore(s: { items: LedgerAssumption[]; blockers: Blocker[] }): AssumptionsLedger {
    const l = new AssumptionsLedger();
    for (const a of s.items ?? []) l.items.set(a.id, a);
    l.blockers = [...(s.blockers ?? [])];
    return l;
  }
}

/** The words for a blocker that stops the run (what is missing, exactly, and what would unblock it). */
export function blockerText(b: Blocker): string {
  return `Stopped at the ${b.stage} stage: ${b.text} Nothing further was built or claimed. To go on: ${b.unblock}`;
}

// ------------------------------------------------------------------------------------------------------------ provenance

/** SHA-256 of a data URL's bytes (hex), or of its text when it is not base64. Null when no crypto is available. */
export async function hashDataUrl(dataUrl: string): Promise<string | null> {
  try {
    const comma = dataUrl.indexOf(',');
    const head = comma >= 0 ? dataUrl.slice(0, comma) : '';
    const body = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
    let bytes: Uint8Array;
    if (/;base64/i.test(head)) {
      const bin = atob(body);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } else bytes = new TextEncoder().encode(decodeURIComponent(body));
    const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

export interface Provenance {
  /** Format version of this record. */
  version: 1;
  source: { sha256: string | null; width: number | null; height: number | null; stored: false };
  /** What the user said about the right to use the photo; local processing and publication are kept apart. */
  permission: { localProcessing: string; publication: string };
  scale: { width: number; depth: number; ceiling: number; basis: string; confidence: number };
  assumptions: Array<Pick<LedgerAssumption, 'id' | 'text' | 'confidence' | 'stage' | 'kind'>>;
  limits: string[];
  stages: PhotoStageView[];
  repairs: Array<{ round: number; difference: string; cause: string; why: string }>;
  open: Array<{ id: string; cause: string; size: number; what: string }>;
  rounds: number;
  models: string[];
  exports: string[];
}

export function buildProvenance(input: {
  hash: string | null;
  size: { width: number; height: number } | null;
  permission?: string;
  footprint: { width: number; depth: number; ceiling: number };
  scaleBasis: string;
  assumptions: readonly LedgerAssumption[];
  stages: readonly PhotoStageView[];
  repairs: RepairGuard['log'];
  open: readonly Difference[];
  rounds: number;
  models: readonly string[];
  exports?: readonly string[];
}): Provenance {
  const scale = input.assumptions.find((a) => a.kind === 'scale');
  return {
    version: 1,
    source: { sha256: input.hash, width: input.size?.width ?? null, height: input.size?.height ?? null, stored: false },
    permission: {
      localProcessing: input.permission?.trim().slice(0, 300) || 'The user supplied this photo to be rebuilt as a room in this project; no further statement was given.',
      publication: 'Not stated. Check you may publish a room made from this photo before you share it.',
    },
    scale: { width: input.footprint.width, depth: input.footprint.depth, ceiling: input.footprint.ceiling, basis: input.scaleBasis, confidence: scale?.confidence ?? 0.4 },
    assumptions: input.assumptions.map(({ id, text, confidence, stage, kind }) => ({ id, text, confidence, stage, kind })),
    limits: [
      'One photograph shows one view: hidden surfaces (behind furniture, behind the camera, out of frame) are authored, not measured.',
      'Metric scale is estimated from cues in the picture, not measured.',
      'The judges are language models looking at images; their verdicts vary between runs. The deterministic measures are advice, not a score.',
    ],
    stages: [...input.stages],
    repairs: input.repairs.map((r) => ({ ...r })),
    open: input.open.slice(0, 20).map((d) => ({ id: d.id, cause: d.cause, size: d.size, what: d.what.slice(0, 160) })),
    rounds: input.rounds,
    models: [...input.models],
    exports: [...(input.exports ?? [])],
  };
}
