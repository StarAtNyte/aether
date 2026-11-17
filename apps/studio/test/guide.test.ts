/**
 * The showroom guide's brain (player/guide/brain.ts): the catalogue, the system prompt and request, the reply parser, the
 * keyword answers without a model, the tour route and its narration. The request is checked against the server's strict
 * schema so a live model never refuses it.
 */
import { describe, expect, it } from 'vitest';
import { WorldDoc } from '@aether/core';
import { CompletionRequestSchema } from '../../server/src/llm/schema';
import {
  catalogue,
  describe as describeProduct,
  greetingFor,
  HISTORY_TURNS,
  keywordAnswer,
  narrate,
  nearestCopy,
  parseReply,
  priceValue,
  productLine,
  products,
  requestBody,
  systemPrompt,
  TOUR_MAX,
  tourRoute,
  type Product,
} from '../src/player/guide/brain';
import { clearWalk, walkPath } from '../src/player/guide/place';

const rug = (id: string, x: number, z: number, product: Record<string, string>): Record<string, unknown> => ({ id, name: id, transform: { position: [x, 0, z], rotation: [0, 0, 0], scale: [1, 1, 1] }, product });

const world = WorldDoc.parse({
  name: 'Rug Gallery',
  entities: {
    a: rug('a', 0, 0, { name: 'Vinton Persian Rug, Teal', price: '€1,290', size: '160 × 230 cm', details: 'A classic Persian medallion in teal. Soft pile.' }),
    b: rug('b', 2, 0, { name: 'Motion Modern Rug, Denim', price: '€980', size: '160 × 230 cm', details: 'Brushstroke design in wool.' }),
    c: rug('c', 4, 0, { name: 'Kashan Heirloom Rug, Rust', price: '€8,900', size: '250 × 350 cm', details: 'Hand-knotted silk and wool, the finest piece here.' }),
    d: rug('d', 6, 0, { name: 'Tabriz Runner, Cream', price: '€620', size: '80 × 250 cm', details: 'A pale runner for halls.' }),
    e: rug('e', 30, 0, { name: 'Vinton Persian Rug, Teal', price: '€1,290', size: '160 × 230 cm', details: 'A classic Persian medallion in teal. Soft pile.' }),
    wall: { id: 'wall', name: 'Wall' },
  },
});
const guide = { name: 'Ava', about: 'Rug Gallery sells hand-knotted and modern rugs. Delivery is free in the EU. Made-to-measure rugs on request.' };
const list = products(world);
const items = catalogue(list);

describe('catalogue', () => {
  it('lists products only, one item per name with its copies', () => {
    expect(list.map((p) => p.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(items.map((p) => p.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(items[0]?.copies).toEqual(['a', 'e']);
    expect(nearestCopy('a', list, [29, 1.6, 1])).toBe('e');
    expect(nearestCopy('a', list, [1, 1.6, 1])).toBe('a');
  });

  it('writes compact lines and reads prices', () => {
    expect(productLine(list[0] as Product)).toBe('a | Vinton Persian Rug, Teal | 160 × 230 cm | €1,290 | A classic Persian medallion in teal. Soft pile.');
    expect(priceValue('€1,290')).toBe(1290);
    expect(priceValue('from $89')).toBe(89);
    expect(priceValue('£8.900')).toBe(8900);
    expect(priceValue(undefined)).toBeNull();
  });
});

describe('prompt and request', () => {
  const system = systemPrompt(guide, world.name, items);

  it('names the guide, the shop and every item, and asks for strict JSON', () => {
    expect(system).toContain('You are Ava');
    expect(system).toContain('"Rug Gallery"');
    expect(system).toContain('Delivery is free in the EU.');
    for (const it of items) expect(system).toContain(productLine(it));
    expect(system).not.toContain('e | Vinton');
    expect(system).toMatch(/never invent/i);
    expect(system).toContain('{"say": "...", "goTo"');
  });

  it('keeps the last turns, opens with the visitor and passes the server schema', () => {
    const turns = Array.from({ length: 9 }, (_, i) => ({ role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant', content: `t${i}` }));
    const body = requestBody(system, turns);
    expect(body.role).toBe('critic');
    expect(body.maxTokens).toBe(400);
    expect(body.messages.length).toBeLessThanOrEqual(HISTORY_TURNS);
    expect(body.messages[0]?.role).toBe('user');
    expect(body.messages.at(-1)?.content).toBe('t8');
    expect(CompletionRequestSchema.safeParse(body).success).toBe(true);
  });
});

describe('parseReply', () => {
  const ids = new Set(list.map((p) => p.id));
  it('reads the JSON object, also inside prose or fences', () => {
    expect(parseReply('{"say":"Here it is.","goTo":"b"}', ids)).toEqual({ say: 'Here it is.', goTo: 'b' });
    expect(parseReply('Sure! ```json\n{"say": "Look {here}.", "goTo": null}\n``` done', ids)).toEqual({ say: 'Look {here}.', goTo: null });
    expect(parseReply('{"say":"Follow me.","goTo":"tour"}', ids)).toEqual({ say: 'Follow me.', goTo: 'tour' });
  });

  it('drops an unknown id and falls back to the text', () => {
    expect(parseReply('{"say":"The gold one.","goTo":"zzz"}', ids)).toEqual({ say: 'The gold one.', goTo: null });
    expect(parseReply('We deliver across the EU for free.', ids)).toEqual({ say: 'We deliver across the EU for free.', goTo: null });
    expect(parseReply('{"say": "unterminated', ids)?.say).toBe('{"say": "unterminated');
    expect(parseReply('   ', ids)).toBeNull();
    expect(parseReply('{"goTo":"a"}', ids)).toBeNull();
  });
});

describe('keywordAnswer (no model)', () => {
  it('matches colours through their shades', () => {
    const r = keywordAnswer('Show me something blue', items, guide);
    expect(['a', 'b']).toContain(r.goTo);
    expect(r.say).toMatch(/Teal|Denim/);
  });

  it('finds the finest and the cheapest', () => {
    expect(keywordAnswer("What's your best Persian rug?", items, guide).goTo).toBe('c');
    expect(keywordAnswer('Anything cheap?', items, guide).goTo).toBe('d');
  });

  it('answers delivery and made-to-measure from the shop text', () => {
    expect(keywordAnswer('Do you deliver?', items, guide)).toEqual({ say: 'Delivery is free in the EU.', goTo: null });
    expect(keywordAnswer('Can you make a custom size?', items, guide).say).toContain('Made-to-measure');
    expect(keywordAnswer('Do you deliver?', items, { name: 'Ava' }).say).toMatch(/shop/);
  });

  it('starts the tour, greets, and never answers nothing', () => {
    expect(keywordAnswer('Can you give me a tour?', items, guide).goTo).toBe('tour');
    expect(keywordAnswer('hello', items, guide).say).toContain("I'm Ava");
    const none = keywordAnswer('zzzz qqq', items, guide);
    expect(none.goTo).toBeNull();
    expect(none.say.length).toBeGreaterThan(10);
  });
});

describe('the tour', () => {
  it('walks nearest first from the start, one of each name, at most TOUR_MAX', () => {
    expect(tourRoute(list, [7, 0, 0]).map((p) => p.id)).toEqual(['d', 'c', 'b', 'a']);
    const many: Product[] = Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, name: `Rug ${i}`, position: [i, 0, 0] }));
    expect(tourRoute(many, [0, 0, 0])).toHaveLength(TOUR_MAX);
  });

  it("follows the world's own order, unknown ids dropped", () => {
    expect(tourRoute(list, [0, 0, 0], ['c', 'nope', 'a', 'c']).map((p) => p.id)).toEqual(['c', 'a']);
    expect(tourRoute(list, [7, 0, 0], ['nope']).map((p) => p.id)).toEqual(['d', 'c', 'b', 'a']);
  });

  it('narrates name, size, price and the first detail', () => {
    const a = list[0] as Product;
    expect(narrate(a, 0, 4)).toBe('We start with the Vinton Persian Rug, Teal. It\'s 160 × 230 cm and costs €1,290. A classic Persian medallion in teal.');
    expect(narrate(a, 3, 4)).toMatch(/^And last, the Vinton/);
    expect(narrate({ id: 'x', name: 'Plain', position: null }, 1, 3)).toBe('Next, the Plain.');
    expect(describeProduct(a)).toBe('The Vinton Persian Rug, Teal (160 × 230 cm, €1,290). A classic Persian medallion in teal.');
  });

  it('greets with the tour offer unless the world has its own line', () => {
    expect(greetingFor({ name: 'Ava' }, 'Rug Gallery', true)).toBe("Welcome to Rug Gallery! I'm Ava. Shall I show you round?");
    expect(greetingFor({ name: 'Ava', greeting: 'Hi there.' }, 'x', true)).toBe('Hi there.');
  });
});

describe('the guide finds its way (place.ts)', () => {
  // A wall along z = 15 with a 4 m opening at x 13..17, seen only from its +z side (a single-sided face, as the renderer's
  // rays meet a wall's front and not its back).
  const fake = {
    raycastWorld(o: number[], d: number[], max: number) {
      const [ox, oy, oz] = o as [number, number, number];
      const [dx, dy, dz] = d as [number, number, number];
      const len = Math.hypot(dx, dy, dz);
      if (dz / len >= 0 || oz < 15) return null;
      const t = ((15 - oz) / dz) * len;
      if (t < 0 || t > max) return null;
      const x = ox + (dx / len) * t;
      if (x > 13 && x < 17) return null;
      return { id: 'wall', point: [x, oy + (dy / len) * t, 15], normal: [0, 0, 1] };
    },
  } as unknown as Parameters<typeof clearWalk>[0];
  (globalThis as { requestAnimationFrame?: (f: () => void) => number }).requestAnimationFrame ??= (f) => setTimeout(f, 0) as unknown as number;

  it('sees a wall from either side', () => {
    expect(clearWalk(fake, [5, 0, 18], [5, 0, 10], new Set())).toBe(false);
    expect(clearWalk(fake, [5, 0, 10], [5, 0, 18], new Set())).toBe(false);
    expect(clearWalk(fake, [15, 0, 18], [15, 0, 10], new Set())).toBe(true);
  });

  it('walks through the opening, not the wall', async () => {
    const path = await walkPath(fake, [5, 0, 18], [5, 0, 10], [[15, 0, 15], [15, 0, 15.9], [15, 0, 14.1]], new Set());
    expect(path).not.toBeNull();
    let at: number[] = [5, 0, 18];
    for (const p of path as number[][]) {
      expect(clearWalk(fake, at as [number, number, number], p as [number, number, number], new Set())).toBe(true);
      at = p;
    }
    expect(at).toEqual([5, 0, 10]);
    expect(await walkPath(fake, [5, 0, 18], [5, 0, 10], [], new Set())).toBeNull();
  });
});
