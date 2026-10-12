import { memo, type ReactElement } from 'react';
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
  if (mode !== 'play') return null;
  const over = game.status !== 'playing';
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
          <kbd>W</kbd>
          <kbd>A</kbd>
          <kbd>S</kbd>
          <kbd>D</kbd> move · <kbd>Space</kbd> jump · <kbd>E</kbd> act · drag to look · <kbd>Esc</kbd> stop
        </div>
      )}
      {over && (
        <div className={`game-over ${game.status === 'won' ? 'is-win' : 'is-lose'}`} role="dialog" aria-modal="false" aria-label="Game over">
          <div className="game-over__card">
            <span className="game-over__icon">
              <Icon name={game.status === 'won' ? 'sparkles' : 'alert'} size={26} />
            </span>
            <h2>{game.status === 'won' ? 'You win!' : 'Game over'}</h2>
            {game.text && <p>{game.text}</p>}
            <div className="game-over__actions">
              <button type="button" className="btn btn--primary" onClick={() => void studio.restart()} autoFocus>
                <Icon name="refresh" /> Restart
              </button>
              <button type="button" className="btn" onClick={() => void studio.togglePlay()}>
                <Icon name="stop" /> Back to editor
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
});
