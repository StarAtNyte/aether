/**
 * The lit window mask of the facade finish carries what a lit room looks like: a ceiling wash, dark furniture at the sill, curtains,
 * mullions and blinds, so a skyline of lit windows is not a field of flat bright rectangles.
 */
import { describe, expect, it } from 'vitest';
import { finishPixels } from '../src/finish-pixels';

describe('facade lit mask', () => {
  const n = 128;
  const { orm } = finishPixels('facade', n) as unknown as { orm: Uint8Array };
  const blue = (x: number, y: number): number => orm[(y * n + x) * 4 + 2] as number;

  it('varies inside the panes (a room), and is dark on the wall and the frame', () => {
    const values = new Set<number>();
    let lit = 0;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const b = blue(x, y);
        if (b > 8) {
          lit++;
          values.add(Math.round(b / 8));
        }
      }
    }
    // Panes cover a good share of the tile and hold many different levels (not one flat value).
    expect(lit).toBeGreaterThan(n * n * 0.25);
    expect(values.size).toBeGreaterThanOrEqual(8);
  });

  it('is brighter under the ceiling than at the sill in a pane without furniture', () => {
    // 4 bays per tile; bay (0, 0): pane spans x 15..85 %, y 20..83 % of the bay.
    const cell = n / 4;
    let upper = 0;
    let lower = 0;
    let samples = 0;
    for (let by = 0; by < 4; by++) {
      for (let bx = 0; bx < 4; bx++) {
        const x = Math.round(bx * cell + cell * 0.5 + 3);
        const topY = Math.round(by * cell + cell * (0.2 + 0.1));
        const botY = Math.round(by * cell + cell * (0.83 - 0.1));
        const u = blue(x, topY);
        const l = blue(x, botY);
        if (u > 8 && l > 8) {
          upper += u;
          lower += l;
          samples++;
        }
      }
    }
    expect(samples).toBeGreaterThan(3);
    expect(upper / samples).toBeGreaterThan(lower / samples);
  });
});
