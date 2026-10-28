import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { absRot, parseAnswer, tileAngles, writeFronts, type Cand } from '../../../scripts/assets/front-fix';
import { loadFrontOverrides, placeOf } from '../../../scripts/assets/front-overrides';
import { acquireLock, lockFile } from '../../../scripts/assets/bulk-lock';
import { needsFrontFix } from '../../../scripts/assets/simready-bulk';

describe('front-fix', () => {
  it('shuffles the four turns by id, the same way every time', () => {
    expect([...tileAngles('a')].sort()).toEqual([0, 180, 270, 90].sort());
    expect(tileAngles('simready-x')).toEqual(tileAngles('simready-x'));
  });

  it('turns the chosen tile into an absolute rotation', () => {
    const a = [180, 0, 270, 90];
    expect(absRot(90, a, 'A')).toBe(270);
    expect(absRot(270, a, 'C')).toBe(180);
    expect(absRot(0, a, 'B')).toBe(0);
  });

  it('reads the answer and rejects nonsense', () => {
    expect(parseAnswer('```json\n{"front":"c","mounting":"Wall","confidence":0.9,"reason":"basin"}\n```')).toEqual({ front: 'C', mounting: 'wall', mountingConfidence: 0.9,confidence: 0.9, reason: 'basin' });
    expect(parseAnswer('{"front":"none","confidence":0.5}')?.front).toBe('none');
    expect(parseAnswer('{"front":"E","confidence":1}')).toBeNull();
    expect(parseAnswer('no json')).toBeNull();
    expect(parseAnswer('{"front":"A"}')).toBeNull();
  });

  it('maps mountings to placements', () => {
    expect([placeOf('table'), placeOf('wall'), placeOf('floor'), placeOf('ceiling')]).toEqual(['surface', 'wall', 'floor', 'ceiling']);
  });

  it('writes only confident fronts, and wall pieces with an unsure front keep their rotation', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ff-'));
    try {
      const c = (id: string): Cand => ({ id, name: id, type: 't', category: 'props', size: [1, 1, 1], builtRot: 90, src: 's', url: '', source: 'bulk', symmetric: false, unsure: true, mounting: 'floor', hint: '' });
      const cands = [c('a'), c('b'), c('c'), c('d')];
      const e = (rot: number | null, mounting: string, confidence: number): Record<string, unknown> => ({ front: 'A', rot, kept: 90, mounting, mountingConfidence: 0.9, confidence, reason: 'r', model: 'm', tokens: [1, 1] });
      const cache = {
        'a|s|claude-sonnet-5-5|p3': e(180, 'floor', 0.9),
        'b|s|claude-sonnet-5-5|p3': e(0, 'floor', 0.5),
        'c|s|claude-sonnet-5-5|p3': e(0, 'wall', 0.5),
        'd|s|claude-sonnet-5-5|p3': e(null, 'floor', 0.9),
      };
      const file = join(dir, 'f.json');
      expect(writeFronts(cache as never, cands, 0.7, file)).toBe(2);
      const got = loadFrontOverrides(file);
      expect(Object.keys(got)).toEqual(['a', 'c']);
      expect(got['a']?.rot).toBe(180);
      expect(got['c']).toMatchObject({ rot: 90, mounting: 'wall' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('decides a reprocess by the override alone', () => {
    const base = { status: 'published' as const, symmetric: false, type: 'chair' };
    const seen = { rot: 180, mounting: 'floor' as const, confidence: 0.9, reason: '', model: '' };
    expect(needsFrontFix({ ...base, id: 'x', front: { rot: 90, sure: true, why: '' } }, { x: seen })).toBe(true);
    expect(needsFrontFix({ ...base, id: 'x', front: { rot: 180, sure: true, why: '' } }, { x: seen })).toBe(false);
  });

  it('the lock waits for a live holder and takes over a dead one', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lk-'));
    try {
      writeFileSync(lockFile(dir), '999999999');
      const release = await acquireLock(dir, 2000);
      release();
      writeFileSync(lockFile(dir), String(process.ppid));
      await expect(acquireLock(dir, 100)).rejects.toThrow(/held/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
