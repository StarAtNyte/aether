import { describe, expect, it } from 'vitest';
import { clampPanelWidth, constrainPanels, initialPanels, layoutModeFor, PANEL_WIDTH, panelsFor, togglePanels } from '../src/lib/layout';
import { createStudioStore } from '../src/state/store';
import { nearestSnap } from '../src/editor/MobileSheet';
import { stickVector } from '../src/components/viewport/TouchControls';
import { placeTooltip } from '../src/components/ui/tooltips';

describe('responsive layout modes', () => {
  it('maps widths to modes at the breakpoints', () => {
    expect(layoutModeFor(1440)).toBe('wide');
    expect(layoutModeFor(1280)).toBe('wide');
    expect(layoutModeFor(1279)).toBe('medium');
    expect(layoutModeFor(1024)).toBe('medium');
    expect(layoutModeFor(1023)).toBe('tablet');
    expect(layoutModeFor(768)).toBe('tablet');
    expect(layoutModeFor(767)).toBe('phone');
    expect(layoutModeFor(390)).toBe('phone');
    expect(layoutModeFor(Number.NaN)).toBe('wide');
  });

  it('opens panels per mode and from the window width', () => {
    expect(panelsFor('wide')).toEqual({ left: true, right: true });
    expect(panelsFor('medium')).toEqual({ left: true, right: false });
    expect(panelsFor('tablet')).toEqual({ left: false, right: false });
    expect(panelsFor('phone')).toEqual({ left: false, right: false });
    expect(initialPanels(null, 1100)).toEqual({ left: true, right: false });
    expect(initialPanels(null, 800)).toEqual({ left: false, right: false });
  });

  it('keeps one side panel at a time below the wide layout', () => {
    expect(togglePanels('wide', { left: true, right: false }, 'right')).toEqual({ left: true, right: true });
    expect(togglePanels('medium', { left: true, right: false }, 'right')).toEqual({ left: false, right: true });
    expect(togglePanels('medium', { left: false, right: true }, 'right')).toEqual({ left: false, right: false });
    expect(togglePanels('tablet', { left: false, right: true }, 'left')).toEqual({ left: true, right: false });
    expect(constrainPanels('medium', { left: true, right: true })).toEqual({ left: true, right: false });
    expect(constrainPanels('tablet', { left: true, right: false })).toEqual({ left: false, right: false });
    expect(constrainPanels('wide', { left: true, right: true })).toEqual({ left: true, right: true });
  });

  it('clamps stored panel widths', () => {
    expect(clampPanelWidth(10, 300)).toBe(PANEL_WIDTH.min);
    expect(clampPanelWidth(9999, 300)).toBe(PANEL_WIDTH.max);
    expect(clampPanelWidth('300', 288)).toBe(288);
    expect(clampPanelWidth(301.6, 288)).toBe(302);
  });

  it('balances the outer columns (rail + left panel = right panel)', () => {
    expect(48 + PANEL_WIDTH.left).toBe(PANEL_WIDTH.right);
  });
});

describe('store panel routing', () => {
  it('shows views and the inspector under each layout', () => {
    const store = createStudioStore({ panels: { left: false, right: true } });
    const st = (): ReturnType<typeof store.getState> => store.getState();
    st().setLayout('medium');
    expect(st().panels).toEqual({ left: false, right: true });
    st().showLeftView('assets');
    expect(st().leftView).toBe('assets');
    expect(st().panels).toEqual({ left: true, right: false });
    st().showInspector();
    expect(st().panels).toEqual({ left: false, right: true });
    st().setLayout('phone');
    expect(st().panels).toEqual({ left: false, right: false });
    st().showLeftView('history');
    expect(st().sheetTab).toBe('history');
    st().showInspector();
    expect(st().sheetTab).toBe('inspector');
    expect(st().panels).toEqual({ left: false, right: false });
  });

  it('tracks save state and keeps toast actions', () => {
    const store = createStudioStore();
    store.getState().setSave('error', 'x'.repeat(500));
    expect(store.getState().save.status).toBe('error');
    expect(store.getState().save.error).toHaveLength(240);
    let ran = 0;
    store.getState().toast('Deleted', 'info', 5, { label: 'Undo', run: () => void ran++ });
    store.getState().toasts[0]?.action?.run();
    expect(ran).toBe(1);
  });
});

describe('touch and sheet helpers', () => {
  it('normalizes the virtual stick and clamps it to its radius', () => {
    expect(stickVector(0, -40)).toMatchObject({ forward: 1, right: 0 });
    expect(stickVector(80, 0)).toMatchObject({ forward: -0, right: 1, x: 40, y: 0 });
    const v = stickVector(30, 40);
    expect(Math.hypot(v.forward, v.right)).toBeCloseTo(1, 5);
    expect(stickVector(0, 0, 0)).toMatchObject({ forward: 0, right: 0 });
  });
  it('snaps the sheet to the nearest stop', () => {
    expect(nearestSnap(0.2)).toBe('min');
    expect(nearestSnap(0.5)).toBe('half');
    expect(nearestSnap(0.9)).toBe('full');
    expect(nearestSnap(Number.NaN)).toBe('min');
  });
});

describe('tooltip placement', () => {
  const r = (left: number, top: number, w = 32, h = 32): { left: number; top: number; right: number; bottom: number; width: number; height: number } => ({ left, top, right: left + w, bottom: top + h, width: w, height: h });
  it('places below and centres by default', () => {
    expect(placeTooltip(r(100, 100), 60, 24, 1000, 800, 'bottom', 'center')).toEqual({ left: 86, top: 138, pos: 'bottom' });
  });
  it('flips at the viewport edges and clamps inside it', () => {
    expect(placeTooltip(r(100, 780, 32, 16), 60, 24, 1000, 800, 'bottom', 'center').pos).toBe('top');
    expect(placeTooltip(r(980, 100), 120, 24, 1000, 800, 'right', 'center').pos).toBe('left');
    const p = placeTooltip(r(0, 0), 200, 24, 1000, 800, 'bottom', 'center');
    expect(p.left).toBe(6);
    expect(placeTooltip(r(990, 10), 200, 24, 1000, 800, 'bottom', 'end').left).toBe(794);
  });
});
