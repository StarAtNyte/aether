/**
 * The explore bar of the standalone player (lazy-loaded with the explore controller): the tour stops or viewpoints with
 * autoplay, the dollhouse and plan of a building, the city's drone tour, time of day, photo mode and Play. In the player's
 * glass style; touch friendly (44 px targets on phones).
 */
import { memo, useState, type ReactElement } from 'react';
import { hourLabel, TIME_PRESETS } from '../state/archUi';
import type { Experience } from './experience';
import type { ExploreController, ExploreState } from './explore';

export { ExploreController, pickStops } from './explore';

/** Short label of stop `i` (its name, else its number). */
function stopLabel(name: string | undefined, i: number, exp: Experience): string {
  if (name) return name;
  if (i === 0) return exp.kind === 'arch' ? 'Arrival' : 'Hero view';
  return `${exp.kind === 'arch' ? 'Stop' : 'View'} ${i + 1}`;
}

/** The bar. */
export const ExploreBar = memo(function ExploreBar({ state, ctrl, exp, onPlay, canPlay }: { state: ExploreState; ctrl: ExploreController; exp: Experience; onPlay: () => void; canPlay: boolean }): ReactElement {
  const [timeOpen, setTimeOpen] = useState(false);
  const inside = state.view === 'dollhouse' || state.view === 'plan';
  if (state.photo) {
    return (
      <div className="pl-photo" role="toolbar" aria-label="Photo mode">
        <button
          type="button"
          className="pl-btn pl-btn--small pl-btn--primary"
          onClick={() =>
            void ctrl.picture().then((url) => {
              if (!url) return;
              const a = document.createElement('a');
              a.href = url;
              a.download = 'aether-photo.jpg';
              a.click();
            })
          }
        >
          Save picture
        </button>
        <button type="button" className="pl-btn pl-btn--small" onClick={() => ctrl.setPhoto(false)}>
          Done
        </button>
      </div>
    );
  }
  return (
    <div className="pl-xbar" role="toolbar" aria-label={exp.stopsLabel} data-testid="pl-xbar">
      {state.stops.length > 0 && (
        <div className="pl-xbar__group pl-xbar__stops">
          <span className="pl-xbar__label">{exp.stopsLabel}</span>
          <button type="button" className="pl-xbtn" aria-label="Previous stop" title="Previous ( [ )" onClick={() => ctrl.prev()}>
            ‹
          </button>
          <div className="pl-xbar__chips">
            {state.stops.map((s, i) => (
              <button key={i} type="button" className={`pl-chip${state.index === i ? ' is-on' : ''}`} aria-current={state.index === i ? 'true' : undefined} onClick={() => ctrl.goTo(i)}>
                {stopLabel(s.name, i, exp)}
              </button>
            ))}
          </div>
          <button type="button" className="pl-xbtn" aria-label="Next stop" title="Next ( ] )" onClick={() => ctrl.next()}>
            ›
          </button>
          <button type="button" className={`pl-xbtn${state.autoplay ? ' is-on' : ''}`} aria-pressed={state.autoplay} aria-label={state.autoplay ? 'Pause the tour' : 'Play the tour'} title="Autoplay (Space)" onClick={() => ctrl.setAutoplay(!state.autoplay)} data-testid="pl-autoplay">
            {state.autoplay ? '❚❚' : '▶'}
          </button>
        </div>
      )}
      {exp.dollhouse && (
        <div className="pl-xbar__group">
          <button type="button" className={`pl-xbtn pl-xbtn--label${state.view === 'dollhouse' ? ' is-on' : ''}`} aria-pressed={state.view === 'dollhouse'} title="Dollhouse: the house cut open, click a room to go in (M)" onClick={() => (state.view === 'plan' ? ctrl.setPlan(false) : ctrl.toggleDollhouse())} data-testid="pl-dollhouse">
            Dollhouse
          </button>
          <button type="button" className={`pl-xbtn pl-xbtn--label${state.view === 'plan' ? ' is-on' : ''}`} aria-pressed={state.view === 'plan'} title="Floor plan from above" onClick={() => ctrl.setPlan(state.view !== 'plan')}>
            Plan
          </button>
          {inside && (
            <button type="button" className="pl-xbtn pl-xbtn--label" onClick={() => ctrl.toggleDollhouse()}>
              Walk
            </button>
          )}
        </div>
      )}
      {exp.explore === 'drone' && (
        <div className="pl-xbar__group">
          <button type="button" className={`pl-xbtn pl-xbtn--label${state.view === 'drone' && state.index === -1 ? ' is-on' : ''}`} title="Drone tour of the whole city" onClick={() => ctrl.droneTour()} data-testid="pl-drone">
            Drone tour
          </button>
        </div>
      )}
      <div className="pl-xbar__group pl-xbar__time">
        <button type="button" className={`pl-xbtn pl-xbtn--label${state.hour !== null ? ' is-on' : ''}`} aria-expanded={timeOpen} title="Time of day (1–4)" onClick={() => setTimeOpen(!timeOpen)}>
          ☀ {state.hour === null ? 'Time' : hourLabel(state.hour)}
        </button>
        {timeOpen && (
          <div className="pl-xpop" role="group" aria-label="Time of day">
            <input type="range" aria-label="Time of day" min={5} max={23} step={0.1} value={state.hour ?? 14} onChange={(e) => ctrl.setHour(Number(e.target.value), true)} onPointerUp={(e) => ctrl.setHour(Number((e.target as HTMLInputElement).value))} />
            <div className="pl-xpop__chips">
              {TIME_PRESETS.map((p) => (
                <button key={p.key} type="button" className={`pl-chip${state.hour === p.hour ? ' is-on' : ''}`} onClick={() => ctrl.setHour(p.hour)}>
                  {p.label}
                </button>
              ))}
              <button type="button" className="pl-chip" disabled={state.hour === null} onClick={() => ctrl.setHour(null)}>
                As built
              </button>
            </div>
          </div>
        )}
      </div>
      {exp.photo && (
        <button type="button" className="pl-xbtn pl-xbtn--label" title="Photo mode (F)" onClick={() => ctrl.setPhoto(true)}>
          Photo
        </button>
      )}
      {canPlay && (
        <button type="button" className="pl-btn pl-btn--primary pl-xbar__play" title="Play as the character (P)" onClick={onPlay} data-testid="pl-explore-play">
          ▶ Play
        </button>
      )}
    </div>
  );
});
