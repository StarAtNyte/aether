import { describe, expect, it } from 'vitest';
import type { Finding } from '@aether/arch';
import { RepeatLedger } from '../src/review';

const f = (subject: string): Finding => ({ code: 'plan_missing', severity: 'warning', message: `planned ${subject} never placed`, entities: [], room: 'auditorium', subject, candidates: [`${subject}-1 (kind ${subject})`], fix: 'x' });

describe('RepeatLedger', () => {
  it('shows a finding in full twice, then folds repeats into one unresolved line that still names each and its candidates', () => {
    const l = new RepeatLedger();
    expect(l.apply([f('screen'), f('stage')])).toHaveLength(2);
    expect(l.apply([f('screen'), f('stage')])).toHaveLength(2);
    const third = l.apply([f('screen'), f('stage')]);
    expect(third).toHaveLength(1);
    expect(third[0]?.code).toBe('unresolved_repeated');
    expect(third[0]?.message).toContain('screen');
    expect(third[0]?.message).toContain('stage');
    expect(third[0]?.message).toContain('screen-1 (kind screen)');
  });

  it('keeps a new finding in full and forgets a finding once it is gone', () => {
    const l = new RepeatLedger();
    l.apply([f('screen')]);
    l.apply([f('screen')]);
    const out = l.apply([f('screen'), f('stage')]);
    expect(out.map((x) => x.code)).toEqual(['plan_missing', 'unresolved_repeated']);
    l.apply([]);
    expect(l.apply([f('screen')])).toHaveLength(1);
    expect(l.apply([f('screen')])[0]?.code).toBe('plan_missing');
  });
});
