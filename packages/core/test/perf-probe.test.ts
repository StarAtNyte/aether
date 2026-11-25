import { afterEach, describe, expect, it } from 'vitest';
import { pb, pe, pj, perfOn, setPerfSink } from '../src/perf-probe';

describe('perf probe', () => {
  afterEach(() => setPerfSink(null));

  it('costs nothing without a sink', () => {
    expect(perfOn()).toBe(false);
    expect(pb()).toBe(0);
    expect(() => pe('x', 0)).not.toThrow();
    expect(() => pj('x')()).not.toThrow();
  });

  it('reports a span with its own time, nested spans removed', () => {
    const got: Array<{ kind: string; self: number; dur: number }> = [];
    setPerfSink({ span: (kind, t0, t1, self) => got.push({ kind, self, dur: t1 - t0 }), job: () => undefined });
    const outer = pb();
    const inner = pb();
    const until = performance.now() + 5;
    while (performance.now() < until);
    pe('inner', inner);
    pe('outer', outer);
    expect(got.map((g) => g.kind)).toEqual(['inner', 'outer']);
    expect(got[0]!.self).toBeGreaterThanOrEqual(4);
    expect(got[1]!.self).toBeLessThan(got[1]!.dur);
  });

  it('counts jobs in flight', () => {
    let n = 0;
    setPerfSink({ span: () => undefined, job: (_k, d) => (n += d) });
    const end = pj('prepare');
    expect(n).toBe(1);
    end();
    end();
    expect(n).toBe(0);
  });
});
