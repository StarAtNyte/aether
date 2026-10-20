import { describe, expect, it } from 'vitest';
import { clearStretches, fitWindow, planWindowAddition, WINDOW_END_MARGIN, WINDOW_GAP, windowsAsSpecs } from '../src/window-fit';
import type { ExteriorWall } from '../src/compile';

const wall = (side: ExteriorWall['side'], t1: number, openings: ExteriorWall['openings'] = [], edge = 0): ExteriorWall => ({ level: 0, room: 'k', side, edge, edgeLength: t1, t0: 0, t1, ceiling: 2.7, openings });

describe('window fitting', () => {
  it('keeps corners and openings clear', () => {
    const free = clearStretches(wall('north', 6, [{ kind: 'door', t0: 2, t1: 3, sill: 0, height: 2.1 }]));
    expect(free).toEqual([
      [WINDOW_END_MARGIN, 2 - WINDOW_GAP],
      [3 + WINDOW_GAP, 6 - WINDOW_END_MARGIN],
    ]);
  });

  it('prefers the widest clear stretch, so an empty wall beats a crowded one', () => {
    const walls = [wall('north', 6, [{ kind: 'window', t0: 2.4, t1: 3.6, sill: 0.9, height: 1.4, style: 'casement' }], 0), wall('east', 4, [], 1)];
    const spot = fitWindow(walls, 0, 'k', 1.2);
    expect(spot?.side).toBe('east');
    expect(spot?.centre).toBe(2);
    expect(fitWindow(walls, 0, 'k', 1.2, 'north')?.side).toBe('north');
    expect(fitWindow(walls, 0, 'k', 3.5)).toBeNull();
  });

  it('turns compiled windows into exact specs, and an even row into a spread', () => {
    const odd = windowsAsSpecs([wall('north', 6, [{ kind: 'window', t0: 1.4, t1: 2.6, sill: 0.9, height: 1.4, style: 'casement' }, { kind: 'door', t0: 4, t1: 5, sill: 0, height: 2.1 }])], 0, 'k');
    expect(odd).toEqual([{ room: 'k', side: 'north', count: 1, width: 1.2, height: 1.4, sill: 0.9, centres: [2], style: 'casement' }]);
    const row = windowsAsSpecs([wall('east', 6, [{ kind: 'window', t0: 0.9, t1: 2.1, sill: 0.9, height: 1.4 }, { kind: 'window', t0: 3.9, t1: 5.1, sill: 0.9, height: 1.4 }])], 0, 'k');
    expect(row).toEqual([{ room: 'k', side: 'east', count: 2, width: 1.2, height: 1.4, sill: 0.9 }]);
  });

  it('re-spreads a full even row when no stretch is clear, and refuses with measurements when that cannot fit either', () => {
    const full = [wall('north', 4, [{ kind: 'window', t0: 1.4, t1: 2.6, sill: 0.9, height: 1.4 }])];
    const more = planWindowAddition(full, [], 0, 'k', { room: 'k', count: 1, width: 1.2, height: 1.4, sill: 0.9 });
    expect(more.ok && more.windows).toEqual([{ room: 'k', side: 'north', count: 2, width: 1.2, height: 1.4, sill: 0.9 }]);
    const none = planWindowAddition([wall('north', 2.4, [{ kind: 'window', t0: 0.6, t1: 1.8, sill: 0.9, height: 1.4 }])], [], 0, 'k', { room: 'k', count: 1, width: 1.2, height: 1.4, sill: 0.9 });
    expect(none.ok).toBe(false);
    expect(!none.ok && none.hint).toMatch(/north 0\.00 m/);
  });
});
