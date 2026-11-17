/**
 * The showroom guide's tour model (player/guide/brain.ts `tourStops` and friends): mixed stops (plain ids and authored
 * `{ at, chapter, intro, title, say }`), chapters, the lines said and their recording keys, the length estimate; the
 * following view's trail (guide.ts `Trail`) and spring (explore.ts `smoothDamp`); and the Rug Exhibition Hall's tour.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WorldDoc } from '@aether/core';
import { catalogue, FIXED_LINES, greetingFor, guideLines, products, speechSeconds, stopLine, talkLine, TOUR_END_SAVED, tourMinutes, tourStops } from '../src/player/guide/brain';
import { Trail } from '../src/player/guide/guide';
import { voiceKey } from '../src/player/guide/voice';
import { smoothDamp } from '../src/player/explore';

const at = (x: number, z: number) => ({ position: [x, 0, z], rotation: [0, 0, 0], scale: [1, 1, 1] });
const world = WorldDoc.parse({
  name: 'Rug Gallery',
  entities: {
    desk: { id: 'desk', name: 'Reception desk', transform: at(0, 10) },
    a: { id: 'a', name: 'a', transform: at(0, 0), product: { name: 'Heriz Runner', price: '€690', size: '80 × 300 cm', details: 'Hand-knotted. Teal.' } },
    b: { id: 'b', name: 'b', transform: at(5, 0), product: { name: 'Tabriz Runner', price: '€620' } },
    c: { id: 'c', name: 'c', transform: at(10, 0), product: { name: 'Heriz Runner', price: '€690' } },
  },
  guide: {
    name: 'Ava',
    tour: [
      { at: 'desk', chapter: 'Welcome', intro: "Let's begin at the desk.", title: 'Reception', say: 'This is our reception.' },
      'a',
      { at: 'nope', chapter: 'Lost' },
      { at: 'b', chapter: 'The hall', intro: 'Into the hall.' },
      'a',
      { at: 'c', say: 'Its twin.' },
    ],
  },
});
const list = products(world);

describe('tour stops', () => {
  const stops = tourStops(world, list, world.guide?.tour);

  it('reads plain ids and authored stops in order, dropping unknown entities and repeats', () => {
    expect(stops.map((s) => s.id)).toEqual(['desk', 'a', 'b', 'c']);
    expect(stops.map((s) => s.product?.id ?? null)).toEqual([null, 'a', 'b', 'c']);
  });

  it('carries a chapter on until the next names one; its intro belongs to its first stop', () => {
    expect(stops.map((s) => s.chapter)).toEqual(['Welcome', 'Welcome', 'The hall', 'The hall']);
    expect(stops.map((s) => s.intro ?? null)).toEqual(["Let's begin at the desk.", null, 'Into the hall.', null]);
  });

  it('titles a stop by its title, else its product, else the entity', () => {
    expect(stops.map((s) => s.title)).toEqual(['Reception', 'Heriz Runner', 'Tabriz Runner', 'Heriz Runner']);
    expect(tourStops(world, list, ['desk'])[0]?.title).toBe('Reception desk');
    expect(stops[0]?.position).toEqual([0, 0, 10]);
  });

  it('says the authored line, else one made from the product, else the title', () => {
    expect(stopLine(stops, 0)).toBe('This is our reception.');
    expect(stopLine(stops, 1)).toBe("Next, the Heriz Runner. It's 80 × 300 cm and costs €690. Hand-knotted.");
    expect(stopLine(stops, 3)).toBe('Its twin.');
    expect(stopLine(tourStops(world, list, ['b', 'desk']), 1)).toBe('Here is the Reception desk.');
  });

  it('without a tour walks the products, one of each name', () => {
    const plain = WorldDoc.parse({ ...world, guide: { name: 'Ava' } });
    const s = tourStops(plain, list, undefined);
    expect(s.map((x) => x.id)).toEqual(['a', 'b']);
    expect(s.every((x) => x.chapter === '' && !x.intro)).toBe(true);
    expect(tourStops(plain, list, [{ at: 'nope' }]).map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('estimates its length in whole minutes from the walk and the lines', () => {
    const lines = stops.reduce((t, s, i) => t + (s.intro ? speechSeconds(s.intro) : 0) + speechSeconds(stopLine(stops, i)), 0);
    expect(lines).toBeGreaterThan(5);
    expect(tourMinutes(stops, [0, 0, 10])).toBe(1);
    const long = Array.from({ length: 20 }, () => stops).flat();
    expect(tourMinutes(long, [0, 0, 10])).toBeGreaterThan(5);
  });
});

describe('the lines to record', () => {
  it('collects the greeting, the fixed lines, every intro and stop line and the product lines, once each', () => {
    const lines = guideLines(world);
    const stops = tourStops(world, list, world.guide?.tour);
    expect(lines).toContain(greetingFor({ name: 'Ava' }, 'Rug Gallery', true));
    for (const f of FIXED_LINES) expect(lines).toContain(f);
    for (const [i, s] of stops.entries()) {
      expect(lines).toContain(stopLine(stops, i));
      if (s.intro) expect(lines).toContain(s.intro);
    }
    for (const p of catalogue(list)) expect(lines).toContain(talkLine(p));
    expect(new Set(lines).size).toBe(lines.length);
    expect(new Set(lines.map(voiceKey)).size).toBe(lines.length);
    expect(lines).toContain(TOUR_END_SAVED);
  });
});

describe('the following view', () => {
  it('keeps to the trail the guide walked', () => {
    const t = new Trail();
    t.reset([0, 0, 0]);
    for (let i = 1; i <= 20; i++) t.push([i / 5, 0, 0]);
    for (let i = 1; i <= 10; i++) t.push([4, 0, i / 5]);
    const g: [number, number, number] = [4, 0, 2];
    // 2.3 m back: round the corner at (4, 0).
    const b = t.back(g, 2.3) as number[];
    expect(b[0]).toBeCloseTo(3.7, 1);
    expect(b[2]).toBeCloseTo(0, 1);
    // Further back than the trail goes: its start.
    expect(t.back(g, 50)).toEqual([0, 0, 0]);
  });

  it('keeps only the latest points in its ring', () => {
    const t = new Trail(4);
    t.reset([0, 0, 0]);
    for (let i = 1; i <= 10; i++) t.push([i, 0, 0]);
    // The ring holds 7..10: further back than that is its oldest point.
    expect(t.back([10, 0, 0], 100)).toEqual([7, 0, 0]);
    expect(t.back([10, 0, 0], 1.5)).toEqual([8.5, 0, 0]);
  });

  it('eases with a critically damped spring: no overshoot, arrives', () => {
    let x = 0;
    let v = 0;
    let max = 0;
    for (let i = 0; i < 240; i++) {
      [x, v] = smoothDamp(x, v, 10, 0.55, 1 / 60);
      max = Math.max(max, x);
    }
    expect(max).toBeLessThanOrEqual(10 + 1e-9);
    expect(x).toBeCloseTo(10, 2);
  });
});

describe('the Rug Exhibition Hall', () => {
  const file = JSON.parse(readFileSync(new URL('../public/templates/worlds/rug-exhibition-hall.json', import.meta.url), 'utf8')) as { world: unknown };
  const w = WorldDoc.parse(file.world);
  const ps = products(w);
  const stops = tourStops(w, ps, w.guide?.tour);

  it('tours the whole building in chapters, every design shown, ending at the Kashan', () => {
    expect(stops.length).toBeGreaterThanOrEqual(15);
    expect(stops.length).toBeLessThanOrEqual(20);
    expect(stops.length).toBe(w.guide?.tour?.length);
    expect(stops[0]?.id).toBe('gallery-reception');
    expect(stops[stops.length - 1]?.id).toBe('wall-rug-feature');
    expect(stops.some((s) => s.id === 'loom-sculpture')).toBe(true);
    const shown = new Set(stops.map((s) => s.product?.name).filter(Boolean));
    for (const item of catalogue(ps)) expect(shown).toContain(item.name);
    // Every chapter opens with an intro.
    const chapters = [...new Set(stops.map((s) => s.chapter))];
    expect(chapters.length).toBeGreaterThanOrEqual(6);
    for (const c of chapters) expect(stops.find((s) => s.chapter === c)?.intro).toBeTruthy();
    const m = tourMinutes(stops, w.player.spawn);
    expect(m).toBeGreaterThanOrEqual(5);
    expect(m).toBeLessThanOrEqual(12);
  });

  it('speaks plain lines: short, no emoji or dashes', () => {
    for (const [i, s] of stops.entries())
      for (const line of [s.intro, stopLine(stops, i)].filter((x): x is string => !!x)) {
        expect(line.length).toBeLessThanOrEqual(300);
        expect(line).not.toMatch(/[—–]|\p{Extended_Pictographic}/u);
        expect((line.match(/[.!?](\s|$)/g) ?? []).length).toBeLessThanOrEqual(4);
      }
  });
});
