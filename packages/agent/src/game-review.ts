/**
 * Game checks in the review loop. A world that is a game (win/lose rules, waves, NPCs that attack the player, a player
 * weapon) is checked in every review round, the way `withSunk` and `withFalls` check every world:
 *
 * - from the data alone, always: a title card to open on and come back to on restart, an objective on it, a way to win;
 * - by playing it, when the host can run physics (`AgentOptions.gameReview`, e.g. `reviewGame` of @aether/playtest):
 *   the game flow (start behind the title card, lose, win, restart to a fresh game) and the balance (a novice lives
 *   through the first wave, an average player reaches 60-80% of the waves, the last wave can be won).
 *
 * The played checks are cached on the parts of the world that change the game (rules, state, player, intro, NPCs,
 * behaviours), so a round that only moved scenery does not play again.
 */
import type { Entity, WorldDoc } from '@aether/core';
import { findingKey, scoreFindings, type Finding } from '@aether/arch';
import type { ReviewSnapshot } from './review';

/** What the host's game review returns: findings with fixes and a few lines for the log. */
export interface GameReviewResult {
  findings: Finding[];
  summary: string[];
}

/** Plays a game world headless and reviews it (null when it could not run). */
export type GameReviewRunner = (world: WorldDoc, signal?: AbortSignal) => Promise<GameReviewResult | null>;

/** Codes of the game findings (one family, replaced together each round). */
export const GAME_CODES: ReadonlySet<string> = new Set([
  'game_no_intro',
  'game_intro_objective',
  'game_no_win',
  'game_message_under_title',
  'game_ends_at_start',
  'game_restart_state',
  'game_restart_dirty',
  'game_lose_unreached',
  'game_win_unreached',
  'game_novice_dies_early',
  'game_too_hard',
  'game_too_easy',
  'game_counter_mismatch',
]);

function hostile(e: Entity): boolean {
  return !!e.npc && e.npc.enemies.includes('player') && !(e.npc.allies ?? []).includes('player');
}

function hasWinOrLose(world: WorldDoc): { win: boolean; lose: boolean } {
  let win = false;
  let lose = false;
  for (const r of world.rules) {
    if (r.enabled === false) continue;
    for (const a of r.then) {
      if (a.do === 'win') win = true;
      if (a.do === 'lose') lose = true;
    }
  }
  for (const e of Object.values(world.entities)) {
    for (const b of e.behaviors) {
      if (b.enabled === false) continue;
      if (b.type === 'goal') win = true;
      if (b.type === 'hazard') lose = true;
    }
  }
  for (const s of Object.values(world.scripts ?? {})) {
    const src = typeof s === 'string' ? s : JSON.stringify(s);
    if (/\bwin\s*\(/.test(src)) win = true;
    if (/\blose\s*\(/.test(src)) lose = true;
  }
  return { win, lose };
}

/** Rules that test a wave or round counter. */
function waveCount(world: WorldDoc): number {
  let n = 0;
  for (const r of world.rules) for (const c of r.if) if (/(^|[-_.])(wave|round)s?($|[-_.])/i.test(c.key) && c.op === '==' && typeof c.value === 'number') n = Math.max(n, c.value);
  return n;
}

/** True when `world` is a game: win/lose rules, waves, NPC enemies of the player or a player weapon. */
export function isReviewedGame(world: WorldDoc): boolean {
  if (world.player.weapon) return true;
  const { win, lose } = hasWinOrLose(world);
  if (win || lose) return true;
  if (waveCount(world) > 0) return true;
  return Object.values(world.entities).some(hostile);
}

/** What the data alone says about the game's loop (intro, play, end, restart). */
export function gameStaticFindings(world: WorldDoc): Finding[] {
  if (!isReviewedGame(world)) return [];
  const out: Finding[] = [];
  const waves = waveCount(world);
  const fighting = !!world.player.weapon || waves > 0 || Object.values(world.entities).some(hostile);
  if (!world.intro) {
    out.push({ code: 'game_no_intro', severity: fighting ? 'warning' : 'info', message: 'The game has no title card: play starts the moment the world opens and a restart has nothing to return to', entities: [], fix: 'set world.intro: title, a one-line tagline, the objective, the controls (up to 6 short lines) and a button label such as "Play"', subject: 'intro' });
  } else if (!world.intro.objective) {
    out.push({ code: 'game_intro_objective', severity: 'info', message: 'The title card does not say what to do', entities: [], fix: 'set world.intro.objective to one sentence: what wins (and what loses) the game', subject: 'intro' });
  }
  const { win } = hasWinOrLose(world);
  if (!win && waves > 0) {
    out.push({ code: 'game_no_win', severity: 'error', message: `The game cannot be won: ${waves} waves and no win action anywhere`, entities: [], fix: `add a victory rule: when the last wave (${waves}) is out and no enemy is left (e.g. on state "alive" <= 0 with wave >= ${waves}) → win with a line of text`, subject: 'win' });
  }
  return out;
}

/** `snap` with the game findings of `world` (from the data, and from `played` when the host played it) in place of last round's. */
export function withGame(snap: ReviewSnapshot, world: WorldDoc, played: GameReviewResult | null): ReviewSnapshot {
  let extra: Finding[];
  try {
    extra = gameStaticFindings(world);
  } catch {
    extra = [];
  }
  if (played) {
    // A played finding on the same subject says more than the data-only one.
    const subjects = new Set(played.findings.map((f) => f.subject).filter((s): s is string => !!s));
    extra = [...extra.filter((f) => !f.subject || !subjects.has(f.subject)), ...played.findings];
  }
  const had = snap.findings.some((f) => GAME_CODES.has(f.code));
  if (extra.length === 0 && !had) return snap;
  const findings = [...snap.findings.filter((f) => !GAME_CODES.has(f.code)), ...extra];
  return { ...snap, findings, score: scoreFindings(findings), keys: new Set(findings.map(findingKey)) };
}

function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

/** The parts of `world` that change how its game plays (not scenery or looks). */
export function gameSignature(world: WorldDoc): string {
  const ents: unknown[] = [];
  for (const e of Object.values(world.entities)) {
    if (e.npc || e.template || e.behaviors.length > 0) ents.push([e.id, e.npc ?? null, e.behaviors, e.template, e.transform.position]);
  }
  ents.sort((a, b) => ((a as [string])[0] < (b as [string])[0] ? -1 : 1));
  return fnv(JSON.stringify([world.rules, world.state, world.player, world.intro ?? null, world.scripts ?? null, ents]));
}

/**
 * The host's game review behind a cache: a world whose game is unchanged since the last call gets the last result
 * (`fresh` false) without playing again. Failures count as no result.
 */
export class GameReviewCache {
  private key = '';
  private last: GameReviewResult | null = null;
  constructor(private readonly runner: GameReviewRunner) {}

  async get(world: WorldDoc, signal?: AbortSignal): Promise<{ result: GameReviewResult | null; fresh: boolean }> {
    if (!isReviewedGame(world)) return { result: null, fresh: false };
    const key = gameSignature(world);
    if (key === this.key) return { result: this.last, fresh: false };
    let result: GameReviewResult | null = null;
    try {
      result = await this.runner(world, signal);
    } catch {
      result = null;
    }
    this.key = key;
    this.last = result;
    return { result, fresh: true };
  }
}
