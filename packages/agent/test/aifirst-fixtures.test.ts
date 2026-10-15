/**
 * Replays the recorded AI-first transcripts (tests/fixtures/aifirst, recorded with a live Codex by
 * `npm run eval:design -- --mode=live`) through the real agent loop: the model's answers are fixed, so the
 * tool execution, the patches, the review and the checker numbers are reproduced with no model call.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateWorld } from '@aether/core';
import { buildingIdsOf, reviewFindings } from '@aether/arch';
import { WorldAgent } from '../src/agent';
import { createReplayProvider, TranscriptSchema } from '../src/providers/replay';
import { collect, MemoryHost, TEST_CATALOGS } from './helpers';

const DIR = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../tests/fixtures/aifirst');
const files = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith('.json')).sort() : [];

interface Recorded {
  id: string;
  transcript: unknown;
  ai: { errors: number; warnings: number; openingCovered: number; entities: number };
}

describe('recorded AI-first transcripts', () => {
  it('has fixtures to replay (record them with the eval when the tools change)', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const fx = JSON.parse(readFileSync(join(DIR, file), 'utf8')) as Recorded;
    it(`${fx.id}: replays to a valid building no worse than recorded`, async () => {
      const transcript = TranscriptSchema.parse(fx.transcript);
      const provider = createReplayProvider(transcript, { onExhausted: 'finish' });
      const host = new MemoryHost();
      const events = await collect(new WorldAgent({ provider, catalogs: TEST_CATALOGS, maxTurns: 40, maxToolCalls: 300, maxRepairs: 2, review: { vision: false, maxRounds: 12, stallRounds: 3 } }).run('replay', host));
      expect(events.filter((e) => e.type === 'error')).toEqual([]);
      expect(validateWorld(host.world).ok).toBe(true);
      const buildings = buildingIdsOf(host.world);
      expect(buildings.length).toBeGreaterThan(0);
      const findings = buildings.flatMap((b) => reviewFindings(host.world, b));
      expect(findings.filter((f) => f.severity === 'error').length).toBeLessThanOrEqual(fx.ai.errors);
      expect(findings.filter((f) => ['wall_item_on_opening', 'window_blocked', 'doorway_blocked', 'door_blocked', 'curtain_off_window'].includes(f.code)).length).toBeLessThanOrEqual(fx.ai.openingCovered);
      expect(provider.used()).toBeLessThanOrEqual(transcript.responses.length);
    });
  }
});
