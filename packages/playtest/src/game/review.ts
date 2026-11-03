/**
 * Game checks for any world that is a game (win/lose rules, waves, NPC enemies or a player weapon), run headless on
 * the real physics, logic and weapon:
 *
 * - flow: start (behind the title card when the world has one), play to the lose screen and, if it can be done, the
 *   win screen, then restart the way the studio and the published player do (a fresh session from the document, held
 *   on the title card again). Restart must give back a fresh game: full health and ammunition, no score, the first wave.
 * - balance: seeded runs of a novice and an average player (see `SKILL_PROFILES`). The novice must almost always live
 *   through the first wave or the first minute; the average player should reach about 60–80% of the waves; the last
 *   wave must be winnable.
 *
 * Every problem is a finding with the numbers measured and a fix in the world's own params (`npc.attack.accuracy`,
 * `npc.attack.damage`, a wave rule's spawn `count`, `npc.drops`, pickups, an objective's `npc.health`). The cost is
 * bounded: a few seeded runs, each capped in game time, and one wall-clock budget for the whole review.
 */
import type { Finding } from '@aether/arch';
import type { Json, WorldDoc } from '@aether/core';
import { Session } from '../session';
import { playGame, SKILL_PROFILES, type GameRun, type SkillProfile } from './bot';
import { gameShape, type GameShape } from './shape';

export interface GameReviewOptions {
  /** Seeded runs per profile (default 3). */
  seeds?: number;
  /** Game seconds per run (default 480). */
  maxSeconds?: number;
  /** Wall-clock budget of the whole review in ms (default 45 000). */
  budgetMs?: number;
  /** Which checks run (default both). */
  flow?: boolean;
  balance?: boolean;
}

export interface GameReview {
  /** False for a world that is not a game (nothing ran). */
  ran: boolean;
  findings: Finding[];
  runs: GameRun[];
  /** One line per profile and the flow steps, for logs. */
  summary: string[];
  ms: number;
}

/** First minute, or the end of the first wave, whichever is later: what a novice must live through. */
export const NOVICE_SURVIVE_SECONDS = 60;
/** Share of waves an average player should reach. */
export const AVERAGE_WAVE_SHARE: readonly [number, number] = [0.6, 0.8];

const r2 = (n: number): number => Math.round(n * 100) / 100;
const pct = (a: number, b: number): string => `${Math.round((100 * a) / Math.max(1e-9, b))}%`;
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

function finding(code: string, severity: Finding['severity'], message: string, fix: string, entities: string[] = [], subject?: string): Finding {
  return { code, severity, message, fix, entities, ...(subject ? { subject } : {}) };
}

/** The share of the game a run reached: waves reached over waves (a win is all of it), or 1 for a game without waves. */
function reached(run: GameRun, shape: GameShape): number {
  if (run.outcome === 'win') return 1;
  if (shape.waves <= 0) return run.outcome === 'lose' ? 0 : 1;
  // A wave is reached once it started; the one it died in counts half.
  const cleared = run.outcome === 'lose' ? run.wave - 0.5 : run.wave;
  return clamp(cleared / shape.waves, 0, 1);
}

/** Damage records summed over the given waves (all when `waves` is null). */
function sumDamage(runs: GameRun[], pick: (r: GameRun) => Record<string, Record<string, number>>, waves: ((w: number, r: GameRun) => boolean) | null): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of runs) {
    for (const [w, by] of Object.entries(pick(r))) {
      if (waves && !waves(Number(w), r)) continue;
      for (const [who, n] of Object.entries(by)) out.set(who, (out.get(who) ?? 0) + n);
    }
  }
  return out;
}

function top(m: Map<string, number>): { id: string; amount: number; total: number } | null {
  let best: { id: string; amount: number } | null = null;
  let total = 0;
  for (const [id, n] of m) {
    total += n;
    if (!best || n > best.amount) best = { id, amount: n };
  }
  return best ? { ...best, total } : null;
}

/** The fix that makes `wave` easier, in the world's params: the top damage dealer's attack, its count in the wave, pickups. */
function easeFix(world: WorldDoc, shape: GameShape, wave: number, dealer: string | null, factor: number, fell: string | null): string[] {
  const parts: string[] = [];
  const e = dealer ? world.entities[dealer] : undefined;
  const atk = e?.npc?.attack;
  if (e && atk) {
    if (atk.ranged && atk.accuracy !== undefined) parts.push(`${dealer}.npc.attack.accuracy ${atk.accuracy} → ${r2(clamp(atk.accuracy * factor, 0.05, 1))}`);
    else if (atk.ranged) parts.push(`set ${dealer}.npc.attack.accuracy ${r2(0.5 * factor)} (unset, every shot in range lands)`);
    parts.push(`${dealer}.npc.attack.damage ${atk.damage} → ${Math.max(1, Math.round(atk.damage * factor))}`);
    if (atk.cooldown !== undefined && factor < 0.7) parts.push(`or ${dealer}.npc.attack.cooldown ${atk.cooldown} → ${r2(atk.cooldown / factor)}`);
  }
  const spawns = (shape.waveSpawns.get(wave) ?? []).filter((s) => !dealer || s.template === dealer);
  for (const s of spawns.slice(0, 2)) {
    if (s.count <= 1) continue;
    const n = Math.max(1, Math.min(s.count - 1, Math.round(s.count * factor)));
    parts.push(`rule ${s.rule} action ${s.action} (spawn ${s.template}) count ${s.count} → ${n}${s.counter ? ` with action ${s.counter.action} add ${s.counter.key} ${s.counter.amount} → ${n}` : ''}`);
  }
  if (fell) {
    const o = world.entities[fell];
    const hp = o?.npc?.health;
    if (typeof hp === 'number') parts.push(`${fell}.npc.health ${hp} → ${Math.round(hp / factor / 10) * 10}`);
  } else {
    const spawn = world.player.spawn;
    const near = shape.pickups.filter((p) => {
      if (p.template || p.key !== 'health') return false;
      const at = world.entities[p.id]?.transform.position;
      return !!at && Math.hypot(at[0] - spawn[0], at[2] - spawn[2]) < 20;
    });
    if (near.length === 0) parts.push(`add a medkit within 15 m of the player spawn [${spawn.map((v) => Math.round(v)).join(', ')}] (a collectible with scoreKey "health", value 35, respawn 30)`);
    const medkit = shape.pickups.find((p) => p.template && p.key === 'health');
    const drop = medkit && e?.npc?.drops?.find((d) => d.template === medkit.id);
    if (e?.npc && medkit && (!drop || (drop.chance ?? 1) < 0.3)) parts.push(`${dealer}.npc.drops ${medkit.id} chance ${drop ? (drop.chance ?? 1) : 0} → 0.3`);
  }
  return parts;
}

/** The state a fresh game starts with, read off a session just after it began. */
function startState(s: Session, shape: GameShape, world: WorldDoc): Record<string, Json> {
  const out: Record<string, Json> = {};
  const keys = new Set<string>(Object.keys(world.state));
  for (const k of ['health', 'score', shape.ammoKey, shape.reserveKey, shape.waveKey]) if (k) keys.add(k);
  for (const k of keys) {
    const v = s.state(k);
    if (v !== undefined) out[k] = v as Json;
  }
  for (const id of shape.objectives) {
    const b = s.runtime.npcs.brains.find((x) => x.id === id);
    const hp = b?.self.state['health'];
    if (b) out[`${id}.health`] = typeof hp === 'number' ? hp : b.hp;
  }
  return out;
}

/** Keys rules only ever count up (score, kills): a fresh game has them at 0. */
function counterKeys(world: WorldDoc, shape: GameShape): Set<string> {
  const up = new Set<string>();
  const down = new Set<string>();
  for (const r of world.rules) for (const a of r.then) if (a.do === 'add') (a.amount >= 0 ? up : down).add(a.key);
  const out = new Set<string>();
  for (const k of up) if (!down.has(k) && k !== shape.reserveKey && k !== shape.ammoKey && k !== 'health') out.add(k);
  return out;
}

interface StartProblem {
  key: string;
  got: Json;
  should: number;
  note?: string;
}

/** What a fresh start must look like, and where `got` differs from it. */
function freshProblems(got: Record<string, Json>, world: WorldDoc, shape: GameShape): StartProblem[] {
  const bad: StartProblem[] = [];
  const low = (key: string | null, should: number, note?: string): void => {
    if (key && typeof got[key] === 'number' && (got[key] as number) < should) bad.push({ key, got: got[key] as number, should, ...(note ? { note } : {}) });
  };
  low('health', shape.maxHealth);
  const w = world.player.weapon;
  if (w) {
    low(shape.ammoKey, w.magazine);
    low(shape.reserveKey, w.reserve);
  }
  if (shape.waveKey && typeof got[shape.waveKey] === 'number') {
    const first = Math.min(...shape.waveSpawns.keys());
    if ((got[shape.waveKey] as number) >= first) bad.push({ key: shape.waveKey, got: got[shape.waveKey] as number, should: first - 1, note: 'the first wave rule starts it' });
  }
  for (const k of counterKeys(world, shape)) if (k !== shape.waveKey && typeof got[k] === 'number' && (got[k] as number) > 0) bad.push({ key: k, got: got[k] as number, should: 0 });
  for (const id of shape.objectives) {
    const max = world.entities[id]?.npc?.health;
    const key = `${id}.health`;
    if (typeof max === 'number' && typeof got[key] === 'number' && (got[key] as number) < max) bad.push({ key, got: got[key] as number, should: max, note: `the objective's npc.health` });
  }
  return bad;
}

const stable = (v: unknown): string => JSON.stringify(v, (_k, x: unknown) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1))) : x));

interface FlowStart {
  state: Record<string, Json>;
  messagesHeld: string[];
  endedAtStart: { result: string; text: string; at: number } | null;
}

/** Open a session as the player would: held on the title card (if any), then the button, then 3 s of standing still. */
async function openGame(world: WorldDoc, shape: GameShape): Promise<FlowStart> {
  const held = world.intro !== undefined;
  const s = await Session.create(world, { trace: false, held });
  try {
    const messagesHeld = held ? s.host.seen.messages.slice() : [];
    s.begin();
    s.idle(1 / 60);
    const state = startState(s, shape, world);
    s.idle(3);
    const endedAtStart = s.host.seen.outcome ? { result: s.host.seen.outcome, text: s.host.seen.endText, at: Math.round(s.time * 10) / 10 } : null;
    return { state, messagesHeld, endedAtStart };
  } finally {
    s.dispose();
  }
}

function profileLine(name: string, runs: GameRun[], shape: GameShape): string {
  if (runs.length === 0) return `${name}: no runs`;
  const wins = runs.filter((r) => r.outcome === 'win').length;
  const waves = shape.waves > 0 ? `, waves ${runs.map((r) => (r.outcome === 'win' ? shape.waves : r.wave)).join('/')} of ${shape.waves}` : '';
  return `${name}: ${runs.length} runs, ${wins} won, lived ${runs.map((r) => `${Math.round(r.seconds)}s${r.outcome === 'lose' ? (r.cause === 'objective' ? ` (${r.fallen} fell)` : ' (died)') : r.outcome === null ? ' (cap)' : ''}`).join(', ')}${waves}, hits ${pct(runs.reduce((a, r) => a + r.hits, 0), runs.reduce((a, r) => a + r.shots, 0))}`;
}

/** Review the game of `world`: flow and balance findings with their fixes, and the runs behind them. */
export async function reviewGame(world: WorldDoc, opts: GameReviewOptions = {}): Promise<GameReview> {
  const t0 = Date.now();
  const shape = gameShape(world);
  if (!shape.isGame) return { ran: false, findings: [], runs: [], summary: [], ms: 0 };
  const seeds = Math.max(1, Math.min(6, opts.seeds ?? 3));
  const maxSeconds = opts.maxSeconds ?? 480;
  const deadline = t0 + (opts.budgetMs ?? 45_000);
  const doFlow = opts.flow !== false;
  const doBalance = opts.balance !== false;
  const findings: Finding[] = [];
  const summary: string[] = [];
  const runs: GameRun[] = [];
  const before = stable(world);
  const play = async (p: SkillProfile, seed: number, cap = maxSeconds): Promise<GameRun | null> => {
    if (Date.now() > deadline) return null;
    const r = await playGame(world, p, seed, { maxSeconds: cap, deadline, shape });
    runs.push(r);
    return r;
  };

  // 1. Start, behind the title card.
  const start = doFlow ? await openGame(world, shape) : null;
  if (start) {
    if (start.messagesHeld.length > 0) findings.push(finding('game_message_under_title', 'warning', `With the title card up (before Play), the game already showed: "${start.messagesHeld[0]?.slice(0, 80)}"`, 'show the welcome and objective only once play starts: put the message in a rule on "start" (it runs when the player presses Play), not in anything that runs while the world loads'));
    if (start.endedAtStart) findings.push(finding('game_ends_at_start', 'error', `The game ended ${start.endedAtStart.at} s after Play (${start.endedAtStart.result}: "${start.endedAtStart.text.slice(0, 80)}") before the player could do anything`, 'find the rule or behavior that ends it at once (a win/lose condition already true at the start, a hazard at the spawn) and make it wait for play: guard it with a condition on the wave or a timer'));
    const bad = freshProblems(start.state, world, shape);
    if (bad.length > 0) findings.push(finding('game_restart_state', 'error', `A new game (and every restart, which starts from the saved world) begins mid-game: ${bad.map((b) => `${b.key} ${String(b.got)} (should be ${b.should}${b.note ? `: ${b.note}` : ''})`).join(', ')}`, `set the start values in world.state: ${bad.map((b) => `${b.key} ${b.should}`).join(', ')} (a value the weapon or an NPC owns, such as ammunition or an objective's health, is reset by removing it from world.state); keep what changes during play out of the saved world`, [], 'start-state'));
    // A wave counter out of step with what the wave spawns never reaches 0: the next wave (or the victory) never comes.
    for (const [wave, list] of shape.waveSpawns) {
      for (const sp of list) {
        if (!sp.counter || sp.counter.amount === sp.count) continue;
        findings.push(finding('game_counter_mismatch', 'warning', `Wave ${wave}: rule ${sp.rule} spawns ${sp.count} ${sp.template} but adds ${sp.counter.amount} to "${sp.counter.key}", so the count of enemies left is wrong and the wave ${sp.counter.amount < sp.count ? 'may end early or go below 0' : 'never ends'}`, `make them match: rule ${sp.rule} action ${sp.counter.action} add ${sp.counter.key} ${sp.counter.amount} → ${sp.count} (or the spawn count → ${sp.counter.amount})`, [sp.template], `${sp.rule}#${sp.action}`));
      }
    }
    summary.push(`flow: start ${world.intro ? 'behind the title card' : '(no title card)'}, state ${Object.entries(start.state).map(([k, v]) => `${k}=${String(v)}`).join(' ')}${start.endedAtStart ? `, ENDED at ${start.endedAtStart.at}s` : ''}`);
  }

  // 2. Balance runs (they also show whether the lose and win screens come).
  const novice: GameRun[] = [];
  const average: GameRun[] = [];
  const strong: GameRun[] = [];
  if (doBalance && shape.hasWeapon && (!start || !start.endedAtStart)) {
    for (let i = 0; i < seeds; i++) {
      const r = await play(SKILL_PROFILES.novice, 101 + i);
      if (r) novice.push(r);
    }
    for (let i = 0; i < seeds; i++) {
      const r = await play(SKILL_PROFILES.average, 201 + i);
      if (r) average.push(r);
    }
    if (!average.some((r) => r.outcome === 'win')) {
      for (let i = 0; i < Math.min(2, seeds); i++) {
        const r = await play(SKILL_PROFILES.strong, 301 + i);
        if (r) strong.push(r);
      }
    }
    summary.push(profileLine('novice', novice, shape), profileLine('average', average, shape));
    if (strong.length > 0) summary.push(profileLine('strong', strong, shape));

    // Novice: the first wave or the first minute.
    const firstWaveEnd = (r: GameRun): number => (r.waveStarts.length > 2 ? (r.waveStarts[2] as number) : Infinity);
    const early = novice.filter((r) => r.outcome === 'lose' && r.seconds < NOVICE_SURVIVE_SECONDS && r.seconds < firstWaveEnd(r));
    if (novice.length > 0 && early.length > 0 && (novice.length - early.length) / novice.length < 0.9) {
      const byPlayer = early.filter((r) => r.cause !== 'objective');
      const byObjective = early.filter((r) => r.cause === 'objective');
      const objective = byObjective.length > byPlayer.length;
      const dmg = sumDamage(early, objective ? (r) => r.objectiveDamage : (r) => r.damage, null);
      const t = top(dmg);
      const meanT = mean(early.map((r) => r.seconds));
      const wave = Math.max(1, Math.round(mean(early.map((r) => r.wave || 1))));
      const factor = r2(clamp(0.45 + (0.4 * meanT) / NOVICE_SURVIVE_SECONDS, 0.5, 0.85));
      const fell = objective ? (byObjective[0]?.fallen ?? null) : null;
      const fix = easeFix(world, shape, wave, t?.id ?? null, factor, fell);
      const who = objective ? `${fell} fell` : 'the novice dies';
      findings.push(finding('game_novice_dies_early', early.length === novice.length ? 'error' : 'warning', `Too hard to start: in ${early.length} of ${novice.length} novice runs ${who} in ${Math.round(meanT)} s on average, in wave ${wave} (a beginner must live through the first wave or the first minute)${t ? `; ${t.id} did ${pct(t.amount, t.total)} of the damage (${Math.round(t.amount)} of ${Math.round(t.total)})` : ''}`, fix.length > 0 ? fix.join('; ') : 'make the first wave smaller and slower, or give the player more health', t ? [t.id] : [], 'novice'));
    }

    // Average: 60-80% of the waves; the last wave must be winnable.
    if (average.length > 0) {
      const share = mean(average.map((r) => reached(r, shape)));
      const wins = average.filter((r) => r.outcome === 'win').length;
      const losses = average.filter((r) => r.outcome === 'lose');
      if (share < AVERAGE_WAVE_SHARE[0] && losses.length > 0) {
        const waveOf = (r: GameRun): number => r.wave || 1;
        const deathWave = Math.round(mean(losses.map(waveOf)));
        const objective = losses.filter((r) => r.cause === 'objective').length > losses.length / 2;
        const t = top(sumDamage(losses, objective ? (r) => r.objectiveDamage : (r) => r.damage, (w, r) => w === waveOf(r)));
        const factor = r2(clamp(share / 0.7, 0.5, 0.9));
        const fell = objective ? (losses.find((r) => r.fallen)?.fallen ?? null) : null;
        const fix = easeFix(world, shape, deathWave, t?.id ?? null, factor, fell);
        findings.push(finding('game_too_hard', 'warning', `Too hard for an average player: ${average.length} runs reached ${pct(share, 1)} of the game${shape.waves > 0 ? ` (waves ${average.map((r) => (r.outcome === 'win' ? shape.waves : r.wave)).join('/')} of ${shape.waves})` : ''}, target ${pct(AVERAGE_WAVE_SHARE[0], 1)}–${pct(AVERAGE_WAVE_SHARE[1], 1)}; most ${objective ? `lost ${fell}` : 'died'} in wave ${deathWave}${t ? `, where ${t.id} did ${pct(t.amount, t.total)} of the damage` : ''}`, fix.length > 0 ? fix.join('; ') : 'make the middle waves smaller or their attackers less accurate', t ? [t.id] : [], 'average'));
      } else if (average.length >= 2 && (wins === average.length || (share > AVERAGE_WAVE_SHARE[1] + 0.1 && wins > average.length / 2))) {
        const last = shape.waveSpawns.get(shape.waves) ?? [];
        const s = last.slice().sort((a, b) => b.count - a.count)[0];
        findings.push(finding('game_too_easy', 'info', `Too easy: the average player won ${wins} of ${average.length} runs (target: reach ${pct(AVERAGE_WAVE_SHARE[0], 1)}–${pct(AVERAGE_WAVE_SHARE[1], 1)} of the waves) and never dropped below ${Math.round(Math.min(...average.map((r) => r.minHealth)))} health`, s ? `raise the late waves: rule ${s.rule} action ${s.action} (spawn ${s.template}) count ${s.count} → ${s.count + 2}, or the attackers' npc.attack.accuracy` : 'add a harder last stretch (more or tougher enemies)', s ? [s.template] : [], 'average'));
      }
    }
  }

  // 3. Lose and win screens.
  if (doFlow && (!start || !start.endedAtStart)) {
    const all = [...novice, ...average, ...strong];
    if (!all.some((r) => r.outcome === 'lose') && (shape.hostiles.length > 0 || shape.losePaths.some((p) => p !== 'npc attacks'))) {
      const r = await play(SKILL_PROFILES.passive, 1, Math.min(maxSeconds, 240));
      if (r) summary.push(`flow: a player who does nothing ${r.outcome ? `${r.outcome === 'lose' ? 'lost' : 'won'} after ${Math.round(r.seconds)} s` : `was still playing after ${Math.round(r.seconds)} s`}`);
      if (r && r.outcome !== 'lose' && !r.cut) {
        findings.push(finding('game_lose_unreached', 'warning', `The lose screen never came: a player who stood still without firing for ${Math.round(r.seconds)} s ${r.outcome === 'win' ? 'won' : 'was still playing'} (health never below ${Math.round(r.minHealth)}${shape.objectives.length > 0 ? `; ${shape.objectives.join(', ')} still standing` : ''})`, shape.hostiles.length > 0 ? `let the enemies reach and hurt the player (npc.enemies includes "player", npc.attack.damage > 0, perception.sight and attack.range long enough), or add a rule that loses the game: on state "health" <= 0 → lose, or on event "<objective>-died" → lose` : 'add a way to lose: a rule with a lose action (on a timer, on health <= 0) or a hazard'));
      }
    } else if (all.some((r) => r.outcome === 'lose')) summary.push('flow: lose screen reached');
    const won = all.find((r) => r.outcome === 'win');
    if (won) summary.push(`flow: win screen reached by the ${won.profile} player after ${Math.round(won.seconds)} s`);
    else if (shape.winPaths.length === 0) {
      if (shape.waves > 0) findings.push(finding('game_win_unreached', 'error', `The game cannot be won: ${shape.waves} waves and no win action anywhere (rules, goals, scripts)`, `add a victory rule: when state "alive" <= 0 with ${shape.waveKey} >= ${shape.waves} (and nothing pending) → win, with a line of text`, [], 'win'));
    } else if (shape.hasWeapon && all.length > 0) {
      const best = [...strong, ...average].sort((a, b) => reached(b, shape) - reached(a, shape))[0];
      if (best) {
        const lw = best.wave || shape.waves;
        const objective = best.cause === 'objective';
        const t = top(sumDamage([best], objective ? (r) => r.objectiveDamage : (r) => r.damage, (w) => w === lw));
        const stalled = best.outcome === null && !best.cut;
        const fix = stalled
          ? [`wave ${lw} never ended in ${Math.round(best.seconds)} s: check that every spawned enemy can reach the player and that the counters the victory rule waits for (alive, pending) reach 0`]
          : easeFix(world, shape, lw, t?.id ?? null, 0.75, objective ? best.fallen : null);
        findings.push(finding('game_win_unreached', 'warning', `No run won: the best (${best.profile}) reached wave ${lw}${shape.waves > 0 ? ` of ${shape.waves}` : ''} and ${stalled ? 'the game never ended' : objective ? `lost ${best.fallen}` : 'died'} after ${Math.round(best.seconds)} s${t ? `; ${t.id} did ${pct(t.amount, t.total)} of the damage there` : ''}. The last wave must be winnable`, fix.join('; '), t ? [t.id] : [], 'win'));
      }
    }
  }

  // 4. Restart: a fresh session from the same document, held on the title card again, must start exactly like the first.
  if (doFlow && start) {
    const after = stable(world);
    if (after !== before) findings.push(finding('game_restart_dirty', 'error', 'Playing changed the saved world itself, so a restart would not start fresh', 'report it: the runtime must work on copies; until then rebuild the world from its saved version on restart', [], 'restart'));
    const again = await openGame(world, shape);
    const diff = Object.keys({ ...start.state, ...again.state }).filter((k) => stable(start.state[k]) !== stable(again.state[k]));
    if (diff.length > 0) findings.push(finding('game_restart_state', 'error', `Restart does not reset: after a played game ${diff.map((k) => `${k} starts at ${String(again.state[k])} instead of ${String(start.state[k])}`).join(', ')}`, 'set these keys in world.state and reset anything kept outside it when the game starts', [], 'restart'));
    if (world.intro && again.messagesHeld.length > 0) findings.push(finding('game_message_under_title', 'warning', `After restart, with the title card up again, the game showed "${again.messagesHeld[0]?.slice(0, 80)}"`, 'show the welcome only when play starts (a rule on "start")', [], 'restart'));
    summary.push(`flow: restart ${diff.length === 0 && after === before ? 'resets the game' : 'does NOT reset the game'}${world.intro ? ' and opens on the title card' : ''}`);
  }
  if (runs.some((r) => r.cut)) summary.push(`(time budget reached: ${runs.filter((r) => r.cut).length} run cut short)`);
  return { ran: true, findings, runs, summary, ms: Date.now() - t0 };
}
