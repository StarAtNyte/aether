/**
 * The shared-visit controls of the player (worlds with `sharedVisits`, loaded lazily): Invite (copies this link with
 * `room=<id>` and joins it), the number of visitors here, this visitor's name and body, a short chat, and the name
 * tags over the others. A link with `room=` joins that room on open. When no relay answers (a static host), nothing
 * is shown.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactElement } from 'react';
import { COPRESENCE_CHAT_MAX, COPRESENCE_NAME_MAX, newRoomId, type PresenceBody } from '@aether/core/copresence';
import type { Simulation } from '../../engine/Simulation';
import { BroadcastTransport } from './broadcast';
import { CopresenceController } from './controller';
import { loadIdentity, roomFromHash, saveIdentity, withRoom, type Identity } from './identity';
import type { SessionSnapshot } from './session';
import type { CopresenceTransport } from './transport';
import { relayAvailable, WebSocketTransport } from './websocket';

const BODIES: ReadonlyArray<{ id: PresenceBody; label: string }> = [
  { id: 'kaho-vrm', label: 'Kaho' },
  { id: 'mio-vrm', label: 'Mio' },
];

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

  // Pick the transport: tabs of this browser (`relay=tabs`), else the server's relay when it answers.
  useEffect(() => {
    let alive = true;
    const { relay } = roomFromHash(location.hash);
    if (relay === 'tabs') setTransport(new BroadcastTransport(world));
    else
      void relayAvailable().then((ok) => {
        if (alive && ok) setTransport(new WebSocketTransport(world));
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
    ctrlRef.current?.session.setIdentity(next.name, next.body);
  };
  const chooseBody = (body: PresenceBody): void => {
    const next = { ...identity, body };
    setIdentity(next);
    saveIdentity(next);
    ctrlRef.current?.session.setIdentity(next.name, next.body);
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
                    <button key={b.id} type="button" className={`pl-seg__item${identity.body === b.id ? ' is-on' : ''}`} aria-pressed={identity.body === b.id} onClick={() => chooseBody(b.id)}>
                      {b.label}
                    </button>
                  ))}
                </div>
              </div>
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
