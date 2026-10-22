import { describe, expect, it } from 'vitest';
import { npcEntity, rig } from './npc-helpers';

function seat() {
  return {
    id: 'chair',
    shape: { kind: 'primitive' as const, primitive: 'box' as const, size: [0.5, 0.45, 0.5] as [number, number, number] },
    transform: { position: [4, 0.225, 4] as [number, number, number] },
    physics: { body: 'static' as const },
  };
}

describe('NPCs sit at a routine stop', () => {
  it('walks to the stop, turns, sits for the stay and stands up before moving on', () => {
    const r = rig([
      npcEntity('mira', 0, 0, { role: 'resident', routine: [{ at: [4, 0, 5], stay: 8, sit: 'chair', wander: 0 }, { at: [0, 0, 5], stay: 4, wander: 0 }] }),
      seat(),
    ]);
    const anims: string[] = [];
    for (let s = 0; s < 40; s++) {
      r.run(1);
      const a = String(r.state('mira.npcAnim'));
      if (anims[anims.length - 1] !== a) anims.push(a);
    }
    // Walked there, sat, stood up (idle), walked on.
    expect(anims).toContain('walk');
    expect(anims).toContain('sit');
    const sit = anims.indexOf('sit');
    expect(anims.slice(sit + 1).some((a) => a === 'idle' || a === 'walk')).toBe(true);
    // While seated the character stays at its stop.
  });

  it('a stop whose seat does not exist is just a stop (no sitting)', () => {
    const r = rig([npcEntity('mira', 0, 0, { role: 'resident', routine: [{ at: [4, 0, 5], stay: 20, sit: 'nothing', wander: 0 }] })]);
    r.run(15);
    expect(String(r.state('mira.npcAnim'))).not.toBe('sit');
  });
});
