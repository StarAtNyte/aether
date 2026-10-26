/**
 * `arch-sign`: a sign with block lettering in an emissive material on a dark panel, for a facade, a canopy fascia or a shop
 * front. The lettering is a 5 x 7 pixel face (runs of pixels merged into bars), so a name of twenty letters is a few
 * thousand triangles in two materials: the panel and the glowing letters. Origin at the bottom centre, back at z = 0, front +Z.
 */
import { Geom, box } from './mesh';
import { PartSet } from './parts';
import type { SignParams } from './params';
import type { ArchOutput } from './types';

const G: Readonly<Record<string, string>> = {
  A: '.###.|#...#|#...#|#####|#...#|#...#|#...#', B: '####.|#...#|#...#|####.|#...#|#...#|####.', C: '.###.|#...#|#....|#....|#....|#...#|.###.',
  D: '####.|#...#|#...#|#...#|#...#|#...#|####.', E: '#####|#....|#....|####.|#....|#....|#####', F: '#####|#....|#....|####.|#....|#....|#....',
  G: '.###.|#...#|#....|#.###|#...#|#...#|.###.', H: '#...#|#...#|#...#|#####|#...#|#...#|#...#', I: '.###.|..#..|..#..|..#..|..#..|..#..|.###.',
  J: '..###|...#.|...#.|...#.|...#.|#..#.|.##..', K: '#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#', L: '#....|#....|#....|#....|#....|#....|#####',
  M: '#...#|##.##|#.#.#|#.#.#|#...#|#...#|#...#', N: '#...#|#...#|##..#|#.#.#|#..##|#...#|#...#', O: '.###.|#...#|#...#|#...#|#...#|#...#|.###.',
  P: '####.|#...#|#...#|####.|#....|#....|#....', Q: '.###.|#...#|#...#|#...#|#.#.#|#..#.|.##.#', R: '####.|#...#|#...#|####.|#.#..|#..#.|#...#',
  S: '.####|#....|#....|.###.|....#|....#|####.', T: '#####|..#..|..#..|..#..|..#..|..#..|..#..', U: '#...#|#...#|#...#|#...#|#...#|#...#|.###.',
  V: '#...#|#...#|#...#|#...#|#...#|.#.#.|..#..', W: '#...#|#...#|#...#|#.#.#|#.#.#|#.#.#|.#.#.', X: '#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#',
  Y: '#...#|#...#|.#.#.|..#..|..#..|..#..|..#..', Z: '#####|....#|...#.|..#..|.#...|#....|#####',
  '0': '.###.|#...#|#..##|#.#.#|##..#|#...#|.###.', '1': '..#..|.##..|..#..|..#..|..#..|..#..|.###.', '2': '.###.|#...#|....#|...#.|..#..|.#...|#####',
  '3': '####.|....#|....#|.###.|....#|....#|####.', '4': '...#.|..##.|.#.#.|#..#.|#####|...#.|...#.', '5': '#####|#....|####.|....#|....#|#...#|.###.',
  '6': '.###.|#....|#....|####.|#...#|#...#|.###.', '7': '#####|....#|...#.|..#..|.#...|.#...|.#...', '8': '.###.|#...#|#...#|.###.|#...#|#...#|.###.',
  '9': '.###.|#...#|#...#|.####|....#|....#|.###.', ' ': '.....|.....|.....|.....|.....|.....|.....', '!': '..#..|..#..|..#..|..#..|..#..|.....|..#..',
  '.': '.....|.....|.....|.....|.....|.....|..#..', ',': '.....|.....|.....|.....|.....|..#..|.#...', '-': '.....|.....|.....|#####|.....|.....|.....',
  "'": '..#..|..#..|.....|.....|.....|.....|.....', '&': '.##..|#..#.|#.#..|.#...|#.#.#|#..#.|.##.#', '/': '....#|....#|...#.|..#..|.#...|#....|#....',
  ':': '.....|..#..|.....|.....|.....|..#..|.....', '+': '.....|..#..|..#..|#####|..#..|..#..|.....',
};
const UNKNOWN = '#####|#...#|#...#|#...#|#...#|#...#|#####';

/** Latin letters with marks lose them (CAFÉ becomes CAFE). */
function plain(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}

/** The width of the lettering (m) for a text and the pixel size. */
export function signTextWidth(text: string, pixel: number): number {
  const n = [...plain(text)].length;
  return n === 0 ? 0 : (n * 6 - 1) * pixel;
}

/** Sign geometry for validated params. */
export function buildSign(p: SignParams): ArchOutput {
  const text = plain(p.text).slice(0, 40);
  const chars = [...text];
  const set = new PartSet();
  const h = p.height;
  const pad = Math.max(0.06, h * 0.14);
  let pixel = (h - 2 * pad) / 7;
  const natural = signTextWidth(text, pixel) + 2 * pad * 1.6;
  let width = p.width ?? natural;
  // Never wider than asked: shrink the lettering to fit.
  if (signTextWidth(text, pixel) + 2 * pad > width) pixel = Math.max(0.005, (width - 2 * pad) / Math.max(1, chars.length * 6 - 1));
  const tw = signTextWidth(text, pixel);
  const th = pixel * 7;
  width = Math.max(width, tw + 2 * pad);
  const d = p.depth;
  // Panel with a thin raised border.
  set.add(box(-width / 2, 0, 0, width / 2, h, d), p.panel);
  const rim = new Geom();
  const b = Math.min(0.025, h * 0.05);
  rim.merge(box(-width / 2 - b, -b, 0, width / 2 + b, 0, d + b));
  rim.merge(box(-width / 2 - b, h, 0, width / 2 + b, h + b, d + b));
  rim.merge(box(-width / 2 - b, 0, 0, -width / 2, h, d + b));
  rim.merge(box(width / 2, 0, 0, width / 2 + b, h, d + b));
  set.add(rim, p.rim);
  const letters = new Geom();
  const x0 = -tw / 2;
  const y0 = (h - th) / 2;
  const lz = d + p.relief;
  chars.forEach((ch, ci) => {
    const rows = (G[ch] ?? UNKNOWN).split('|');
    for (let r = 0; r < 7; r++) {
      const row = rows[r] ?? '.....';
      let c = 0;
      while (c < 5) {
        if (row[c] !== '#') {
          c++;
          continue;
        }
        let e = c;
        while (e < 5 && row[e] === '#') e++;
        const px0 = x0 + (ci * 6 + c) * pixel;
        const px1 = x0 + (ci * 6 + e) * pixel;
        const py1 = y0 + (7 - r) * pixel;
        letters.merge(box(px0, py1 - pixel, d, px1, py1, lz));
        c = e;
      }
    }
  });
  set.add(letters, { preset: 'emissive', color: p.letters, emissive: p.letters, emissiveIntensity: p.glow });
  return set.build();
}
