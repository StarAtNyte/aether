import { describe, expect, it } from 'vitest';
import { createStudioStore } from '../src/state/store';
import { MAX_TOASTS } from '../src/config';

describe('studio store', () => {
  it('manages selection without redundant updates', () => {
    const store = createStudioStore();
    let changes = 0;
    store.subscribe(() => changes++);
    store.getState().select(['a', 'b', 'a']);
    expect(store.getState().selection).toEqual(['a', 'b']);
    store.getState().select(['a', 'b']);
    expect(changes).toBe(1);
    store.getState().pruneEntities(new Set(['b']));
    expect(store.getState().selection).toEqual(['b']);
  });

  it('streams assistant events into the right entry', () => {
    const store = createStudioStore();
    const s = store.getState();
    s.addUserMessage('build a castle');
    const id = s.startAssistant();
    s.pushEvent(id, { type: 'plan', text: 'Plan' });
    s.pushEvent(id, { type: 'status', text: 'Working' });
    s.pushEvent(999, { type: 'message', text: 'ignored' });
    s.finishAssistant(id, 'done');
    const entry = store.getState().chat[1];
    expect(entry).toEqual({ id, role: 'assistant', status: 'done', events: [{ type: 'plan', text: 'Plan' }] });
    const aborted = s.startAssistant();
    s.pushEvent(aborted, { type: 'status', text: 'Planning…' });
    s.finishAssistant(aborted, 'aborted');
    expect(store.getState().chat.at(-1)).toEqual({ id: aborted, role: 'assistant', status: 'aborted', events: [{ type: 'status', text: 'Stopped.' }] });
  });

  it('continues chat ids after restoring a transcript', () => {
    const store = createStudioStore({ chat: [{ id: 7, role: 'user', text: 'x' }] });
    expect(store.getState().addUserMessage('y')).toBe(8);
    store.getState().setChat([{ id: 20, role: 'user', text: 'z' }]);
    expect(store.getState().startAssistant()).toBe(21);
  });

  it('caps and clamps toasts', () => {
    const store = createStudioStore();
    for (let i = 0; i < MAX_TOASTS + 3; i++) store.getState().toast(`t${i}`, 'info', 999);
    const toasts = store.getState().toasts;
    expect(toasts).toHaveLength(MAX_TOASTS);
    expect(toasts[0]?.duration).toBe(30);
    expect(toasts[toasts.length - 1]?.text).toBe(`t${MAX_TOASTS + 2}`);
    store.getState().dismissToast(toasts[0]?.id ?? -1);
    expect(store.getState().toasts).toHaveLength(MAX_TOASTS - 1);
    store.getState().toast('x'.repeat(1000));
    expect(store.getState().toasts.at(-1)?.text.length).toBeLessThanOrEqual(240);
  });

  it('toggles panels, tabs, settings and game state', () => {
    const store = createStudioStore();
    const s = store.getState();
    s.togglePanel('left');
    expect(store.getState().panels).toEqual({ left: false, right: true });
    s.setRightTab('verify');
    expect(store.getState().rightTab).toBe('verify');
    s.updateSettings({ showPerf: false });
    expect(store.getState().settings.showPerf).toBe(false);
    s.setGame({ status: 'won', text: 'gg' });
    expect(store.getState().game.status).toBe('won');
    s.resetGame();
    expect(store.getState().game).toEqual({ status: 'playing', text: '', hud: {}, time: 0, intro: false });
    s.setVerify({ status: 'running' });
    expect(store.getState().verify.status).toBe('running');
    s.setOutlinerFilter('y'.repeat(500));
    expect(store.getState().outlinerFilter).toHaveLength(120);
  });

  it('counts the steps of a running turn and queues messages for the agent to pick up', () => {
    const store = createStudioStore();
    const s = store.getState();
    s.setAgentRun({ startedAt: 1, via: 'x', step: 'Planning…' });
    s.bumpAgentStep('Placing 3 items');
    s.bumpAgentStep();
    expect(store.getState().agentRun).toMatchObject({ steps: 2, step: 'Placing 3 items' });
    s.queueMessage('  add a rug ');
    s.queueMessage('and a lamp');
    s.removeQueued(0);
    expect(store.getState().queued).toEqual(['and a lamp']);
    for (let i = 0; i < 10; i++) s.queueMessage(`m${i}`);
    expect(store.getState().queued).toHaveLength(4);
    expect(s.takeQueued()).toHaveLength(4);
    expect(store.getState().queued).toEqual([]);
    expect(s.takeQueued()).toEqual([]);
  });
});
