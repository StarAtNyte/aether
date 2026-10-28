/**
 * Chat transcript model. Agent events are converted into compact,
 * serializable "views" (patch lists become summaries, reports are trimmed)
 * so the transcript stays small in memory and in localStorage, and anything
 * loaded back from storage is re-validated field by field.
 */
import { diffLineText } from '@aether/agent/diff-text';
import type { AgentEvent, ChatMessage } from '@aether/agent';
import { AGENT_CONTEXT_TURNS, MAX_CHAT_ENTRIES, MAX_EVENTS_PER_ENTRY, MAX_EVENT_TEXT } from '../config';
import { summarizePatches, type PatchSummary } from './patchSummary';
import { clip } from './format';

/** Result of one verification test, as shown in chat and the Verify panel. */
export interface TestResultView {
  id: string;
  kind: string;
  passed: boolean;
  message: string;
}

/** Physics diagnostic, as shown in chat and the Verify panel. */
export interface DiagnosticView {
  severity: 'error' | 'warning' | 'info';
  code: string;
  entities: string[];
  message: string;
  suggestion?: string;
}

/** Serializable view of one agent event. */
export type ChatEventView =
  | { type: 'status'; text: string }
  | { type: 'plan'; text: string }
  | { type: 'patches'; message: string; summary: PatchSummary; errors: string[] }
  | { type: 'generator'; id: string; description: string; source: string; ok: boolean; error?: string }
  | { type: 'verify'; passed: boolean; summary: string; results: TestResultView[]; diagnostics: DiagnosticView[] }
  | { type: 'repair'; text: string; attempt: number }
  | { type: 'message'; text: string }
  | { type: 'edit'; summary: string; lines: EditLineView[]; notes: string[]; ms: number; local: boolean; cosmetic: boolean; head?: number }
  | { type: 'clarify'; text: string; candidates: Array<{ id: string; label: string }> }
  | { type: 'error'; text: string }
  | { type: 'done'; inputTokens: number; outputTokens: number; calls: number; cachedInputTokens?: number; ms?: number; via?: string; models?: string[] }
  | { type: 'notice'; tone: 'info' | 'warning'; text: string; /** Offline planner could not map the request: show the connect-AI action and these examples. */ offline?: { examples: string[] } }
  | { type: 'review'; round: number; phase: 'checking' | 'found' | 'fixing' | 'approved' | 'stalled' | 'limit' | 'crosscheck'; text: string; score?: number; findings?: number; differences?: DifferenceEventView[] }
  /** One step the agent took ("Placing 4 items"); `thumbs` are small pictures of what it looked at (live only, never stored). */
  | { type: 'step'; tool: string; label: string; ok: boolean; thumbs?: Array<{ label: string; src: string }> }
  | PhotoEventView
  | BriefEventView
  | { type: 'quality'; score: number; round: number; source: 'heuristic' | 'critic' | 'blend'; summary: string; criteria: QualityCriterionView[]; applied: string[] };

/** The plan a world is built from (the generation brief), as the chat shows it. Collapsible; editable before the build when asked. */
export interface BriefEventView {
  type: 'brief';
  elaboration: 'elaborate' | 'moderate' | 'minimal';
  reason: string;
  kind: string;
  summary: string;
  scale: string;
  zones: Array<{ name: string; purpose: string; size?: string }>;
  elements: Array<{ name: string; count: number; size?: string; note?: string }>;
  materials: string[];
  lighting: string;
  richness: { kinds: number; pieces: number; note?: string };
  reference: { decision: 'generated' | 'skipped' | 'unavailable' | 'failed'; reason: string; prompt?: string; provenance?: string; via?: string; model?: string };
  notes?: string;
  /** Waiting for the user to edit and confirm (live only; a stored brief is never waiting). */
  editable: boolean;
  /** The brief as the agent wrote it (what an edit starts from). */
  raw?: unknown;
}

/** Bounded, validated view of a brief (live event or stored view). */
export function briefView(v: unknown, editable: boolean): BriefEventView | null {
  if (!isRecord(v)) return null;
  const list = (x: unknown, n: number): Record<string, unknown>[] => (Array.isArray(x) ? x.filter(isRecord).slice(0, n) : []);
  const opt = (x: unknown, n: number): { v: string } | Record<string, never> => (typeof x === 'string' && x.trim() ? { v: str(x, n) } : {});
  const ref = isRecord(v['reference']) ? v['reference'] : {};
  const rich = isRecord(v['richness']) ? v['richness'] : {};
  const decision = (['generated', 'skipped', 'unavailable', 'failed'] as const).find((d) => d === ref['decision']) ?? 'skipped';
  const el = (['elaborate', 'moderate', 'minimal'] as const).find((d) => d === v['elaboration']) ?? 'moderate';
  const out: BriefEventView = {
    type: 'brief',
    elaboration: el,
    reason: str(v['reason'] ?? v['elaboration_reason'], 200),
    kind: str(v['kind'], 80),
    summary: str(v['summary'], 400),
    scale: str(v['scale'], 120),
    zones: list(v['zones'], 14).map((z) => ({ name: str(z['name'], 60), purpose: str(z['purpose'], 160), ...(opt(z['size'], 60).v ? { size: opt(z['size'], 60).v } : {}) })),
    elements: list(v['elements'], 60).map((e) => ({ name: str(e['name'], 60), count: Math.max(0, Math.min(5000, Math.round(num(e['count'])))), ...(opt(e['size'], 80).v ? { size: opt(e['size'], 80).v } : {}), ...(opt(e['note'], 160).v ? { note: opt(e['note'], 160).v } : {}) })),
    materials: Array.isArray(v['materials']) ? v['materials'].filter((m): m is string => typeof m === 'string').slice(0, 14).map((m) => str(m, 80)) : [],
    lighting: str(v['lighting'], 300),
    richness: { kinds: Math.max(0, Math.min(400, Math.round(num(rich['kinds'])))), pieces: Math.max(0, Math.min(20000, Math.round(num(rich['pieces'])))), ...(opt(rich['note'], 200).v ? { note: opt(rich['note'], 200).v } : {}) },
    reference: { decision, reason: str(ref['reason'], 300), ...(opt(ref['prompt'], 600).v ? { prompt: opt(ref['prompt'], 600).v } : {}), ...(opt(ref['provenance'], 40).v ? { provenance: opt(ref['provenance'], 40).v } : {}), ...(opt(ref['via'], 40).v ? { via: opt(ref['via'], 40).v } : {}), ...(opt(ref['model'], 64).v ? { model: opt(ref['model'], 64).v } : {}) },
    ...(opt(v['notes'], 1000).v ? { notes: opt(v['notes'], 1000).v } : {}),
    editable,
  };
  return out.elements.length > 0 ? out : null;
}

/** One difference between the reference (a photo, or the request) and the render, as the model wrote it. */
export interface DifferenceEventView {
  id: string;
  kind: string;
  where: string;
  what: string;
  /** 1..5 (5: obvious at first glance); 0 once fixed. */
  size: number;
  status: string;
  rounds: number;
  source: 'model' | 'independent' | 'object';
}

/** Bounded, validated list of differences (live or stored). */
export function toDifferences(v: unknown): DifferenceEventView[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter(isRecord).slice(0, 20).map((d): DifferenceEventView => ({ id: str(d['id'], 40), kind: str(d['kind'], 20), where: str(d['where'], 80), what: str(d['what'], 200), size: Math.max(0, Math.min(5, Math.round(num(d['size'])))), status: str(d['status'], 12), rounds: Math.max(1, Math.min(99, Math.round(num(d['rounds'])))), source: d['source'] === 'independent' ? 'independent' : d['source'] === 'object' ? 'object' : 'model' }));
  return out.length > 0 ? out : undefined;
}

/** Progress of a room rebuilt from a photograph (reading it, the assumptions as chips, each compare round, the final score). */
export interface PhotoEventView {
  type: 'photo';
  phase: 'analysing' | 'described' | 'building' | 'built' | 'textures' | 'stage' | 'comparing' | 'round' | 'done' | 'offline' | 'unavailable';
  text: string;
  round?: number;
  /** The staged checklist (capability to delivery) with each stage's status. */
  stages?: PhotoStageEventView[];
  /** The record kept with the photo room: source hash, permission note, scale, assumptions, limits, repairs. */
  provenance?: PhotoProvenanceEventView;
  /** The run can be continued at its repair stage (the state itself is held by the studio, not the chat). */
  resumable?: boolean;
  assumptions?: Array<{ id: string; text: string; confidence: number; adjust: string }>;
  score?: PhotoScoreEventView;
  palette?: string[];
  differences?: DifferenceEventView[];
  /** The per-object table of the inventory: one verdict per aspect for each object the photo shows. */
  objects?: ObjectEventView[];
}

export const ASPECT_STATES = ['pass', 'close', 'fail', 'unclear', 'na', 'unjudged'] as const;
export type AspectEventState = (typeof ASPECT_STATES)[number];
export const OBJECT_ASPECTS = ['present', 'type', 'position', 'size', 'material'] as const;
export interface ObjectEventView {
  id: string;
  label: string;
  kind: string;
  present: AspectEventState;
  type: AspectEventState;
  position: AspectEventState;
  size: AspectEventState;
  material: AspectEventState;
  note: string;
  seen: 'both' | 'primary' | 'blind' | 'measured';
  waived?: string;
  /** "stopped: ...": the loop ended with this object still off. */
  stopped?: string;
}

/** Bounded, validated per-object table (live or stored). */
export function toObjects(v: unknown): ObjectEventView[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const st = (x: unknown): AspectEventState => ASPECT_STATES.find((a) => a === x) ?? 'unjudged';
  const out = v.filter(isRecord).slice(0, 80).map((o): ObjectEventView => ({
    id: str(o['id'], 60),
    label: str(o['label'], 80),
    kind: str(o['kind'], 40),
    present: st(o['present']),
    type: st(o['type']),
    position: st(o['position']),
    size: st(o['size']),
    material: st(o['material']),
    note: str(o['note'], 160),
    seen: o['seen'] === 'blind' ? 'blind' : o['seen'] === 'primary' ? 'primary' : 'both',
    ...(typeof o['waived'] === 'string' && o['waived'] ? { waived: str(o['waived'], 160) } : {}),
    ...(typeof o['stopped'] === 'string' && o['stopped'] ? { stopped: str(o['stopped'], 200) } : {}),
  }));
  return out.length > 0 ? out : undefined;
}

export const STAGE_STATUSES = ['pending', 'active', 'passed', 'failed', 'blocked', 'skipped'] as const;
export interface PhotoStageEventView {
  id: string;
  title: string;
  status: (typeof STAGE_STATUSES)[number];
  note?: string;
}

/** Bounded view of the provenance record of a photo room. */
export interface PhotoProvenanceEventView {
  sha256: string | null;
  width: number | null;
  height: number | null;
  permission: { localProcessing: string; publication: string };
  scale: { width: number; depth: number; ceiling: number; basis: string; confidence: number };
  assumptions: Array<{ id: string; text: string; confidence: number; stage: string; kind: string }>;
  limits: string[];
  repairs: Array<{ round: number; difference: string; cause: string; why: string }>;
  open: Array<{ id: string; cause: string; size: number; what: string }>;
  rounds: number;
  models: string[];
  exports: string[];
  /** The record as the agent wrote it (what the download saves). */
  raw: unknown;
}

function toStages(v: unknown): PhotoStageEventView[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter(isRecord).slice(0, 16).map((x): PhotoStageEventView => {
    const note = str(x['note'], 300);
    return { id: str(x['id'], 24), title: str(x['title'], 80), status: STAGE_STATUSES.find((k) => k === x['status']) ?? 'pending', ...(note ? { note } : {}) };
  });
  return out.length > 0 ? out : undefined;
}

function toProvenance(v: unknown): PhotoProvenanceEventView | undefined {
  if (!isRecord(v)) return undefined;
  const src = isRecord(v['source']) ? v['source'] : {};
  const perm = isRecord(v['permission']) ? v['permission'] : {};
  const sc = isRecord(v['scale']) ? v['scale'] : {};
  const list = (x: unknown): Record<string, unknown>[] => (Array.isArray(x) ? x.filter(isRecord) : []);
  const strs = (x: unknown, n: number): string[] => (Array.isArray(x) ? x.filter((i): i is string => typeof i === 'string').slice(0, n).map((i) => str(i, 300)) : []);
  const nn = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x) : null);
  return {
    sha256: typeof src['sha256'] === 'string' && /^[0-9a-f]{64}$/.test(src['sha256']) ? src['sha256'] : null,
    width: nn(src['width']),
    height: nn(src['height']),
    permission: { localProcessing: str(perm['localProcessing'], 300), publication: str(perm['publication'], 300) },
    scale: { width: num(sc['width']), depth: num(sc['depth']), ceiling: num(sc['ceiling']), basis: str(sc['basis'], 300), confidence: Math.max(0, Math.min(1, num(sc['confidence']))) },
    assumptions: list(v['assumptions']).slice(0, 40).map((a) => ({ id: str(a['id'], 40), text: str(a['text'], 300), confidence: Math.max(0, Math.min(1, num(a['confidence']))), stage: str(a['stage'], 20), kind: str(a['kind'], 20) })),
    limits: strs(v['limits'], 8),
    repairs: list(v['repairs']).slice(0, 60).map((r) => ({ round: Math.max(0, Math.min(999, Math.round(num(r['round'])))), difference: str(r['difference'], 40), cause: str(r['cause'], 20), why: str(r['why'], 200) })),
    open: list(v['open']).slice(0, 20).map((d) => ({ id: str(d['id'], 40), cause: str(d['cause'], 20), size: Math.max(0, Math.min(5, Math.round(num(d['size'])))), what: str(d['what'], 160) })),
    rounds: Math.max(0, Math.min(999, Math.round(num(v['rounds'])))),
    models: strs(v['models'], 6).map((m) => m.slice(0, 64)),
    exports: strs(v['exports'], 8),
    raw: v,
  };
}

/** Measures behind the measured fidelity of a photo round. */
export const FIDELITY_KEYS = ['openings', 'inventory', 'placement', 'sizes', 'materials', 'clearance', 'framing', 'similarity', 'regionColour'] as const;
export type FidelityKey = (typeof FIDELITY_KEYS)[number];

/** The score of a photo round: the judges' item verdicts, their rubric score, the deterministic measures (advisory), who judged. */
export interface PhotoScoreEventView {
  passed: number;
  total: number;
  /** Measured fidelity 0..1. */
  objective?: number;
  fidelity?: Partial<Record<FidelityKey, number>>;
  /** Judge score 0..1 (median rubric score of the panel, or the single judge's pass rate). */
  judge?: number;
  /** Independent judges behind `judge`. */
  judges?: number;
  spread?: number;
  /** Who judged: independent AI judges, or the assistant that fixes the room. */
  judgedBy?: 'panel' | 'assistant';
  preference?: 'current' | 'previous' | 'tie';
  /** False: the state was not kept. */
  accepted?: boolean;
  structuralFailed: boolean;
  failing: Array<{ id: string; text: string; note: string }>;
}

const PHOTO_PHASES = ['analysing', 'described', 'building', 'built', 'textures', 'stage', 'comparing', 'round', 'done', 'offline', 'unavailable'] as const;

/** Bounded, validated view of a photo event (live or stored). */
function photoView(v: Record<string, unknown>): PhotoEventView {
  const phase = PHOTO_PHASES.find((p) => p === v['phase']) ?? 'analysing';
  const out: PhotoEventView = { type: 'photo', phase, text: str(v['text'], 900) };
  if (typeof v['round'] === 'number' && Number.isFinite(v['round'])) out.round = Math.max(0, Math.min(500, Math.round(v['round'])));
  if (Array.isArray(v['assumptions'])) {
    out.assumptions = v['assumptions']
      .filter(isRecord)
      .slice(0, 24)
      .map((a) => ({ id: str(a['id'], 40), text: str(a['text'], 260), confidence: Math.max(0, Math.min(1, num(a['confidence']))), adjust: str(a['adjust'], 200) }));
  }
  if (isRecord(v['score'])) {
    const sc = v['score'];
    const failing = Array.isArray(sc['failing']) ? sc['failing'].filter(isRecord).slice(0, 24).map((f) => ({ id: str(f['id'], 60), text: str(f['text'], 200), note: str(f['note'], 240) })) : [];
    out.score = {
      passed: Math.max(0, Math.min(500, Math.round(num(sc['passed'])))),
      total: Math.max(0, Math.min(500, Math.round(num(sc['total'])))),
      structuralFailed: sc['structuralFailed'] === true,
      failing,
      ...(unit(sc['objective']) !== undefined ? { objective: unit(sc['objective']) as number } : {}),
      ...(unit(sc['judge']) !== undefined ? { judge: unit(sc['judge']) as number } : {}),
      ...(unit(sc['spread']) !== undefined ? { spread: unit(sc['spread']) as number } : {}),
      ...(sc['judgedBy'] === 'panel' || sc['judgedBy'] === 'assistant' ? { judgedBy: sc['judgedBy'] } : {}),
      ...(typeof sc['judges'] === 'number' && Number.isFinite(sc['judges']) ? { judges: Math.max(1, Math.min(9, Math.round(sc['judges']))) } : {}),
      ...(sc['preference'] === 'current' || sc['preference'] === 'previous' || sc['preference'] === 'tie' ? { preference: sc['preference'] } : {}),
      ...(typeof sc['accepted'] === 'boolean' ? { accepted: sc['accepted'] } : {}),
    };
    if (isRecord(sc['fidelity'])) {
      const f: Partial<Record<FidelityKey, number>> = {};
      for (const k of FIDELITY_KEYS) {
        const v = unit(sc['fidelity'][k]);
        if (v !== undefined) f[k] = v;
      }
      if (Object.keys(f).length > 0) out.score.fidelity = f;
    }
  }
  const diffs = toDifferences(v['differences']);
  if (diffs) out.differences = diffs;
  const objs = toObjects(v['objects']);
  if (objs) out.objects = objs;
  const stages = toStages(v['stages']);
  if (stages) out.stages = stages;
  const prov = toProvenance(v['provenance']);
  if (prov) out.provenance = prov;
  if (isRecord(v['resume']) || v['resumable'] === true) out.resumable = true;
  if (Array.isArray(v['palette'])) out.palette = v['palette'].filter((c): c is string => typeof c === 'string' && HEX.test(c)).slice(0, 8);
  return out;
}

/** One line of a small-edit diff ("Sofa · colour: grey → dark green"). */
export interface EditLineView {
  text: string;
  kind: 'change' | 'add' | 'remove';
  fromColor?: string;
  toColor?: string;
}

/** One rubric row of a quality event. */
export interface QualityCriterionView {
  id: string;
  label: string;
  score: number;
  note: string;
}

/** Lifecycle of an assistant turn. */
export type ChatStatus = 'streaming' | 'done' | 'error' | 'aborted';

/** One chat entry (user prompt or assistant turn). */
export type ChatEntry =
  | { id: number; role: 'user'; text: string }
  | { id: number; role: 'assistant'; events: ChatEventView[]; status: ChatStatus };

const MAX_SOURCE_CHARS = 60_000;
const MAX_ERRORS = 20;
/** Most step events kept in one assistant entry. */
export const MAX_STEPS_PER_ENTRY = 80;
const MAX_RESULTS = 100;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown, max: number = MAX_EVENT_TEXT): string {
  return typeof v === 'string' ? clip(v, max) : '';
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** A finite number clamped to 0..1, or undefined. */
function unit(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : undefined;
}

const SEVERITIES = new Set(['error', 'warning', 'info']);

/** Extract test results from an untrusted verify report. */
export function toTestResults(report: unknown): TestResultView[] {
  if (!isRecord(report) || !Array.isArray(report['results'])) return [];
  const out: TestResultView[] = [];
  for (const r of report['results'].slice(0, MAX_RESULTS)) {
    if (!isRecord(r)) continue;
    out.push({ id: str(r['id'], 80), kind: str(r['kind'], 40), passed: r['passed'] === true, message: str(r['message'], 400) });
  }
  return out;
}

/** Extract diagnostics from an untrusted verify report (or a bare diagnostics array). */
export function toDiagnostics(report: unknown): DiagnosticView[] {
  const list = Array.isArray(report) ? report : isRecord(report) && Array.isArray(report['diagnostics']) ? report['diagnostics'] : [];
  const out: DiagnosticView[] = [];
  for (const d of list.slice(0, MAX_RESULTS)) {
    if (!isRecord(d)) continue;
    const severity = typeof d['severity'] === 'string' && SEVERITIES.has(d['severity']) ? (d['severity'] as DiagnosticView['severity']) : 'info';
    const entities = Array.isArray(d['entities']) ? d['entities'].filter((e): e is string => typeof e === 'string').slice(0, 20).map((e) => clip(e, 64)) : [];
    const view: DiagnosticView = { severity, code: str(d['code'], 40), entities, message: str(d['message'], 400) };
    if (typeof d['suggestion'] === 'string') view.suggestion = str(d['suggestion'], 400);
    out.push(view);
  }
  return out;
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Convert a live agent event into its stored view. `history` and `memory` are control events: callers handle them first (they map to an empty status line). */
export function toEventView(e: AgentEvent, ctx: { head?: number } = {}): ChatEventView {
  switch (e.type) {
    case 'history':
    case 'memory':
      return { type: 'status', text: '' };
    case 'edit':
      return {
        type: 'edit',
        summary: str(e.summary, 200),
        lines: e.diff.slice(0, 12).map((l): EditLineView => ({ text: str(diffLineText(l), 160), kind: l.kind, ...(l.fromColor && HEX.test(l.fromColor) ? { fromColor: l.fromColor } : {}), ...(l.toColor && HEX.test(l.toColor) ? { toColor: l.toColor } : {}) })),
        notes: e.notes.slice(0, 3).map((n) => str(n, 200)),
        ms: num(e.ms),
        local: e.local === true,
        cosmetic: e.cosmetic === true,
        ...(ctx.head !== undefined ? { head: ctx.head } : {}),
      };
    case 'clarify':
      return { type: 'clarify', text: str(e.text, 200), candidates: e.candidates.slice(0, 8).map((c) => ({ id: str(c.id, 64), label: str(c.label, 80) })) };
    case 'status':
    case 'plan':
    case 'message':
    case 'error':
      return { type: e.type, text: str(e.text) };
    case 'steer':
      return { type: 'status', text: `Picked up your queued message: ${str(e.text, 160)}` };
    case 'step':
      return { type: 'step', tool: str(e.tool, 40), label: str(e.label, 80), ok: e.ok === true };
    case 'repair':
      return { type: 'repair', text: str(e.text), attempt: num(e.attempt) };
    case 'patches':
      return {
        type: 'patches',
        message: str(e.message, 300),
        summary: summarizePatches(e.patches),
        errors: e.result.errors.slice(0, MAX_ERRORS).map((x) => clip(`#${x.index} ${x.op}: ${x.message}`, 300)),
      };
    case 'generator': {
      const v: ChatEventView = { type: 'generator', id: str(e.def.id, 64), description: str(e.def.description, 300), source: str(e.def.source, MAX_SOURCE_CHARS), ok: e.ok };
      if (e.error) v.error = str(e.error, 600);
      return v;
    }
    case 'verify':
      return { type: 'verify', passed: e.passed, summary: str(e.summary), results: toTestResults(e.report), diagnostics: toDiagnostics(e.report) };
    case 'review': {
      const v: ChatEventView = { type: 'review', round: Math.max(0, Math.min(500, Math.round(num(e.round)))), phase: e.phase, text: str(e.text, 400) };
      if (typeof e.score === 'number' && Number.isFinite(e.score)) v.score = Math.max(0, Math.min(100, Math.round(e.score)));
      if (typeof e.findings === 'number' && Number.isFinite(e.findings)) v.findings = Math.max(0, Math.min(999, Math.round(e.findings)));
      const diffs = toDifferences(e.differences);
      if (diffs && v.type === 'review') v.differences = diffs;
      return v;
    }
    case 'photo':
      return photoView(e as unknown as Record<string, unknown>);
    case 'brief': {
      const v = briefView({ ...e.view.brief, reason: e.view.brief.elaboration_reason, reference: e.view.reference, notes: e.view.notes }, e.view.editable);
      if (!v) return { type: 'status', text: '' };
      return e.view.editable ? { ...v, raw: e.view.brief } : v;
    }
    case 'done':
      return { type: 'done', inputTokens: num(e.usage.inputTokens), outputTokens: num(e.usage.outputTokens), calls: num(e.usage.calls), ...(e.usage.cachedInputTokens ? { cachedInputTokens: num(e.usage.cachedInputTokens) } : {}) };
  }
}

/** Append an event to an assistant entry, keeping only the newest {@link MAX_EVENTS_PER_ENTRY}. Consecutive status events collapse. */
export function appendEvent(events: readonly ChatEventView[], view: ChatEventView): ChatEventView[] {
  const last = events[events.length - 1];
  const base = last && last.type === 'status' && view.type === 'status' ? events.slice(0, -1) : events.slice();
  // The staged checklist of a photo room is one live card: a newer stage update replaces the older one in place.
  // The brief card is one card too: the edited plan replaces the one that was waiting for the user.
  const at = view.type === 'photo' && view.phase === 'stage' ? base.findLastIndex((e) => e.type === 'photo' && e.phase === 'stage') : view.type === 'brief' ? base.findLastIndex((e) => e.type === 'brief') : -1;
  if (at >= 0) base[at] = view;
  else base.push(view);
  // Steps are the bulk of a long run: only the newest ones are kept, so they never push real results out.
  const steps = base.reduce((n, e) => n + (e.type === 'step' ? 1 : 0), 0);
  if (steps > MAX_STEPS_PER_ENTRY) {
    let drop = steps - MAX_STEPS_PER_ENTRY;
    const kept = base.filter((e) => !(e.type === 'step' && drop-- > 0));
    return kept.length > MAX_EVENTS_PER_ENTRY ? kept.slice(kept.length - MAX_EVENTS_PER_ENTRY) : kept;
  }
  return base.length > MAX_EVENTS_PER_ENTRY ? base.slice(base.length - MAX_EVENTS_PER_ENTRY) : base;
}

/** Keep only the newest {@link MAX_CHAT_ENTRIES}. */
export function trimChat(entries: readonly ChatEntry[]): ChatEntry[] {
  return entries.length > MAX_CHAT_ENTRIES ? entries.slice(entries.length - MAX_CHAT_ENTRIES) : entries.slice();
}

/** Final assistant text of a turn (its message events, else what its edit cards say, else its plan, else its patch lines). */
export function assistantText(entry: Extract<ChatEntry, { role: 'assistant' }>): string {
  const messages = entry.events.filter((e): e is Extract<ChatEventView, { type: 'message' }> => e.type === 'message').map((e) => e.text);
  if (messages.length > 0) return messages.join('\n\n');
  const edits = entry.events.filter((e): e is Extract<ChatEventView, { type: 'edit' }> => e.type === 'edit').map((e) => [`${e.summary.replace(/[.!]$/, '')}.`, ...e.notes].join(' '));
  if (edits.length > 0) return edits.join('\n\n');
  const plan = entry.events.find((e): e is Extract<ChatEventView, { type: 'plan' }> => e.type === 'plan');
  if (plan) return plan.text;
  // A stored local edit keeps its patch line (edit cards are not kept across reloads).
  const patches = entry.events.filter((e): e is Extract<ChatEventView, { type: 'patches' }> => e.type === 'patches' && e.message.length > 0).map((e) => `${e.message.replace(/[.!]$/, '')}.`);
  return patches.join(' ');
}

const sentenceKey = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * What a reply adds to the edit card right before it: the sentences the card already shows (its summary and its
 * notes) are dropped. '' when the reply only repeats the card ("Made the sofa dark green velvet." under the card
 * that says so).
 */
export function beyondEditCard(card: { summary: string; notes: readonly string[] }, text: string): string {
  const shown = new Set([card.summary, ...card.notes].map(sentenceKey).filter((k) => k.length > 0));
  const sentences = text.match(/[^.!?]+[.!?]*/g) ?? [];
  return sentences.filter((s) => !shown.has(sentenceKey(s))).join('').trim();
}

/** Conversation context for the agent: the last N completed user/assistant pairs, text only. */
export function buildAgentHistory(entries: readonly ChatEntry[], turns: number = AGENT_CONTEXT_TURNS): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const e of entries) {
    if (e.role === 'user') out.push({ role: 'user', content: clip(e.text, 4000) });
    else if (e.status === 'done') {
      const text = assistantText(e);
      if (text && out.length > 0 && out[out.length - 1]?.role === 'user') out.push({ role: 'assistant', content: clip(text, 4000) });
    }
  }
  // Drop a trailing unanswered user turn (the agent receives the new prompt separately).
  while (out.length > 0 && out[out.length - 1]?.role === 'user') out.pop();
  // Keep complete pairs only.
  const pairs: ChatMessage[] = [];
  for (let i = 0; i + 1 < out.length; i++) {
    const u = out[i];
    const a = out[i + 1];
    if (u?.role === 'user' && a?.role === 'assistant') {
      pairs.push(u, a);
      i++;
    }
  }
  return pairs.slice(Math.max(0, pairs.length - turns * 2));
}

function reviveSummary(v: unknown): PatchSummary | null {
  if (!isRecord(v)) return null;
  const ids = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string').slice(0, 40).map((s) => clip(s, 140)) : []);
  return {
    added: ids(v['added']),
    updated: ids(v['updated']),
    removed: ids(v['removed']),
    addedCount: num(v['addedCount']),
    updatedCount: num(v['updatedCount']),
    removedCount: num(v['removedCount']),
    rules: num(v['rules']),
    generators: ids(v['generators']),
    scripts: ids(v['scripts']),
    tests: num(v['tests']),
    world: num(v['world']),
    total: num(v['total']),
  };
}

/** Re-validate one stored event view; null when malformed. */
export function reviveEvent(v: unknown): ChatEventView | null {
  if (!isRecord(v) || typeof v['type'] !== 'string') return null;
  switch (v['type']) {
    case 'status':
    case 'plan':
    case 'message':
    case 'error':
      return { type: v['type'], text: str(v['text']) };
    case 'step':
      return { type: 'step', tool: str(v['tool'], 40), label: str(v['label'], 80), ok: v['ok'] === true };
    case 'repair':
      return { type: 'repair', text: str(v['text']), attempt: num(v['attempt']) };
    case 'patches': {
      const summary = reviveSummary(v['summary']);
      if (!summary) return null;
      const errors = Array.isArray(v['errors']) ? v['errors'].filter((s): s is string => typeof s === 'string').slice(0, MAX_ERRORS).map((s) => clip(s, 300)) : [];
      return { type: 'patches', message: str(v['message'], 300), summary, errors };
    }
    case 'generator': {
      const g: ChatEventView = { type: 'generator', id: str(v['id'], 64), description: str(v['description'], 300), source: str(v['source'], MAX_SOURCE_CHARS), ok: v['ok'] === true };
      if (typeof v['error'] === 'string') g.error = str(v['error'], 600);
      return g;
    }
    case 'verify':
      return { type: 'verify', passed: v['passed'] === true, summary: str(v['summary']), results: toTestResults(v), diagnostics: toDiagnostics(v) };
    case 'done': {
      const d: ChatEventView = { type: 'done', inputTokens: num(v['inputTokens']), outputTokens: num(v['outputTokens']), calls: num(v['calls']) };
      if (typeof v['cachedInputTokens'] === 'number' && Number.isFinite(v['cachedInputTokens']) && v['cachedInputTokens'] > 0) d.cachedInputTokens = Math.min(num(v['cachedInputTokens']), d.inputTokens);
      if (typeof v['ms'] === 'number' && Number.isFinite(v['ms']) && v['ms'] >= 0) d.ms = Math.min(v['ms'], 3_600_000);
      if (typeof v['via'] === 'string') d.via = str(v['via'], 80);
      if (Array.isArray(v['models'])) {
        const models = v['models'].filter((m): m is string => typeof m === 'string').slice(0, 6).map((m) => str(m, 64));
        if (models.length > 0) d.models = models;
      }
      return d;
    }
    case 'review': {
      const phases = ['checking', 'found', 'fixing', 'approved', 'stalled', 'limit'] as const;
      const phase = phases.find((p) => p === v['phase']) ?? 'checking';
      const r: ChatEventView = { type: 'review', round: Math.max(0, Math.min(500, Math.round(num(v['round'])))), phase, text: str(v['text'], 400) };
      if (typeof v['score'] === 'number' && Number.isFinite(v['score'])) r.score = Math.max(0, Math.min(100, Math.round(v['score'])));
      if (typeof v['findings'] === 'number' && Number.isFinite(v['findings'])) r.findings = Math.max(0, Math.min(999, Math.round(v['findings'])));
      return r;
    }
    case 'photo':
      return photoView(v);
    case 'brief':
      return briefView(v, false);
    case 'notice':
    {
      const off = v['offline'];
      const examples = isRecord(off) && Array.isArray(off['examples']) ? off['examples'].filter((x): x is string => typeof x === 'string').slice(0, 6).map((x) => str(x, 120)) : null;
      return { type: 'notice', tone: v['tone'] === 'warning' ? 'warning' : 'info', text: str(v['text'], 600), ...(examples ? { offline: { examples } } : {}) };
    }
    case 'quality': {
      const criteria = Array.isArray(v['criteria'])
        ? v['criteria'].filter(isRecord).slice(0, 10).map((c) => ({ id: str(c['id'], 24), label: str(c['label'], 40), score: Math.max(0, Math.min(10, num(c['score']))), note: str(c['note'], 200) }))
        : [];
      const source = v['source'] === 'critic' || v['source'] === 'blend' ? v['source'] : 'heuristic';
      const applied = Array.isArray(v['applied']) ? v['applied'].filter((x): x is string => typeof x === 'string').slice(0, 8).map((x) => clip(x, 160)) : [];
      return { type: 'quality', score: Math.max(0, Math.min(100, Math.round(num(v['score'])))), round: Math.max(0, Math.min(10, num(v['round']))), source, summary: str(v['summary'], 300), criteria, applied };
    }
    default:
      return null;
  }
}

/** Re-validate a stored transcript. Malformed entries are dropped; interrupted turns become 'aborted'. */
export function reviveChat(value: unknown): ChatEntry[] {
  if (!Array.isArray(value)) return [];
  const out: ChatEntry[] = [];
  let nextId = 1;
  for (const raw of value.slice(-MAX_CHAT_ENTRIES)) {
    if (!isRecord(raw)) continue;
    if (raw['role'] === 'user' && typeof raw['text'] === 'string') {
      out.push({ id: nextId++, role: 'user', text: clip(raw['text'], MAX_EVENT_TEXT) });
    } else if (raw['role'] === 'assistant' && Array.isArray(raw['events'])) {
      const events: ChatEventView[] = [];
      for (const ev of raw['events'].slice(-MAX_EVENTS_PER_ENTRY)) {
        const view = reviveEvent(ev);
        if (view) events.push(view);
      }
      const s = raw['status'];
      const status: ChatStatus = s === 'done' || s === 'error' || s === 'aborted' ? s : 'aborted';
      out.push({ id: nextId++, role: 'assistant', events, status });
    }
  }
  return out;
}
