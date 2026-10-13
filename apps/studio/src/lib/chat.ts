/**
 * Chat transcript model. Agent events are converted into compact,
 * serializable "views" (patch lists become summaries, reports are trimmed)
 * so the transcript stays small in memory and in localStorage, and anything
 * loaded back from storage is re-validated field by field.
 */
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
  | { type: 'error'; text: string }
  | { type: 'done'; inputTokens: number; outputTokens: number; calls: number; ms?: number; via?: string }
  | { type: 'notice'; tone: 'info' | 'warning'; text: string }
  | { type: 'quality'; score: number; round: number; source: 'heuristic' | 'critic' | 'blend'; summary: string; criteria: QualityCriterionView[]; applied: string[] };

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

/** Convert a live agent event into its stored view. */
export function toEventView(e: AgentEvent): ChatEventView {
  switch (e.type) {
    case 'status':
    case 'plan':
    case 'message':
    case 'error':
      return { type: e.type, text: str(e.text) };
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
    case 'done':
      return { type: 'done', inputTokens: num(e.usage.inputTokens), outputTokens: num(e.usage.outputTokens), calls: num(e.usage.calls) };
  }
}

/** Append an event to an assistant entry, keeping only the newest {@link MAX_EVENTS_PER_ENTRY}. Consecutive status events collapse. */
export function appendEvent(events: readonly ChatEventView[], view: ChatEventView): ChatEventView[] {
  const last = events[events.length - 1];
  const base = last && last.type === 'status' && view.type === 'status' ? events.slice(0, -1) : events.slice();
  base.push(view);
  return base.length > MAX_EVENTS_PER_ENTRY ? base.slice(base.length - MAX_EVENTS_PER_ENTRY) : base;
}

/** Keep only the newest {@link MAX_CHAT_ENTRIES}. */
export function trimChat(entries: readonly ChatEntry[]): ChatEntry[] {
  return entries.length > MAX_CHAT_ENTRIES ? entries.slice(entries.length - MAX_CHAT_ENTRIES) : entries.slice();
}

/** Final assistant text of a turn (its message events, else its plan). */
export function assistantText(entry: Extract<ChatEntry, { role: 'assistant' }>): string {
  const messages = entry.events.filter((e): e is Extract<ChatEventView, { type: 'message' }> => e.type === 'message').map((e) => e.text);
  if (messages.length > 0) return messages.join('\n\n');
  const plan = entry.events.find((e): e is Extract<ChatEventView, { type: 'plan' }> => e.type === 'plan');
  return plan ? plan.text : '';
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
      if (typeof v['ms'] === 'number' && Number.isFinite(v['ms']) && v['ms'] >= 0) d.ms = Math.min(v['ms'], 3_600_000);
      if (typeof v['via'] === 'string') d.via = str(v['via'], 80);
      return d;
    }
    case 'notice':
      return { type: 'notice', tone: v['tone'] === 'warning' ? 'warning' : 'info', text: str(v['text'], 600) };
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
