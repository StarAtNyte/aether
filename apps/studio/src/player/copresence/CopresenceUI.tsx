/**
 * The shared-visit controls of the player (worlds with `sharedVisits`, loaded lazily): Invite (copies this link with
 * `room=<id>` and joins it), the number of visitors here, this visitor's name, body and outfit colour, a short chat, and the name
 * tags over the others. A link with `room=` joins that room on open. The server's relay is the first choice; a static
 * host uses the build's Supabase project (`supabase.ts`); with neither, nothing is shown.
 *
 * Voice: a mic button (off until clicked; the browser asks for the microphone then, and `voice.ts` loads then), open
 * mic or push-to-talk (hold V, or hold the button), and in the panel the people here with a mute and a volume for each.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactElement } from 'react';
import { COPRESENCE_CHAT_MAX, COPRESENCE_NAME_MAX, PRESENCE_HUES, VOICE_MAX_TALKERS, newRoomId, presenceColours, type PresenceBody } from '@aether/core/copresence';
import type { Simulation } from '../../engine/Simulation';
import { BroadcastTransport } from './broadcast';
import { CopresenceController } from './controller';
import { loadIdentity, roomFromHash, saveIdentity, withRoom, type Identity } from './identity';
import type { SessionSnapshot } from './session';
import type { CopresenceTransport } from './transport';
import type { VoiceMode, VoiceSnapshot, VoiceStatus } from './voice';
import { relayInfo, WebSocketTransport } from './websocket';

const BODIES: ReadonlyArray<{ id: PresenceBody; label: string }> = [
  { id: 'kaho-vrm', label: 'Kaho' },
  { id: 'mio-vrm', label: 'Mio' },
];

/** Names of the {@link PRESENCE_HUES} swatches (screen readers and tooltips). */
const HUE_NAMES: Readonly<Record<number, string>> = { 0: 'red', 30: 'orange', 55: 'yellow', 140: 'green', 180: 'teal', 210: 'blue', 260: 'violet', 310: 'pink' };

const VOICE_TEXT: Partial<Record<VoiceStatus, string>> = {
  denied: 'Microphone blocked. Allow it for this site to talk.',
  full: `Voice is full (${VOICE_MAX_TALKERS} people). Chat still works.`,
  unsupported: "Voice isn't available in this browser.",
  error: 'No microphone could be opened.',
};

/** Push-to-talk key (held). */
const PTT_CODE = 'KeyV';

const isTyping = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

function MicIcon({ off }: { off?: boolean }): ReactElement {
  return (
    <svg className="pl-cmic__icon" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      {off && <path d="M4 4l16 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
    </svg>
  );
}

const STATUS_TEXT: Partial<Record<SessionSnapshot['status'], string>> = {
  connecting: 'Joining…',
  full: 'This visit is full (16 people).',
  lost: 'Connection lost.',
  unreachable: 'Could not join the visit.',
};

export function CopresencePanel({ sim, world, hidden }: { sim: Simulation; world: string; hidden?: boolean }): ReactElement | null {
  const layerRef = useRef<HTMLDivElement>(null);
  const ctrlRef = useRef<CopresenceController | null>(null);
  const [transport, setTransport] = useState<CopresenceTransport | null>(null);
  const [snap, setSnap] = useState<SessionSnapshot | null>(null);
  const [identity, setIdentity] = useState<Identity>(() => loadIdentity());
  const [nameDraft, setNameDraft] = useState(identity.name);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const logRef = useRef<HTMLOListElement>(null);
  const [voice, setVoice] = useState<VoiceSnapshot | null>(null);

  // Pick the transport: tabs of this browser (`relay=tabs`), else the server's relay when it answers, else the build's
  // Supabase project (a static host), loaded only then.
  useEffect(() => {
    let alive = true;
    const { relay } = roomFromHash(location.hash);
    if (relay === 'tabs') setTransport(new BroadcastTransport(world));
    else
      void relayInfo().then(async (info) => {
        if (info.ok) return alive && setTransport(new WebSocketTransport(world, location.href, info.voice));
        if (!import.meta.env.VITE_SUPABASE_URL) return;
        const { SupabaseTransport, supabaseConfig } = await import('./supabase');
        const cfg = supabaseConfig();
        if (alive && cfg) setTransport(new SupabaseTransport(world, cfg));
      });
    return () => {
      alive = false;
    };
  }, [world]);

  // One controller per transport; a link with a room joins it at once.
  useEffect(() => {
    const layer = layerRef.current;
    if (!transport || !layer) return;
    const ctrl = new CopresenceController(sim, transport, layer, identity, setSnap);
    ctrl.onVoice = setVoice;
    ctrl.onVoiceFailed = (_peer, name) => setNote(`Voice couldn't connect to ${name}. A network on the way blocks direct connections.`);
    ctrlRef.current = ctrl;
    const { room } = roomFromHash(location.hash);
    if (room) void ctrl.join(room);
    const bye = (): void => ctrl.leave();
    window.addEventListener('pagehide', bye);
    return () => {
      window.removeEventListener('pagehide', bye);
      ctrl.dispose();
      ctrlRef.current = null;
    };
    // The identity is read once here; later changes go through setIdentity on the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transport, sim]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [snap?.chat.length, open]);

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 3500);
    return () => clearTimeout(t);
  }, [note]);

  const live = snap?.status === 'live';
  const voiceOn = voice?.status === 'on';
  const mode: VoiceMode = voice?.mode ?? 'open';

  // Push-to-talk: hold V (not while typing). Window blur lets go.
  useEffect(() => {
    const v = ctrlRef.current?.voice;
    if (!voiceOn || mode !== 'ptt' || !v) return;
    const down = (e: globalThis.KeyboardEvent): void => {
      if (e.code !== PTT_CODE || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      e.preventDefault();
      if (!e.repeat) v.setHolding(true);
    };
    const up = (e: globalThis.KeyboardEvent): void => {
      if (e.code === PTT_CODE) v.setHolding(false);
    };
    const blur = (): void => v.setHolding(false);
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
      window.removeEventListener('blur', blur);
      v.setHolding(false);
    };
  }, [voiceOn, mode]);

  const mic = async (): Promise<void> => {
    const ctrl = ctrlRef.current;
    if (!ctrl) return;
    if (voiceOn) {
      if (mode === 'open') ctrl.voice?.setSelfMuted(!voice?.selfMuted);
      return;
    }
    const s = await ctrl.startVoice();
    const text = VOICE_TEXT[s];
    if (text) setNote(text);
    else if (s === 'on') setNote(mode === 'ptt' ? 'In voice. Hold V to talk.' : 'In voice. Others nearby hear you.');
  };
  const hold = (on: boolean): void => {
    if (voiceOn && mode === 'ptt') ctrlRef.current?.voice?.setHolding(on);
  };

  const invite = useCallback(async () => {
    const ctrl = ctrlRef.current;
    if (!ctrl) return;
    let room = roomFromHash(location.hash).room;
    if (!room || !live) {
      room = room ?? newRoomId();
      // replaceState: a hash change would reload the player.
      history.replaceState(history.state, '', withRoom(location.href, room));
      if (!live && !(await ctrl.join(room))) return;
    }
    const link = withRoom(location.href, room);
    try {
      await navigator.clipboard.writeText(link);
      setShareLink(null);
      setNote('Link copied. Anyone who opens it joins this visit.');
    } catch {
      // No clipboard (an http address on the network, a denied permission): show the link to copy by hand.
      setShareLink(link);
      setOpen(true);
    }
  }, [live]);

  const commitName = (): void => {
    const name = nameDraft.trim().slice(0, COPRESENCE_NAME_MAX);
    if (!name) {
      setNameDraft(identity.name);
      return;
    }
    const next = { ...identity, name };
    setIdentity(next);
    saveIdentity(next);
    ctrlRef.current?.session.setIdentity(next.name, next.body, next.tint);
  };
  const chooseLook = (change: Partial<Pick<Identity, 'body' | 'tint'>>): void => {
    const next = { ...identity, ...change };
    setIdentity(next);
    saveIdentity(next);
    ctrlRef.current?.session.setIdentity(next.name, next.body, next.tint);
  };
  const send = (e: FormEvent): void => {
    e.preventDefault();
    if (ctrlRef.current?.session.say(draft)) setDraft('');
  };
  const escapeBlurs = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.currentTarget.blur();
    }
  };
  const leave = (): void => {
    ctrlRef.current?.leave();
    setVoice(null);
    setOpen(false);
    const u = new URL(location.href);
    const q = new URLSearchParams(u.hash.slice(1));
    q.delete('room');
    u.hash = q.toString();
    history.replaceState(history.state, '', u.href);
  };

  const status = snap ? STATUS_TEXT[snap.status] : undefined;
  return (
    <>
      <div className="pl-ctags" ref={layerRef} aria-hidden="true" />
      {transport && !hidden && (
        <div className="pl-copresence" role="region" aria-label="Shared visit" data-testid="pl-copresence">
          <div className="pl-copresence__bar">
            {live && (
              <button type="button" className="pl-cbtn" aria-expanded={open} aria-controls="pl-cpanel" onClick={() => setOpen(!open)} data-testid="pl-copresence-count">
                <span className="pl-cbtn__dot" aria-hidden="true" />
                {snap.count === 1 ? 'Only you here' : `${snap.count} here`}
              </button>
            )}
            {live && transport.voice && (
              <button
                type="button"
                className={`pl-cbtn pl-cmic${voiceOn ? ' is-on' : ''}${voice?.transmitting ? ' is-live' : ''}${voice?.selfSpeaking ? ' is-speaking' : ''}`}
                aria-pressed={voiceOn ? (mode === 'ptt' ? !!voice?.transmitting : !voice?.selfMuted) : false}
                disabled={voice?.status === 'starting'}
                title={voiceOn ? (mode === 'ptt' ? 'Hold to talk (or hold V)' : voice?.selfMuted ? 'Unmute your microphone' : 'Mute your microphone') : 'Join voice: talk with the others here (asks for your microphone)'}
                onClick={() => void mic()}
                onPointerDown={() => hold(true)}
                onPointerUp={() => hold(false)}
                onPointerLeave={() => hold(false)}
                onPointerCancel={() => hold(false)}
                onKeyDown={(e) => {
                  if (mode === 'ptt' && voiceOn && (e.key === ' ' || e.key === 'Enter')) {
                    e.preventDefault();
                    hold(true);
                  }
                }}
                onKeyUp={(e) => {
                  if (e.key === ' ' || e.key === 'Enter') hold(false);
                }}
                data-testid="pl-voice"
              >
                <MicIcon off={voiceOn && !voice?.transmitting && mode === 'open'} />
                {!voiceOn ? (voice?.status === 'starting' ? 'Voice…' : 'Voice') : mode === 'ptt' ? (voice?.transmitting ? 'Talking' : 'Hold V') : voice?.selfMuted ? 'Muted' : 'Mic on'}
              </button>
            )}
            <button type="button" className="pl-cbtn pl-cbtn--invite" onClick={() => void invite()} disabled={snap?.status === 'connecting'} data-testid="pl-invite" title="Copy a link to this world that others can join">
              Invite
            </button>
          </div>
          <p className="pl-copresence__note" role="status">
            {note ?? (snap && snap.status !== 'live' && snap.status !== 'closed' ? status : '')}
          </p>
          {open && live && (
            <div className="pl-cpanel" id="pl-cpanel" role="dialog" aria-label="Shared visit">
              {shareLink && (
                <label className="pl-cfield">
                  <span>Link to share</span>
                  <input className="pl-cinput" readOnly value={shareLink} onFocus={(e) => e.currentTarget.select()} onKeyDown={escapeBlurs} />
                </label>
              )}
              <label className="pl-cfield">
                <span>Your name</span>
                <input
                  className="pl-cinput"
                  value={nameDraft}
                  maxLength={COPRESENCE_NAME_MAX}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onBlur={commitName}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                    escapeBlurs(e);
                  }}
                  data-testid="pl-copresence-name"
                />
              </label>
              <div className="pl-cfield">
                <span id="pl-cbody">Your look</span>
                <div className="pl-seg" role="group" aria-labelledby="pl-cbody">
                  {BODIES.map((b) => (
                    <button key={b.id} type="button" className={`pl-seg__item${identity.body === b.id ? ' is-on' : ''}`} aria-pressed={identity.body === b.id} onClick={() => chooseLook({ body: b.id })}>
                      {b.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="pl-cfield">
                <span id="pl-ctint">Your colours</span>
                <div className="pl-cswatches" role="group" aria-labelledby="pl-ctint" data-testid="pl-copresence-tint">
                  <button type="button" className={`pl-cswatch pl-cswatch--auto${identity.tint === null ? ' is-on' : ''}`} aria-pressed={identity.tint === null} title="Automatic: a colour of its own for each visit" onClick={() => chooseLook({ tint: null })}>
                    Auto
                  </button>
                  {PRESENCE_HUES.map((h) => {
                    const c = presenceColours(h);
                    return (
                      <button
                        key={h}
                        type="button"
                        className={`pl-cswatch${identity.tint === h ? ' is-on' : ''}`}
                        style={{ background: `linear-gradient(135deg, ${c.top} 0 55%, ${c.bottom} 55% 100%)` }}
                        aria-pressed={identity.tint === h}
                        aria-label={`Colour ${HUE_NAMES[h] ?? h}`}
                        title={HUE_NAMES[h]}
                        onClick={() => chooseLook({ tint: h })}
                      />
                    );
                  })}
                </div>
              </div>
              {transport.voice && (
                <div className="pl-cfield" data-testid="pl-voice-panel">
                  <span id="pl-cvoice">Voice</span>
                  {voiceOn ? (
                    <>
                      <div className="pl-seg" role="group" aria-labelledby="pl-cvoice">
                        {(['open', 'ptt'] as const).map((m) => (
                          <button key={m} type="button" className={`pl-seg__item${mode === m ? ' is-on' : ''}`} aria-pressed={mode === m} onClick={() => ctrlRef.current?.voice?.setMode(m)}>
                            {m === 'open' ? 'Open mic' : 'Push to talk'}
                          </button>
                        ))}
                      </div>
                      <p className="pl-chint">{mode === 'ptt' ? 'Hold V, or hold the mic button, to talk.' : 'Voices come from where people stand. Headphones stop echo.'}</p>
                      <button type="button" className="pl-btn pl-btn--small pl-cleave" onClick={() => ctrlRef.current?.stopVoice()}>
                        Leave voice
                      </button>
                    </>
                  ) : (
                    <p className="pl-chint">Off. The mic button joins: voices come from where people stand, up to {VOICE_MAX_TALKERS} people.</p>
                  )}
                </div>
              )}
              {snap.peers.length > 0 && (
                <div className="pl-cfield">
                  <span id="pl-cpeople">People here</span>
                  <ul className="pl-cpeople" aria-labelledby="pl-cpeople" data-testid="pl-copresence-people">
                    {snap.peers.map((p) => {
                      const link = voice?.peers[p.id];
                      const heard = voiceOn && link?.state === 'live';
                      const state = !p.voice ? (voiceOn ? 'Not in voice' : '') : !voiceOn ? 'In voice' : !link ? 'Connecting…' : link.state === 'live' ? (link.speaking ? 'Speaking' : 'In voice') : link.state === 'failed' ? "Couldn't connect" : link.state === 'busy' ? 'Voice full' : 'Connecting…';
                      return (
                        <li key={p.id} className={`pl-cperson${link?.speaking && heard ? ' is-speaking' : ''}`}>
                          <span className="pl-cperson__dot" style={{ background: presenceColours(p.hue).top }} aria-hidden="true" />
                          <span className="pl-cperson__name">{p.name}</span>
                          {state && <span className={`pl-cperson__state${link?.state === 'failed' ? ' is-bad' : ''}`}>{state}</span>}
                          {heard && link && (
                            <span className="pl-cperson__ctl">
                              <button type="button" className={`pl-cmute${link.muted ? ' is-on' : ''}`} aria-pressed={link.muted} aria-label={`Mute ${p.name}`} title={link.muted ? `Unmute ${p.name}` : `Mute ${p.name}`} onClick={() => ctrlRef.current?.voice?.setPeerMuted(p.id, !link.muted)}>
                                <MicIcon off={link.muted} />
                              </button>
                              <input type="range" className="pl-cvol" min={0} max={100} step={5} value={Math.round(link.volume * 100)} disabled={link.muted} aria-label={`Volume of ${p.name}`} onChange={(e) => ctrlRef.current?.voice?.setPeerVolume(p.id, Number(e.target.value) / 100)} />
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              <ol className="pl-cchat" ref={logRef} role="log" aria-label="Chat" aria-live="polite">
                {snap.chat.length === 0 && <li className="pl-cchat__empty">{snap.count > 1 ? 'Say hello.' : 'Invite someone, then chat here.'}</li>}
                {snap.chat.map((l) => (
                  <li key={l.id} className={l.self ? 'is-self' : undefined}>
                    <strong>{l.self ? 'You' : l.name}</strong> {l.text}
                  </li>
                ))}
              </ol>
              <form className="pl-csend" onSubmit={send}>
                <input className="pl-cinput" aria-label="Message" placeholder="Message" value={draft} maxLength={COPRESENCE_CHAT_MAX} onChange={(e) => setDraft(e.target.value)} onKeyDown={escapeBlurs} data-testid="pl-copresence-chat" />
                <button type="submit" className="pl-btn pl-btn--small" disabled={!draft.trim()}>
                  Send
                </button>
              </form>
              <button type="button" className="pl-btn pl-btn--small pl-cleave" onClick={leave}>
                Leave visit
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
