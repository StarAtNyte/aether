import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PHOTO_BUILDING_ID, readScene, reviewFindings } from '@aether/arch';
import { WorldAgent } from '../src/agent';
import { createReplayProvider, TranscriptSchema } from '../src/providers/replay';
import type { AgentEvent } from '../src/types';
import { collect, MemoryHost, TEST_CATALOGS } from './helpers';

const DIR = resolve(__dirname, '../../../tests/fixtures/photo');

/** A PNG data URL whose header says 1920×1280 (the recorded run saw the real photo; replay only needs its shape). */
function header(): string {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]).copy(b, 0);
  b.writeUInt32BE(1920, 16);
  b.writeUInt32BE(1280, 20);
  return `data:image/png;base64,${b.toString('base64')}`;
}

/**
 * The first answer of each recorded run is what a real vision model (Claude Code, live) wrote for a real photograph.
 * Replaying it proves that real descriptions validate, build through the design tools and leave a room with no
 * checker error, whatever the models do later: this is the regression test for the description schema, the
 * derivation and the shell fitting.
 */
describe('recorded vision descriptions build', () => {
  for (const id of ['hotel', 'pd1']) {
    const file = resolve(DIR, `${id}.transcript.json`);
    it.skipIf(!existsSync(file))(`${id}: the recorded description becomes a clean room`, async () => {
      const t = TranscriptSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
      const agent = new WorldAgent({ provider: createReplayProvider({ ...t, responses: t.responses.slice(0, 1) }, { onExhausted: 'finish' }), catalogs: TEST_CATALOGS, maxTurns: 4, photo: {} });
      const host = new MemoryHost();
      const events: AgentEvent[] = await collect(agent.run('make this bedroom in 3D', host, { images: [header()] }));
      expect(events.some((e) => e.type === 'error'), JSON.stringify(events.filter((e) => e.type === 'error'))).toBe(false);
      const scene = readScene(host.world, PHOTO_BUILDING_ID);
      expect(scene).not.toBeNull();
      expect(scene?.items.length).toBeGreaterThan(6);
      expect(reviewFindings(host.world, PHOTO_BUILDING_ID).filter((f) => f.severity === 'error')).toEqual([]);
      const built = events.find((e) => e.type === 'photo' && e.phase === 'built');
      expect(built && built.type === 'photo' ? built.text : '').toMatch(/pieces placed/);
    });
  }
});
