import { describe, expect, it } from 'vitest';
import { recheckAfterRepair } from '../src/engine/playtest/controller';

describe('recheckAfterRepair (checks follow the repaired world)', () => {
  it('re-runs checks that had a verdict on the world the bot started from, once a repair moved the head', () => {
    expect(recheckAfterRepair({ status: 'passed', head: 4 }, 4, 5, true)).toBe('now');
    expect(recheckAfterRepair({ status: 'failed', head: 4 }, 4, 6, true)).toBe('now');
    expect(recheckAfterRepair({ status: 'error', head: 4 }, 4, 5, true)).toBe('now');
  });

  it('waits for checks still running on the old world', () => {
    expect(recheckAfterRepair({ status: 'running', head: 4 }, 4, 5, true)).toBe('after-run');
  });

  it('leaves the checks alone without a repair, without checks, or when they already describe something newer', () => {
    expect(recheckAfterRepair({ status: 'passed', head: 4 }, 4, 4, false)).toBe('no');
    expect(recheckAfterRepair({ status: 'passed', head: 4 }, 4, 4, true)).toBe('no');
    expect(recheckAfterRepair({ status: 'idle', head: null }, 4, 5, true)).toBe('no');
    expect(recheckAfterRepair({ status: 'passed', head: 5 }, 4, 5, true)).toBe('no');
    expect(recheckAfterRepair({ status: 'passed', head: 2 }, 4, 5, true)).toBe('no');
  });
});
