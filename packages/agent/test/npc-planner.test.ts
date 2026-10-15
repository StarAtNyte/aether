import { describe, expect, it } from 'vitest';
import { applyPatches, summarizeWorld, type Entity, type WorldDoc } from '@aether/core';
import { LogicRuntime, analyzeNpcs, type LogicHost } from '@aether/logic';
import { mockApply } from './helpers';
import { planMock } from '../src/providers/mock/planner';
import { parseTraits, resolveNpcTargets } from '../src/providers/mock/npc';
import { parseWorldSummary } from '../src/providers/mock/world-view';

const npcs = (w: WorldDoc): Entity[] => Object.values(w.entities).filter((e) => e.npc);
const byRole = (w: WorldDoc, role: string): Entity[] => npcs(w).filter((e) => e.npc?.role === role);

async function make(prompt: string, base?: WorldDoc): Promise<WorldDoc> {
  const { result } = await mockApply(prompt, base);
  expect(result.errors).toEqual([]);
  return result.world;
}

describe('trait parsing', () => {
  it('reads the three headline requests', () => {
    const guard = parseTraits('guard who patrols the gate and chases me when he sees me');
    expect(guard).toMatchObject({ patrol: true, chase: true });
    expect(guard.place).toBe('the gate');
    const shop = parseTraits('shopkeeper who greets me and sells a key');
    expect(shop.greets).toBe(true);
    expect(shop.sells).toEqual({ item: 'key', price: undefined });
    const wolves = parseTraits('wolf pack that hunts at night');
    expect(wolves).toMatchObject({ hunts: true, night: true });
  });

  it('reads prices, fears, followers and props', () => {
    expect(parseTraits('merchant sells a rusty sword for 12 coins').sells).toEqual({ item: 'rusty-sword', price: 12 });
    expect(parseTraits('wolves afraid of fire and water').fears).toEqual(['fire', 'water']);
    expect(parseTraits('a dog that follows me').follows).toBe(true);
    expect(parseTraits('a knight with a sword and shield').props).toEqual(['sword', 'shield']);
    expect(parseTraits('a guard named Bram').name).toBe('Bram');
  });
});

describe('creating characters from language', () => {
  it('"a guard who patrols the gate and chases me when he sees me"', async () => {
    const w = await make('add a guard who patrols the gate and chases me when he sees me');
    const [guard] = byRole(w, 'guard');
    expect(guard?.npc).toMatchObject({ archetype: 'guard', faction: 'watch' });
    expect(guard?.npc?.waypoints.length).toBeGreaterThanOrEqual(2);
    expect(guard?.npc?.attack?.damage).toBeGreaterThan(0);
    expect(guard?.physics?.body).toBe('kinematic');
    expect(guard?.tags).toContain('npc');
    // A gate was built for it, and the patrol runs in front of it.
    const gate = Object.values(w.entities).find((e) => e.tags.includes('gate'));
    expect(gate).toBeDefined();
    expect(w.state['health']).toBe(100);
    expect(w.hud.some((h) => h.key === 'health')).toBe(true);
    expect(w.tests.some((t) => t.kind === 'npcs')).toBe(true);
  });

  it('the guard it builds passes the static NPC checks (reachable patrol, nothing blocked)', async () => {
    const w = await make('add a guard who patrols the gate and chases me when he sees me');
    const a = analyzeNpcs(w);
    expect(a.errors).toEqual([]);
    expect(a.npcs).toBe(1);
  });

  it('"a shopkeeper who greets me and sells a key" builds a stall, a dialogue, coins to pay with', async () => {
    const w = await make('a shopkeeper who greets me and sells a key');
    const [shop] = byRole(w, 'shopkeeper');
    expect(shop?.npc?.archetype).toBe('merchant');
    const start = shop?.npc?.dialogue?.nodes['start'];
    expect(start?.text).toMatch(/Welcome/);
    expect(start?.choices.some((c) => /key/.test(c.text))).toBe(true);
    expect(w.state['coins']).toBe(0);
    expect(w.state['key']).toBe(0);
    expect(Object.values(w.entities).filter((e) => e.tags.includes('coin')).length).toBeGreaterThanOrEqual(3);
    expect(Object.values(w.entities).some((e) => e.tags.includes('stall'))).toBe(true);
    expect(analyzeNpcs(w).errors).toEqual([]);
  });

  it('"a wolf pack that hunts at night" makes a pack, night, a fire to flee to', async () => {
    const w = await make('a wolf pack that hunts at night');
    const wolves = byRole(w, 'wolf');
    expect(wolves.length).toBeGreaterThanOrEqual(3);
    for (const wolf of wolves) {
      expect(wolf.npc).toMatchObject({ archetype: 'predator', faction: 'wolves', activeHours: [19, 6] });
      expect(wolf.npc?.fears).toContain('fire');
    }
    expect(w.environment.sky).toBe('night');
    expect(Object.values(w.entities).some((e) => e.tags.includes('fire'))).toBe(true);
    expect(analyzeNpcs(w).errors).toEqual([]);
  });

  it('works offline end-to-end: every prompt yields a valid, summarizable world', async () => {
    for (const p of ['a guard who patrols the gate', 'three villagers', 'a bandit camp with two bandits', 'a deer herd that runs from wolves', 'a friendly companion dog that follows me']) {
      const w = await make(p);
      expect(npcs(w).length).toBeGreaterThan(0);
      expect(summarizeWorld(w)).toContain('npc "');
    }
  });

  it('adds to an existing world without disturbing it', async () => {
    const base = await make('a meadow');
    const before = Object.keys(base.entities).length;
    const w = await make('add a guard who patrols near the campfire', base);
    expect(Object.keys(w.entities).length).toBeGreaterThan(before);
    for (const id of Object.keys(base.entities)) expect(w.entities[id]).toBeDefined();
    expect(byRole(w, 'guard')).toHaveLength(1);
  });

  it('counts and names: "two guards", "a guard named Bram"', async () => {
    const w = await make('add two guards named Bram');
    expect(byRole(w, 'guard').length).toBe(2);
    const w2 = await make('add a guard named Bram');
    expect(byRole(w2, 'guard')[0]?.name).toBe('Bram');
  });

  it('characters named inside a scene description are placed with the scene', async () => {
    const castle = await make('a medieval castle with two guards');
    expect(byRole(castle, 'guard')).toHaveLength(2);
    expect(Object.keys(castle.entities).length).toBeGreaterThan(20); // the castle itself was built too
    expect(castle.tests.some((t) => t.kind === 'npcs')).toBe(true);
    expect(analyzeNpcs(castle).errors).toEqual([]);
    const camp = await make('a bandit camp with three bandits'); // "bandit camp" is a place, not a fourth bandit
    expect(byRole(camp, 'bandit')).toHaveLength(3);
  });

  it('several kinds in one request', async () => {
    const w = await make('a guard at the gate and a shopkeeper who sells a lantern and some villagers');
    expect(byRole(w, 'guard').length).toBe(1);
    expect(byRole(w, 'shopkeeper').length).toBe(1);
    expect(byRole(w, 'villager').length).toBeGreaterThanOrEqual(2);
    expect(w.state['lantern']).toBe(0);
  });

  it('is deterministic', async () => {
    const a = await make('a wolf pack that hunts at night');
    const b = await make('a wolf pack that hunts at night');
    expect(b).toEqual(a);
  });
});

describe('editing characters with minimal patches', () => {
  async function village(): Promise<WorldDoc> {
    return make('a guard who patrols the gate and chases me when he sees me and a wolf pack and a shopkeeper who sells a key');
  }

  it('"make the guard faster" changes only speeds', async () => {
    const w = await village();
    const [guard] = byRole(w, 'guard');
    const { patches, result } = await mockApply('make the guard faster', w);
    expect(result.errors).toEqual([]);
    expect(patches).toHaveLength(1);
    expect(patches[0]).toMatchObject({ op: 'update', id: guard?.id });
    const set = (patches[0] as { set: { npc: Record<string, unknown> } }).set.npc;
    expect(Object.keys(set).sort()).toEqual(['runSpeed', 'speed']);
    const after = result.world.entities[guard?.id ?? ''];
    expect(after?.npc?.speed).toBeGreaterThan(guard?.npc?.speed ?? 0);
    expect(after?.npc?.waypoints).toEqual(guard?.npc?.waypoints);
  });

  it('"give him a torch" adds a flame child with a light and records it', async () => {
    const w = await village();
    const [guard] = byRole(w, 'guard');
    const after = await make('give the guard a torch', w);
    const g = after.entities[guard?.id ?? ''];
    expect(g?.npc?.carries).toContain('torch');
    const flame = Object.values(after.entities).find((e) => e.tags.includes('fire') && !w.entities[e.id]);
    expect(flame).toBeDefined();
    const torch = Object.values(after.entities).find((e) => e.parent === guard?.id && e.tags.includes('torch'));
    expect(torch).toBeDefined();
    expect(Object.values(after.entities).some((e) => e.light && !w.entities[e.id])).toBe(true);
  });

  it('"make the wolves afraid of fire" updates every wolf (and lights a fire when there is none)', async () => {
    let w = await make('a wolf pack that hunts at night');
    // Strip the fear and the fire to mimic a world built another way.
    const strip = Object.values(w.entities).filter((e) => e.npc).map((e) => ({ op: 'update' as const, id: e.id, set: { npc: { fears: [] } } }));
    w = applyPatches(w, [...strip, ...Object.values(w.entities).filter((e) => e.tags.includes('fire')).map((e) => ({ op: 'remove' as const, id: e.id }))]).world;
    expect(byRole(w, 'wolf').every((e) => e.npc?.fears.length === 0)).toBe(true);
    const after = await make('make the wolves afraid of fire', w);
    const wolves = byRole(after, 'wolf');
    expect(wolves.length).toBe(byRole(w, 'wolf').length);
    for (const wolf of wolves) expect(wolf.npc?.fears).toEqual(['fire']);
    expect(Object.values(after.entities).some((e) => e.tags.includes('fire'))).toBe(true);
  });

  it('says so when the characters already have what was asked', async () => {
    const w = await make('a wolf pack that hunts at night');
    const res = planMock('make the wolves afraid of fire', summarizeWorld(w));
    expect(res.patches).toHaveLength(0);
    expect(res.message).toMatch(/already fears fire/);
  });

  it('pronouns in one request carry the subject: "make the guard faster and give him a torch"', async () => {
    const w = await village();
    const [guard] = byRole(w, 'guard');
    const after = await make('make the guard faster and give him a torch', w);
    expect(after.entities[guard?.id ?? '']?.npc?.speed).toBeGreaterThan(guard?.npc?.speed ?? 0);
    expect(after.entities[guard?.id ?? '']?.npc?.carries).toContain('torch');
  });

  it('addresses characters by name, role, faction and archetype', async () => {
    const w = await make('add a guard named Bram and a villager named Ada');
    const view = parseWorldSummary(summarizeWorld(w));
    expect(resolveNpcTargets(view, 'make Bram slower', []).map((e) => e.name)).toEqual(['Bram']);
    expect(resolveNpcTargets(view, 'the villager', []).map((e) => e.name)).toEqual(['Ada']);
    expect(resolveNpcTargets(view, 'the watch', []).map((e) => e.name)).toEqual(['Bram']);
    const after = await make('make Ada friendly and tougher', w);
    const ada = Object.values(after.entities).find((e) => e.name === 'Ada');
    expect(ada?.npc?.health).toBe(120);
    expect(ada?.npc?.allies).toContain('player');
  });

  it('friendly / hostile flips relations', async () => {
    const w = await village();
    const friendly = await make('make the guard friendly', w);
    expect(byRole(friendly, 'guard')[0]?.npc?.allies).toContain('player');
    expect(summarizeWorld(friendly)).not.toMatch(/guard[^\n]*foes=player/);
    const hostile = await make('make the shopkeeper hostile', w);
    expect(byRole(hostile, 'shopkeeper')[0]?.npc?.enemies).toContain('player');
  });

  it('patrol, stand still, follow me and night-only', async () => {
    const w = await village();
    const p = await make('make the guard patrol the gate', w);
    expect(byRole(p, 'guard')[0]?.npc?.waypoints.length).toBeGreaterThan(1);
    const stand = await make('make the guard stand still', p);
    expect(byRole(stand, 'guard')[0]?.npc?.waypoints).toEqual([]);
    const follow = await make('make the shopkeeper follow me', w);
    expect(byRole(follow, 'shopkeeper')[0]?.npc?.follow).toBe(true);
    const night = await make('make the guard only active at night', w);
    expect(byRole(night, 'guard')[0]?.npc?.activeHours).toEqual([19, 6]);
    const always = await make('make the wolves active all day', w);
    expect(byRole(always, 'wolf').every((e) => e.npc?.activeHours === undefined)).toBe(true);
  });

  it('senses: sees farther, hears better, tougher, stronger', async () => {
    const w = await village();
    const [guard] = byRole(w, 'guard');
    const after = await make('make the guard see farther and hear better and hit harder', w);
    const g = after.entities[guard?.id ?? ''];
    expect(g?.npc?.perception.sight).toBeGreaterThan(guard?.npc?.perception.sight ?? 99);
    expect(g?.npc?.perception.hearing).toBeGreaterThan(guard?.npc?.perception.hearing ?? 99);
    expect(g?.npc?.attack?.damage).toBeGreaterThan(guard?.npc?.attack?.damage ?? 99);
  });

  it('changes the shop: "make the shopkeeper sell a map for 8 coins"', async () => {
    const w = await village();
    const after = await make('make the shopkeeper sell a map for 8 coins', w);
    const shop = byRole(after, 'shopkeeper')[0];
    expect(shop?.npc?.dialogue?.nodes['start']?.choices[0]?.text).toMatch(/map \(8 coins\)/);
    expect(after.state['map']).toBe(0);
  });

  it('renames and gives a line', async () => {
    const w = await village();
    const after = await make('call the guard Rook and make him say "Not one step further"', w);
    const g = Object.values(after.entities).find((e) => e.name === 'Rook');
    expect(g?.npc?.role).toBe('guard');
    expect(g?.npc?.dialogue?.nodes['start']?.text).toBe('Not one step further');
  });

  it('asks which character when it is ambiguous, and leaves the world alone', async () => {
    const w = await make('three villagers');
    const res = planMock('make him faster', summarizeWorld(w));
    expect(res.patches).toHaveLength(0);
    expect(res.message).toMatch(/which character/);
  });

  it('refuses nothing it should do: locked characters are left alone', async () => {
    const w = await village();
    const [guard] = byRole(w, 'guard');
    const locked = applyPatches(w, [{ op: 'update', id: guard?.id ?? '', set: { locked: true } }]).world;
    const res = planMock('make the guard faster', summarizeWorld(locked));
    expect(res.patches).toHaveLength(0);
  });

  it('generic edits and removal reach characters by role', async () => {
    const w = await village();
    const [guard] = byRole(w, 'guard');
    const gone = await make('remove the guard', w);
    expect(gone.entities[guard?.id ?? '']).toBeUndefined();
    const bigger = await make('make the wolves bigger', w);
    const wolf = byRole(bigger, 'wolf')[0];
    expect(wolf?.transform.scale[0]).toBeGreaterThan(1);
  });
});

describe('free conversation is a one-line prompt away', () => {
  it('"a shopkeeper who sells a key and chats freely" gets a persona, facts and the authored fallback', async () => {
    const w = await make('a shopkeeper who sells a key and chats freely about anything');
    const shop = byRole(w, 'shopkeeper')[0];
    expect(shop?.npc?.chat?.persona).toMatch(/You are .*shopkeeper/);
    expect(shop?.npc?.chat?.facts.some((f) => /key costs 5 coins/.test(f))).toBe(true);
    expect(shop?.npc?.dialogue?.nodes['start']).toBeDefined(); // the offline fallback
    expect(summarizeWorld(w)).toMatch(/shopkeeper[^\n]* chat/);
  });

  it('can be switched on and off by chat edits', async () => {
    const w = await make('a guard who patrols the gate');
    expect(byRole(w, 'guard')[0]?.npc?.chat).toBeUndefined();
    const on = await make('let the guard talk freely', w);
    expect(byRole(on, 'guard')[0]?.npc?.chat?.persona).toMatch(/stern/);
    const off = await make('stop the guard chatting freely', on);
    expect(byRole(off, 'guard')[0]?.npc?.chat).toBeUndefined();
    expect(byRole(off, 'guard')[0]?.npc?.dialogue).toBeDefined();
  });
});

describe('the sale opens the gate it was built for', () => {
  it('buying the key sets the gate flag and the door slides open', async () => {
    const w = await make('a guard who patrols the gate and a shopkeeper who greets me and sells a key');
    const door = Object.values(w.entities).find((e) => e.tags.includes('door') && e.behaviors.some((b) => b.type === 'door'));
    expect(door).toBeDefined();
    const shop = byRole(w, 'shopkeeper')[0] as Entity;
    const play = (coins: number) => {
      const host = new FlatHost();
      host.place('avatar', [shop.transform.position[0], 0, shop.transform.position[2] + 2.2]);
      const rt = new LogicRuntime(applyPatches(w, [{ op: 'setState', key: 'coins', value: coins }]).world, host);
      const input = { forward: 0, right: 0, jump: false, action: false, keys: new Set<string>(), pointerYawDeg: 0 };
      const idle = (n: number): void => {
        for (let i = 0; i < n; i++) rt.tick(1 / 60, input, []);
      };
      const tap = (key: string): void => {
        rt.tick(1 / 60, { ...input, keys: new Set([key]) }, []);
        rt.tick(1 / 60, input, []);
      };
      idle(30);
      return { rt, idle, tap };
    };
    // Too poor: the purchase is not offered.
    const poor = play(0);
    poor.tap('e');
    expect(poor.rt.npcs.dialogue?.choices.some((c) => /^buy/i.test(c))).toBe(false);
    // Rich: it is, and taking it opens the gate.
    const rich = play(10);
    expect(rich.rt.readState(`${door?.id}.open`)).toBe(false);
    rich.tap('e');
    const buy = rich.rt.npcs.dialogue?.choices.findIndex((c) => /^buy/i.test(c)) ?? -1;
    expect(buy).toBeGreaterThanOrEqual(0);
    rich.rt.npcs.choose(buy);
    expect(rich.rt.readState('key')).toBe(1);
    expect(rich.rt.readState('coins')).toBe(5);
    rich.idle(120);
    expect(rich.rt.readState(`${door?.id}.open`)).toBe(true);
  });
});

describe('verification of planner output', () => {
  it('runs headless: the guard patrols without sticking', async () => {
    const w = await make('a guard who patrols the gate');
    const host = new FlatHost();
    const rt = new LogicRuntime(w, host);
    for (let i = 0; i < 60 * 20; i++) rt.tick(1 / 60, { forward: 0, right: 0, jump: false, action: false, keys: new Set(), pointerYawDeg: 0 }, []);
    const guard = byRole(w, 'guard')[0];
    expect(rt.readState(`${guard?.id}.npcLegs`)).toBeGreaterThanOrEqual(1);
    expect(Number(rt.readState(`${guard?.id}.npcStuck`) ?? 0)).toBeLessThan(2);
  });
});

/** A host without a player: enough for patrols. */
class FlatHost implements LogicHost {
  private readonly poses = new Map<string, { position: [number, number, number]; quaternion: [number, number, number, number] }>();
  private player: string | undefined;
  place(id: string, position: [number, number, number]): void {
    this.poses.set(id, { position, quaternion: [0, 0, 0, 1] });
    this.player = id;
  }
  getTransform(id: string) {
    return this.poses.get(id);
  }
  setKinematic(id: string, position: [number, number, number], quaternion: [number, number, number, number]): void {
    this.poses.set(id, { position: [...position], quaternion: [...quaternion] });
  }
  applyImpulse(): void {}
  setVelocity(): void {}
  getVelocity() {
    return undefined;
  }
  teleport(): void {}
  explode(): void {}
  setGravity(): void {}
  spawn(): void {}
  destroy(): void {}
  setProperty(): void {}
  message(): void {}
  sound(): void {}
  gameOver(): void {}
  reset(): void {}
  playerId() {
    return this.player;
  }
}
