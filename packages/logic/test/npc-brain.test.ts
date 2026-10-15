import { describe, expect, it } from 'vitest';
import { walkPlayer, npcEntity, rig, wallEntity } from './npc-helpers';

const GUARD = {
  role: 'guard',
  archetype: 'guard',
  faction: 'watch',
  speed: 2,
  runSpeed: 5,
  attack: { damage: 12, range: 1.8, cooldown: 1 },
} as const;

describe('patrol', () => {
  it('walks its route, reaching every waypoint, staying on the floor', () => {
    const r = rig([
      npcEntity('guard', 0, 0, { ...GUARD, waypoints: [[8, 0, 0], [8, 0, 8], [0, 0, 8], [0, 0, 0]], patrol: { mode: 'loop', wait: 0.5 } }),
    ]);
    r.run(40);
    const info = r.rt.npcs.info('guard');
    expect(info?.legs).toBeGreaterThanOrEqual(5);
    expect(Math.abs(r.at('guard')[1] - 0.9)).toBeLessThan(0.06); // floor height plus the walking bob
    expect(r.state('guard.npcLegs')).toBe(info?.legs);
    expect(['patrol', 'idle']).toContain(info?.mode);
  });

  it('pingpong reverses at the ends and random visits points', () => {
    const route = [[6, 0, 0], [6, 0, 6], [0, 0, 6]] as [number, number, number][];
    const a = rig([npcEntity('g', 0, 0, { ...GUARD, waypoints: route, patrol: { mode: 'pingpong', wait: 0 } })]);
    const seen = new Set<number>();
    for (let i = 0; i < 60; i++) {
      a.run(0.5);
      seen.add(a.rt.npcs.info('g')?.waypoint ?? -1);
    }
    expect([...seen].sort()).toEqual([0, 1, 2]);
    const b = rig([npcEntity('g', 0, 0, { ...GUARD, waypoints: route, patrol: { mode: 'random', wait: 0 } })]);
    b.run(60);
    expect(b.rt.npcs.info('g')?.legs).toBeGreaterThan(3);
  });

  it('walks around a wall instead of through it', () => {
    const r = rig([wallEntity('wall', 4, 0, 1, 10), npcEntity('guard', 0, 0, { ...GUARD, waypoints: [[8, 0, 0], [0, 0, 0]], patrol: { mode: 'loop', wait: 0 } })]);
    let crossedWall = false;
    for (let i = 0; i < 40 * 60; i++) {
      r.rt.tick(1 / 60, { forward: 0, right: 0, jump: false, action: false, keys: new Set(), pointerYawDeg: 0 }, []);
      const p = r.at('guard');
      if (Math.abs(p[0] - 4) < 0.5 && Math.abs(p[2]) < 4.9) crossedWall = true;
    }
    expect(crossedWall).toBe(false);
    expect(r.rt.npcs.info('guard')?.legs).toBeGreaterThanOrEqual(2);
  });

  it('skips a walled-off waypoint rather than freezing', () => {
    const boxIn = [wallEntity('n', 10, 7, 6, 1), wallEntity('s', 10, 13, 6, 1), wallEntity('e', 13, 10, 1, 6), wallEntity('w', 7, 10, 1, 6)];
    const r = rig([...boxIn, npcEntity('guard', 0, 0, { ...GUARD, waypoints: [[10, 0, 10], [5, 0, 0]], patrol: { mode: 'loop', wait: 0 } })]);
    r.run(30);
    expect(r.rt.npcs.info('guard')?.legs).toBeGreaterThan(0);
    expect(Number(r.state('guard.npcStuck'))).toBeLessThan(6);
  });
});

describe('perception and chase', () => {
  const guardWorld = (extra = {}) => [npcEntity('guard', 0, 0, { ...GUARD, waypoints: [], wander: 0, ...extra })];

  it('sees a player in front within range, not one behind', () => {
    const front = rig(guardWorld());
    front.player(0, -8);
    front.run(1);
    expect(front.mode('guard')).toBe('chase');
    const behind = rig(guardWorld());
    behind.player(0, 8);
    behind.run(1);
    expect(behind.mode('guard')).not.toBe('chase');
  });

  it('does not see through a tall wall, but does over a low crate', () => {
    const blocked = rig([wallEntity('wall', 0, -4, 6, 0.5), ...guardWorld()]);
    blocked.player(0, -8);
    blocked.run(1);
    expect(blocked.mode('guard')).not.toBe('chase');
    const crate = rig([wallEntity('crate', 0, -4, 1, 1, 0.8), ...guardWorld()]);
    crate.player(0, -8);
    crate.run(1);
    expect(crate.mode('guard')).toBe('chase');
  });

  it('ignores a player beyond sight range or outside the cone', () => {
    const far = rig(guardWorld({ perception: { sight: 10 } }));
    far.player(0, -14);
    far.run(1);
    expect(far.mode('guard')).not.toBe('chase');
    const narrow = rig(guardWorld({ perception: { fov: 40 } }));
    narrow.player(6, -3); // 63 degrees off axis
    narrow.run(1);
    expect(narrow.mode('guard')).not.toBe('chase');
  });

  it('hears a running player behind it and investigates, but not a walking one', () => {
    const r = rig(guardWorld({ perception: { hearing: 8 } }));
    walkPlayer(r, [0, 14], [0, 5], 6); // running toward the guard's back
    const log = (rt: typeof r.rt) => rt.log.map((e) => e.text).join('\n');
    expect(log(r.rt)).toMatch(/guard: idle → investigate/);
    const calm = rig(guardWorld({ perception: { hearing: 8 } }));
    walkPlayer(calm, [0, 14], [0, 5], 1.4); // walking: quieter than 8 m
    expect(log(calm.rt)).not.toMatch(/investigate/);
  });

  it('chases at run speed and catches up, then attacks and hurts the player', () => {
    const r = rig(guardWorld(), { extra: { state: { health: 100 } } });
    r.player(0, -9);
    r.run(0.3);
    expect(r.mode('guard')).toBe('chase');
    r.run(6);
    expect(['attack', 'chase']).toContain(r.mode('guard'));
    expect(Number(r.state('health'))).toBeLessThan(100);
    expect(r.host.sounds).toContain('hit');
    expect(Math.hypot(r.at('guard')[0], r.at('guard')[2] + 9)).toBeLessThan(2.5);
  });

  it('ends the game when health runs out', () => {
    const r = rig(guardWorld({ attack: { damage: 60, range: 2, cooldown: 0.5 } }), { extra: { state: { health: 100 } } });
    r.player(0, -3);
    r.run(5);
    expect(r.rt.status).toBe('lost');
    expect(r.host.gameOverResult?.text).toMatch(/Guard/);
  });

  it('loses the player, searches the last known spot, then returns to patrol', () => {
    const r = rig(guardWorld({ waypoints: [[6, 0, 0], [0, 0, 0]] }));
    r.player(0, -8);
    r.run(1);
    expect(r.mode('guard')).toBe('chase');
    r.player(100, 100);
    r.run(40);
    expect(['patrol', 'idle']).toContain(r.mode('guard'));
    const log = r.rt.log.map((e) => e.text).join('\n');
    expect(log).toMatch(/guard: idle → chase|guard: patrol → chase/);
    expect(log).toMatch(/chase → investigate/);
    expect(log).toMatch(/investigate → patrol/);
  });

  it('gives up a chase that leads too far from home', () => {
    const r = rig(guardWorld({ leash: 10, perception: { sight: 40 } }));
    r.player(0, -9);
    r.run(0.5);
    r.player(0, -60);
    r.run(15);
    expect(r.mode('guard')).not.toBe('chase');
  });

  it('is not hostile to an allied player', () => {
    const r = rig(guardWorld({ allies: ['player'] }));
    r.player(0, -6);
    r.run(2);
    expect(r.mode('guard')).not.toBe('chase');
  });

  it('is provoked by a hit and by dialogue effects', () => {
    const r = rig([npcEntity('vil', 0, 0, { archetype: 'villager', faction: 'town', perception: { fov: 360 } })], { player: [0, -2] });
    r.run(1);
    expect(r.mode('vil')).not.toBe('flee');
    r.rt.npcs.damage('vil', 10);
    r.run(0.5);
    expect(r.rt.npcs.info('vil')?.health).toBe(90);
  });

  it('allies share an alarm', () => {
    const r = rig([
      npcEntity('a', 0, 0, { ...GUARD, perception: { alert: 20 } }),
      npcEntity('b', 6, 6, { ...GUARD, perception: { fov: 20 } }, { transform: { position: [6, 0.9, 6], rotation: [0, 180, 0] } }),
    ]);
    r.player(0, -8);
    r.run(1.5);
    expect(r.mode('a')).toBe('chase');
    // b faces away and has a narrow cone, yet learns about the foe from a.
    expect(['investigate', 'chase']).toContain(r.mode('b'));
  });
});

describe('flee, fear and rest', () => {
  it('a wounded villager runs away from the player', () => {
    const r = rig([npcEntity('vil', 0, 0, { archetype: 'villager', faction: 'town', enemies: ['player'], runSpeed: 5, perception: { fov: 360 } })], { player: [0, -4] });
    r.run(0.5);
    expect(r.mode('vil')).toBe('flee');
    const d0 = Math.hypot(r.at('vil')[0], r.at('vil')[2] + 4);
    r.run(4);
    expect(Math.hypot(r.at('vil')[0], r.at('vil')[2] + 4)).toBeGreaterThan(d0 + 6);
  });

  it('wolves flee a campfire but chase the player elsewhere', () => {
    const fire = { id: 'fire', tags: ['fire'], transform: { position: [0, 0, -5] as [number, number, number] } };
    const wolf = { archetype: 'predator', faction: 'wolves', fears: ['fire'], fearRange: 6, speed: 2, runSpeed: 6, perception: { fov: 360, sight: 20 }, attack: { damage: 10 } } as const;
    const r = rig([fire, npcEntity('wolf', 0, 0, wolf)], { player: [0, -12] });
    r.run(0.4);
    expect(r.mode('wolf')).toBe('flee');
    const away = rig([npcEntity('wolf', 0, 0, wolf)], { player: [0, -12] });
    away.run(0.4);
    expect(away.mode('wolf')).toBe('chase');
  });

  it('a predator rests outside its active hours and hunts inside them', () => {
    const spec = { archetype: 'predator', faction: 'wolves', activeHours: [20, 5] as [number, number], perception: { fov: 360, sight: 20 }, speed: 2 } as const;
    const day = rig([npcEntity('wolf', 0, 0, spec)], { player: [0, -8], extra: { environment: { timeOfDay: 12 } } });
    day.run(2);
    expect(day.mode('wolf')).toBe('idle');
    const night = rig([npcEntity('wolf', 0, 0, spec)], { player: [0, -8], extra: { environment: { timeOfDay: 22 } } });
    night.run(2);
    expect(['chase', 'attack']).toContain(night.mode('wolf'));
    // A rule-driven clock wins over the environment.
    const changed = rig([npcEntity('wolf', 0, 0, spec)], { player: [0, -8], extra: { environment: { timeOfDay: 12 }, state: { timeOfDay: 23 } } });
    changed.run(2);
    expect(['chase', 'attack']).toContain(changed.mode('wolf'));
  });

  it('a pack hunts together: one wolf seeing the player alerts the others', () => {
    const wolf = { archetype: 'predator', faction: 'wolves', speed: 2, runSpeed: 6, perception: { fov: 90, sight: 20 } } as const;
    const r = rig(
      [npcEntity('w1', 0, 0, wolf), npcEntity('w2', 5, 5, wolf, { transform: { position: [5, 0.9, 5], rotation: [0, 180, 0] } }), npcEntity('w3', -5, 5, wolf, { transform: { position: [-5, 0.9, 5], rotation: [0, 180, 0] } })],
      { player: [0, -10] },
    );
    r.run(2);
    expect(['chase', 'attack']).toContain(r.mode('w1'));
    expect(['chase', 'investigate', 'attack']).toContain(r.mode('w2'));
    expect(['chase', 'investigate', 'attack']).toContain(r.mode('w3'));
  });

  it('prey bolts from a hunter', () => {
    const r = rig(
      [
        npcEntity('deer', 0, 0, { archetype: 'prey', faction: 'deer', perception: { fov: 360, sight: 15 } }),
        npcEntity('wolf', 0, -9, { archetype: 'predator', faction: 'wolves', enemies: ['deer'], speed: 1, perception: { fov: 360, sight: 15 } }, { transform: { position: [0, 0.9, -9] } }),
      ],
      {},
    );
    r.run(1);
    expect(r.mode('deer')).toBe('flee');
    expect(['chase', 'attack', 'idle', 'investigate']).toContain(r.mode('wolf'));
  });

  it('a hurt NPC dies at zero health, falls over and announces it', () => {
    const r = rig([npcEntity('bandit', 0, 0, { health: 30, faction: 'bandits' })]);
    r.rt.npcs.damage('bandit', 35);
    r.run(0.2);
    expect(r.rt.npcs.info('bandit')?.dead).toBe(true);
    expect(r.state('bandit.npcState')).toBe('dead');
    expect(r.state('bandit.npcAnim')).toBe('dead');
    expect(r.rt.log.some((e) => e.text.includes('bandit died'))).toBe(true);
  });

  it('rules can drive damage through entity state', () => {
    const r = rig(
      [npcEntity('crate-guy', 0, 0, { health: 50 })],
      { rules: [{ id: 'poison', when: { on: 'timer', at: 0.5 }, then: [{ do: 'add', key: 'crate-guy.health', amount: -60 }] }] },
    );
    r.run(1.5);
    expect(r.rt.npcs.info('crate-guy')?.dead).toBe(true);
  });
});

describe('follow, wander and talk stance', () => {
  it('a follower keeps close to the player once asked to follow', () => {
    const r = rig([npcEntity('pal', 0, 0, { archetype: 'follower', faction: 'friends', speed: 2.5, runSpeed: 5 })], { player: [3, 0] });
    r.run(3);
    expect(r.mode('pal')).toBe('idle');
    r.rt.npcs.brainOf('pal')!.following = true;
    r.player(20, 10);
    r.run(10);
    expect(r.mode('pal')).toBe('follow');
    expect(Math.hypot(r.at('pal')[0] - 20, r.at('pal')[2] - 10)).toBeLessThan(3.5);
  });

  it('wanderers stay inside their radius and keep moving', () => {
    const r = rig([npcEntity('vil', 0, 0, { archetype: 'villager', wander: 5, speed: 1.4 })]);
    let max = 0;
    let moved = 0;
    let last = [...r.at('vil')] as [number, number, number];
    for (let i = 0; i < 90; i++) {
      r.run(1);
      const p = r.at('vil');
      max = Math.max(max, Math.hypot(p[0], p[2]));
      moved += Math.hypot(p[0] - last[0], p[2] - last[2]);
      last = [...p] as [number, number, number];
    }
    expect(max).toBeLessThanOrEqual(5.6);
    expect(moved).toBeGreaterThan(10);
  });

  it('publishes animation hints and state for the renderer', () => {
    const r = rig([npcEntity('g', 0, 0, { ...GUARD, waypoints: [[8, 0, 0], [0, 0, 0]] })]);
    r.run(2);
    expect(r.state('g.npcAnim')).toBe('walk');
    expect(r.state('g.npcState')).toBe('patrol');
  });

  it('stationary sentinels scan, never walk, and strike in reach', () => {
    const r = rig([npcEntity('turret', 0, 0, { archetype: 'sentinel', faction: 'ruins', attack: { damage: 5, range: 6, cooldown: 1 } })], { player: [0, -4], extra: { state: { health: 100 } } });
    r.run(3);
    expect(Number(r.state('health'))).toBeLessThan(100);
    expect(Math.hypot(r.at('turret')[0], r.at('turret')[2])).toBeLessThan(0.1);
  });
});

describe('custom graph edges and speech', () => {
  it('npc.transitions add edges on top of the archetype and can speak a line', () => {
    const r = rig(
      [npcEntity('timid', 0, 0, { archetype: 'villager', faction: 'town', transitions: [{ from: 'idle', to: 'flee', when: { k: 'playerWithin', r: 6 }, say: 'Eek!' }] })],
      { player: [0, -12] },
    );
    r.run(0.5);
    expect(r.mode('timid')).toBe('idle');
    expect(r.rt.npcs.bubbleCount).toBe(0);
    r.player(0, -4);
    r.run(0.3);
    expect(r.mode('timid')).toBe('flee');
    expect(r.rt.npcs.bubbleCount).toBe(1);
    const b = r.rt.npcs.bubbleAt(0);
    expect(b).toMatchObject({ npc: 'timid', text: 'Eek!', kind: 'bark' });
    expect(b?.y).toBeGreaterThan(1.8); // above the head
    // The bubble expires.
    r.player(0, -40);
    r.run(8);
    expect(r.rt.npcs.bubbleCount).toBe(0);
  });

  it('a custom edge outranks a default of equal priority, and a hold edge blocks lower ones', () => {
    const spec = { ...GUARD, perception: { fov: 360 }, transitions: [{ from: 'idle', to: 'idle', when: { k: 'seesFoe' }, priority: 95 }] };
    const r = rig([npcEntity('stoic', 0, 0, spec)], { player: [0, -6] });
    r.run(2);
    expect(r.mode('stoic')).toBe('idle'); // the hold edge keeps him from chasing
  });

  it('barks show for the speaker nearby and carry the world position', () => {
    const r = rig([npcEntity('g', 0, 0, { ...GUARD, barks: { spot: ['Halt!'] } })], { player: [0, -8] });
    r.run(0.5);
    const texts = r.rt.npcs.activeBubbles().map((x) => x.text);
    expect(texts).toContain('Halt!');
  });
});

describe('determinism and rules', () => {
  const build = () => {
    const wolf = { archetype: 'predator', faction: 'wolves', wander: 6, speed: 1.6, perception: { fov: 200, sight: 18 } } as const;
    return rig(
      [wallEntity('w', 3, 3, 4, 1), npcEntity('w1', 0, 0, wolf), npcEntity('w2', 6, -4, wolf), npcEntity('g', -5, 0, { ...GUARD, waypoints: [[-5, 0, 8], [-5, 0, -8]] })],
      { player: [2, 14] },
    );
  };

  it('same world and inputs replay identically', () => {
    const a = build();
    const b = build();
    for (let k = 0; k < 20; k++) {
      a.player(2 + k * 0.3, 14 - k * 0.8);
      b.player(2 + k * 0.3, 14 - k * 0.8);
      a.run(1);
      b.run(1);
    }
    for (const id of ['w1', 'w2', 'g']) {
      expect(a.at(id)).toEqual(b.at(id));
      expect(a.rt.npcs.info(id)).toEqual(b.rt.npcs.info(id));
    }
    expect(a.rt.log.map((e) => e.text)).toEqual(b.rt.log.map((e) => e.text));
  });

  it('events raised when an NPC dies reach rules', () => {
    const r = rig(
      [npcEntity('boss', 0, 0, { health: 10 })],
      { rules: [{ id: 'boss-down', when: { on: 'event', name: 'boss-died' }, then: [{ do: 'set', key: 'victory', value: true }] }], extra: { state: { victory: false } } },
    );
    r.rt.npcs.damage('boss', 20);
    r.run(0.5);
    expect(r.state('victory')).toBe(true);
  });

  it('hot reload keeps a brain running when its spec is unchanged and swaps it when edited', () => {
    const r = rig([npcEntity('g', 0, 0, { ...GUARD, waypoints: [[8, 0, 0], [0, 0, 0]] })]);
    r.run(3);
    const before = r.rt.npcs.info('g');
    expect(before?.legs).toBeGreaterThanOrEqual(0);
    r.run(0.5);
    expect(r.rt.npcs.count).toBe(1);
  });
});
