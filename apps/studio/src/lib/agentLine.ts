import type { StudioState } from '../state/store';

/** Latest progress line of the running agent turn (stable string for the selector). */
export function liveAgentLine(s: Pick<StudioState, 'agentBusy' | 'chat'>): string {
  if (!s.agentBusy) return '';
  const last = s.chat[s.chat.length - 1];
  if (!last || last.role !== 'assistant') return 'Listening…';
  for (let i = last.events.length - 1; i >= 0; i--) {
    const ev = last.events[i];
    if (ev && (ev.type === 'status' || ev.type === 'repair')) return ev.text;
    if (ev && ev.type === 'plan') return 'Planning the world…';
    if (ev && ev.type === 'patches') return 'Shaping terrain and placing things…';
    if (ev && ev.type === 'verify') return 'Testing it with real physics…';
  }
  return 'Reading your words…';
}
