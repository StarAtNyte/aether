/**
 * Pixel difference of two directories of PNG stills (same file names): mean absolute channel difference and the share of
 * pixels that differ by more than 8/255. Run: `tsx scripts/bench/pixel-diff.ts <dirA> <dirB>`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodePng } from '../../tests/e2e/support/png';

const [a, b] = process.argv.slice(2);
if (!a || !b) throw new Error('usage: pixel-diff <dirA> <dirB>');
for (const f of readdirSync(a).filter((n) => n.endsWith('.png'))) {
  const x = decodePng(readFileSync(join(a, f)));
  const y = decodePng(readFileSync(join(b, f)));
  if (x.width !== y.width || x.height !== y.height) {
    console.log(`${f}: size differs`);
    continue;
  }
  let sum = 0;
  let over = 0;
  const n = x.width * x.height;
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs((x.data[i * 4 + c] as number) - (y.data[i * 4 + c] as number));
      sum += d;
      if (d > m) m = d;
    }
    if (m > 8) over++;
  }
  console.log(`${f}: mean abs diff ${(sum / (n * 3)).toFixed(3)}/255, ${((over / n) * 100).toFixed(3)}% of pixels differ by more than 8`);
}
