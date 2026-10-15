/**
 * Agent panel: the conversation with the world agent. Empty state offers
 * suggestion chips and the template gallery (real rendered thumbnails);
 * the composer takes a prompt, optional reference images and sends with
 * Enter. Streaming turns show skeleton lines, never spinners.
 */
import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { MAX_PROMPT_CHARS } from '../config';
import { useStudio, useUI, useWorld } from '../app/context';
import type { ChatEntry } from '../lib/chat';
import { FEATURED_TEMPLATES, SUGGESTION_CHIPS, TEMPLATES, templateThumbnail } from '../lib/examples';
import { MAX_REFERENCE_IMAGES, prepareReferenceImage } from '../lib/images';
import { remixSuggestions } from '../lib/remix';
import { composerPlaceholder, hasContent, refineChips } from '../lib/refine';
import { isPristineStarter } from '../lib/starterWorld';
import { ChatEvent } from '../components/chat/ChatEvent';
import { Icon } from '../components/Icon';
import { Logomark } from '../components/Logo';
import { DeepBuildToggle, ModelPicker, RefineMenu } from '../components/ai/ComposerControls';
import { formatElapsed } from '../components/chat/ChatEvent';
import { Thumb } from '../home/cards';
import { aiConnection } from '../ai/connection';
import { useAi } from '../ai/useAi';
import { launchPromptFlight } from '../lib/promptFlight';
import { onNextFrame as scheduleScroll } from '../lib/frame';

/** Connection card shown in the empty state: "Connect Codex" until an AI connection is ready. */
const ConnectionCard = memo(function ConnectionCard(): ReactElement | null {
  const studio = useStudio();
  const provider = useUI((s) => s.provider);
  const local = useAi((s) => s.local);
  const [starting, setStarting] = useState(false);
  const localReady = local.state === 'ready';
  if (localReady || (provider.status !== 'offline' && local.state !== 'not_logged_in')) return null;
  const canSignInHere = local.state === 'not_logged_in' && local.backends.some((b) => b.id === 'codex' && b.installed);
  const connect = (): void => {
    if (canSignInHere) {
      setStarting(true);
      // Start Codex's own device sign-in; the settings pane shows the link and code.
      void aiConnection()
        .localApi.login('codex')
        .catch(() => undefined)
        .finally(() => {
          setStarting(false);
          studio.store.getState().openSettings('ai');
        });
    } else studio.store.getState().openSettings('ai');
  };
  return (
    <div className="connect-card connect-card--hero" data-testid="connect-codex">
      <span className="connect-card__icon">
        <Icon name="link" />
      </span>
      <span className="connect-card__text">
        <span className="connect-card__title">Connect Codex</span>
        <span className="connect-card__hint">
          {local.state === 'off'
            ? 'Use your ChatGPT or Claude subscription for open-ended prompts and deep-built assets. Until then, the offline planner runs in your browser.'
            : 'Sign in with ChatGPT once: Codex then builds worlds and writes new assets on this computer, checking its own work.'}
        </span>
      </span>
      <button type="button" className="btn btn--sm btn--primary" onClick={connect} disabled={starting}>
        {starting ? 'Starting…' : 'Connect Codex'}
      </button>
    </div>
  );
});

/** Empty state: greeting, suggestions, templates. */
const EmptyAgent = memo(function EmptyAgent({ onPrompt, onRefine, onTemplate }: { onPrompt: (p: string) => void; onRefine: (p: string) => void; onTemplate: (prompt: string) => void }): ReactElement {
  const world = useWorld();
  const selection = useUI((s) => s.selection);
  // A project that already has something of the user's in it is refined, not replaced.
  const mine = useMemo(() => hasContent(world) && !isPristineStarter(world), [world]);
  const chips = useMemo(() => refineChips(world, selection), [world, selection]);
  return (
    <div className="agent-empty">
      <ConnectionCard />
      <div className="agent-empty__hero">
        <Logomark size={28} />
        <h2 className="agent-empty__title">{mine ? 'Refine your world' : 'Let’s build!'}</h2>
        <p className="agent-empty__text">
          {mine
            ? 'Say what to change, in plain words: only what you mention changes, and every step is undoable. Select something and say “make it bigger”.'
            : 'Describe a world. The agent builds it, checks the physics and makes it playable. Then keep refining it in plain words: only what you mention changes, and every step is undoable.'}
        </p>
        <div className="suggestions" role="group" aria-label="Suggestions">
          {mine
            ? chips.map((c) => (
                <button key={c.prompt} type="button" className="chip chip--action" onClick={() => onRefine(c.prompt)}>
                  {c.label}
                </button>
              ))
            : SUGGESTION_CHIPS.map((s) => (
                <button key={s} type="button" className="chip chip--action" onClick={() => onPrompt(s)}>
                  {s}
                </button>
              ))}
        </div>
      </div>
      <div className="agent-empty__section">
        <div className="agent-empty__head">
          <span className="agent-empty__label">Templates</span>
        </div>
        <div className="agent-templates">
          {(FEATURED_TEMPLATES.length > 0 ? FEATURED_TEMPLATES : TEMPLATES).slice(0, 12).map((t) => (
            <button key={t.slug} type="button" className="agent-template" onClick={() => onTemplate(t.prompt)} title={t.description} aria-label={`Build template: ${t.title}`}>
              <Thumb src={templateThumbnail(t.slug)} alt="" />
              <span className="agent-template__title">{t.title}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
});

/** Live progress while the agent works: current step, connection, elapsed time and cancel. */
function ThinkingSkeleton({ text }: { text: string }): ReactElement {
  const studio = useStudio();
  const run = useUI((s) => s.agentRun);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="thinking" role="status">
      <span className="thinking__row">
        <span className="thinking__text">{run?.step || text}</span>
        {run && (
          <span className="thinking__meta">
            {run.via} · {formatElapsed(Math.max(0, now - run.startedAt))}
          </span>
        )}
        {run && (
          <button type="button" className="link thinking__stop" onClick={() => studio.stopAgent()}>
            Cancel
          </button>
        )}
      </span>
      <span className="skeleton skeleton--line" style={{ width: '92%' }} />
      <span className="skeleton skeleton--line" style={{ width: '74%' }} />
    </div>
  );
}

/** One chat entry. */
const ChatItem = memo(function ChatItem({ entry }: { entry: ChatEntry }): ReactElement {
  if (entry.role === 'user') {
    return (
      <div className="msg msg--user">
        <div className="msg__bubble">{entry.text}</div>
      </div>
    );
  }
  const live = entry.status === 'streaming';
  const last = entry.events[entry.events.length - 1];
  return (
    <div className={`msg msg--assistant${live ? ' is-live' : ''}`}>
      {entry.events.length === 0 && live && <ThinkingSkeleton text="Thinking…" />}
      {entry.events.map((ev, i) =>
        // A small edit's card already says what changed: the generic patch summary before it is redundant.
        ev.type === 'patches' && entry.events[i + 1]?.type === 'edit' ? null :
        // While streaming only the newest progress line is relevant.
        ev.type === 'status' && i !== entry.events.length - 1 ? null : ev.type === 'status' && live ? <ThinkingSkeleton key={i} text={ev.text} /> : <ChatEvent key={i} event={ev} live={live && i === entry.events.length - 1} />,
      )}
      {live && last && last.type !== 'status' && <ThinkingSkeleton text="Working…" />}
      {entry.status === 'aborted' && entry.events.length === 0 && <div className="ev ev--status">Stopped.</div>}
    </div>
  );
});

/** One-tap follow-ups under the latest finished turn. */
const RemixChips = memo(function RemixChips({ onPick }: { onPick: (prompt: string) => void }): ReactElement | null {
  const world = useWorld();
  const selection = useUI((s) => s.selection);
  const mode = useUI((s) => s.mode);
  const { sky, weather, gravity } = world.environment;
  const remix = useMemo(() => remixSuggestions({ sky, weather, gravity }), [sky, weather, gravity]);
  const refine = useMemo(() => refineChips(world, selection), [world, selection]);
  const chips = selection.length > 0 ? refine : [...refine.slice(0, 1), ...remix.map((r) => ({ label: r.prompt, prompt: r.prompt }))].slice(0, 3);
  if (mode !== 'edit' || chips.length === 0) return null;
  return (
    <div className="remix" role="group" aria-label="Refine it">
      {chips.map((c) => (
        <button key={c.prompt} type="button" className="chip chip--action" onClick={() => onPick(c.prompt)}>
          {c.label}
        </button>
      ))}
    </div>
  );
});

/** First-run nudge: the world exists, so the next message edits it. Shown until the first small edit. */
const RefineHint = memo(function RefineHint(): ReactElement | null {
  const edited = useUI((s) => s.chat.some((e) => e.role === 'assistant' && e.events.some((ev) => ev.type === 'edit')));
  if (edited) return null;
  return (
    <p className="refine-hint" data-testid="refine-hint">
      <Icon name="info" /> Your world is ready. Keep going in plain words: every message tweaks it (“make the roof red”, “move that a bit left”) and only what you name changes. Select something and say “make it bigger”.
    </p>
  );
});

/** Prompt composer with reference images. */
const Composer = memo(function Composer({ onSend, busy }: { onSend: (text: string, images: string[], photo?: 'recreate') => void; busy: boolean }): ReactElement {
  const studio = useStudio();
  const world = useWorld();
  const selection = useUI((s) => s.selection);
  const [draft, setDraft] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  const send = (): void => {
    const t = draft.trim();
    if (!t || busy) return;
    onSend(t, images);
    setDraft('');
    setImages([]);
  };
  // "Recreate this image": rebuild the room in the first attached photo from the photo itself.
  const recreate = (): void => {
    if (busy || images.length === 0) return;
    onSend(draft.trim() || 'Recreate this room from the photo', images, 'recreate');
    setDraft('');
    setImages([]);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };
  const attach = async (files: FileList | null): Promise<void> => {
    const list = [...(files ?? [])].slice(0, MAX_REFERENCE_IMAGES - images.length);
    for (const f of list) {
      const r = await prepareReferenceImage(f);
      if (r.ok) setImages((prev) => (prev.length < MAX_REFERENCE_IMAGES ? [...prev, r.dataUrl] : prev));
      else studio.store.getState().toast(r.error, 'error', 5);
    }
  };

  return (
    <form
      className={`composer${busy ? ' is-busy' : ''}`}
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      {images.length > 0 && (
        <div className="composer__images">
          {images.map((src, i) => (
            <span key={i} className="composer__image">
              <img src={src} alt={`Reference ${i + 1}`} width={40} height={40} />
              <button type="button" className="composer__image-x" aria-label={`Remove reference ${i + 1}`} onClick={() => setImages((p) => p.filter((_, j) => j !== i))}>
                <Icon name="x" />
              </button>
            </span>
          ))}
        </div>
      )}
      <textarea
        id="prompt-input"
        ref={inputRef}
        className="composer__input"
        value={draft}
        rows={2}
        maxLength={MAX_PROMPT_CHARS}
        placeholder={composerPlaceholder(world, selection, busy)}
        aria-label="Prompt"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="composer__bar">
        <button
          type="button"
          className="icon-btn icon-btn--sm"
          aria-label="Attach reference images"
          data-tip="Attach reference images"
          disabled={images.length >= MAX_REFERENCE_IMAGES}
          onClick={() => fileRef.current?.click()}
        >
          <Icon name="plus" />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          hidden
          onChange={(e) => {
            void attach(e.target.files);
            e.target.value = '';
          }}
        />
        <ModelPicker />
        <RefineMenu />
        <DeepBuildToggle />
        {images.length > 0 && !busy && (
          <button type="button" className="chip chip--action" onClick={recreate} data-testid="recreate-image" data-tip="Rebuild the room in this photo: its walls, windows, furniture and colours">
            <Icon name="image" /> Recreate this image
          </button>
        )}
        <span className="spacer" />
        {busy ? (
          <button type="button" className="send-btn send-btn--stop" onClick={() => studio.stopAgent()} aria-label="Stop generating" data-tip="Stop" data-kbd="Esc">
            <Icon name="stop" />
          </button>
        ) : (
          <button type="submit" className="send-btn" disabled={draft.trim() === ''} aria-label="Send" data-tip="Send" data-kbd="↵">
            <Icon name="send" />
          </button>
        )}
      </div>
    </form>
  );
});

/** The agent panel body (header is rendered by the left panel shell). */
export const AgentPanel = memo(function AgentPanel(): ReactElement {
  const studio = useStudio();
  const chat = useUI((s) => s.chat);
  const busy = useUI((s) => s.agentBusy);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const lastEntry = chat[chat.length - 1];
  const lastDone = lastEntry !== undefined && lastEntry.role === 'assistant' && lastEntry.status === 'done';

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    // The empty state reads top-down; a conversation follows its newest entry. Scrolling
    // waits for the next frame: chat updates stream in from worker and network messages
    // (every verification result), and scrolling inside each of those tasks forced a layout
    // per message; one scroll per frame covers any number of updates.
    const empty = chat.length === 0;
    return scheduleScroll(() => {
      if (empty) el.scrollTop = 0;
      else if (stickToBottom.current) el.scrollTop = el.scrollHeight;
    });
  }, [chat]);

  const send = (text: string, images: readonly string[] = [], offline = false, intent?: 'new', photo?: 'recreate'): void => {
    const t = text.trim();
    if (!t || busy) return;
    stickToBottom.current = true;
    launchPromptFlight(t, document.getElementById('prompt-input'));
    void studio.send(t, { images, offline, ...(intent ? { intent } : {}), ...(photo ? { photo } : {}) });
  };

  return (
    <div className="agent">
      <div
        className="agent__list scroll-y"
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        aria-live="polite"
      >
        {chat.length === 0 ? <EmptyAgent onPrompt={(p) => send(p, [], false, 'new')} onRefine={(p) => send(p)} onTemplate={(p) => send(p, [], true, 'new')} /> : chat.map((entry) => <ChatItem key={entry.id} entry={entry} />)}
        {!busy && lastDone && <RefineHint />}
        {!busy && lastDone && <RemixChips onPick={(p) => send(p)} />}
      </div>
      <Composer onSend={(t, imgs, photo) => send(t, imgs, false, undefined, photo)} busy={busy} />
    </div>
  );
});
