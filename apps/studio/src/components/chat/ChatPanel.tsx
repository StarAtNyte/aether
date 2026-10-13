import { memo, useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { MAX_PROMPT_CHARS } from '../../config';
import { useStudio, useUI } from '../../app/context';
import type { ChatEntry } from '../../lib/chat';
import { EXAMPLE_PROMPTS } from '../../lib/examples';
import { Icon } from '../Icon';
import { Orb } from '../Orb';
import { ChatEvent } from './ChatEvent';

/** How often the idle composer placeholder rotates to the next example. */
const PLACEHOLDER_ROTATE_MS = 4200;

/** Curated prompt gallery shown when the chat is empty. */
const ExampleGallery = memo(function ExampleGallery({ onPick }: { onPick: (prompt: string) => void }): ReactElement {
  return (
    <div className="gallery">
      <div className="gallery__intro">
        <Orb size={64} className="gallery__orb" />
        <p className="gallery__eyebrow">Natural language → living 3D</p>
        <h2>
          Speak a world <em>into being</em>
        </h2>
        <p>Describe a scene, a physics contraption or a little game. Aether builds it, checks it with real physics, and lets you play it.</p>
      </div>
      <div className="gallery__grid">
        {EXAMPLE_PROMPTS.map((p, i) => (
          <button key={p.title} type="button" className="prompt-card" style={{ ['--hue' as string]: String(p.hue), ['--i' as string]: String(i) }} onClick={() => onPick(p.prompt)}>
            <span className="prompt-card__swatch" aria-hidden="true" />
            <span className="prompt-card__kind">
              <span className="prompt-card__num">{String(i + 1).padStart(2, '0')}</span> {p.kind}
            </span>
            <span className="prompt-card__title">{p.title}</span>
            <span className="prompt-card__text">{p.prompt}</span>
          </button>
        ))}
      </div>
    </div>
  );
});

/** One chat entry. */
const ChatItem = memo(function ChatItem({ entry }: { entry: ChatEntry }): ReactElement {
  if (entry.role === 'user') {
    return (
      <div className="msg msg--user">
        <div className="msg__bubble">
          <span className="msg__quote" aria-hidden="true">
            “
          </span>
          {entry.text}
        </div>
      </div>
    );
  }
  const live = entry.status === 'streaming';
  return (
    <div className={`msg msg--assistant${live ? ' is-live' : ''}`}>
      <div className="msg__avatar" aria-hidden="true">
        <Orb size={22} className={live ? 'is-live' : ''} />
      </div>
      <div className="msg__body">
        {entry.events.length === 0 && live && (
          <div className="ev ev--status">
            <span className="spinner" aria-hidden="true" /> Thinking…
          </div>
        )}
        {entry.events.map((ev, i) =>
          // While streaming only the newest progress line is relevant.
          ev.type === 'status' && i !== entry.events.length - 1 ? null : <ChatEvent key={i} event={ev} live={live && i === entry.events.length - 1} />,
        )}
        {entry.status === 'aborted' && entry.events.length === 0 && <div className="ev ev--status muted">Stopped.</div>}
      </div>
    </div>
  );
});

/** Left panel: streaming agent conversation + prompt box. */
export const ChatPanel = memo(function ChatPanel(): ReactElement {
  const studio = useStudio();
  const chat = useUI((s) => s.chat);
  const busy = useUI((s) => s.agentBusy);
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);
  const [hintIndex, setHintIndex] = useState(0);

  // Idle composer: rotate through example prompts as an invitation.
  useEffect(() => {
    if (busy || draft !== '') return;
    const id = window.setInterval(() => setHintIndex((i) => (i + 1) % EXAMPLE_PROMPTS.length), PLACEHOLDER_ROTATE_MS);
    return () => window.clearInterval(id);
  }, [busy, draft]);
  const example = EXAMPLE_PROMPTS[hintIndex];
  const placeholder = busy ? 'Aether is building…' : chat.length === 0 || !example ? 'Describe a world, or ask for a change…' : `Try: ${example.prompt.toLowerCase()}`;

  useEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [chat]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [draft]);

  const send = (text: string): void => {
    const t = text.trim();
    if (!t || busy) return;
    setDraft('');
    stickToBottom.current = true;
    void studio.send(t);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(draft);
    }
  };

  return (
    <aside className="panel panel--left chat" aria-label="AI chat">
      <div className="panel__header">
        <span className="panel__title">
          <Icon name="sparkles" size={14} /> World agent
          {busy && <span className="panel__live" aria-hidden="true" />}
        </span>
        {chat.length > 0 && (
          <button type="button" className="btn btn--ghost btn--xs" onClick={() => studio.store.getState().clearChat()} disabled={busy} title="Clear conversation (the world is kept)">
            Clear
          </button>
        )}
      </div>
      <div
        className="chat__list"
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        aria-live="polite"
      >
        {chat.length === 0 ? <ExampleGallery onPick={send} /> : chat.map((entry) => <ChatItem key={entry.id} entry={entry} />)}
      </div>
      <form
        className={`composer${busy ? ' is-busy' : ''}`}
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <span className="composer__aurora" aria-hidden="true" />
        <textarea
          id="prompt-input"
          ref={inputRef}
          className="composer__input"
          value={draft}
          rows={1}
          maxLength={MAX_PROMPT_CHARS}
          placeholder={placeholder}
          aria-label="Prompt"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {busy ? (
          <button type="button" className="composer__btn composer__btn--stop" onClick={() => studio.stopAgent()} title="Stop generating" aria-label="Stop generating">
            <Icon name="stop" size={14} />
          </button>
        ) : (
          <button type="submit" className="composer__btn" disabled={draft.trim() === ''} title="Send (Enter)" aria-label="Send">
            <Icon name="send" size={15} />
          </button>
        )}
      </form>
      <div className="composer__hint">
        <kbd>Enter</kbd> send · <kbd>Shift</kbd>+<kbd>Enter</kbd> newline
      </div>
    </aside>
  );
});
