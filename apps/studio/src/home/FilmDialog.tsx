/**
 * The film player: a modal (native <dialog>: focus trap, Esc, top layer) over a Stories film. Loaded only when a film card
 * is opened, so the first download carries none of it. The video has `preload="none"` until the modal opens; it then
 * autoplays muted and loops (it is a short clip; reduced-motion users get the poster and press play). WebM is listed
 * first, the MP4 is the fallback. Space or K plays and pauses; the Sound button unmutes.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { Dialog } from '../components/ui/Dialog';
import type { FilmTemplate } from '../lib/examples';
import { FILM_PROVENANCE } from '../showcase/manifest';
import { clock } from './cards';
import '../styles/film.css';

/** Clips up to this long loop. */
export const LOOP_MAX_SECONDS = 30;

export default function FilmDialog({ template, onClose }: { template: FilmTemplate; onClose: () => void }): ReactElement {
  const { film } = template;
  const video = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    let reduce = false;
    try {
      reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      /* no matchMedia: play */
    }
    if (!reduce) void v.play().catch(() => undefined);
  }, []);
  const toggle = (): void => {
    const v = video.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => undefined);
    else v.pause();
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if ((e.key !== ' ' && e.key.toLowerCase() !== 'k') || (e.target as HTMLElement).tagName === 'BUTTON') return;
    e.preventDefault();
    toggle();
  };
  return (
    <Dialog open onClose={onClose} title={template.title} description={template.description} size="lg" className="film-dialog">
      <div className="film__stage" onKeyDown={onKey}>
        <video
          ref={video}
          className="film__video"
          poster={film.poster}
          preload="none"
          controls
          loop={film.seconds <= LOOP_MAX_SECONDS}
          muted={muted}
          playsInline
          aria-label={`${template.title}, a ${clock(film.seconds)} film`}
          onVolumeChange={(e) => setMuted(e.currentTarget.muted)}
        >
          <source src={film.webm} type="video/webm" />
          <source src={film.mp4} type="video/mp4" />
        </video>
        {muted && (
          <button type="button" className="btn film__sound" onClick={() => setMuted(false)} aria-label="Turn sound on">
            Sound on
          </button>
        )}
      </div>
      <p className="film__credit">
        <span>{film.credit}</span>
        <span className="film__label">
          {FILM_PROVENANCE} · {clock(film.seconds)} · {film.note}
        </span>
      </p>
    </Dialog>
  );
}
