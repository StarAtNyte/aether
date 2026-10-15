import { describe, expect, it } from 'vitest';
import { Dialogue, type DialogueEffect } from '@aether/core';
import { DialogueSession, type DialogueHost } from '../src';
import { npcEntity, rig } from './npc-helpers';

const SHOP = {
  start: 'start',
  nodes: {
    start: {
      text: 'Welcome, traveller! Looking for a key?',
      variants: [{ if: [{ key: 'key', op: '>=', value: 1 }], text: 'You again. The key serves you well?' }],
      choices: [
        { text: 'Buy the gate key (5 coins)', if: [{ key: 'coins', op: '>=', value: 5 }, { key: 'key', op: '<', value: 1 }], effects: [{ do: 'take', item: 'coins', count: 5 }, { do: 'give', item: 'key' }, { do: 'openDoor', target: 'gate' }], next: 'thanks' },
        { text: 'Who are you?', once: true, next: 'about' },
        { text: 'Just looking.', next: null },
      ],
    },
    about: { text: 'Mira. I keep the only shop in the hollow.', next: 'start' },
    thanks: { text: 'A pleasure doing business.', mode: 'trade', next: null },
  },
} as const;

const SHOPKEEPER = { role: 'shopkeeper', archetype: 'merchant', faction: 'village', dialogue: SHOP } as const;

function shop(over: Record<string, unknown> = {}) {
  return rig([npcEntity('mira', 0, 0, SHOPKEEPER)], { player: [0, -2], extra: { state: { coins: 0, key: 0, ...over } } });
}

describe('talking', () => {
  it('shows a prompt in reach, starts on E, numbers the visible choices', () => {
    const r = shop();
    r.run(0.2);
    expect(r.rt.npcs.prompt?.npc).toBe('mira');
    expect(r.rt.npcs.prompt?.name).toBe('Mira');
    r.tap('e');
    const d = r.rt.npcs.dialogue;
    expect(d?.text).toMatch(/Welcome/);
    expect(d?.speaker).toBe('Mira');
    expect(d?.choices).toEqual(['Who are you?', 'Just looking.']); // buying needs 5 coins
    expect(r.rt.npcs.prompt).toBeNull();
    expect(r.mode('mira')).toBe('talk');
    expect(r.state('mira.talking')).toBe(true);
  });

  it('does not offer a conversation out of reach', () => {
    const r = rig([npcEntity('mira', 0, 0, SHOPKEEPER)], { player: [0, -9] });
    r.run(0.2);
    expect(r.rt.npcs.prompt).toBeNull();
    r.tap('e');
    expect(r.rt.npcs.dialogue).toBeNull();
  });

  it('selling the key: coins taken, key given, gate unlocked, trade pose, then back to idle', () => {
    const r = shop({ coins: 7 });
    r.tap('e');
    expect(r.rt.npcs.dialogue?.choices[0]).toMatch(/Buy the gate key/);
    r.tap('1');
    expect(r.state('coins')).toBe(2);
    expect(r.state('key')).toBe(1);
    expect(r.state('gate-unlocked')).toBe(true);
    expect(r.host.messages).toContain('Received: key');
    expect(r.rt.npcs.dialogue?.text).toMatch(/pleasure/i);
    r.run(0.1);
    expect(r.mode('mira')).toBe('trade');
    r.tap('e');
    expect(r.rt.npcs.dialogue).toBeNull();
    r.run(0.2);
    expect(r.mode('mira')).toBe('idle');
  });

  it('variants swap the greeting once the key is owned and the sale is hidden', () => {
    const r = shop({ coins: 20, key: 1 });
    r.tap('e');
    expect(r.rt.npcs.dialogue?.text).toMatch(/You again/);
    expect(r.rt.npcs.dialogue?.choices.some((c) => /Buy/.test(c))).toBe(false);
  });

  it('a once-only choice disappears after being taken, even across conversations', () => {
    const r = shop();
    r.tap('e');
    r.tap('1'); // Who are you?
    expect(r.rt.npcs.dialogue?.text).toMatch(/Mira/);
    r.tap('e'); // advance back to the start node
    expect(r.rt.npcs.dialogue?.choices).toEqual(['Just looking.']);
    r.tap('1');
    expect(r.rt.npcs.dialogue).toBeNull();
    r.run(1);
    r.tap('e');
    expect(r.rt.npcs.dialogue?.choices).toEqual(['Just looking.']);
  });

  it('a single choice can be taken with E', () => {
    const r = shop();
    r.tap('e');
    r.tap('1');
    r.tap('e');
    r.tap('1'); // only "Just looking." is left
    expect(r.rt.npcs.dialogue).toBeNull();
  });

  it('touch / pointer API: startDialogue, choose, advance, endDialogue', () => {
    const r = shop({ coins: 5 });
    r.run(0.1);
    expect(r.rt.npcs.startDialogue('mira')).toBe(true);
    expect(r.rt.npcs.startDialogue('mira')).toBe(false); // already talking
    expect(r.rt.npcs.choose(9)).toBe(false);
    expect(r.rt.npcs.choose(0)).toBe(true);
    expect(r.state('key')).toBe(1);
    expect(r.rt.npcs.dialogue?.text).toMatch(/pleasure/i);
    expect(r.rt.npcs.advance()).toBe(true);
    expect(r.rt.npcs.dialogue).toBeNull();
    expect(r.rt.npcs.startDialogue('nobody')).toBe(false);
  });

  it('walking away ends the conversation', () => {
    const r = shop();
    r.tap('e');
    expect(r.rt.npcs.dialogue).not.toBeNull();
    r.player(0, -12);
    r.run(0.1);
    expect(r.rt.npcs.dialogue).toBeNull();
  });

  it('the NPC stands still and faces the player while talking', () => {
    const r = rig([npcEntity('mira', 0, 0, { ...SHOPKEEPER, wander: 4, archetype: 'villager' })], { player: [3, 0], extra: { state: { coins: 0, key: 0 } } });
    r.run(0.2);
    r.player(1.5, 0);
    r.run(0.1);
    r.tap('e');
    const p = [...r.at('mira')] as [number, number, number];
    r.run(2);
    expect(Math.hypot(r.at('mira')[0] - p[0], r.at('mira')[2] - p[2])).toBeLessThan(0.3);
    expect(r.state('mira.npcAnim')).toBe('talk');
  });

  it('a guard in pursuit cannot be talked to; an angry shopkeeper stops talking', () => {
    const r = rig(
      [npcEntity('g', 0, 0, { archetype: 'guard', faction: 'watch', attack: { damage: 1 }, dialogue: { start: 'start', nodes: { start: { text: 'Halt.' } } } })],
      { player: [0, -3] },
    );
    r.run(1);
    expect(r.mode('g')).toBe('attack');
    expect(r.rt.npcs.startDialogue('g')).toBe(false);
  });

  it('effects: provoke turns the NPC on the player, follow recruits it, win ends the game', () => {
    const tree = {
      start: 'start',
      nodes: {
        start: {
          text: 'Well?',
          choices: [
            { text: 'Insult him', effects: [{ do: 'provoke' }], next: null },
            { text: 'Come with me', effects: [{ do: 'follow', on: true }], next: null },
            { text: 'Claim the prize', effects: [{ do: 'win', text: 'Quest complete' }], next: null },
          ],
        },
      },
    } as const;
    const a = rig([npcEntity('n', 0, 0, { archetype: 'villager', faction: 'town', dialogue: tree })], { player: [0, -2] });
    a.tap('e');
    a.tap('1');
    a.run(2);
    expect(['chase', 'attack', 'flee']).toContain(a.mode('n')); // a villager runs from the one it is angry at
    const b = rig([npcEntity('n', 0, 0, { archetype: 'follower', faction: 'town', dialogue: tree })], { player: [0, -2] });
    b.tap('e');
    b.tap('2');
    b.player(15, -15);
    b.run(8);
    expect(b.mode('n')).toBe('follow');
    const c = rig([npcEntity('n', 0, 0, { archetype: 'villager', faction: 'town', dialogue: tree })], { player: [0, -2] });
    c.tap('e');
    c.tap('3');
    expect(c.rt.status).toBe('won');
  });

  it('survives hot reload of the dialogue and a world reset without a stale conversation', () => {
    const r = shop();
    r.tap('e');
    expect(r.rt.npcs.dialogue).not.toBeNull();
    r.rt.npcs.reset();
    expect(r.rt.npcs.dialogue).toBeNull();
  });
});

describe('free conversation hooks (the model itself lives in the studio)', () => {
  const chatty = { ...SHOPKEEPER, chat: { persona: 'You are a warm, shrewd shopkeeper.', facts: ['The key costs five coins.'], maxTurns: 4 } } as const;

  it('exposes a context only for characters with a chat spec, and only during a conversation', () => {
    const plain = shop();
    plain.run(0.1);
    plain.rt.npcs.startDialogue('mira');
    expect(plain.rt.npcs.chatContext()).toBeNull();
    expect(plain.rt.npcs.dialogue?.chat).toBe(false);
    const r = rig([npcEntity('mira', 0, 0, chatty)], { player: [0, -2], extra: { state: { coins: 0, key: 0 } } });
    r.run(0.1);
    expect(r.rt.npcs.chatContext()).toBeNull();
    r.rt.npcs.startDialogue('mira');
    const ctx = r.rt.npcs.chatContext();
    expect(ctx).toMatchObject({ npc: 'mira', name: 'Mira', role: 'shopkeeper', persona: 'You are a warm, shrewd shopkeeper.', facts: ['The key costs five coins.'], maxTurns: 4 });
    expect(ctx?.shown).toMatch(/Welcome/);
    expect(ctx?.choices).toEqual(['How much for the key?'.length ? ctx?.choices[0] : '', ctx?.choices[1]].filter(Boolean));
    expect(r.rt.npcs.dialogue?.chat).toBe(true);
  });

  it('a free reply replaces the shown text, keeps the authored choices and clears on the next choice', () => {
    const r = rig([npcEntity('mira', 0, 0, chatty)], { player: [0, -2], extra: { state: { coins: 0, key: 0 } } });
    r.run(0.1);
    r.rt.npcs.startDialogue('mira');
    const choices = [...(r.rt.npcs.dialogue?.choices ?? [])];
    const v0 = r.rt.npcs.dialogue?.version ?? 0;
    expect(r.rt.npcs.freeReply('  The **night** is\ncold,   traveller.\u0007 ')).toBe(true);
    const d = r.rt.npcs.dialogue;
    expect(d?.text).toBe('The **night** is cold, traveller.'); // control characters and whitespace are flattened; formatting is the studio's job
    expect(d?.free).toBe(true);
    expect(d?.choices).toEqual(choices);
    expect(d?.version).toBeGreaterThan(v0);
    r.rt.npcs.choose(0);
    expect(r.rt.npcs.dialogue?.free).toBe(false);
  });

  it('refuses replies without a conversation, empty ones and non-strings; long ones are capped', () => {
    const r = rig([npcEntity('mira', 0, 0, chatty)], { player: [0, -2] });
    r.run(0.1);
    expect(r.rt.npcs.freeReply('hello')).toBe(false);
    r.rt.npcs.startDialogue('mira');
    expect(r.rt.npcs.freeReply('   ')).toBe(false);
    expect(r.rt.npcs.freeReply(42 as unknown as string)).toBe(false);
    r.rt.npcs.freeReply('x'.repeat(1000));
    expect((r.rt.npcs.dialogue?.text.length ?? 0)).toBeLessThanOrEqual(320);
  });

  it('the chat spec validates: persona required, facts and turns capped', () => {
    const ok = Dialogue.safeParse({ nodes: { start: { text: 'hi' } } });
    expect(ok.success).toBe(true);
    const ents = (chat: unknown) => ({ id: 'n', npc: { chat } });
    expect(() => rig([ents({ persona: '' }) as never])).toThrow();
    expect(() => rig([ents({ persona: 'x'.repeat(501) }) as never])).toThrow();
    expect(() => rig([ents({ persona: 'ok', maxTurns: 99 }) as never])).toThrow();
    expect(() => rig([ents({ persona: 'ok', facts: Array.from({ length: 9 }, () => 'f') }) as never])).toThrow();
  });
});

describe('DialogueSession', () => {
  const tree = Dialogue.parse(SHOP);
  const host = (state: Record<string, number>, applied: DialogueEffect[] = []): DialogueHost => ({
    read: (k) => state[k],
    apply: (fx) => {
      applied.push(fx);
    },
  });

  it('walks nodes, applies effects in order, ends on null', () => {
    const applied: DialogueEffect[] = [];
    const s = new DialogueSession('mira', 'Mira', tree, host({ coins: 9, key: 0 }, applied), new Set());
    expect(s.view.choices).toHaveLength(3);
    expect(s.choose(0)).toBe(true);
    expect(applied.map((a) => a.do)).toEqual(['take', 'give', 'openDoor']);
    expect(s.view.text).toMatch(/pleasure/i);
    expect(s.view.mode).toBe('trade');
    expect(s.advance()).toBe(true);
    expect(s.ended).toBe(true);
    expect(s.choose(0)).toBe(false);
  });

  it('refuses to advance while a choice is pending', () => {
    const s = new DialogueSession('mira', 'Mira', tree, host({}), new Set());
    expect(s.awaitingChoice).toBe(true);
    expect(s.advance()).toBe(false);
  });

  it('finds unreachable nodes', () => {
    const t = Dialogue.parse({ start: 'a', nodes: { a: { text: 'x', next: 'b' }, b: { text: 'y' }, c: { text: 'lost' } } });
    expect([...DialogueSession.reachable(t)].sort()).toEqual(['a', 'b']);
  });

  it('validates the tree: dangling links and a missing start are rejected', () => {
    expect(Dialogue.safeParse({ start: 'a', nodes: { a: { text: 'x', next: 'nope' } } }).success).toBe(false);
    expect(Dialogue.safeParse({ start: 'a', nodes: { a: { text: 'x', choices: [{ text: 'c', next: 'zzz' }] } } }).success).toBe(false);
    expect(Dialogue.safeParse({ start: 'missing', nodes: { a: { text: 'x' } } }).success).toBe(false);
    expect(Dialogue.safeParse({ nodes: { start: { text: 'hi' } } }).success).toBe(true);
  });

  it('caps sizes: 7 choices, 49 nodes and 400-char lines are refused', () => {
    const seven = { start: 'a', nodes: { a: { text: 'x', choices: Array.from({ length: 7 }, (_, i) => ({ text: `c${i}` })) } } };
    expect(Dialogue.safeParse(seven).success).toBe(false);
    const nodes: Record<string, unknown> = {};
    for (let i = 0; i < 49; i++) nodes[`n${i}`] = { text: 'x' };
    expect(Dialogue.safeParse({ start: 'n0', nodes }).success).toBe(false);
    expect(Dialogue.safeParse({ start: 'a', nodes: { a: { text: 'x'.repeat(400) } } }).success).toBe(false);
  });
});
