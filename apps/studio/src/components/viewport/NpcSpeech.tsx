/**
 * Play-mode speech for NPCs: bubbles above characters, the "press E to talk"
 * hint and the dialogue card with numbered choices. Everything is plain text
 * (never HTML). Keys 1-6 and E are handled by the logic runtime; the buttons
 * here are the pointer and touch route to the same actions.
 */
import { memo, useEffect, useMemo, useState, type FormEvent, type ReactElement } from 'react';
import { useSimulation, useStudio, useUI } from '../../app/context';
import { NPC_CHAT_MAX_LINE, type ChatAvailability, type ChatResult } from '../../engine/npcChat';
import type { NpcDialogueFrame, NpcFrame } from '../../engine/npcFrame';
import type { Simulation } from '../../engine/Simulation';

/** Characters revealed per second by the typewriter. */
const TYPE_CPS = 70;

/** Actions the overlay can trigger on the running game. */
export type NpcActions = Pick<Simulation, 'npcChoose' | 'npcAdvance' | 'npcClose'>;

/** Free conversation, when the studio offers it (a connected model). */
export interface NpcChatPort {
  availability(): ChatAvailability;
  send(line: string): Promise<ChatResult>;
}

/** The text of a node, revealed progressively (all at once for reduced motion). */
export function useTypewriter(text: string, key: number): string {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const reduce = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setShown(text.length);
      return undefined;
    }
    setShown(0);
    const start = performance.now();
    const id = window.setInterval(() => {
      const n = Math.min(text.length, Math.ceil(((performance.now() - start) / 1000) * TYPE_CPS));
      setShown(n);
      if (n >= text.length) window.clearInterval(id);
    }, 33);
    return () => window.clearInterval(id);
  }, [text, key]);
  return text.slice(0, shown);
}

/** "Say something…": a free line to the character through the connected model. */
function SayBox({ chat }: { chat: NpcChatPort }): ReactElement {
  const [line, setLine] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const avail = chat.availability();
  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (busy || !avail.ok || line.trim().length === 0) return;
    setBusy(true);
    setNote('');
    void chat.send(line).then((r) => {
      setBusy(false);
      if (r.ok) setLine('');
      else setNote(r.reason);
    });
  };
  return (
    <form className="npc-say" onSubmit={submit}>
      <input
        className="npc-say__input"
        aria-label="Say something"
        placeholder={avail.ok ? 'Say something…' : avail.reason}
        title={avail.ok ? undefined : avail.reason}
        maxLength={NPC_CHAT_MAX_LINE}
        value={line}
        disabled={!avail.ok || busy}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => setLine(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
      />
      <button type="submit" className="npc-say__send" disabled={!avail.ok || busy || line.trim().length === 0}>
        {busy ? '…' : 'Say'}
      </button>
      {note && <span className="npc-say__note" role="status">{note}</span>}
    </form>
  );
}

function DialogueCard({ d, actions, chat }: { d: NpcDialogueFrame; actions: NpcActions | null; chat: NpcChatPort | null }): ReactElement {
  const text = useTypewriter(d.text, d.version);
  const done = text.length >= d.text.length;
  return (
    <div className={`npc-card${d.mode === 'trade' ? ' is-trade' : ''}`} role="dialog" aria-label={`Conversation with ${d.speaker}`} aria-live="polite">
      <div className="npc-card__head">
        <span className="npc-card__speaker">{d.speaker}</span>
        {d.mode === 'trade' && <span className="npc-card__tag">trade</span>}
        <button type="button" className="npc-card__close" aria-label="End conversation" onClick={() => actions?.npcClose()}>
          ×
        </button>
      </div>
      <p className="npc-card__text">{text}</p>
      {done && d.choices.length > 0 && (
        <ol className="npc-card__choices">
          {d.choices.map((c, i) => (
            <li key={`${d.version}-${i}`}>
              <button type="button" className="npc-choice" onClick={() => actions?.npcChoose(i)}>
                <kbd>{i + 1}</kbd>
                <span>{c}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
      {done && d.choices.length === 0 && (
        <button type="button" className="npc-card__more" onClick={() => actions?.npcAdvance()}>
          <kbd>E</kbd> Continue
        </button>
      )}
      {d.chat && chat && <SayBox chat={chat} />}
    </div>
  );
}

/** Presentational overlay: used by the studio (store) and the standalone player (state). */
export const NpcSpeechView = memo(function NpcSpeechView({ frame, actions, chat = null }: { frame: NpcFrame | null; actions: (NpcActions & Pick<Simulation, 'npcAdvance'>) | null; chat?: NpcChatPort | null }): ReactElement | null {
  if (!frame) return null;
  const talking = frame.dialogue !== null;
  return (
    <div className="npc-layer" data-testid="npc-layer">
      {frame.bubbles.map((b) => (
        <div key={b.id} className="npc-bubble" style={{ left: `${(b.x * 100).toFixed(2)}%`, top: `${(b.y * 100).toFixed(2)}%` }} role="status">
          <span className="npc-bubble__name">{b.name}</span>
          <span className="npc-bubble__text">{b.text}</span>
        </div>
      ))}
      {!talking && frame.prompt && (
        <button type="button" className="npc-prompt" onClick={() => actions?.npcAdvance()}>
          <kbd>E</kbd> Talk to {frame.prompt.name}
        </button>
      )}
      {frame.dialogue && <DialogueCard d={frame.dialogue} actions={actions} chat={chat} />}
    </div>
  );
});

/** The studio's NPC overlay (reads the store, acts on the running simulation). */
export const NpcSpeech = memo(function NpcSpeech(): ReactElement | null {
  const frame = useUI((s) => s.npc);
  const mode = useUI((s) => s.mode);
  const sim = useSimulation();
  const studio = useStudio();
  const port: NpcChatPort = useMemo(() => ({ availability: () => studio.npcChat.availability(), send: (line) => studio.npcSay(line) }), [studio]);
  if (mode !== 'play') return null;
  return <NpcSpeechView frame={frame} actions={sim} chat={port} />;
});
