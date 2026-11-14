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

describe('gaits and the crouch', () => {
  it('shows a run at a run pace and the sprint clip only for a sprint', () => {
    const m = new LocomotionMachine(clipTable('male'));
    const input = base();
    input.speed = 5.6 * 0.7;
    run(m, input, 1);
    expect(m.update(1 / 60, input).clip).toBe('run');
    // The same speed with the sprint asked for, and a sprint's speed.
    input.sprinting = true;
    input.speed = 5.6;
    run(m, input, 1);
    expect(m.update(1 / 60, input).clip).toBe('sprint');
  });

  it('does not flicker through the ladder while speeding up', () => {
    const m = new LocomotionMachine(clipTable('male'));
    const input = base();
    const clips: string[] = [];
    // About 0.15 s from a stand to a run, as the player's controller does.
    for (let i = 0; i < 60; i++) {
      input.speed = Math.min(3.9, i * (3.9 / 9));
      const plan = m.update(1 / 60, input);
      if (clips[clips.length - 1] !== plan.clip) clips.push(plan.clip);
    }
    expect(clips[clips.length - 1]).toBe('run');
    // No clip comes back once left.
    expect(new Set(clips).size).toBe(clips.length);
    expect(clips).not.toContain('walk_fast');
  });

  it('crouches over the standing idle and walk (the rig bends them), never the squat clips', () => {
    const m = new LocomotionMachine(clipTable('male'));
    const input = base();
    input.crouching = true;
    run(m, input, 0.5);
    let plan = m.update(1 / 60, input);
    expect(plan.state).toBe('crouch');
    expect(plan.clip).toBe('idle');
    input.speed = 1.6;
    run(m, input, 0.5);
    plan = m.update(1 / 60, input);
    expect(plan.state).toBe('crouch');
    expect(plan.clip).toBe('walk');
    expect(plan.timeScale).toBeCloseTo(1.6 / (clipTable('male').get('walk')?.stride ?? 1), 2);
    input.crouching = false;
    plan = m.update(1 / 60, input);
    expect(plan.state).toBe('loco');
  });
});

describe('cancelling an action', () => {
  it('ends a requested wave at once so the walk takes over, but lets a hit play out', () => {
    const m = new LocomotionMachine(clipTable('female'));
    const input = base();
    run(m, input, 0.2);
    expect(m.trigger('wave')).toBe(true);
    input.speed = 1.4;
    expect(m.update(1 / 60, input).state).toBe('action');
    m.cancelAction();
    run(m, input, 0.3);
    expect(m.update(1 / 60, input).state).toBe('loco');
    m.trigger('hit');
    m.cancelAction();
    expect(m.update(1 / 60, input).state).toBe('hit');
  });
});
