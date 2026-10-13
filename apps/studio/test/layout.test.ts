import { describe, expect, it } from 'vitest';
import { COMPACT_QUERY, initialPanels, isCompactLayout } from '../src/lib/layout';
import { createStudioStore } from '../src/state/store';

describe('layout', () => {
  it('opens both panels on wide screens and outside a browser', () => {
    expect(initialPanels(() => false)).toEqual({ left: true, right: true });
    expect(initialPanels(null)).toEqual({ left: true, right: true });
  });
  it('starts the inspector closed on compact screens', () => {
    expect(initialPanels((q) => q === COMPACT_QUERY)).toEqual({ left: true, right: false });
  });
  it('treats a throwing matcher as wide', () => {
    expect(
      isCompactLayout(() => {
        throw new Error('no');
      }),
    ).toBe(false);
  });
  it('feeds the store', () => {
    expect(createStudioStore({ panels: { left: true, right: false } }).getState().panels).toEqual({ left: true, right: false });
    expect(createStudioStore().getState().panels).toEqual({ left: true, right: true });
  });
});
