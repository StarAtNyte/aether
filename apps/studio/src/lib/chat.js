/**
 * Chat transcript model. Agent events are converted into compact,
 * serializable "views" (patch lists become summaries, reports are trimmed)
 * so the transcript stays small in memory and in localStorage, and anything
 * loaded back from storage is re-validated field by field.
 */
import { diffLineText } from '@aether/agent';
import { AGENT_CONTEXT_TURNS, MAX_CHAT_ENTRIES, MAX_EVENTS_PER_ENTRY, MAX_EVENT_TEXT } from '../config';
import { summarizePatches } from './patchSummary';
import { clip } from './format';
const PHOTO_PHASES = ['analysing', 'described', 'building', 'built', 'comparing', 'round', 'done', 'offline', 'unavailable'];
/** Bounded, validated view of a photo event (live or stored). */
function photoView(v) {
    const phase = PHOTO_PHASES.find((p) => p === v['phase']) ?? 'analysing';
    const out = { type: 'photo', phase, text: str(v['text'], 900) };
    if (typeof v['round'] === 'number' && Number.isFinite(v['round']))
        out.round = Math.max(0, Math.min(50, Math.round(v['round'])));
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
            ...(typeof sc['objective'] === 'number' && Number.isFinite(sc['objective']) ? { objective: Math.max(0, Math.min(1, sc['objective'])) } : {}),
        };
    }
    if (Array.isArray(v['palette']))
        out.palette = v['palette'].filter((c) => typeof c === 'string' && HEX.test(c)).slice(0, 8);
    return out;
}
const MAX_SOURCE_CHARS = 60_000;
const MAX_ERRORS = 20;
const MAX_RESULTS = 100;
function isRecord(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function str(v, max = MAX_EVENT_TEXT) {
    return typeof v === 'string' ? clip(v, max) : '';
}
function num(v) {
    return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
const SEVERITIES = new Set(['error', 'warning', 'info']);
/** Extract test results from an untrusted verify report. */
export function toTestResults(report) {
    if (!isRecord(report) || !Array.isArray(report['results']))
        return [];
    const out = [];
    for (const r of report['results'].slice(0, MAX_RESULTS)) {
        if (!isRecord(r))
            continue;
        out.push({ id: str(r['id'], 80), kind: str(r['kind'], 40), passed: r['passed'] === true, message: str(r['message'], 400) });
    }
    return out;
}
/** Extract diagnostics from an untrusted verify report (or a bare diagnostics array). */
export function toDiagnostics(report) {
    const list = Array.isArray(report) ? report : isRecord(report) && Array.isArray(report['diagnostics']) ? report['diagnostics'] : [];
    const out = [];
    for (const d of list.slice(0, MAX_RESULTS)) {
        if (!isRecord(d))
            continue;
        const severity = typeof d['severity'] === 'string' && SEVERITIES.has(d['severity']) ? d['severity'] : 'info';
        const entities = Array.isArray(d['entities']) ? d['entities'].filter((e) => typeof e === 'string').slice(0, 20).map((e) => clip(e, 64)) : [];
        const view = { severity, code: str(d['code'], 40), entities, message: str(d['message'], 400) };
        if (typeof d['suggestion'] === 'string')
            view.suggestion = str(d['suggestion'], 400);
        out.push(view);
    }
    return out;
}
const HEX = /^#[0-9a-f]{6}$/i;
/** Convert a live agent event into its stored view. `history` and `memory` are control events: callers handle them first (they map to an empty status line). */
export function toEventView(e, ctx = {}) {
    switch (e.type) {
        case 'history':
        case 'memory':
            return { type: 'status', text: '' };
        case 'edit':
            return {
                type: 'edit',
                summary: str(e.summary, 200),
                lines: e.diff.slice(0, 12).map((l) => ({ text: str(diffLineText(l), 160), kind: l.kind, ...(l.fromColor && HEX.test(l.fromColor) ? { fromColor: l.fromColor } : {}), ...(l.toColor && HEX.test(l.toColor) ? { toColor: l.toColor } : {}) })),
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
            const v = { type: 'generator', id: str(e.def.id, 64), description: str(e.def.description, 300), source: str(e.def.source, MAX_SOURCE_CHARS), ok: e.ok };
            if (e.error)
                v.error = str(e.error, 600);
            return v;
        }
        case 'verify':
            return { type: 'verify', passed: e.passed, summary: str(e.summary), results: toTestResults(e.report), diagnostics: toDiagnostics(e.report) };
        case 'review': {
            const v = { type: 'review', round: Math.max(0, Math.min(500, Math.round(num(e.round)))), phase: e.phase, text: str(e.text, 400) };
            if (typeof e.score === 'number' && Number.isFinite(e.score))
                v.score = Math.max(0, Math.min(100, Math.round(e.score)));
            if (typeof e.findings === 'number' && Number.isFinite(e.findings))
                v.findings = Math.max(0, Math.min(999, Math.round(e.findings)));
            return v;
        }
        case 'photo':
            return photoView(e);
        case 'done':
            return { type: 'done', inputTokens: num(e.usage.inputTokens), outputTokens: num(e.usage.outputTokens), calls: num(e.usage.calls) };
    }
}
/** Append an event to an assistant entry, keeping only the newest {@link MAX_EVENTS_PER_ENTRY}. Consecutive status events collapse. */
export function appendEvent(events, view) {
    const last = events[events.length - 1];
    const base = last && last.type === 'status' && view.type === 'status' ? events.slice(0, -1) : events.slice();
    base.push(view);
    return base.length > MAX_EVENTS_PER_ENTRY ? base.slice(base.length - MAX_EVENTS_PER_ENTRY) : base;
}
/** Keep only the newest {@link MAX_CHAT_ENTRIES}. */
export function trimChat(entries) {
    return entries.length > MAX_CHAT_ENTRIES ? entries.slice(entries.length - MAX_CHAT_ENTRIES) : entries.slice();
}
/** Final assistant text of a turn (its message events, else its plan). */
export function assistantText(entry) {
    const messages = entry.events.filter((e) => e.type === 'message').map((e) => e.text);
    if (messages.length > 0)
        return messages.join('\n\n');
    const plan = entry.events.find((e) => e.type === 'plan');
    return plan ? plan.text : '';
}
/** Conversation context for the agent: the last N completed user/assistant pairs, text only. */
export function buildAgentHistory(entries, turns = AGENT_CONTEXT_TURNS) {
    const out = [];
    for (const e of entries) {
        if (e.role === 'user')
            out.push({ role: 'user', content: clip(e.text, 4000) });
        else if (e.status === 'done') {
            const text = assistantText(e);
            if (text && out.length > 0 && out[out.length - 1]?.role === 'user')
                out.push({ role: 'assistant', content: clip(text, 4000) });
        }
    }
    // Drop a trailing unanswered user turn (the agent receives the new prompt separately).
    while (out.length > 0 && out[out.length - 1]?.role === 'user')
        out.pop();
    // Keep complete pairs only.
    const pairs = [];
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
function reviveSummary(v) {
    if (!isRecord(v))
        return null;
    const ids = (x) => (Array.isArray(x) ? x.filter((s) => typeof s === 'string').slice(0, 40).map((s) => clip(s, 140)) : []);
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
export function reviveEvent(v) {
    if (!isRecord(v) || typeof v['type'] !== 'string')
        return null;
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
            if (!summary)
                return null;
            const errors = Array.isArray(v['errors']) ? v['errors'].filter((s) => typeof s === 'string').slice(0, MAX_ERRORS).map((s) => clip(s, 300)) : [];
            return { type: 'patches', message: str(v['message'], 300), summary, errors };
        }
        case 'generator': {
            const g = { type: 'generator', id: str(v['id'], 64), description: str(v['description'], 300), source: str(v['source'], MAX_SOURCE_CHARS), ok: v['ok'] === true };
            if (typeof v['error'] === 'string')
                g.error = str(v['error'], 600);
            return g;
        }
        case 'verify':
            return { type: 'verify', passed: v['passed'] === true, summary: str(v['summary']), results: toTestResults(v), diagnostics: toDiagnostics(v) };
        case 'done': {
            const d = { type: 'done', inputTokens: num(v['inputTokens']), outputTokens: num(v['outputTokens']), calls: num(v['calls']) };
            if (typeof v['ms'] === 'number' && Number.isFinite(v['ms']) && v['ms'] >= 0)
                d.ms = Math.min(v['ms'], 3_600_000);
            if (typeof v['via'] === 'string')
                d.via = str(v['via'], 80);
            if (Array.isArray(v['models'])) {
                const models = v['models'].filter((m) => typeof m === 'string').slice(0, 6).map((m) => str(m, 64));
                if (models.length > 0)
                    d.models = models;
            }
            return d;
        }
        case 'review': {
            const phases = ['checking', 'found', 'fixing', 'approved', 'stalled', 'limit'];
            const phase = phases.find((p) => p === v['phase']) ?? 'checking';
            const r = { type: 'review', round: Math.max(0, Math.min(500, Math.round(num(v['round'])))), phase, text: str(v['text'], 400) };
            if (typeof v['score'] === 'number' && Number.isFinite(v['score']))
                r.score = Math.max(0, Math.min(100, Math.round(v['score'])));
            if (typeof v['findings'] === 'number' && Number.isFinite(v['findings']))
                r.findings = Math.max(0, Math.min(999, Math.round(v['findings'])));
            return r;
        }
        case 'photo':
            return photoView(v);
        case 'notice':
            {
                const off = v['offline'];
                const examples = isRecord(off) && Array.isArray(off['examples']) ? off['examples'].filter((x) => typeof x === 'string').slice(0, 6).map((x) => str(x, 120)) : null;
                return { type: 'notice', tone: v['tone'] === 'warning' ? 'warning' : 'info', text: str(v['text'], 600), ...(examples ? { offline: { examples } } : {}) };
            }
        case 'quality': {
            const criteria = Array.isArray(v['criteria'])
                ? v['criteria'].filter(isRecord).slice(0, 10).map((c) => ({ id: str(c['id'], 24), label: str(c['label'], 40), score: Math.max(0, Math.min(10, num(c['score']))), note: str(c['note'], 200) }))
                : [];
            const source = v['source'] === 'critic' || v['source'] === 'blend' ? v['source'] : 'heuristic';
            const applied = Array.isArray(v['applied']) ? v['applied'].filter((x) => typeof x === 'string').slice(0, 8).map((x) => clip(x, 160)) : [];
            return { type: 'quality', score: Math.max(0, Math.min(100, Math.round(num(v['score'])))), round: Math.max(0, Math.min(10, num(v['round']))), source, summary: str(v['summary'], 300), criteria, applied };
        }
        default:
            return null;
    }
}
/** Re-validate a stored transcript. Malformed entries are dropped; interrupted turns become 'aborted'. */
export function reviveChat(value) {
    if (!Array.isArray(value))
        return [];
    const out = [];
    let nextId = 1;
    for (const raw of value.slice(-MAX_CHAT_ENTRIES)) {
        if (!isRecord(raw))
            continue;
        if (raw['role'] === 'user' && typeof raw['text'] === 'string') {
            out.push({ id: nextId++, role: 'user', text: clip(raw['text'], MAX_EVENT_TEXT) });
        }
        else if (raw['role'] === 'assistant' && Array.isArray(raw['events'])) {
            const events = [];
            for (const ev of raw['events'].slice(-MAX_EVENTS_PER_ENTRY)) {
                const view = reviveEvent(ev);
                if (view)
                    events.push(view);
            }
            const s = raw['status'];
            const status = s === 'done' || s === 'error' || s === 'aborted' ? s : 'aborted';
            out.push({ id: nextId++, role: 'assistant', events, status });
        }
    }
    return out;
}
