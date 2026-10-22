import { describe, expect, it } from 'vitest';
import { clipTable, LocomotionMachine, SIT_RATE, type ActorInput } from '../src';

const base = (): ActorInput => ({ speed: 0, vy: 0, grounded: true, crouching: false, sprinting: false, talking: false, sitting: false, mood: 'neutral' });

function run(m: LocomotionMachine, input: ActorInput, seconds: number, each?: (state: string, clip: string, t: number) => void): void {
  for (let t = 0; t < seconds; t += 1 / 60) {
    const plan = m.update(1 / 60, input);
    each?.(plan.state, plan.clip, t);
  }
}

describe('jump states', () => {
  it('takes off, rises, falls and lands without the crouch-in-the-air clip', () => {
    const m = new LocomotionMachine(clipTable('male'));
    const input = base();
    const seen: string[] = [];
    const clips = new Set<string>();
    run(m, input, 0.3);
    for (let i = 0; i < 100; i++) {
      const t = i / 60;
      input.vy = 5.5 - 9.81 * t;
      input.grounded = i === 0 || t >= 1.1;
      const plan = m.update(1 / 60, input);
      if (seen[seen.length - 1] !== plan.state) seen.push(plan.state);
      clips.add(plan.clip);
    }
    expect(seen.slice(0, 3)).toEqual(['loco', 'jump', 'air']);
    expect(seen).toContain('fall');
    expect(seen).toContain('land');
    expect(clips.has('jump_start')).toBe(false);
  });
});

describe('sitting states', () => {
  it('sits down at the captured clip rate, stays, then stands up and returns to idle', () => {
    const table = clipTable('male');
    const m = new LocomotionMachine(table);
    const input = base();
    run(m, input, 0.3);
    input.sitting = true;
    const states: string[] = [];
    let rate = 0;
    run(m, input, 4, (s) => {
      if (states[states.length - 1] !== s) states.push(s);
    });
    expect(states).toEqual(['sit_down', 'sit']);
    const down = m.update(1 / 60, { ...input, sitting: true });
    expect(down.clip).toBe('sit');
    input.sitting = false;
    run(m, input, 0.1, (_s, _c, _t) => void 0);
    const plan = m.update(1 / 60, input);
    rate = plan.timeScale;
    expect(plan.state).toBe('stand_up');
    expect(rate).toBeCloseTo(SIT_RATE, 5);
    run(m, input, 3);
    expect(m.update(1 / 60, input).state).toBe('loco');
  });
});
