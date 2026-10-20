/**
 * The action, city and story flagships (Hollow Gate, Kart Canyon, Neon Rain City, Kyoto Temple, Orbital Lab, Chain Reaction): what
 * a still of each is made of. These are the defects found in screenshot rounds, pinned so they cannot come back: floating props, solid
 * clouds over a road, flat gates, people who are not people, windows with nothing behind them.
 */
import { applyPatches, createWorld, type Entity, type WorldDoc } from '@aether/core';
import { describe, expect, it } from 'vitest';
import { FLAGSHIPS } from '../src/providers/mock/showcase/index';
import { Builder } from '../src/providers/mock/builder';

function build(id: string): WorldDoc {
  const f = FLAGSHIPS.find((x) => x.id === id);
  if (!f) throw new Error(`no flagship ${id}`);
  const r = applyPatches(createWorld(), f.plan().patches);
  expect(r.errors.map((e) => e.message)).toEqual([]);
  return r.world;
}

const all = (w: WorldDoc): Entity[] => Object.values(w.entities);
const named = (w: WorldDoc, re: RegExp): Entity[] => all(w).filter((e) => re.test(e.id));

describe('plans are chunk-safe', () => {
  it('puts the player settings after the entities (a chunk may not name an entity from a later one)', () => {
    const b = new Builder(1, [], { night: false, dusk: false, dawn: false, rain: false, snow: false, fog: false, lowGravity: false, water: false });
    const id = b.prim('kart', 'box', [1, 1, 1], [0, 0, 0]);
    b.player({ mode: 'vehicle', controls: id });
    const ops = b.build().map((p) => p.op);
    expect(ops.indexOf('setPlayer')).toBeGreaterThan(ops.lastIndexOf('add'));
  });
});

describe('The Hollow Gate', () => {
  const w = build('hollow-gate');
  it('has a masonry wall with a coping and buttresses, not a slab', () => {
    expect(named(w, /^wall-1$/)[0]?.material?.finish).toBe('limestone');
    expect(named(w, /^wall-cap/).length).toBeGreaterThanOrEqual(5);
    expect(named(w, /^buttress/).length).toBeGreaterThanOrEqual(6);
  });
  it('gives the guard a held torch, not a pole floating beside him', () => {
    const guard = all(w).find((e) => e.name === 'Marek');
    expect(guard?.character?.hold).toBe('torch');
    const poles = all(w).filter((e) => e.parent === guard?.id && e.tags.includes('torch') && e.shape.kind === 'primitive' && e.shape.primitive === 'cylinder');
    expect(poles).toHaveLength(0);
  });
  it('shows gold as a warm glowing coin with a milled rim, not a pale flat disc', () => {
    const coins = named(w, /^gold-\d+$/);
    expect(coins.length).toBe(6);
    expect(coins[0]?.material?.preset).toBe('gold');
    expect(coins[0]?.material?.color?.toLowerCase()).toBe('#f0b838');
    expect(named(w, /^gold-rim/).length).toBe(6);
  });
  it('gives Mira a stall with an awning, goods and a lantern', () => {
    expect(named(w, /^stall-awning/).length).toBe(8);
    expect(named(w, /^stall-loaf/).length).toBe(3);
    expect(named(w, /^stall-lantern-\d+$/).length).toBe(1);
  });
  it('lights the wolves’ clearing so the pack can be seen', () => {
    const shaft = all(w).find((e) => e.name === 'Moon shaft');
    expect(shaft).toBeDefined();
    const light = all(w).find((e) => e.parent === shaft?.id && e.light);
    expect(light?.light?.color.toLowerCase()).toBe('#9db8ff');
  });
});

describe('Kart Canyon', () => {
  const w = build('kart-canyon');
  it('starts under a real gantry: pylons, a painted beam, a chequered banner and start lights', () => {
    const start = all(w).find((e) => e.name === 'Start gantry');
    expect(start).toBeDefined();
    const kids = all(w).filter((e) => e.parent === start?.id);
    expect(kids.filter((e) => e.id.startsWith('gantry-pylon')).length).toBe(2);
    expect(kids.filter((e) => e.id.startsWith('chequer-banner')).length).toBe(40);
    expect(kids.filter((e) => e.id.startsWith('start-light')).length).toBe(5);
    // No flat glowing frame.
    expect(named(w, /^gate-post|^gate-banner/).filter((e) => e.material?.preset === 'neon')).toHaveLength(0);
  });
  it('has stepped, roofed stands with seats and a crowd of people on the terraces', () => {
    expect(named(w, /^(stand-tier|grandstand)/).length).toBe(6);
    expect(named(w, /^stand-seats/).length).toBe(6);
    expect(named(w, /^stand-roof$/).length + named(w, /^stand-roof-1$/).length).toBeGreaterThanOrEqual(1);
    const fans = named(w, /^fan-/);
    expect(fans.length).toBeGreaterThanOrEqual(20);
    expect(fans.every((f) => f.character !== undefined)).toBe(true);
    // Every fan stands on a tread (above the tier they are on), none floats.
    for (const f of fans) expect(f.transform.position[1]).toBeGreaterThan(1.3);
  });
  it('has chevron boost pads, tyre walls on both hairpins and a kart big enough to read', () => {
    expect(named(w, /^boost-chevron/).length).toBe(12);
    expect(named(w, /^tyre-stack/).length).toBeGreaterThanOrEqual(24);
    expect(w.entities['kart-1']?.transform.scale[0]).toBeGreaterThan(1.2);
  });
});

describe('Neon Rain City', () => {
  const w = build('neon-rain-city');
  it('lights its street level: shopfronts with glass, mullions and spilled light', () => {
    expect(named(w, /^shop-glass/).length).toBeGreaterThanOrEqual(8);
    expect(named(w, /^shop-mullion/).length).toBeGreaterThanOrEqual(24);
    expect(named(w, /^shop-spill/).length).toBeGreaterThanOrEqual(8);
  });
  it('has no solid cloud sitting in the road', () => {
    expect(named(w, /^steam/)).toHaveLength(0);
    expect(all(w).filter((e) => e.shape.kind === 'procedural' && e.shape.generator === 'cloud')).toHaveLength(0);
  });
  it('puts umbrellas up over some of the pedestrians and parks cars at the kerb', () => {
    const people = named(w, /^pedestrian-/);
    expect(people.length).toBeGreaterThanOrEqual(8);
    expect(people.filter((p) => p.character?.hold === 'umbrella').length).toBeGreaterThanOrEqual(3);
    expect(named(w, /^parked-car-\d+$/).length).toBe(5);
    expect(named(w, /^traffic-light/).length).toBe(4);
  });
  it('has a glossy wet road', () => {
    expect(w.entities['avenue-1']?.material?.roughness ?? 1).toBeLessThan(0.4);
  });
});

describe('Kyoto Temple Lanterns', () => {
  const w = build('kyoto-temple');
  it('lines the path with stone lanterns (post, firebox, hip cap), half of them alight', () => {
    const roots = named(w, /^stone-lantern-\d+$/);
    expect(roots.length).toBeGreaterThanOrEqual(6);
    expect(named(w, /^toro-cap/).length).toBe(roots.length);
    const lit = named(w, /^toro-fire-\d+$/).filter((e) => (e.material?.emissiveIntensity ?? 0) > 1);
    expect(lit.length).toBeGreaterThanOrEqual(roots.length / 2 - 1);
  });
  it('builds halls with a timber frame, tiled two-part roofs and a finial, and no floating ridge beam', () => {
    expect(named(w, /^hall-post/).length).toBeGreaterThanOrEqual(12);
    expect(named(w, /^hall-roof-top/)[0]?.material?.finish).toBe('roof-tile');
    expect(named(w, /^hall-ridge/)).toHaveLength(0);
    expect(named(w, /^hall-finial/).length).toBe(2);
  });
});

describe('Orbital Lab', () => {
  const w = build('orbital-lab');
  it('is crewed by people, not a primitive robot', () => {
    expect(all(w).filter((e) => e.shape.kind === 'procedural' && e.shape.generator === 'robot')).toHaveLength(0);
    const crew = all(w).filter((e) => e.id.startsWith('crew-'));
    expect(crew.map((c) => c.name).sort()).toEqual(['Chief Okafor', 'Dr. Lin']);
    for (const c of crew) {
      expect(c.character?.wardrobe).toBe('worker');
      expect(c.behaviors.some((b) => b.type === 'npc')).toBe(true);
    }
  });
  it('has plated pods with portholes, a hatch, a dome and a beacon', () => {
    expect(named(w, /^porthole/).length).toBeGreaterThanOrEqual(20);
    expect(named(w, /^pod-hatch-\d+$/).length).toBe(4);
    expect(named(w, /^pod-dome/).length).toBe(4);
    expect(named(w, /^pod-beacon/).length).toBe(4);
  });
  it('has a railing around the deck and a braced gantry', () => {
    expect(named(w, /^rail-post/).length).toBe(48);
    expect(named(w, /^gantry-post/).length).toBe(4);
    expect(named(w, /^gantry-brace/).length).toBe(4);
  });
  it('is hazy, not a dead vacuum, and the crane arm sits on its mast', () => {
    expect(w.environment.fog).not.toBeNull();
    const mast = w.entities['crane-mast-1'];
    const arm = w.entities['crane-arm-1'];
    const mastTop = (mast?.transform.position[1] ?? 0) + (mast?.shape.kind === 'primitive' ? mast.shape.size[1] / 2 : 0);
    const armBottom = (arm?.transform.position[1] ?? 0) - 0.3;
    expect(armBottom - mastTop).toBeGreaterThanOrEqual(0);
    expect(armBottom - mastTop).toBeLessThan(0.3);
  });
});

describe('Chain Reaction', () => {
  const w = build('chain-reaction');
  it('is a workshop: a brick wall with a factory window over each machine, girders, columns and pendant lamps', () => {
    expect(w.entities['workshop-wall-1']?.material?.finish).toBe('brick');
    expect(named(w, /^window-glow/).length).toBe(60); // twelve panes in each of the five factory windows
    expect(named(w, /^girder-\d+$/).length).toBe(5);
    expect(named(w, /^column-\d+$/).length).toBe(6);
    expect(named(w, /^lamp-shade/).length).toBe(5);
  });
  it('stands on gravel, not a lawn, and the stage keeps its machines', () => {
    expect(w.environment.ground?.material?.finish).toBe('gravel');
    expect(named(w, /^domino-/).length).toBe(20);
  });
});
