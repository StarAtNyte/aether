/**
 * Game checks in the review loop: the data checks (title card, a way to win), the merge into a review snapshot, the
 * cache that keeps an unchanged game from being played twice, and the loop end to end on Kestrel Outpost saved
 * mid-game: the played check finds that a restart does not reset, the model fixes the start state, and the next round is clean.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createWorld, type WorldDoc } from '@aether/core';
import type { Finding } from '@aether/arch';
import { reviewGame } from '@aether/playtest/game';
import { describe, expect, it } from 'vitest';
import { WorldAgent } from '../src/agent';
import { GameReviewCache, gameStaticFindings, isReviewedGame, withGame, type GameReviewRunner } from '../src/game-review';
import type { ReviewSnapshot } from '../src/review';
import type { AgentEvent, CompletionRequest, CompletionResponse, ContentBlock, Provider } from '../src/types';
import { collect, MemoryHost, TEST_CATALOGS } from './helpers';

const FILE = fileURLToPath(new URL('../../../apps/studio/public/templates/worlds/kestrel-outpost.json', import.meta.url));
const kestrel = (): WorldDoc => createWorld((JSON.parse(readFileSync(FILE, 'utf8')) as { world: WorldDoc }).world);

const snapOf = (findings: Finding[]): ReviewSnapshot => ({ buildings: ['x'], findings, score: 100, keys: new Set(), views: [], legend: '', advice: '' });
const f = (code: string, subject?: string): Finding => ({ code, severity: 'warning', message: code, entities: [], fix: 'fix it', ...(subject ? { subject } : {}) });

describe('game data checks', () => {
  it('passes Kestrel Outpost (a title card with an objective, a victory rule)', () => {
    expect(isReviewedGame(kestrel())).toBe(true);
    expect(gameStaticFindings(kestrel())).toEqual([]);
  });

  it('asks for a title card, and for a way to win a game with waves', () => {
    const w = kestrel();
    w.intro = undefined;
    w.rules = w.rules.filter((r) => !r.then.some((a) => a.do === 'win'));
    const codes = gameStaticFindings(w).map((x) => `${x.code}:${x.severity}`);
    expect(codes).toEqual(['game_no_intro:warning', 'game_no_win:error']);
  });

  it('leaves a world that is not a game alone', () => {
    expect(isReviewedGame(createWorld())).toBe(false);
    const snap = snapOf([f('sunk_in_ground')]);
    expect(withGame(snap, createWorld(), null)).toBe(snap);
  });

  it('replaces last round\'s game findings, and a played finding replaces the data one on its subject', () => {
    const w = kestrel();
    w.rules = w.rules.filter((r) => !r.then.some((a) => a.do === 'win'));
    const prev = snapOf([f('sunk_in_ground'), f('game_too_hard', 'average')]);
    const out = withGame(prev, w, { findings: [f('game_win_unreached', 'win')], summary: [] });
    expect(out.findings.map((x) => x.code)).toEqual(['sunk_in_ground', 'game_win_unreached']);
    expect(out.score).toBeLessThan(100);
    expect(withGame(prev, w, null).findings.map((x) => x.code)).toEqual(['sunk_in_ground', 'game_no_win']);
  });
});

describe('game review cache', () => {
  it('plays a game once until its game changes; scenery moves do not count', async () => {
    let calls = 0;
    const cache = new GameReviewCache(async () => {
      calls++;
      return { findings: [], summary: ['ok'] };
    });
    const w = kestrel();
    expect((await cache.get(w)).fresh).toBe(true);
    expect((await cache.get(w)).fresh).toBe(false);
    const moved = structuredClone(w);
    const rock = Object.values(moved.entities).find((e) => e.tags.includes('rock'));
    if (rock) rock.transform.position = [rock.transform.position[0] + 1, rock.transform.position[1], rock.transform.position[2]];
    expect((await cache.get(moved)).fresh).toBe(false);
    const harder = structuredClone(w);
    harder.entities['raider-n']!.npc!.attack!.accuracy = 0.9;
    expect((await cache.get(harder)).fresh).toBe(true);
    expect(calls).toBe(2);
    expect((await cache.get(createWorld())).result).toBeNull();
    expect(calls).toBe(2);
  });
});

class Scripted implements Provider {
  readonly name = 'scripted';
  readonly requests: CompletionRequest[] = [];
  constructor(private readonly script: CompletionResponse[]) {}
  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    this.requests.push({ ...req, messages: req.messages.map((m) => ({ ...m, content: Array.isArray(m.content) ? [...m.content] : m.content })) });
    return this.script.shift() ?? { content: [{ type: 'text', text: 'done' }], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 } };
  }
}
let seq = 0;
const call = (name: string, input: unknown): ContentBlock => ({ type: 'tool_use', id: `g-${++seq}`, name, input });
const turn = (...content: ContentBlock[]): CompletionResponse => ({ content, stopReason: 'tool_use', usage: { inputTokens: 10, outputTokens: 5 } });

describe('the review loop on a game', () => {
  it('plays it, shows the model a restart that does not reset, and is clean once the start state is fixed', async () => {
    const w = kestrel();
    w.state = { ...w.state, score: 1200, wave: 3, health: 40, kills: 12 };
    const host = new MemoryHost(w);
    let played = 0;
    const runner: GameReviewRunner = async (world) => {
      played++;
      const r = await reviewGame(world, { balance: false, budgetMs: 30_000 });
      return { findings: r.findings, summary: r.summary };
    };
    const provider = new Scripted([
      turn(call('apply_patches', { patches: [{ op: 'updateRule', id: 'begin', set: { description: 'Opening' } }], message: 'Name the opening rule' }), call('finish', { message: 'Built.' })),
      // Review round 1: the model applies the fix the game check named.
      turn(call('apply_patches', { patches: [{ op: 'setState', key: 'health', value: 100 }, { op: 'setState', key: 'wave', value: 0 }, { op: 'setState', key: 'score', value: 0 }, { op: 'setState', key: 'kills', value: 0 }], message: 'Fresh start state' })),
      turn(call('finish', { message: 'A restart now starts a fresh game.' })),
    ]);
    const agent = new WorldAgent({ provider, catalogs: TEST_CATALOGS, gameReview: runner, review: { maxRounds: 4, stallRounds: 2 } });
    const events: AgentEvent[] = await collect(agent.run('make the outpost game', host));
    const shown = JSON.stringify(provider.requests.map((r) => r.messages.at(-1)?.content));
    expect(shown).toContain('GAME CHECK');
    expect(shown).toContain('game_restart_state');
    expect(shown).toContain('health 40');
    expect(host.world.state['health']).toBe(100);
    expect(events.some((e) => e.type === 'status' && e.text.startsWith('Game check:'))).toBe(true);
    // Played once per change of the game: the broken world and the fixed one.
    expect(played).toBe(2);
    const phases = events.filter((e) => e.type === 'review').map((e) => (e as { phase: string }).phase);
    expect(phases).not.toContain('stalled');
  }, 120_000);
});
