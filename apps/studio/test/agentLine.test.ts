import { describe, expect, it } from 'vitest';
import { liveAgentLine } from '../src/lib/agentLine';
import type { ChatEntry } from '../src/lib/chat';

const asst = (events: Extract<ChatEntry, { role: 'assistant' }>['events']): ChatEntry => ({ id: 2, role: 'assistant', status: 'streaming', events });

describe('liveAgentLine', () => {
  it('is empty when the agent is idle', () => {
    expect(liveAgentLine({ agentBusy: false, chat: [asst([{ type: 'status', text: 'x' }])] })).toBe('');
  });
  it('waits for the assistant entry', () => {
    expect(liveAgentLine({ agentBusy: true, chat: [{ id: 1, role: 'user', text: 'hi' }] })).toBe('Listening…');
  });
  it('shows the newest status line', () => {
    expect(liveAgentLine({ agentBusy: true, chat: [asst([{ type: 'plan', text: 'p' }, { type: 'status', text: 'Generating forest' }])] })).toBe('Generating forest');
  });
  it('describes structural events', () => {
    expect(liveAgentLine({ agentBusy: true, chat: [asst([{ type: 'verify', passed: true, summary: '', results: [], diagnostics: [] }])] })).toMatch(/physics/);
    expect(liveAgentLine({ agentBusy: true, chat: [asst([])] })).toBe('Reading your words…');
  });
});
