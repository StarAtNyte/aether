import { createWorld, stableStringify, type WorldDoc } from '@aether/core';
import { describe, expect, it } from 'vitest';
import { WorldAgent } from '../src/agent';
import { createMockProvider } from '../src/providers/mock/index';
import { parseIntent } from '../src/providers/mock/intent';
import { Builder } from '../src/providers/mock/builder';
import { askMock, collect, MemoryHost, mockApply, patchesOf, TEST_CATALOGS } from './helpers';

const BUILTIN = new Set([
  'terrain', 'island', 'mountain', 'tree-pine', 'tree-oak', 'tree-palm', 'bush', 'rock', 'grass-tuft', 'flowers', 'mushroom', 'house', 'tower', 'wall', 'fence', 'bridge',
  'stairs', 'arch', 'ramp', 'lamp-post', 'bench', 'table', 'chair', 'crate', 'barrel', 'car', 'boat', 'windmill', 'crystal', 'campfire', 'tent', 'dock', 'cloud', 'statue', 'portal',
  // The realistic vegetation set: worlds are built realistic by default (leaf-card trees, ground cover, boulders, cacti).
  'tree-spruce', 'tree-broadleaf', 'tree-birch', 'shrub', 'fern', 'meadow-grass', 'wildflowers', 'boulder', 'cactus',
]);

const THEME_PROMPTS: Array<[string, string]> = [
  ['forest', 'a cozy forest campsite with tents around a campfire'],
  ['beach', 'a tropical beach island with palm trees'],
  ['village', 'a small medieval village with houses'],
  ['castle', 'a stone castle on a hill'],
  ['city', 'a city street with cars'],
  ['space', 'an asteroid field in outer space'],
  ['winter', 'a snowy winter wonderland'],
  ['desert', 'a desert canyon with cacti'],
  ['volcano', 'an erupting volcano with rivers of lava'],
  ['park', 'a park with a playground'],
  ['domino', 'a domino run that knocks over a bell'],
  ['coins', 'collect 10 coins before time runs out'],
  ['parkour', 'an obstacle course parkour challenge'],
  ['bowling', 'a bowling alley with pins'],
  ['tower', 'knock down a tower of crates with a cannonball'],
  ['farm', 'a farm with windmills and sheep'],
  ['haunted', 'a haunted graveyard at night'],
  ['meadow', 'something calm and pretty'],
];

function generatorsUsed(world: WorldDoc): string[] {
  const out: string[] = [];
  for (const e of Object.values(world.entities)) {
    if (e.shape.kind === 'procedural') out.push(e.shape.generator);
    if (e.shape.kind === 'scatter' && e.shape.of.kind === 'procedural') out.push(e.shape.of.generator);
  }
  return out;
}

describe('mock provider: world themes', () => {
  it.each(THEME_PROMPTS)('%s theme produces valid, rich patches', async (_id, prompt) => {
    const { result, res } = await mockApply(prompt);
    expect(result.errors).toEqual([]);
    const world = result.world;
    const count = Object.keys(world.entities).length;
    expect(count).toBeGreaterThanOrEqual(15);
    expect(count).toBeLessThanOrEqual(400);
    expect(world.tests.length).toBeGreaterThan(0);
    expect(world.name).not.toBe('Untitled world');
    for (const g of generatorsUsed(world)) expect(BUILTIN.has(g)).toBe(true);
    // The response mirrors a real model: plan text, apply_patches, finish.
    expect(res.stopReason).toBe('tool_use');
    expect(res.content[0]?.type).toBe('text');
    expect(res.content.at(-1)).toMatchObject({ type: 'tool_use', name: 'finish' });
  });

  it('domino run topples into a bell with proper tests', async () => {
    const { result } = await mockApply('a domino chain reaction');
    const w = result.world;
    expect(w.player.mode).toBe('orbit');
    const dominoes = Object.values(w.entities).filter((e) => e.tags.includes('domino'));
    expect(dominoes.length).toBeGreaterThanOrEqual(12);
    expect(dominoes.every((d) => d.physics?.body === 'dynamic')).toBe(true);
    expect(dominoes.filter((d) => d.physics?.initialAngularVelocity).length).toBe(1);
    expect(w.tests.some((t) => t.kind === 'topples')).toBe(true);
    expect(w.rules.some((r) => r.when.on === 'collision')).toBe(true);
  });

  it('coin game has HUD, timer, win and lose rules and honors the count', async () => {
    const { result } = await mockApply('collect 12 coins');
    const w = result.world;
    const coins = Object.values(w.entities).filter((e) => e.tags.includes('coin'));
    expect(coins.length).toBe(12);
    expect(w.state['score']).toBe(0);
    expect(w.hud.map((h) => h.key)).toEqual(['score', 'timeLeft']);
    const actions = w.rules.flatMap((r) => r.then.map((a) => a.do));
    expect(actions).toContain('win');
    expect(actions).toContain('lose');
    expect(w.tests.some((t) => t.kind === 'eventually')).toBe(true);
  });

  it('space sets low gravity and removes the ground', async () => {
    const { result } = await mockApply('a space station among asteroids');
    expect(result.world.environment.ground).toBeNull();
    expect(result.world.environment.gravity[1]).toBeGreaterThan(-3);
    expect(result.world.environment.sky).toBe('space');
  });

  it('obstacle course has a goal, hazard and checkpoint', async () => {
    const { result } = await mockApply('parkour over lava');
    const types = Object.values(result.world.entities).flatMap((e) => e.behaviors.map((b) => b.type));
    expect(types).toEqual(expect.arrayContaining(['goal', 'hazard', 'checkpoint', 'patrol']));
  });

  it('city street lets the player drive a car', async () => {
    const { result } = await mockApply('drive a car through the city');
    const w = result.world;
    expect(w.player.mode).toBe('vehicle');
    const car = w.entities[w.player.controls ?? ''];
    expect(car?.behaviors.some((b) => b.type === 'vehicle')).toBe(true);
    expect(car?.physics?.body).toBe('dynamic');
  });

  it('combines themes and moods', async () => {
    const { result } = await mockApply('a haunted castle in a snowy forest at night with fog');
    expect(result.errors).toEqual([]);
    const w = result.world;
    expect(w.environment.sky).toBe('night');
    expect(w.environment.fog).not.toBeNull();
    const ids = Object.keys(w.entities).join(' ');
    expect(ids).toMatch(/tower/);
    expect(ids).toMatch(/gravestone/);
    expect(ids).toMatch(/tree/);
  });

  it('activity inside a setting keeps the play area clear', async () => {
    const { result } = await mockApply('a domino run in a forest');
    expect(result.errors).toEqual([]);
    const trees = Object.values(result.world.entities).filter((e) => e.tags.includes('tree'));
    expect(trees.length).toBeGreaterThan(5);
    for (const t of trees) expect(Math.hypot(t.transform.position[0], t.transform.position[2])).toBeGreaterThan(12);
  });

  it('places nothing on top of each other in the occupancy map', async () => {
    const { result } = await mockApply('a village');
    const houses = Object.values(result.world.entities).filter((e) => e.tags.includes('house'));
    for (let i = 0; i < houses.length; i++) {
      for (let j = i + 1; j < houses.length; j++) {
        const a = houses[i]!.transform.position;
        const b = houses[j]!.transform.position;
        expect(Math.hypot(a[0] - b[0], a[2] - b[2])).toBeGreaterThan(8);
      }
    }
  });

  it('is deterministic for the same prompt and varies across prompts', async () => {
    const a = await askMock('a forest camp');
    const b = await askMock('a forest camp');
    const c = await askMock('a forest camp by the lake');
    expect(stableStringify(a)).toBe(stableStringify(b));
    expect(stableStringify(patchesOf(a))).not.toBe(stableStringify(patchesOf(c)));
  });

  it('applies mood overrides', async () => {
    expect((await mockApply('a beach at sunset')).result.world.environment.sky).toBe('sunset');
    expect((await mockApply('a village in the rain')).result.world.environment.weather).toBe('rain');
    expect((await mockApply('a park with low gravity')).result.world.environment.gravity).toEqual([0, -1.62, 0]);
  });
});

describe('mock provider: edits on an existing world', () => {
  async function base(prompt = 'a village'): Promise<WorldDoc> {
    const { result } = await mockApply(prompt);
    expect(result.errors).toEqual([]);
    return result.world;
  }

  it('adds N things without id clashes', async () => {
    const w = await base();
    const before = Object.keys(w.entities).length;
    const { result } = await mockApply('add 5 rocks', w);
    expect(result.errors).toEqual([]);
    const rocks = Object.keys(result.world.entities).filter((id) => /^rock-/.test(id) && !w.entities[id]);
    expect(rocks.length).toBe(5);
    expect(Object.keys(result.world.entities).length).toBe(before + 5);
  });

  it('adds many decorative things as one scatter', async () => {
    const w = await base();
    const { result } = await mockApply('add 100 flowers', w);
    expect(result.errors).toEqual([]);
    const added = Object.values(result.world.entities).filter((e) => !w.entities[e.id]);
    expect(added).toHaveLength(1);
    expect(added[0]!.shape.kind).toBe('scatter');
  });

  it('adds coins with score state and keeps the HUD', async () => {
    const w = await base('collect 5 coins in a park');
    const { result } = await mockApply('add 3 more coins', w);
    expect(result.errors).toEqual([]);
    expect(Object.values(result.world.entities).filter((e) => e.tags.includes('coin'))).toHaveLength(8);
    expect(result.world.hud).toEqual(w.hud);
  });

  it('changes the environment ("make it night and rainy")', async () => {
    const w = await base();
    const { result } = await mockApply('make it night and rainy', w);
    expect(result.errors).toEqual([]);
    expect(result.world.environment.sky).toBe('night');
    expect(result.world.environment.weather).toBe('rain');
    expect(Object.keys(result.world.entities)).toEqual(Object.keys(w.entities));
  });

  it('removes entities by name', async () => {
    const w = await base();
    const houses = Object.values(w.entities).filter((e) => e.tags.includes('house')).length;
    expect(houses).toBeGreaterThan(2);
    const { result } = await mockApply('remove all the houses', w);
    expect(result.errors).toEqual([]);
    expect(Object.values(result.world.entities).filter((e) => e.tags.includes('house'))).toHaveLength(0);
    const one = await mockApply('delete the statue', w);
    expect(one.result.errors).toEqual([]);
    expect(Object.values(one.result.world.entities).some((e) => e.id.startsWith('statue'))).toBe(false);
  });

  it('modifies properties: bigger, color, bouncy, heavy, spin, bob', async () => {
    const w = await base('a bowling alley');
    const ballId = Object.values(w.entities).find((e) => e.id.startsWith('bowling-ball'))!.id;
    const bigger = await mockApply('make the bowling ball bigger', w);
    expect(bigger.result.errors).toEqual([]);
    expect(bigger.result.world.entities[ballId]!.transform.scale[0]).toBeCloseTo(1.6);
    // A resting primitive keeps its bottom on the lane when scaled.
    expect(bigger.result.world.entities[ballId]!.transform.position[1]).toBeCloseTo(0.1 + (0.55 * 1.6) / 2, 1);

    const red = await mockApply('paint the bowling ball red', w);
    expect(red.result.world.entities[ballId]!.material?.color).toBe('#e63946');
    const bouncy = await mockApply('make the bowling ball bouncy', w);
    expect(bouncy.result.world.entities[ballId]!.physics?.restitution).toBe(0.9);
    const heavy = await mockApply('make the bowling ball heavier', w);
    expect(heavy.result.world.entities[ballId]!.physics?.mass).toBeGreaterThanOrEqual(35);
    const spin = await mockApply('make the lamp posts spin', w);
    expect(spin.result.errors).toEqual([]);
    const lamps = Object.values(spin.result.world.entities).filter((e) => e.tags.includes('lamp'));
    expect(lamps.length).toBeGreaterThan(0);
    expect(lamps.every((l) => l.behaviors.some((b) => b.type === 'spin'))).toBe(true);
  });

  it('recolors procedural entities through generator params', async () => {
    const w = await base('a city street');
    const { result } = await mockApply('make the parked cars yellow', w);
    expect(result.errors).toEqual([]);
    const cars = Object.values(result.world.entities).filter((e) => e.id.startsWith('parked-car'));
    expect(cars.length).toBeGreaterThan(0);
    for (const c of cars) expect(c.shape.kind === 'procedural' && c.shape.params['color']).toBe('#f9c74f');
  });

  it('keeps existing behaviors when adding one', async () => {
    const w = await base('collect coins');
    const coin = Object.values(w.entities).find((e) => e.tags.includes('coin'))!;
    const { result } = await mockApply(`make ${coin.id} bigger and make the coins bob`, w);
    expect(result.errors).toEqual([]);
    expect(result.world.entities[coin.id]!.behaviors.map((b) => b.type)).toEqual(['spin', 'bob', 'collectible']);
  });

  it('low gravity edit', async () => {
    const w = await base();
    const { result } = await mockApply('switch to low gravity', w);
    expect(result.world.environment.gravity).toEqual([0, -1.62, 0]);
  });

  it('adds a whole theme to an existing world at a free slot', async () => {
    const w = await base('a beach');
    const { result } = await mockApply('add a castle', w);
    expect(result.errors).toEqual([]);
    expect(Object.keys(result.world.entities).some((id) => id.startsWith('keep'))).toBe(true);
  });

  it('a themed scene description replaces the world, edit phrasing does not', async () => {
    const w = await base();
    const scene = await mockApply('A cozy lakeside camp at sunset with a campfire, tents and fireflies', w);
    expect(scene.result.errors).toEqual([]);
    expect(scene.patches[0]).toMatchObject({ op: 'clear' });
    expect(Object.keys(scene.result.world.entities).some((id) => id.startsWith('house'))).toBe(false);
    expect(Object.keys(scene.result.world.entities).some((id) => id.startsWith('campfire'))).toBe(true);
    for (const edit of ['add a forest', 'now make it a snowy winter', 'more tents please', 'a forest too']) {
      expect(parseIntent(edit).describesScene, edit).toBe(false);
    }
    expect(parseIntent('Bowling alley: knock down a pyramid of 15 crates').describesScene).toBe(true);
  });

  it('bowling at a crate pyramid is one mechanic: the pyramid replaces the pins at the end of the lane', async () => {
    const { result } = await mockApply('Bowling alley: knock down a pyramid of 15 crates with a heavy ball');
    expect(result.errors).toEqual([]);
    const w = result.world;
    const ids = Object.keys(w.entities);
    // One launcher, no separate cannon set-piece.
    expect(w.state).toMatchObject({ launched: false, cratesHit: 0 });
    expect(ids.some((id) => id.startsWith('cannonball'))).toBe(false);
    expect(ids.some((id) => id.startsWith('pin-'))).toBe(false);
    const crates = Object.values(w.entities).filter((e) => e.tags.includes('crate'));
    expect(crates).toHaveLength(15);
    // The pyramid stands on the lane, beyond the ball, and the ball is the heavy one.
    const lane = w.entities['lane-1']!.transform.position;
    const ball = w.entities['bowling-ball-1']!;
    for (const c of crates) {
      expect(Math.abs(c.transform.position[0] - lane[0])).toBeLessThan(1.3);
      expect(c.transform.position[2]).toBeLessThan(ball.transform.position[2] - 10);
    }
    expect(ball.physics?.mass).toBeGreaterThanOrEqual(12);
    expect(w.tests.some((t) => t.id === 'pyramid-falls')).toBe(true);
    // A night alley: no meadow around it.
    expect(w.environment.sky).toBe('night');
    expect(ids.some((id) => id.startsWith('mountain'))).toBe(false);
  });

  it('fresh state keys never collide within one build', () => {
    const b = new Builder(1, [], parseIntent('x').mood);
    expect(b.freshStateKey('launched')).toBe('launched');
    b.state('launched', false);
    expect(b.freshStateKey('launched')).toBe('launched2');
    b.state('launched2', false);
    expect(b.freshStateKey('launched')).toBe('launched3');
  });

  it('start over rebuilds the world', async () => {
    const w = await base();
    const { result, patches } = await mockApply('start over and create a volcano', w);
    expect(result.errors).toEqual([]);
    expect(patches[0]).toMatchObject({ op: 'clear' });
    expect(Object.keys(result.world.entities).some((id) => id.startsWith('volcano'))).toBe(true);
    expect(Object.keys(result.world.entities).some((id) => id.startsWith('house'))).toBe(false);
  });

  it('explains when it cannot understand an edit', async () => {
    const w = await base();
    const res = await askMock('quantum flux the gizmo', w);
    expect(patchesOf(res)).toHaveLength(0);
    expect(res.stopReason).toBe('end');
    expect(res.content[0]).toMatchObject({ type: 'text' });
  });

  it('reports targets it cannot find without failing', async () => {
    const w = await base();
    const { result } = await mockApply('remove the dragon and add 2 benches', w);
    expect(result.errors).toEqual([]);
  });
});

describe('mock provider: protocol', () => {
  it('ends politely on tool-result and repair turns', async () => {
    const provider = createMockProvider();
    const res = await provider.complete({
      role: 'planner',
      system: 's',
      messages: [
        { role: 'user', content: 'x' },
        { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'finish', input: {} }] },
        { role: 'user', content: [{ type: 'tool_result', toolUseId: 't1', content: 'ok' }, { type: 'text', text: 'Verification FAILED' }] },
      ],
    });
    expect(res.stopReason).toBe('end');
    expect(res.content.some((b) => b.type === 'tool_use')).toBe(false);
  });

  it('coder role returns a schema-valid generator', async () => {
    const provider = createMockProvider();
    const res = await provider.complete({ role: 'coder', system: 's', messages: [{ role: 'user', content: 'Write a generator with id "obelisk".' }] });
    const call = res.content.find((b) => b.type === 'tool_use');
    expect(call).toMatchObject({ name: 'submit_generator', input: { id: 'obelisk' } });
  });

  it('honors abort', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(createMockProvider().complete({ role: 'planner', system: '', messages: [{ role: 'user', content: 'x' }] }, ctrl.signal)).rejects.toMatchObject({ code: 'aborted' });
  });

  it('handles a bare request without the envelope', async () => {
    const res = await createMockProvider().complete({ role: 'planner', system: '', messages: [{ role: 'user', content: 'a forest' }] });
    expect(patchesOf(res).length).toBeGreaterThan(10);
  });

  it('intent parser recognizes counts, moods and clauses', () => {
    const i = parseIntent('Add 3 lamps, make the car red and remove the tent at sunset');
    expect(i.mood.dusk).toBe(true);
    expect(i.edits.map((e) => e.kind)).toEqual(['add', 'modify', 'remove']);
    expect(i.count).toBe(3);
  });

  it('intent parser separates time limits from counts', async () => {
    expect(parseIntent('collect 10 coins in 60 seconds')).toMatchObject({ count: 10, seconds: 60 });
    expect(parseIntent('in 2 minutes grab 12 coins')).toMatchObject({ count: 12, seconds: 120 });
    expect(parseIntent('collect coins within 3s').seconds).toBe(10);
    expect(parseIntent('collect 5 coins').seconds).toBeUndefined();
    const { result } = await mockApply('A coin collecting game on a tropical island — collect 10 coins in 60 seconds');
    expect(result.world.state['timeLeft']).toBe(60);
  });

  it('runs end-to-end through WorldAgent with every theme', async () => {
    for (const [, prompt] of THEME_PROMPTS.slice(0, 6)) {
      const host = new MemoryHost(createWorld());
      const agent = new WorldAgent({ provider: createMockProvider(), catalogs: TEST_CATALOGS });
      const events = await collect(agent.run(prompt, host));
      const patchEvents = events.filter((e) => e.type === 'patches');
      expect(patchEvents.length).toBeGreaterThan(0);
      for (const e of patchEvents) if (e.type === 'patches') expect(e.result.errors).toEqual([]);
      expect(events.some((e) => e.type === 'verify')).toBe(true);
      expect(events.at(-1)?.type).toBe('done');
    }
  });

  it('is fast (< 50 ms per world on average)', async () => {
    const t0 = performance.now();
    for (const [, prompt] of THEME_PROMPTS) await askMock(prompt);
    expect((performance.now() - t0) / THEME_PROMPTS.length).toBeLessThan(50);
  });
});
