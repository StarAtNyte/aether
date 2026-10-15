/**
 * Shape of a small-edit eval case.
 */
import type { FixtureName } from './fixtures';

/** What a correct, minimal edit looks like. */
export interface Expect {
  /** Entity ids that must change (or be removed). */
  t?: string[];
  /** Entities allowed to change besides `t` and their descendants (ids or a regex source). */
  allow?: Array<string | RegExp>;
  /** Regex sources; each must match at least one changed property path of the targets ("entity.path"). */
  p?: string[];
  /** Environment keys that must change. */
  env?: string[];
  /** Player spec keys that must change. */
  player?: string[];
  /** World state keys / rule ids / hud that must change (any scope except entity). */
  game?: string[];
  /** Number of added entities (min, max). */
  added?: [number, number];
  /** Entity ids that must be gone. */
  removed?: string[];
  /** Wall faces: only faces looking into `room` (optionally just `side`) may change, and at least one must. */
  wall?: { room: string; side?: string; all?: boolean };
  /** The right answer is to ask which one (candidates in `cands`, at least this many). */
  ask?: number;
  /** The right answer is a local no-op/decline (the model handles it). */
  decline?: boolean;
  /** Voxel settings paths that must change (prefix match). */
  voxel?: string[];
  /** Undo/redo handled by the host. */
  history?: 'undo' | 'redo';
}

/** One case. */
export interface EditCase {
  id: string;
  world: FixtureName;
  prompt: string;
  /** Earlier turns of the conversation (applied in order, same engine). */
  prior?: string[];
  /** Entities selected in the viewport. */
  selection?: string[];
  heading?: number;
  expect: Expect;
}
