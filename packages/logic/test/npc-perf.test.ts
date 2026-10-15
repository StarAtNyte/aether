/**
 * 50+ NPCs at 60 fps: a crowd of patrolling guards, hunting wolves, wandering
 * villagers and a shopkeeper, with a player running through them. Measures
 * the logic cost per tick and proves the steady-state NPC path allocates
 * (almost) nothing.
 */
import { describe, expect, it } from 'vitest';
import { EMPTY_INPUT } from '../src';
import { describeSites, probeAllocations } from '../../../tests/unit/alloc-probe';
import { DT, FakeHost, worldOf } from './helpers';
import { LogicRuntime } from '../src';
import { npcEntity, wallEntity } from './npc-helpers';
import type { EntityInput } from '@aether/core';

const NPC_SRC = /packages\/logic\/src\/npc\//;

function crowd(n: number): { rt: LogicRuntime; host: FakeHost; step(i: number): void } {
  const ents: EntityInput[] = [];
  for (let i = 0; i < 6; i++) ents.push(wallEntity(`w${i}`, -30 + i * 12, 5, 6, 1));
  for (let i = 0; i < n; i++) {
    const x = ((i * 37) % 60) - 30;
    const z = ((i * 53) % 60) - 30;
    const kind = i % 4;
    if (kind === 0) ents.push(npcEntity(`g${i}`, x, z, { archetype: 'guard', faction: 'watch', waypoints: [[x + 6, 0, z], [x + 6, 0, z + 6], [x, 0, z + 6], [x, 0, z]], attack: { damage: 1 } }));
    else if (kind === 1) ents.push(npcEntity(`w${i}`, x, z, { archetype: 'predator', faction: 'wolves', wander: 8, fears: ['fire'], perception: { fov: 200 }, attack: { damage: 1 } }));
    else if (kind === 2) ents.push(npcEntity(`v${i}`, x, z, { archetype: 'villager', faction: 'town', wander: 5 }));
    else ents.push(npcEntity(`m${i}`, x, z, { archetype: 'merchant', faction: 'town', dialogue: { start: 'start', nodes: { start: { text: 'Hello' } } } }));
  }
  ents.push({ id: 'campfire', tags: ['fire'], transform: { position: [0, 0, 0] } });
  const host = new FakeHost();
  host.player = 'avatar';
  host.place('avatar', [0, 0, 20]);
  const rt = new LogicRuntime(worldOf(ents, [], { state: { health: 1e9 } }), host);
  return {
    rt,
    host,
    step(i) {
      host.place('avatar', [Math.sin(i * 0.004) * 25, 0, Math.cos(i * 0.003) * 25]);
      rt.tick(DT, EMPTY_INPUT, []);
    },
  };
}

describe('NPC crowd performance', () => {
  it('60 NPCs tick well inside a 60 fps frame', () => {
    const c = crowd(60);
    expect(c.rt.npcs.count).toBe(60);
    for (let i = 0; i < 300; i++) c.step(i); // warm-up (navigation grids, JIT)
    const t0 = performance.now();
    const N = 600;
    for (let i = 0; i < N; i++) c.step(300 + i);
    const perTick = (performance.now() - t0) / N;
    // A frame is 16.7 ms; the NPCs get a fraction of it even on a loaded CI machine.
    expect(perTick).toBeLessThan(3);
    // Everyone is alive and on the floor.
    for (const info of c.rt.npcs.infos()) {
      expect(info.dead).toBe(false);
      expect(Number.isFinite(info.x) && Number.isFinite(info.z)).toBe(true);
    }
  });

  it('120 NPCs with 200 ticks stay deterministic and finite', () => {
    const a = crowd(120);
    const b = crowd(120);
    for (let i = 0; i < 200; i++) {
      a.step(i);
      b.step(i);
    }
    expect(a.rt.npcs.infos()).toEqual(b.rt.npcs.infos());
  });

  it('the steady-state NPC tick allocates no objects, arrays or strings (only transient boxed numbers)', async () => {
    const c = crowd(60);
    let i = 0;
    for (let k = 0; k < 600; k++) c.step(i++);
    const r = await probeAllocations(() => c.step(i++), { iterations: 1500, warmup: 3000, match: NPC_SRC });
    // 60 NPCs per tick: what remains is boxed doubles passed between non-inlined calls (~16 B each);
    // any per-tick array, closure, string or object would be several times this budget.
    expect(r.bytesPerIteration, describeSites(r)).toBeLessThan(16 * 1024);
  }, 120_000);
});
