/**
 * Public data types of the autonomous playtest agent. Everything here is
 * plain JSON-able data (plus one typed array for the replay trace) so a
 * report can cross a worker boundary, be stored in a share link and be
 * validated again on the other side (see `proof.ts`).
 */
import type { EntityId, Vec3 } from '@aether/core';

/** What the bot is asked to prove. */
export type PlaytestKind = 'game' | 'walkthrough';

/**
 * Overall verdict of a run:
 * - `passed`: a real run reached the win condition (game) or every room (walkthrough);
 * - `failed`: the run found a defect that stops the world working;
 * - `inconclusive`: nothing playable to prove (no goal), or the budget ran out;
 * - `unsupported`: a kind of world the bot cannot drive (orbit/vehicle player, block worlds).
 */
export type PlaytestStatus = 'passed' | 'failed' | 'inconclusive' | 'unsupported';

/** What an objective is. */
export type ObjectiveKind = 'collect' | 'goal' | 'zone' | 'room' | 'plate' | 'talk';

/** Final state of an objective after a run. */
export type ObjectiveStatus = 'done' | 'unreachable' | 'blocked' | 'untouched' | 'pending';

/** One thing the bot has to do or reach. */
export interface Objective {
  id: string;
  kind: ObjectiveKind;
  /** Short human label, e.g. "coin-3", "the exit portal". */
  label: string;
  /** Entity the objective is attached to, if any. */
  entity?: EntityId;
  /** World position the bot heads for (the centre of the trigger volume). */
  position: Vec3;
  /** Must be done for the world to count as completed. */
  required: boolean;
  /** State key a collectible raises (for key-and-door reasoning). */
  key?: string;
}

/** Outcome of one objective in a report. */
export interface ObjectiveResult {
  id: string;
  kind: ObjectiveKind;
  label: string;
  entity?: EntityId;
  position: Vec3;
  required: boolean;
  status: ObjectiveStatus;
  /** Simulated second it was completed at. */
  at?: number;
  /** Why it could not be done (plain words). */
  reason?: string;
}

/** Defect classes the bot can report. */
export type FindingCode =
  | 'unreachable_objective'
  | 'door_locked'
  | 'door_stuck'
  | 'unwinnable'
  | 'lost'
  | 'spawn_blocked'
  | 'stuck'
  | 'soft_lock'
  | 'fell'
  | 'no_win_condition'
  | 'budget'
  | 'unsupported'
  | 'room_unreachable'
  | 'door_blocked'
  | 'clipping'
  | 'no_entrance'
  | 'talk_failed';

/** One defect or note. */
export interface Finding {
  code: FindingCode;
  /** `error` blocks the verdict, `warning` is a caution, `info` is a note. */
  severity: 'error' | 'warning' | 'info';
  /** One plain sentence for the user, e.g. "the key at 12,3 is unreachable". */
  message: string;
  /** Entities involved. */
  entities: EntityId[];
  /** Where in the world it happens. */
  position?: Vec3;
  /** Concrete fix for the agent / repair loop. */
  hint: string;
  /** Extra data the repair loop needs (nearest reachable point, gap size …). */
  data?: Record<string, number | string | boolean | number[]>;
}

/** An event on the replay timeline (pickup, door, win …). */
export interface TraceEvent {
  /** Simulated seconds. */
  t: number;
  kind: 'pickup' | 'door' | 'goal' | 'fall' | 'stuck' | 'room' | 'win' | 'lose' | 'start';
  label: string;
  position: Vec3;
}

/**
 * The ghost's recorded run. `poses` is frame-major with {@link TRACE_STRIDE}
 * floats per frame: x, y, z (feet), yaw (degrees, 0 faces −Z).
 */
export interface PlaytestTrace {
  /** Seconds between frames. */
  dt: number;
  frames: number;
  poses: Float32Array;
  events: TraceEvent[];
}

/** Floats per trace frame. */
export const TRACE_STRIDE = 4;

/** The report of one playtest. */
export interface PlaytestReport {
  /** Report format version. */
  v: 1;
  kind: PlaytestKind;
  status: PlaytestStatus;
  /** The run reached the game's win (game) or every room (walkthrough). */
  won: boolean;
  outcome: 'win' | 'lose' | null;
  /** Simulated seconds until the win (or until the run ended). */
  seconds: number;
  /** Fixed physics steps simulated. */
  steps: number;
  /** Wall-clock milliseconds the run took. */
  wallMs: number;
  objectives: ObjectiveResult[];
  findings: Finding[];
  /** Times the bot fell off the course. */
  falls: number;
  /** Places the bot got stuck. */
  stuckPoints: Vec3[];
  /** Down-sampled path walked (for a minimap / quick view). */
  path: Vec3[];
  /** Full replay trace (absent when recording was off). */
  trace?: PlaytestTrace;
  /** One plain sentence for the user. */
  summary: string;
  /** Hash of the gameplay-relevant world content the run proved (see `proof.ts`). */
  worldHash: string;
  /** Message text the game showed at the end, if any. */
  endText?: string;
  /** Cost figures of the run (informational). */
  stats?: { searches: number; expanded: number; navNodes: number; navCell: number; navMs: number; planMs: number };
}

/** Progress notification during a run. */
export interface PlaytestProgress {
  phase: 'prepare' | 'navigate' | 'play' | 'analyse' | 'done';
  /** 0..1 overall estimate. */
  fraction: number;
  /** Simulated seconds so far. */
  seconds: number;
  /** Short status line, e.g. "walking to coin-4 (3/8)". */
  note: string;
  /** Position of the bot (for a live minimap). */
  position?: Vec3;
}

/** Options of {@link playtest}. */
export interface PlaytestOptions {
  /** Longest simulated play time in seconds (default 240, max 900). */
  maxSimSeconds?: number;
  /** Wall-clock budget in milliseconds (default 20 000, max 120 000). */
  budgetMs?: number;
  /** Record the replay trace (default true). */
  trace?: boolean;
  /** Trace sample rate (default 12 Hz). */
  traceHz?: number;
  /** Progress callback (called at most ~10 times a second). */
  onProgress?: (p: PlaytestProgress) => void;
  /** Abort the run: rejects with an `AbortError`. */
  signal?: AbortSignal;
  /** Sandboxed script runner for worlds with scripts (caller owned). */
  scripts?: () => import('@aether/logic').ScriptRunner | undefined;
}

/** Caps of the playtest agent. */
export const PLAYTEST_LIMITS = Object.freeze({
  DEFAULT_MAX_SIM_SECONDS: 240,
  MAX_SIM_SECONDS: 900,
  DEFAULT_BUDGET_MS: 20_000,
  MAX_BUDGET_MS: 120_000,
  MAX_OBJECTIVES: 200,
  MAX_FINDINGS: 24,
  MAX_PATH_POINTS: 240,
  MAX_TRACE_FRAMES: 6_000,
  /** Navigation grid cells (all levels together). */
  MAX_NAV_CELLS: 120_000,
  MAX_NAV_NODES: 160_000,
  /** Replans allowed per objective before it is called stuck. */
  MAX_REPLANS: 7,
});
