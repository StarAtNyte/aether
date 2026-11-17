/**
 * The showroom guide's controls (worlds with `guide`, loaded lazily):
 * - a welcome card when the guide first greets the visitor (her greeting, "Start the guided tour · about N min",
 *   "Explore on my own");
 * - on the tour, a bar with the chapter and the stop, a track of one dot per stop (a click goes there), Back, Pause or
 *   Resume, Next (ringed by the countdown to the next stop), Ask and End, and a heart to save the piece shown;
 * - captions: the line the guide is saying, while she says it;
 * - at the end, a card of the saved pieces with their prices and Enquire, and "Ask {name} about these";
 * - the dock ("Ask {name}", "Take the tour"), which opens into a small chat (the last lines, suggestions, a text field).
 * The person and its bubble are drawn by `guide.ts`.
 */
import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactElement } from 'react';
import type { GuideSpec, WorldDoc } from '@aether/core';
import type { Simulation } from '../../engine/Simulation';
import type { ExploreController } from '../explore';
import { productCard } from '../products/model';
import { COUNTDOWN_S } from './brain';
import { GuideController, SHOW_EVENT, type GuideSnapshot, type SavedPiece } from './guide';
import './guide.css';

/** Suggestions under the chat (the tour first when there is one). */
const SUGGESTIONS = ['Show me something blue', "What's your best Persian rug?", 'Do you deliver?'];

const Icon = ({ d, fill = false }: { d: string; fill?: boolean }): ReactElement => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill={fill ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);
const HEART = 'M12 20.5s-7.2-4.4-9.2-8.8C1.4 8.5 3.4 4.8 7 4.8c2 0 3.5 1.1 5 2.9 1.5-1.8 3-2.9 5-2.9 3.6 0 5.6 3.7 4.2 6.9-2 4.4-9.2 8.8-9.2 8.8z';
const BACK = 'M15 6l-6 6 6 6';
const NEXT = 'M9 6l6 6-6 6';
const PAUSE = 'M8 5v14M16 5v14';
const PLAY = 'M7 5l12 7-12 7z';
const CHAT = 'M4 5h16v11H9l-5 4z';
/** Length of the countdown ring's circle (r = 16). */
const RING = 2 * Math.PI * 16;

/** Open the shop's page for a piece (its card's Enquire or Buy), else its product card. */
function enquire(world: WorldDoc, id: string): void {
  const a = productCard(world, id)?.action;
  if (!a) window.dispatchEvent(new CustomEvent(SHOW_EVENT, { detail: { id } }));
  else if (a.mail) window.location.href = a.url;
  else window.open(a.url, '_blank', 'noopener,noreferrer');
}

export function GuidePanel({
  sim,
  world,
  guide,
  explore,
  show,
}: {
  sim: Simulation;
  world: WorldDoc;
  guide: GuideSpec;
  explore: () => ExploreController | null;
  /** `all`: person and controls; `person`: the person only (playing); `none`: nothing (a story). */
  show: 'all' | 'person' | 'none';
}): ReactElement {
  const layerRef = useRef<HTMLDivElement>(null);
  const ctrlRef = useRef<GuideController | null>(null);
  const [snap, setSnap] = useState<GuideSnapshot | null>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [focused, setFocused] = useState(false);
  const logRef = useRef<HTMLOListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const exploreRef = useRef(explore);
  exploreRef.current = explore;

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const ctrl = new GuideController(sim, world, guide, layer, () => exploreRef.current(), setSnap);
    ctrlRef.current = ctrl;
    setSnap(ctrl.snapshot);
    return () => {
      ctrl.dispose();
      ctrlRef.current = null;
    };
  }, [sim, world, guide]);

  useEffect(() => ctrlRef.current?.setHidden(show === 'none'), [show]);
  useEffect(() => ctrlRef.current?.setTyping(focused || draft.trim().length > 0), [focused, draft]);
  // The guide asks for the panel (Ask the guide, a click on the person, an answer coming).
  const openSeq = snap?.openSeq ?? 0;
  useEffect(() => {
    if (openSeq > 0) setOpen(true);
  }, [openSeq]);
  // A tour starting folds the chat away (the captions and the tour bar take over).
  const touring = !!snap?.tour;
  useEffect(() => {
    if (touring) setOpen(false);
  }, [touring]);
  const logLen = snap?.log.length ?? 0;
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logLen, open, snap?.thinking]);

  const ctrl = ctrlRef.current;
  const name = snap?.name ?? guide.name ?? 'Ava';
  const initial = name.slice(0, 1);
  const send = (text: string): void => {
    const t = text.trim();
    if (!t || !ctrl) return;
    setDraft('');
    void ctrl.ask(t);
  };
  const onSubmit = (e: FormEvent): void => {
    e.preventDefault();
    send(draft);
  };
  const tour = snap?.tour ?? null;
  const visible = show === 'all' && !!snap;
  const welcome = !tour ? (snap?.welcome ?? null) : null;
  const summary = !tour ? (snap?.summary ?? null) : null;
  const card = !!welcome || !!summary;
  const startTour = (): void => {
    setOpen(false);
    ctrl?.startTour();
  };

  return (
    <>
      <div className="pl-ctags" ref={layerRef} aria-hidden="true" />
      {visible && (
        <div className={`pl-gstage${open ? ' is-behind' : ''}`} data-testid="pl-guide-stage">
          {snap.caption && (
            <p className="pl-gcap" key={snap.caption.id} aria-live="polite" data-testid="pl-guide-caption">
              <span className="pl-gcap__who">{name}</span>
              {snap.caption.text}
            </p>
          )}
          {welcome && (
            <section className="pl-gcard" role="dialog" aria-label={`${name}, your guide`} data-testid="pl-guide-welcome">
              <div className="pl-gcard__head">
                <span className="pl-gavatar pl-gavatar--lg" aria-hidden="true">
                  {initial}
                </span>
                <span className="pl-gcard__who">
                  <strong>{name}</strong>
                  <span>Your guide{world.name ? ` at ${world.name}` : ''}</span>
                </span>
                <button type="button" className="pl-gbtn pl-gbtn--ghost" aria-label="Close" onClick={() => ctrl?.dismiss()}>
                  ×
                </button>
              </div>
              <p className="pl-gcard__text">{welcome}</p>
              <div className="pl-gcard__actions">
                <button type="button" className="pl-gcta is-primary" onClick={startTour} data-testid="pl-guide-welcome-tour">
                  <Icon d={PLAY} fill />
                  <span>
                    Start the guided tour
                    <small>
                      about {snap.minutes} min · {snap.stops.length} stops
                    </small>
                  </span>
                </button>
                <button type="button" className="pl-gcta" onClick={() => ctrl?.dismiss()} data-testid="pl-guide-welcome-explore">
                  Explore on my own
                </button>
              </div>
            </section>
          )}
          {summary && <Summary name={name} initial={initial} items={summary} world={world} ctrl={ctrl} onAsk={() => ctrl?.askAboutSaved()} onAgain={startTour} />}
          {tour && (
            <div className="pl-gbar" role="toolbar" aria-label="Guided tour" data-testid="pl-guide-tour">
              <div className="pl-gbar__row">
                <span className="pl-gavatar" aria-hidden="true">
                  {initial}
                </span>
                <span className="pl-gbar__where" aria-live="polite">
                  <span className="pl-gbar__chapter">{tour.chapter || `Stop ${tour.index + 1} of ${tour.count}`}</span>
                  <span className="pl-gbar__title">{tour.title}</span>
                </span>
                {tour.product && (
                  <button
                    type="button"
                    className={`pl-gbtn pl-gbtn--icon pl-gheart${snap.saved.includes(tour.product) ? ' is-on' : ''}`}
                    aria-pressed={snap.saved.includes(tour.product)}
                    aria-label={snap.saved.includes(tour.product) ? `Remove ${tour.title} from favourites` : `Save ${tour.title} to favourites`}
                    title={snap.saved.includes(tour.product) ? 'Saved' : 'Save'}
                    onClick={() => ctrl?.toggleSaved()}
                    data-testid="pl-guide-save"
                  >
                    <Icon d={HEART} fill={snap.saved.includes(tour.product)} />
                  </button>
                )}
                <span className="pl-gbar__n" aria-hidden="true">
                  {tour.index + 1}/{tour.count}
                </span>
              </div>
              <ol className="pl-gtrack" aria-label="Stops">
                {snap.stops.map((s, i) => (
                  <li key={i} className={i > 0 && s.chapter !== snap.stops[i - 1]?.chapter ? 'is-chapter' : undefined}>
                    <button
                      type="button"
                      className={`pl-gdot${i < tour.index ? ' is-done' : ''}${i === tour.index ? ' is-now' : ''}${s.product && snap.saved.includes(s.product) ? ' is-saved' : ''}`}
                      aria-label={`Stop ${i + 1}: ${s.title}`}
                      aria-current={i === tour.index ? 'step' : undefined}
                      title={s.chapter ? `${s.chapter} · ${s.title}` : s.title}
                      onClick={() => ctrl?.goStop(i)}
                    />
                  </li>
                ))}
              </ol>
              <div className="pl-gbar__btns">
                <button type="button" className="pl-gbtn pl-gbtn--icon" onClick={() => ctrl?.tourBack()} disabled={tour.index === 0} aria-label="Previous stop">
                  <Icon d={BACK} />
                </button>
                <button type="button" className={`pl-gbtn pl-gbtn--wide${tour.paused ? ' is-primary' : ''}`} onClick={() => (tour.paused ? ctrl?.resumeTour() : ctrl?.pauseTour())} data-testid="pl-guide-tour-pause">
                  <Icon d={tour.paused ? PLAY : PAUSE} fill={tour.paused} />
                  {tour.paused ? 'Resume' : 'Pause'}
                </button>
                <button type="button" className="pl-gbtn pl-gbtn--icon pl-gnext" onClick={() => ctrl?.tourNext()} aria-label={tour.index === tour.count - 1 ? 'Finish the tour' : 'Next stop'} data-testid="pl-guide-tour-next">
                  {tour.countdown && (
                    <svg className="pl-gring" viewBox="0 0 36 36" aria-hidden="true" key={tour.countdown.seq}>
                      <circle cx="18" cy="18" r="16" style={{ '--c0': `${RING * (1 - tour.countdown.seconds / COUNTDOWN_S)}px`, animationDuration: `${tour.countdown.seconds}s` } as CSSProperties} />
                    </svg>
                  )}
                  <Icon d={NEXT} />
                </button>
                <span className="pl-gbar__gap" />
                <button type="button" className="pl-gbtn pl-gbtn--wide" onClick={() => setOpen(true)} data-testid="pl-guide-tour-ask">
                  <Icon d={CHAT} />
                  Ask
                </button>
                <button type="button" className="pl-gbtn pl-gbtn--wide" onClick={() => ctrl?.endTour()}>
                  End
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {visible && (
        <div className="pl-guide" role="region" aria-label={`${name}, your guide`} data-testid="pl-guide">
          {open ? (
            <div className="pl-gpanel" role="dialog" aria-label={`Ask ${name}`} data-testid="pl-guide-panel">
              <div className="pl-gpanel__head">
                <span className="pl-gavatar" aria-hidden="true">
                  {initial}
                </span>
                <span className="pl-gpanel__title">
                  <strong>{name}</strong>
                  <span>{tour ? `Your guide · ${tour.paused ? 'tour paused' : 'on the tour'}` : 'Your guide'}</span>
                </span>
                {snap.voice !== 'none' && (
                  <button type="button" className={`pl-gbtn pl-gbtn--ghost pl-gvoice${snap.voice === 'on' ? ' is-on' : ''}`} aria-pressed={snap.voice === 'on'} aria-label={snap.voice === 'on' ? `Mute ${name}'s voice` : `Turn on ${name}'s voice`} title={snap.voice === 'on' ? 'Voice on' : 'Voice off'} onClick={() => ctrl?.setVoice(snap.voice !== 'on')} data-testid="pl-guide-voice">
                    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 5 6 9H3v6h3l5 4V5z" />
                      {snap.voice === 'on' ? <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /> : <path d="m16 9 6 6m0-6-6 6" />}
                    </svg>
                  </button>
                )}
                <button type="button" className="pl-gbtn pl-gbtn--ghost" aria-label="Close" onClick={() => setOpen(false)}>
                  ×
                </button>
              </div>
              <ol className="pl-glog" ref={logRef} aria-live="polite" data-testid="pl-guide-log">
                {snap.log.slice(-6).map((l) => (
                  <li key={l.id} className={`pl-gline pl-gline--${l.who}`}>
                    {l.text}
                  </li>
                ))}
                {snap.thinking && (
                  <li className="pl-gline pl-gline--guide pl-gline--thinking" aria-label={`${name} is thinking`}>
                    <i />
                    <i />
                    <i />
                  </li>
                )}
              </ol>
              <div className="pl-gchips">
                {tour?.paused && (
                  <button
                    type="button"
                    className="pl-gchip is-primary"
                    onClick={() => {
                      setOpen(false);
                      ctrl?.resumeTour();
                    }}
                    data-testid="pl-guide-tour-resume"
                  >
                    Carry on with the tour
                  </button>
                )}
                {snap.canTour && !tour && (
                  <button type="button" className="pl-gchip is-primary" onClick={startTour} data-testid="pl-guide-tour-start">
                    Take the tour
                  </button>
                )}
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" className="pl-gchip" onClick={() => send(s)} disabled={snap.thinking}>
                    {s}
                  </button>
                ))}
              </div>
              <form className="pl-gform" onSubmit={onSubmit}>
                <input
                  ref={inputRef}
                  className="pl-ginput"
                  value={draft}
                  maxLength={300}
                  placeholder={`Ask ${name} anything`}
                  aria-label={`Ask ${name}`}
                  onChange={(e) => setDraft(e.target.value)}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Escape') e.currentTarget.blur();
                  }}
                  data-testid="pl-guide-input"
                />
                <button type="submit" className="pl-gbtn pl-gbtn--send" disabled={!draft.trim() || snap.thinking}>
                  Send
                </button>
              </form>
            </div>
          ) : (
            !tour &&
            !card && (
              <div className="pl-gdock">
                <button type="button" className="pl-gopen" onClick={() => setOpen(true)} data-testid="pl-guide-open">
                  <span className="pl-gavatar" aria-hidden="true">
                    {initial}
                  </span>
                  Ask {name}
                </button>
                {snap.canTour && (
                  <button type="button" className="pl-gopen pl-gopen--tour" onClick={startTour}>
                    Take the tour
                  </button>
                )}
              </div>
            )
          )}
        </div>
      )}
    </>
  );
}

/** The end-of-tour card: the saved pieces, each with its price and Enquire. */
function Summary({ name, initial, items, world, ctrl, onAsk, onAgain }: { name: string; initial: string; items: SavedPiece[]; world: WorldDoc; ctrl: GuideController | null; onAsk: () => void; onAgain: () => void }): ReactElement {
  return (
    <section className="pl-gcard" role="dialog" aria-label={items.length > 0 ? 'Your favourites' : 'End of the tour'} data-testid="pl-guide-summary">
      <div className="pl-gcard__head">
        <span className="pl-gavatar pl-gavatar--lg" aria-hidden="true">
          {initial}
        </span>
        <span className="pl-gcard__who">
          <strong>{items.length > 0 ? 'Your favourites' : "That's the tour"}</strong>
          <span>{items.length > 0 ? `${items.length} ${items.length === 1 ? 'piece' : 'pieces'} saved on the tour` : `Thank you for walking round with ${name}`}</span>
        </span>
        <button type="button" className="pl-gbtn pl-gbtn--ghost" aria-label="Close" onClick={() => ctrl?.dismiss()}>
          ×
        </button>
      </div>
      {items.length > 0 ? (
        <ul className="pl-gsaved">
          {items.map((p) => (
            <li key={p.id} className="pl-gsaved__item">
              <span className="pl-gsaved__info">
                <strong>{p.name}</strong>
                <span>{[p.size, p.price].filter(Boolean).join(' · ')}</span>
              </span>
              <button type="button" className="pl-gbtn pl-gbtn--icon pl-gheart is-on" aria-label={`Remove ${p.name}`} title="Remove" onClick={() => ctrl?.toggleSaved(p.id)}>
                <Icon d={HEART} fill />
              </button>
              <button type="button" className="pl-gbtn pl-gbtn--wide is-primary" onClick={() => enquire(world, p.id)}>
                {productCard(world, p.id)?.action?.label ?? 'Enquire'}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="pl-gcard__text">Nothing saved this time. Tap the heart at any stop to keep a piece for later.</p>
      )}
      <div className="pl-gcard__actions">
        {items.length > 0 && (
          <button type="button" className="pl-gcta is-primary" onClick={onAsk} data-testid="pl-guide-ask-saved">
            Ask {name} about these
          </button>
        )}
        <button type="button" className="pl-gcta" onClick={onAgain}>
          Take the tour again
        </button>
      </div>
    </section>
  );
}
