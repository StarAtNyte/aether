/**
 * The film's "Render video" panel: the frame rate (30 or 60 fps at 1080p), the progress of the offline render with a
 * cancel, and the finished file (it downloads by itself; the link stays to download it again).
 */
import { memo, type ReactElement } from 'react';
import { FILM_FPS, type FilmFps } from './film-schedule';
import type { FilmProgress } from './film-export';

export interface FilmPanelState {
  fps: FilmFps;
  /** The render under way, null before and after. */
  progress: FilmProgress | null;
  /** The finished file. */
  done: { url: string; name: string; detail: string } | null;
  error: string | null;
}

const PHASES: Record<FilmProgress['phase'], string> = {
  preparing: 'Preparing…',
  sound: 'Rendering the sound…',
  rendering: 'Rendering',
  encoding: 'Finishing the encode…',
  muxing: 'Writing the file…',
};

export const FilmPanel = memo(function FilmPanel({ state, onFps, onStart, onCancel, onClose }: { state: FilmPanelState; onFps: (fps: FilmFps) => void; onStart: () => void; onCancel: () => void; onClose: () => void }): ReactElement {
  const p = state.progress;
  const share = p && p.frames > 0 ? (p.phase === 'rendering' ? p.frame / p.frames : p.phase === 'encoding' || p.phase === 'muxing' ? 1 : 0) : 0;
  return (
    <div className="pl-center pl-dim">
      <div className="pl-panel" role="dialog" aria-label="Render video" data-testid="pl-film-panel">
        <h2 className="pl-panel__title">Render video</h2>
        <p className="pl-muted">The film rendered frame by frame at 1080p on the top quality, with its sound. It never drops a frame; it takes longer than the film runs.</p>
        <div className="pl-seg pl-seg--2" role="radiogroup" aria-label="Frame rate">
          {FILM_FPS.map((f) => (
            <button key={f} type="button" role="radio" aria-checked={state.fps === f} disabled={p !== null} className={`pl-seg__item${state.fps === f ? ' is-on' : ''}`} onClick={() => onFps(f)} data-testid={`pl-film-fps-${f}`}>
              {f} fps
            </button>
          ))}
        </div>
        {p && (
          <div className="pl-film__progress" data-testid="pl-film-progress">
            <div className="pl-film__bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)}>
              <span style={{ width: `${(share * 100).toFixed(1)}%` }} />
            </div>
            <p className="pl-muted">{p.phase === 'rendering' ? `${PHASES.rendering} frame ${p.frame} of ${p.frames}` : PHASES[p.phase]}</p>
          </div>
        )}
        {state.done && (
          <p className="pl-muted" data-testid="pl-film-done">
            Saved <a href={state.done.url} download={state.done.name}>{state.done.name}</a> ({state.done.detail})
          </p>
        )}
        {state.error && (
          <p className="pl-muted" role="alert">
            {state.error}
          </p>
        )}
        <div className="pl-panel__actions">
          {p ? (
            <button type="button" className="pl-btn" onClick={onCancel} data-testid="pl-film-cancel">
              Cancel
            </button>
          ) : (
            <>
              <button type="button" className="pl-btn" onClick={onClose} data-testid="pl-film-close">
                Close
              </button>
              <button type="button" className="pl-btn pl-btn--primary" onClick={onStart} autoFocus data-testid="pl-film-start">
                {state.done ? 'Render again' : 'Render'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
});
