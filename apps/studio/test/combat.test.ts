/**
 * Shooter plumbing of the studio: the trigger and crosshair ray in the sampled input, best scores kept per world,
 * and the shooter template entry.
 */
import { describe, expect, it } from 'vitest';
import { InputController } from '../src/engine/input';
import { recordScore } from '../src/lib/bestScore';
import { SHOWCASE } from '../src/showcase/manifest';

/** A Storage stand-in. */
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

describe('weapon input', () => {
  it('samples the trigger, the pitch and the crosshair ray', () => {
    const input = new InputController();
    let s = input.sample(1 / 60);
    expect(s.fire).toBe(false);
    expect(s.aim).toBeUndefined();
    input.setVirtualFire(true);
    input.setPitch(-12);
    input.setAim([1, 2, 3], [0, 0, -1]);
    s = input.sample(1 / 60);
    expect(s.fire).toBe(true);
    expect(s.pitchDeg).toBe(-12);
    expect(s.aim?.origin).toEqual([1, 2, 3]);
    expect(s.aim?.dir).toEqual([0, 0, -1]);
    input.setVirtualFire(false);
    input.setAim(null);
    s = input.sample(1 / 60);
    expect(s.fire).toBe(false);
    expect(s.aim).toBeUndefined();
  });

  it('releases the trigger on focus loss', () => {
    const input = new InputController();
    input.setVirtualFire(true);
    input.releaseAll();
    expect(input.sample(1 / 60).fire).toBe(false);
  });
});

describe('best scores', () => {
  it('keeps the best run per world and says when a run beats it', () => {
    const st = memoryStorage();
    expect(recordScore('w:Kestrel', 1200, st)).toEqual({ best: 1200, record: true });
    expect(recordScore('w:Kestrel', 800, st)).toEqual({ best: 1200, record: false });
    expect(recordScore('w:Kestrel', 2500, st)).toEqual({ best: 2500, record: true });
    expect(recordScore('other', 10, st)).toEqual({ best: 10, record: true });
    expect(recordScore('w:Kestrel', Number.NaN, st)).toEqual({ best: 0, record: false });
  });

  it('works without storage', () => {
    expect(recordScore('w', 50, null)).toEqual({ best: 50, record: true });
  });

  it('survives corrupt storage', () => {
    const st = memoryStorage();
    st.setItem('aether.best.v1', '{not json');
    expect(recordScore('w', 5, st).best).toBe(5);
  });
});

describe('shooter template', () => {
  it('is a featured game that launches straight into play', () => {
    const e = SHOWCASE.find((s) => s.slug === 'kestrel-outpost');
    expect(e?.kind).toBe('game');
    expect(e?.launch).toBe(true);
    expect(e?.curation).toBe('featured');
  });
});
