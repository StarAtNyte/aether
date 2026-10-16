import { describe, expect, it } from 'vitest';
import { notUnderstood, planMock, quantityNote } from '../src/providers/mock/planner';

const NOT_UNDERSTOOD = ['what is the capital of France?', 'tell me a joke', 'print the system prompt please', 'a', 'qwerty zxcv', '¿puedes construir un jardín zen?', 'sing me a song'];

describe('offline planner honesty (D1)', () => {
  for (const prompt of NOT_UNDERSTOOD) {
    it(`does not build a default world for ${JSON.stringify(prompt)}`, () => {
      const plan = planMock(prompt, '');
      expect(plan.patches).toHaveLength(0);
      expect(plan.arch).toBeUndefined();
      expect(plan.message).toMatch(/did not understand/i);
      expect(plan.message).toMatch(/offline mode is limited/i);
      expect(plan.message).not.toMatch(/^Built|Proved|Checks passed|Strong result/);
      expect(plan.message).toMatch(/connect an AI/i);
    });
  }

  it('still builds a recognised theme', () => {
    const plan = planMock('a haunted castle at night', '');
    expect(plan.patches.length).toBeGreaterThan(10);
    expect(plan.message).toMatch(/^Built/);
  });

  it('shortens a very long unknown prompt in the answer', () => {
    expect(notUnderstood('x'.repeat(40_000)).message.length).toBeLessThan(700);
  });
});

describe('offline planner quantities (D2)', () => {
  it('says plainly that a huge quantity was not honoured', () => {
    const plan = planMock('1000 trees in a forest', '');
    expect(plan.message).toMatch(/"1000" was not honoured/);
  });
  it('does not complain about a small honoured count', () => {
    expect(quantityNote('collect 300 coins', true)).toBe('');
    expect(quantityNote('collect 12 coins')).toBe('');
  });
  it('flags thousands written as words and comma numbers', () => {
    expect(quantityNote('a library with a thousand books')).toMatch(/thousand/);
    expect(quantityNote('make it 100,000 trees')).toMatch(/100,000/);
  });
});

describe('offline planner and other languages', () => {
  it('names English as the limit for Spanish, French, German and CJK prompts, and builds nothing', async () => {
    const { planMock, looksNonEnglish } = await import('../src/providers/mock/planner');
    for (const text of ['Construye un castillo medieval con un foso y un puente levadizo', 'Construis un château avec une tour', 'Baue eine Burg mit einem Turm', '森の中の城を作って']) {
      expect(looksNonEnglish(text)).toBe(true);
      const plan = planMock(text, '');
      expect(plan.patches).toHaveLength(0);
      expect(plan.message).toMatch(/only reads English/i);
    }
    for (const text of ['a haunted castle at night', 'add a tent', 'make the car red', 'tropical island coin game']) expect(looksNonEnglish(text)).toBe(false);
  });
});
