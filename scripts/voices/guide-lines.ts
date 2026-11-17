/**
 * The prepared lines of a world's showroom guide, for recording (`modal_tts.py`). Builds them with the player's own code
 * (`apps/studio/src/player/guide/brain.ts` `guideLines`: greeting, fixed lines, the tour's chapter intros and stop lines,
 * the products' lines), so the recordings match what the guide says, keyed by `voiceKey` of the text as said, and writes:
 *   <out>/lines.json   the spec for modal_tts.py ({ lines: { <voiceKey>: text }, ref?, exaggeration, cfg })
 *   <out>/index.json   what the player reads ({ lines: { <voiceKey>: "<voiceKey>.mp3" } })
 *
 *   npx tsx scripts/voices/guide-lines.ts <world.json> <out folder> [reference.wav]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { WorldDoc } from '../../packages/core/src/schema';
import { guideLines } from '../../apps/studio/src/player/guide/brain';
import { voiceKey } from '../../apps/studio/src/player/guide/voice';

const [file, out, ref] = process.argv.slice(2);
if (!file || !out) throw new Error('usage: guide-lines.ts <world.json> <out folder> [reference.wav]');
const raw = JSON.parse(readFileSync(file, 'utf8')) as { world?: unknown };
const world = WorldDoc.parse(raw.world ?? raw);
if (!world.guide) throw new Error('the world has no guide');
// Every line the guide can say: greeting, fixed lines, the tour's chapter intros and stop lines, the products' lines.
const texts = guideLines(world);
/** How a line is read aloud: sizes and prices as words a voice model reads right ("80 by 300 centimetres", "690 euros"). */
export function spoken(t: string): string {
  return t
    .trim()
    .replace(/(\d[\d.,]*)\s*[×x]\s*(\d[\d.,]*)\s*cm\b/g, '$1 by $2 centimetres')
    .replace(/€\s?(\d[\d,]*(?:\.\d+)?)/g, '$1 euros')
    .replace(/\bcm\b/g, 'centimetres');
}
const lines: Record<string, string> = {};
for (const t of texts) lines[voiceKey(t)] = spoken(t);
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'lines.json'), JSON.stringify({ lines, ...(ref ? { ref } : {}), exaggeration: 0.5, cfg: 0.5 }, null, 2));
writeFileSync(join(out, 'index.json'), JSON.stringify({ lines: Object.fromEntries(Object.keys(lines).sort().map((k) => [k, `${k}.mp3`])) }) + '\n');
console.log(`${Object.keys(lines).length} lines`);
