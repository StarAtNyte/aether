/**
 * The editing session kept next to a project: the recent undo history and the last verdicts (the bot's proof and
 * the physics checks), so Undo and "Verified playable" survive a reload.
 *
 * Bounded: the history keeps a window of the active branch around the head ({@link HISTORY_BACK} undo steps,
 * {@link HISTORY_AHEAD} redo steps), and the whole session stays under {@link MAX_SESSION_CHARS}; when it does not
 * fit, older undo steps go first, then the history altogether. Read back, everything is untrusted: zod for the
 * structure, `History.fromJSON` (which re-validates the snapshot and replays every patch) for the history,
 * `parseProof` for the proof. A history whose head is not the saved world, or a verdict made for other content, is
 * dropped.
 */
import { z } from 'zod';
import { deepEqual, History, isPlainObject, type WorldDoc } from '@aether/core';
import { hashWorld, parseProof, type Proof } from '@aether/playtest/proof';
import type { DiagnosticView, TestResultView } from '../lib/chat';

/** Undo steps kept (before the head). */
export const HISTORY_BACK = 40;
/** Redo steps kept (after the head). */
export const HISTORY_AHEAD = 10;
/** Largest serialized session (characters). */
export const MAX_SESSION_CHARS = 1_500_000;
const MAX_RESULTS = 200;
const MAX_DIAGNOSTICS = 60;
const MAX_REPAIRS = 6;

const TestResultWire = z.object({ id: z.string().max(80), kind: z.string().max(40), passed: z.boolean(), message: z.string().max(400) });
const DiagnosticWire = z.object({
  severity: z.enum(['error', 'warning', 'info']),
  code: z.string().max(80),
  entities: z.array(z.string().max(80)).max(8),
  message: z.string().max(400),
  suggestion: z.string().max(400).optional(),
});

/** Saved physics-check verdict. */
const VerifyWire = z.object({
  /** {@link contentKey} of the world the checks ran on. */
  key: z.string().regex(/^[0-9a-f]{16}$/),
  status: z.enum(['passed', 'failed', 'error']),
  summary: z.string().max(400),
  results: z.array(TestResultWire).max(MAX_RESULTS),
  diagnostics: z.array(DiagnosticWire).max(MAX_DIAGNOSTICS),
  ms: z.number().finite().min(0).max(10_000_000),
});

/** Saved playtest verdict: the bot's compact proof (validated with `parseProof`) and its sentences. */
const PlaytestWire = z.object({
  proof: z.unknown(),
  sentence: z.string().max(400),
  repairs: z.array(z.string().max(200)).max(MAX_REPAIRS),
});

const SessionWire = z.object({
  v: z.literal(1),
  history: z.unknown().optional(),
  playtest: PlaytestWire.optional(),
  verify: VerifyWire.optional(),
});

/** The stored form. */
export type ProjectSession = z.infer<typeof SessionWire>;

/** A saved physics-check verdict, ready for the store. */
export interface RestoredVerify {
  status: 'passed' | 'failed' | 'error';
  summary: string;
  results: TestResultView[];
  diagnostics: DiagnosticView[];
  ms: number;
}

/** A saved playtest verdict, ready for the store. */
export interface RestoredPlaytest {
  proof: Proof;
  sentence: string;
  repairs: string[];
}

/** What a session gives back on open. */
export interface RestoredSession {
  history: History | null;
  playtest: RestoredPlaytest | null;
  verify: RestoredVerify | null;
}

/** What {@link encodeSession} saves. */
export interface SessionInput {
  history: History;
  /** The bot's proof while it describes the head world (null otherwise). */
  playtest: RestoredPlaytest | null;
  /** The physics checks' verdict while it describes the head world (null otherwise). */
  verify: RestoredVerify | null;
}

/** Exact content key of a world (FNV-1a 64 over its JSON, 16 hex characters). */
export function contentKey(world: WorldDoc): string {
  const text = JSON.stringify(world);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

/** The session to store next to `world` (the history head), within {@link MAX_SESSION_CHARS}; null when nothing fits. */
export function encodeSession(input: SessionInput, maxChars: number = MAX_SESSION_CHARS): ProjectSession | null {
  const world = input.history.current;
  const base: ProjectSession = { v: 1 };
  if (input.playtest && input.playtest.proof.worldHash === hashWorld(world)) {
    base.playtest = { proof: input.playtest.proof, sentence: input.playtest.sentence.slice(0, 400), repairs: input.playtest.repairs.slice(0, MAX_REPAIRS).map((r) => r.slice(0, 200)) };
  }
  if (input.verify) {
    const v = input.verify;
    base.verify = {
      key: contentKey(world),
      status: v.status,
      summary: v.summary.slice(0, 400),
      results: v.results.slice(0, MAX_RESULTS).map((r) => ({ id: r.id.slice(0, 80), kind: r.kind.slice(0, 40), passed: r.passed, message: r.message.slice(0, 400) })),
      diagnostics: v.diagnostics.slice(0, MAX_DIAGNOSTICS).map((d) => ({ severity: d.severity, code: d.code.slice(0, 80), entities: d.entities.slice(0, 8).map((e) => e.slice(0, 80)), message: d.message.slice(0, 400), ...(d.suggestion ? { suggestion: d.suggestion.slice(0, 400) } : {}) })),
      ms: Math.max(0, Math.min(10_000_000, Math.round(v.ms))),
    };
  }
  const size = (s: ProjectSession): number => JSON.stringify(s).length;
  let used = size(base);
  if (used > maxChars) {
    // The verdicts alone are small; a proof with a long trace is the only thing that can get here.
    delete base.playtest;
    used = size(base);
    if (used > maxChars) return null;
  }
  // Fewer undo steps until the history fits (its root snapshot is a full world, so a huge world may not fit at all).
  if (!input.history.canUndo() && !input.history.canRedo()) return base;
  for (let back = HISTORY_BACK; back >= 1; back = back > 2 ? Math.floor(back / 2) : back - 1) {
    const history = input.history.toCompactJSON(back, Math.min(HISTORY_AHEAD, back));
    const withHistory: ProjectSession = { ...base, history };
    if (size(withHistory) <= maxChars) return withHistory;
  }
  return base;
}

/**
 * The stored session of `world` after the project is renamed to `name`: the same undo steps and verdicts for the
 * renamed world. The name is not part of what the steps undo (every snapshot and title change in the kept history
 * takes the new name), and a verdict stays because the name changes nothing that was checked. Null when nothing
 * is worth keeping; anything invalid is dropped as in {@link decodeSession}.
 */
export function renameSession(raw: unknown, world: WorldDoc, name: string): ProjectSession | null {
  const restored = decodeSession(raw, world);
  const renamed: WorldDoc = { ...world, name };
  let history = new History(renamed);
  if (restored.history) {
    const json = restored.history.toCompactJSON(HISTORY_BACK, HISTORY_AHEAD);
    const parsed = CompactHistory.safeParse(json);
    if (parsed.success) {
      const entries = parsed.data.entries.map((e) => ({
        ...e,
        ...(isPlainObject(e['world']) ? { world: { ...e['world'], name } } : {}),
        patches: e.patches.map((p) => (isPlainObject(p) && p['op'] === 'setMeta' && typeof p['name'] === 'string' ? { ...p, name } : p)),
      }));
      try {
        const h = History.fromJSON({ ...parsed.data, entries });
        if (deepEqual(h.current, renamed)) history = h;
      } catch {
        /* the steps do not replay on the renamed world: the project keeps its verdicts only */
      }
    }
  }
  if (!restored.history && !restored.playtest && !restored.verify) return null;
  return encodeSession({ history, playtest: restored.playtest, verify: restored.verify });
}

/** The parts of a compact history JSON that {@link renameSession} rewrites (the rest is passed through). */
const CompactHistory = z.looseObject({ entries: z.array(z.looseObject({ patches: z.array(z.unknown()) })) });

/** Read a stored session back for `world` (the saved world). Never throws; anything invalid or stale is dropped. */
export function decodeSession(raw: unknown, world: WorldDoc): RestoredSession {
  const out: RestoredSession = { history: null, playtest: null, verify: null };
  const parsed = SessionWire.safeParse(raw);
  if (!parsed.success) return out;
  const s = parsed.data;
  if (s.history !== undefined) {
    try {
      const h = History.fromJSON(s.history);
      if (deepEqual(h.current, world)) out.history = h;
    } catch {
      /* a damaged history: the project opens with a fresh one */
    }
  }
  if (s.playtest) {
    const proof = parseProof(s.playtest.proof);
    if (proof && proof.worldHash === hashWorld(world)) out.playtest = { proof, sentence: s.playtest.sentence, repairs: s.playtest.repairs };
  }
  if (s.verify && s.verify.key === contentKey(world)) {
    const v = s.verify;
    out.verify = {
      status: v.status,
      summary: v.summary,
      results: v.results,
      diagnostics: v.diagnostics.map((d) => ({ severity: d.severity, code: d.code, entities: d.entities, message: d.message, ...(d.suggestion !== undefined ? { suggestion: d.suggestion } : {}) })),
      ms: v.ms,
    };
  }
  return out;
}
