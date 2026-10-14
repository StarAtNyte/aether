import { memo, useMemo, type ReactElement } from 'react';
import { useStudio, useUI, useWorld } from '../../app/context';
import { Icon } from '../Icon';

function formatClock(t: number): string {
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Play-mode HUD: bound state values, timer, controls hint and the win/lose overlay. */
export const PlayHud = memo(function PlayHud(): ReactElement | null {
  const studio = useStudio();
  const world = useWorld();
  const mode = useUI((s) => s.mode);
  const game = useUI((s) => s.game);
  const building = useUI((s) => s.arch.building !== null);
  const photo = useUI((s) => s.arch.photo);
  // The end screen credits the people behind the assets (required for CC-BY, a courtesy for CC0).
  const credits = useMemo(() => (mode === 'play' ? studio.assets.credits() : []), [mode, world, studio]);
  if (mode !== 'play') return null;
  const over = game.status !== 'playing';
  if (building && world.hud.length === 0) {
    // Building walkthrough: no score or clock, just the controls.
    return photo ? (
      <span className="photo-badge">Photo mode · P to leave</span>
    ) : (
      <div className="walk-hint" aria-hidden="true">
        <span>
          <kbd>W</kbd>
          <kbd>A</kbd>
          <kbd>S</kbd>
          <kbd>D</kbd> Walk
        </span>
        <span>
          <kbd>E</kbd> Doors · lights
        </span>
        <span>
          <kbd>L</kbd> All lights
        </span>
        <span>
          <kbd>R</kbd> Swap finish
        </span>
        <span>
          <kbd>1</kbd>–<kbd>4</kbd> Time of day
        </span>
        <span>
          <kbd>V</kbd> View
        </span>
        <span>
          <kbd>P</kbd> Photo
        </span>
        <span>
          <kbd>Esc</kbd> Stop
        </span>
      </div>
    );
  }
  return (
    <>
      <div className="play-hud" aria-live="polite">
        {world.hud.map((b) => (
          <div key={b.key} className="play-hud__stat">
            <span className="play-hud__label">{b.label}</span>
            <span className="play-hud__value">{game.hud[b.key] ?? '–'}</span>
          </div>
        ))}
        <div className="play-hud__stat play-hud__stat--time">
          <span className="play-hud__label">Elapsed</span>
          <span className="play-hud__value">{formatClock(game.time)}</span>
        </div>
      </div>
      {!over && (
        <div className="play-hint" aria-hidden="true">
          <span>
            <kbd>W</kbd>
            <kbd>A</kbd>
            <kbd>S</kbd>
            <kbd>D</kbd> Move
          </span>
          <span>
            <kbd>Space</kbd> Jump
          </span>
          <span>
            <kbd>E</kbd> Act
          </span>
          <span>
            <kbd>Esc</kbd> Stop
          </span>
        </div>
      )}
      {over && (
        <div className={`game-over ${game.status === 'won' ? 'is-win' : 'is-lose'}`} role="dialog" aria-modal="false" aria-label="Game over">
          <div className="game-over__card">
            <span className="game-over__icon">
              <Icon name={game.status === 'won' ? 'check' : 'alert'} size={20} />
            </span>
            <h2>{game.status === 'won' ? 'You win!' : 'Game over'}</h2>
            {game.text && <p>{game.text}</p>}
            {credits.length > 0 && (
              <p className="game-over__credits">
                Assets: {credits.slice(0, 3).map((c) => `${c.source} (${c.licence})`).join(', ')}
                {credits.length > 3 ? ` and ${credits.length - 3} more` : ''}.{' '}
                <button type="button" className="link-btn" onClick={() => studio.assets.setCreditsOpen(true)}>
                  Full credits
                </button>
              </p>
            )}
            <div className="game-over__actions">
              <button type="button" className="btn" onClick={() => void studio.togglePlay()}>
                Back to editor
              </button>
              <button type="button" className="btn btn--primary" onClick={() => void studio.restart()} autoFocus>
                <Icon name="refresh" /> Play again
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
});
