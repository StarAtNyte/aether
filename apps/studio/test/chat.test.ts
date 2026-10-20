import { describe, expect, it } from 'vitest';
import { Patch } from '@aether/core';
import type { AgentEvent } from '@aether/agent';
import { appendEvent, assistantText, beyondEditCard, buildAgentHistory, reviveChat, toDiagnostics, toEventView, toTestResults, trimChat, type ChatEntry, type ChatEventView } from '../src/lib/chat';
import { summarizePatches } from '../src/lib/patchSummary';
import { MAX_CHAT_ENTRIES, MAX_EVENTS_PER_ENTRY } from '../src/config';

describe('chat model', () => {
  it('converts patch events into compact summaries', () => {
    const ev: AgentEvent = {
      type: 'patches',
      patches: [Patch.parse({ op: 'add', entity: { id: 'a' } })],
      message: 'Add a',
      result: { applied: 1, errors: [{ index: 1, op: 'update', message: 'unknown entity' }] },
    };
    const v = toEventView(ev);
    expect(v.type).toBe('patches');
    if (v.type === 'patches') {
      expect(v.summary.addedCount).toBe(1);
      expect(v.errors).toEqual(['#1 update: unknown entity']);
    }
  });

  it('keeps review progress events, bounded, and revives them defensively', () => {
    const v = toEventView({ type: 'review', round: 3, phase: 'found', text: 'x'.repeat(5000), score: 140, findings: 2 });
    expect(v).toMatchObject({ type: 'review', round: 3, phase: 'found', score: 100, findings: 2 });
    if (v.type === 'review') expect(v.text.length).toBeLessThanOrEqual(400);
    const revived = reviveChat([{ id: 1, role: 'assistant', status: 'done', events: [{ type: 'review', round: 99999, phase: 'nonsense', text: 5, score: 'x' }, { type: 'review', round: 2, phase: 'approved', text: 'Looks right.', score: 91, findings: 0 }] }]);
    const events = (revived[0] as Extract<ChatEntry, { role: 'assistant' }>).events;
    expect(events[0]).toMatchObject({ type: 'review', round: 500, phase: 'checking', text: '' });
    expect(events[1]).toMatchObject({ phase: 'approved', score: 91, findings: 0 });
  });

  it('extracts verify results from untrusted reports', () => {
    const report = {
      results: [{ id: 't1', kind: 'stable', passed: true, message: 'ok' }, 'junk', { id: 5 }],
      diagnostics: [{ severity: 'nope', code: 'overlap', entities: ['a', 3, 'b'], message: 'm', suggestion: 's' }],
    };
    expect(toTestResults(report)).toEqual([
      { id: 't1', kind: 'stable', passed: true, message: 'ok' },
      { id: '', kind: '', passed: false, message: '' },
    ]);
    expect(toDiagnostics(report)).toEqual([{ severity: 'info', code: 'overlap', entities: ['a', 'b'], message: 'm', suggestion: 's' }]);
    expect(toTestResults(null)).toEqual([]);
    const v = toEventView({ type: 'verify', passed: false, summary: 'bad', report });
    expect(v.type === 'verify' && v.results.length).toBe(2);
  });

  it('collapses consecutive status events and caps length', () => {
    let events: ChatEventView[] = [];
    events = appendEvent(events, { type: 'status', text: 'a' });
    events = appendEvent(events, { type: 'status', text: 'b' });
    expect(events).toEqual([{ type: 'status', text: 'b' }]);
    for (let i = 0; i < MAX_EVENTS_PER_ENTRY + 20; i++) events = appendEvent(events, { type: 'message', text: String(i) });
    expect(events).toHaveLength(MAX_EVENTS_PER_ENTRY);
  });

  it('trims the transcript', () => {
    const many: ChatEntry[] = Array.from({ length: MAX_CHAT_ENTRIES + 5 }, (_, i) => ({ id: i, role: 'user', text: String(i) }));
    expect(trimChat(many)).toHaveLength(MAX_CHAT_ENTRIES);
  });

  it('builds agent history from completed pairs only', () => {
    const chat: ChatEntry[] = [
      { id: 1, role: 'user', text: 'make a tree' },
      { id: 2, role: 'assistant', status: 'done', events: [{ type: 'plan', text: 'plan' }, { type: 'message', text: 'Done!' }] },
      { id: 3, role: 'user', text: 'failed one' },
      { id: 4, role: 'assistant', status: 'error', events: [{ type: 'error', text: 'x' }] },
      { id: 5, role: 'user', text: 'pending' },
    ];
    expect(buildAgentHistory(chat)).toEqual([
      { role: 'user', content: 'make a tree' },
      { role: 'assistant', content: 'Done!' },
    ]);
    expect(buildAgentHistory(chat, 0)).toEqual([]);
  });

  it('falls back to the plan for assistant text', () => {
    expect(assistantText({ id: 1, role: 'assistant', status: 'done', events: [{ type: 'plan', text: 'P' }] })).toBe('P');
  });

  it('a local edit is said once: the reply keeps only what its card does not say, and history still has it', () => {
    const card = { summary: 'Made the sofa dark green velvet', notes: ['it now matches the rug'] };
    expect(beyondEditCard(card, 'Made the sofa dark green velvet.')).toBe('');
    expect(beyondEditCard(card, 'Made the sofa dark green velvet. It now matches the rug.')).toBe('');
    expect(beyondEditCard(card, 'Made the sofa dark green velvet. 2 parts were refused (locked objects).')).toBe('2 parts were refused (locked objects).');
    expect(beyondEditCard(card, 'Heads up: the checks flagged something.')).toBe('Heads up: the checks flagged something.');
    const entry = { id: 3, role: 'assistant' as const, status: 'done' as const, events: [{ type: 'edit' as const, summary: 'Made the sofa dark green velvet', lines: [], notes: [], ms: 1, local: true, cosmetic: true }] };
    expect(assistantText(entry)).toBe('Made the sofa dark green velvet.');
    // After a reload the card is gone; its patch line still answers.
    expect(assistantText({ id: 4, role: 'assistant', status: 'done', events: [{ type: 'patches', message: 'Made the sofa dark green velvet', summary: summarizePatches([]), errors: [] }] })).toBe('Made the sofa dark green velvet.');
    expect(buildAgentHistory([{ id: 2, role: 'user', text: 'make the sofa dark green velvet' }, entry])).toEqual([
      { role: 'user', content: 'make the sofa dark green velvet' },
      { role: 'assistant', content: 'Made the sofa dark green velvet.' },
    ]);
  });

  it('parses cached tokens of a done event, never more than the input', () => {
    const v = toEventView({ type: 'done', usage: { inputTokens: 1000, outputTokens: 5, calls: 2, cachedInputTokens: 900 } });
    expect(v).toEqual({ type: 'done', inputTokens: 1000, outputTokens: 5, calls: 2, cachedInputTokens: 900 });
    const revived = reviveChat([{ role: 'assistant', status: 'done', events: [{ type: 'done', inputTokens: 10, outputTokens: 1, calls: 1, cachedInputTokens: 99 }] }]);
    const ev = revived[0]?.role === 'assistant' ? revived[0].events[0] : undefined;
    expect(ev).toEqual({ type: 'done', inputTokens: 10, outputTokens: 1, calls: 1, cachedInputTokens: 10 });
  });

  it('revives stored transcripts defensively', () => {
    const stored = [
      { role: 'user', text: 'hi' },
      { role: 'assistant', status: 'streaming', events: [{ type: 'message', text: 'hello' }, { type: 'bogus' }, { type: 'patches', summary: 'bad' }] },
      { role: 'system', text: 'nope' },
      'junk',
      { role: 'assistant', status: 'done', events: [{ type: 'verify', passed: true, summary: 's', results: [{ id: 'a', kind: 'k', passed: true, message: 'm' }], diagnostics: [] }] },
    ];
    const chat = reviveChat(stored);
    expect(chat).toHaveLength(3);
    expect(chat[1]).toEqual({ id: 2, role: 'assistant', status: 'aborted', events: [{ type: 'message', text: 'hello' }] });
    const last = chat[2];
    expect(last?.role === 'assistant' && last.events[0]?.type).toBe('verify');
    expect(reviveChat({})).toEqual([]);
  });
});

describe('photo round scores', () => {
  it('keeps the judges, the measures and the combined signal, clamped, and drops what is not a number', () => {
    const v = toEventView({
      type: 'photo',
      phase: 'round',
      round: 2,
      text: 'Round 2',
      score: { passed: 11, total: 17, rate: 11 / 17, objective: 0.81, judge: 0.72, judges: 3, spread: 0.2, combined: 0.765, preference: 'current', accepted: true, fidelity: { openings: 1, inventory: 0.95, framing: 1.7 }, structuralFailed: false, failing: [] },
    });
    expect(v.type).toBe('photo');
    if (v.type !== 'photo') return;
    expect(v.score).toMatchObject({ passed: 11, total: 17, objective: 0.81, judge: 0.72, judges: 3, combined: 0.765, preference: 'current', accepted: true });
    expect(v.score?.fidelity).toEqual({ openings: 1, inventory: 0.95, framing: 1 });
    const revived = reviveChat([{ id: 1, role: 'assistant', status: 'done', events: [{ type: 'photo', phase: 'round', text: 'x', score: { passed: 1, total: 2, judge: 'high', judges: 99, preference: 'maybe', fidelity: { openings: 'all', bogus: 1 }, structuralFailed: false, failing: [] } }] }]);
    const ev = (revived[0] as Extract<ChatEntry, { role: 'assistant' }>).events[0] as Extract<ChatEventView, { type: 'photo' }>;
    expect(ev.score?.judge).toBeUndefined();
    expect(ev.score?.judges).toBe(9);
    expect(ev.score?.preference).toBeUndefined();
    expect(ev.score?.fidelity).toBeUndefined();
  });
});
