/**
 * Generated houses for the stair sweeps: a footprint, a split into two rooms on every storey, doors between them
 * and a stair drawn at a random place (it is usually wrong; create_building settles it). Deterministic by seed.
 */
import type { PlanStair } from '../../src/plan';

/** Small seeded generator (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

export interface GeneratedHouse {
  plan: Record<string, unknown>;
  /** One line for failure messages. */
  label: string;
}

const HEADINGS = ['north', 'east', 'south', 'west'] as const;
const snap = (v: number, step = 0.5): number => Math.round(v / step) * step;

/** A house of 2 or 3 storeys, 7-15 m wide and 5-9 m deep, with a stair per storey drawn anywhere on the ground floor. */
export function generateHouse(seed: number, opts: { furnish?: boolean } = {}): GeneratedHouse {
  const r = rng(seed * 7919 + 13);
  const W = snap(7 + r() * 8);
  const D = snap(5 + r() * 4);
  const a = snap(W * (0.4 + r() * 0.25));
  const storeys = r() < 0.3 ? 3 : 2;
  const height = [2.7, 2.9, 3.1, 3.4][Math.floor(r() * 4)] as number;
  const mirror = r() < 0.5;
  const rect = (x0: number, z0: number, x1: number, z1: number): [number, number, number, number] => (mirror ? [W - x1, z0, W - x0, z1] : [x0, z0, x1, z1]);
  const styles = ['modern', 'scandinavian', 'industrial', 'classic'] as const;
  const stairs = (): PlanStair[] => {
    const shape = (['straight', 'l', 'u'] as const)[Math.floor(r() * 3)] as PlanStair['shape'];
    return [{ at: [snap(r() * a, 0.1), snap(r() * D, 0.1)], heading: HEADINGS[Math.floor(r() * 4)] as PlanStair['heading'], shape, width: r() < 0.5 ? 1 : 0.9, turn: r() < 0.5 ? 'left' : 'right' }];
  };
  const levels: Array<Record<string, unknown>> = [];
  const d1 = snap(D * (0.4 + r() * 0.2));
  levels.push({
    height,
    rooms: [
      { id: 'hall', type: (r(), 'hall'), rect: rect(0, 0, a, D) },
      { id: 'living', type: r() < 0.5 ? 'living' : 'dining', rect: rect(a, 0, W, D) },
    ],
    doors: [{ between: ['hall', 'outside'], side: mirror ? 'south' : 'south', main: true }, { between: ['hall', 'living'], kind: 'opening', width: 1.2, at: 0.5 }],
    stairs: stairs(),
  });
  for (let s = 1; s < storeys; s++) {
    levels.push({
      height,
      rooms: [
        { id: `landing${s}`, type: 'hall', rect: rect(0, 0, a, s === 1 ? D : d1) },
        ...(s === 1 ? [] : [{ id: `store${s}`, type: 'bedroom', rect: rect(0, d1, a, D) }]),
        { id: `bed${s}`, type: 'bedroom', rect: rect(a, 0, W, D) },
      ],
      doors: [{ between: [`landing${s}`, `bed${s}`], at: 0.5 }, ...(s === 1 ? [] : [{ between: [`landing${s}`, `store${s}`], at: 0.5 }])],
      ...(s < storeys - 1 ? { stairs: stairs() } : {}),
    });
  }
  if (opts.furnish === false) for (const l of levels) for (const room of l['rooms'] as Array<Record<string, unknown>>) room['furnish'] = false;
  const plan = { id: 'house', style: styles[Math.floor(r() * 4)], levels };
  return { plan, label: `seed ${seed}: ${W} x ${D} m, split at ${a}, ${storeys} storeys of ${height} m, drawn stairs ${JSON.stringify(levels.map((l) => (l['stairs'] as PlanStair[] | undefined)?.[0]))}` };
}
