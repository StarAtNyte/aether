import { describe, expect, it } from 'vitest';
import { Rule, WorldTest, type Action, type Trigger } from '@aether/core';
import { formatAction, formatRule, formatSelector, formatTest, formatTrigger, formatValue, ruleSentence } from '../src/lib/ruleFormat';

const rule = (input: unknown): Rule => Rule.parse(input);

describe('rule formatting', () => {
  it('formats the canonical coin rule', () => {
    const r = rule({
      id: 'coin-pickup',
      when: { on: 'enter', zone: 'coin', who: 'player' },
      then: [
        { do: 'add', key: 'score', amount: 1 },
        { do: 'destroy', target: 'coin' },
      ],
    });
    expect(ruleSentence(r)).toBe('WHEN player enters coin → ADD score +1, DESTROY coin');
  });

  it('includes conditions and flags', () => {
    const r = rule({
      id: 'win',
      when: { on: 'state', key: 'score', op: '>=', value: 10 },
      if: [{ key: 'time', op: '<', value: 60 }],
      then: [{ do: 'win', text: 'Yay' }],
      once: true,
    });
    const c = formatRule(r);
    expect(c.when).toBe('score ≥ 10');
    expect(c.conditions).toEqual(['time < 60']);
    expect(c.once).toBe(true);
    expect(ruleSentence(r)).toBe('WHEN score ≥ 10 IF time < 60 → WIN "Yay"');
  });

  it('formats every trigger kind', () => {
    const triggers: Trigger[] = [
      { on: 'start' },
      { on: 'tick', every: 0.5 },
      { on: 'timer', at: 3 },
      { on: 'collision', a: '#ball', b: '*', minImpulse: 2 },
      { on: 'exit', zone: 'zone', who: 'player' },
      { on: 'key', key: 'e' },
      { on: 'click', target: 'button' },
      { on: 'event', name: 'boom' },
      { on: 'fallBelow', target: 'player', y: -5 },
    ];
    const out = triggers.map(formatTrigger);
    expect(out).toEqual(['game starts', 'every 0.5s', '3s have passed', 'any #ball hits anything (impulse ≥ 2)', 'player leaves zone', 'key "e" pressed', 'button is clicked', 'event "boom"', 'player falls below y -5']);
  });

  it('formats every action kind', () => {
    const actions: Action[] = [
      { do: 'set', key: 'door.open', value: true },
      { do: 'add', key: 'lives', amount: -1 },
      { do: 'spawn', template: 'coin', at: [1, 2, 3], count: 3, spread: 1 },
      { do: 'impulse', target: 'ball', vector: [0, 5, 0] },
      { do: 'setVelocity', target: 'ball', vector: [1, 0, 0] },
      { do: 'teleport', target: 'player', to: 'start' },
      { do: 'setProperty', target: 'lamp', path: 'light.intensity', value: 2 },
      { do: 'enableBehavior', target: '#guard', behavior: 'patrol', enabled: false },
      { do: 'explode', at: 'tnt', force: 20, radius: 5 },
      { do: 'setGravity', vector: [0, -1.6, 0] },
      { do: 'emit', event: 'go', delay: 2 },
      { do: 'message', text: 'Hello', duration: 3 },
      { do: 'sound', sound: 'bell' },
      { do: 'lose', text: 'Oops' },
      { do: 'reset' },
    ];
    expect(actions.map(formatAction)).toEqual([
      'SET door.open = true',
      'ADD lives -1',
      'SPAWN 3× coin at (1, 2, 3)',
      'PUSH ball (0, 5, 0)',
      'VELOCITY ball (1, 0, 0)',
      'TELEPORT player → start',
      'SET lamp.light.intensity = 2',
      'DISABLE patrol on any #guard',
      'EXPLODE at tnt (force 20, r 5)',
      'GRAVITY (0, -1.6, 0)',
      'EMIT "go" after 2s',
      'SAY "Hello"',
      'SOUND bell',
      'LOSE "Oops"',
      'RESET',
    ]);
  });

  it('clips long values and handles odd JSON', () => {
    expect(formatValue('x'.repeat(200)).length).toBeLessThanOrEqual(52);
    expect(formatValue(undefined)).toBe('∅');
    expect(formatValue(null)).toBe('null');
    expect(formatValue({ a: [1, 2] })).toBe('{"a":[1,2]}');
    expect(formatValue(1 / 3)).toBe('0.333');
  });

  it('formats selectors', () => {
    expect(formatSelector('*')).toBe('anything');
    expect(formatSelector('#coin')).toBe('any #coin');
    expect(formatSelector('door-1')).toBe('door-1');
  });

  it('formats tests', () => {
    const tests = [
      { id: 'a', kind: 'stable', target: '#crate' },
      { id: 'b', kind: 'noOverlap' },
      { id: 'c', kind: 'reaches', target: 'ball', zone: { center: [0, 0, 5], radius: 2 } },
      { id: 'd', kind: 'eventually', condition: { key: 'score', op: '>=', value: 1 } },
      { id: 'e', kind: 'moves', target: 'domino-1' },
      { id: 'f', kind: 'topples', target: 'tower' },
      { id: 'g', kind: 'staysAbove', target: 'ball' },
    ].map((t) => WorldTest.parse(t));
    const out = tests.map(formatTest);
    expect(out[0]).toBe('any #crate stays put for 3s (drift ≤ 0.15m)');
    expect(out[2]).toBe('ball reaches 2m around (0, 0, 5) within 10s');
    expect(out[3]).toBe('score ≥ 1 within 10s');
    expect(out[6]).toBe('ball stays above y -1 for 10s');
  });
});
