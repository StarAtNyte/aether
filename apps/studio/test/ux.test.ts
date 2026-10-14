import { describe, expect, it } from 'vitest';
import { createWorld } from '@aether/core';
import { cardPlacement, markTourSeen, TOUR_KEY, TOUR_STEPS, tourSeen } from '../src/onboarding/tour';
import { MAX_PLAN_MARKS, planKey, planMarks } from '../src/lib/planMarks';
import { flightPath } from '../src/lib/promptFlight';
import { stageIndex } from '../src/home/Hero';
import { sealText } from '../src/components/viewport/ProofSeal';
import { paletteResults, MIN_FALLBACK_QUERY, type Command } from '../src/components/ui/CommandPalette';
import { isHelpKey, SHORTCUT_GROUPS } from '../src/components/ShortcutsDialog';
import { SHORTCUTS } from '../src/app/useShortcuts';
import { DEFAULT_SETTINGS, loadSettings, type StorageLike } from '../src/lib/storage';

function memory(init: Record<string, string> = {}): StorageLike & { data: Map<string, string> } {
  const data = new Map(Object.entries(init));
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

describe('tour', () => {
  it('has three steps: describe, prove, play', () => {
    expect(TOUR_STEPS.map((s) => s.id)).toEqual(['describe', 'prove', 'play']);
  });

  it('remembers being seen and rejects tampered markers', () => {
    const s = memory();
    expect(tourSeen(s)).toBe(false);
    markTourSeen(s, 5);
    expect(tourSeen(s)).toBe(true);
    for (const bad of ['true', '{"done":"yes"}', '[1]', '{"__proto__":{"done":true}}', 'not json']) {
      expect(tourSeen(memory({ [TOUR_KEY]: bad }))).toBe(false);
    }
    expect(tourSeen(null)).toBe(false);
  });

  it('places the card beside its anchor and keeps it on screen', () => {
    const view = { width: 1440, height: 900 };
    const card = { width: 300, height: 160 };
    expect(cardPlacement({ left: 60, top: 780, width: 240, height: 60 }, view, card).side).toBe('right');
    const below = cardPlacement({ left: 1300, top: 10, width: 100, height: 30 }, view, card);
    expect(below.side).toBe('below');
    expect(below.left + card.width).toBeLessThanOrEqual(view.width);
    expect(cardPlacement(null, view, card)).toEqual({ left: 570, top: 370, side: 'center' });
    // Off-screen anchors centre the card.
    expect(cardPlacement({ left: 2000, top: 10, width: 10, height: 10 }, view, card).side).toBe('center');
    // A phone: no room to the right, the card goes above a bottom anchor.
    const phone = cardPlacement({ left: 16, top: 760, width: 358, height: 60 }, { width: 390, height: 844 }, { width: 300, height: 160 });
    expect(phone.side).toBe('above');
    expect(phone.top).toBeGreaterThanOrEqual(12);
  });
});

describe('plan annotations', () => {
  const world = createWorld({
    entities: {
      p1: { id: 'p1', name: 'Palm 1', shape: { kind: 'procedural', generator: 'palm' }, transform: { position: [0, 0, 0] } },
      p2: { id: 'p2', name: 'Palm 2', shape: { kind: 'procedural', generator: 'palm' }, transform: { position: [4, 2, 0] } },
      c1: { id: 'c1', name: 'Coin #3', shape: { kind: 'primitive', primitive: 'cylinder', size: [1, 0.1, 1] } },
      t: { id: 't', name: '', shape: { kind: 'procedural', generator: 'terrain' } },
      kid: { id: 'kid', name: 'Hat', parent: 'p1', shape: { kind: 'primitive', primitive: 'cone', size: [1, 1, 1] } },
      box: { id: 'box', name: '', shape: { kind: 'primitive', primitive: 'box', size: [1, 1, 1] } },
    },
  });

  it('groups new top-level objects by name without numbering', () => {
    const marks = planMarks(null, world);
    expect(marks.map((m) => [m.name, m.metric])).toEqual([
      ['Palm', '×2'],
      ['Box', 'new'],
      ['Coin', 'new'],
    ]);
    const palm = marks[0];
    expect(palm?.tone).toBe('plan');
    expect(palm?.position[0]).toBeCloseTo(2, 5);
    expect(palm?.position[1]).toBeCloseTo(2 + 1.4, 5);
  });

  it('only annotates what is new, and skips backdrops', () => {
    const before = createWorld({ entities: { p1: world.entities['p1'] as never, p2: world.entities['p2'] as never } });
    expect(planMarks(before, world).map((m) => m.name)).toEqual(['Box', 'Coin']);
    expect(planKey(world.entities['t'] as never)).toBeNull();
  });

  it('caps the number of groups', () => {
    const entities: Record<string, unknown> = {};
    for (let i = 0; i < 20; i++) entities[`e${i}`] = { id: `e${i}`, name: `Thing${String.fromCharCode(65 + i)}`, shape: { kind: 'primitive', primitive: 'box', size: [1, 1, 1] } };
    expect(planMarks(null, createWorld({ entities: entities as never })).length).toBe(MAX_PLAN_MARKS);
  });
});

describe('prompt flight', () => {
  it('arcs from the composer centre to the viewport centre and fades out', () => {
    const k = flightPath({ left: 0, top: 800, width: 200, height: 40 }, { left: 300, top: 0, width: 800, height: 600 }, { width: 100, height: 20 });
    expect(k[0]).toEqual({ x: 50, y: 810, scale: 1, opacity: 1 });
    expect(k[2]).toEqual({ x: 650, y: 290, scale: 0.35, opacity: 0 });
    // The midpoint lifts above the higher end.
    expect(k[1]?.y).toBeLessThan(290);
  });
});

describe('hero stage', () => {
  it('cycles slides by time and tolerates bad input', () => {
    expect(stageIndex(0, 5)).toBe(0);
    expect(stageIndex(4.6, 5, 4.5)).toBe(1);
    expect(stageIndex(4.5 * 5 + 0.1, 5, 4.5)).toBe(0);
    expect(stageIndex(-1, 5)).toBe(0);
    expect(stageIndex(Number.NaN, 5)).toBe(0);
    expect(stageIndex(10, 0)).toBe(0);
  });
});

describe('proof seal text', () => {
  it('summarises passed and failed runs', () => {
    expect(sealText({ passed: true, tests: 4, passedTests: 4, seconds: 7.267 })).toEqual({ title: 'Proved', detail: '4 of 4 checks · 7.3 s simulated' });
    expect(sealText({ passed: true, tests: 0, passedTests: 0, seconds: 0 })).toEqual({ title: 'Proved', detail: 'Settles cleanly' });
    expect(sealText({ passed: false, tests: 3, passedTests: 1, seconds: 2 }).detail).toBe('2 of 3 checks failed · 2.0 s simulated');
    expect(sealText({ passed: false, tests: 2, passedTests: 2, seconds: 0 }).detail).toBe('Physics problems found');
  });
});

describe('command palette free text', () => {
  const commands: Command[] = [
    { id: 'play', title: 'Play', group: 'Actions', run: () => undefined },
    { id: 'undo', title: 'Undo', group: 'Actions', run: () => undefined },
  ];
  const ask = (q: string): Command => ({ id: 'ask', title: `Ask: ${q}`, group: 'Agent', run: () => undefined });

  it('offers the fallback last, or alone when nothing matches', () => {
    expect(paletteResults(commands, 'pla', ask).map((c) => c.id)).toEqual(['play', 'ask']);
    expect(paletteResults(commands, 'make it snow', ask).map((c) => c.id)).toEqual(['ask']);
    // A sentence goes first even when fuzzy matching finds something; a command's own name does not.
    expect(paletteResults(commands, 'put a lamp on', ask)[0]?.id).toBe('ask');
    expect(paletteResults([{ id: 'snow', title: 'Make it snow now', group: 'x', run: () => undefined }], 'make it snow', ask).map((c) => c.id)).toEqual(['snow', 'ask']);
    expect(paletteResults(commands, 'x'.repeat(MIN_FALLBACK_QUERY - 1), ask).every((c) => c.id !== 'ask')).toBe(true);
    expect(paletteResults(commands, '', ask).map((c) => c.id)).toEqual(['play', 'undo']);
    expect(paletteResults(commands, 'make it snow').length).toBe(0);
  });
});

describe('shortcuts overlay', () => {
  it('lists every shortcut once and opens on "?" only', () => {
    expect(SHORTCUTS.length).toBe(SHORTCUT_GROUPS.reduce((n, g) => n + g.items.length, 0));
    expect(SHORTCUTS.some(([k]) => k === '?')).toBe(true);
    expect(isHelpKey({ key: '?', ctrlKey: false, metaKey: false, altKey: false })).toBe(true);
    expect(isHelpKey({ key: '?', ctrlKey: true, metaKey: false, altKey: false })).toBe(false);
    expect(isHelpKey({ key: '/', ctrlKey: false, metaKey: false, altKey: false })).toBe(false);
  });
});

describe('new settings', () => {
  it('default to quiet interface sounds and full-window play, and validate types', () => {
    expect(DEFAULT_SETTINGS.uiSounds).toBe(false);
    expect(DEFAULT_SETTINGS.immersivePlay).toBe(true);
    const s = memory({ 'aether.studio.settings.v1': JSON.stringify({ uiSounds: true, immersivePlay: 'no' }) });
    const loaded = loadSettings(s);
    expect(loaded.uiSounds).toBe(true);
    expect(loaded.immersivePlay).toBe(true);
  });
});
