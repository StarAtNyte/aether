import { memo, useMemo, type CSSProperties, type ReactElement } from 'react';
import type { WorldIntro } from '@aether/core';
import { useStudio, useUI, useWorld } from '../../app/context';
import { isTouchScreen, touchHints } from '../../lib/touchHints';
import { Icon } from '../Icon';

function formatClock(t: number): string {
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Title card: the world's title screen over the live scene (held until the
 * player starts). Everything is rendered as plain text.
 */
const TitleCardView = memo(function TitleCardView({ intro, onStart, onExit }: { intro: WorldIntro; onStart: () => void; onExit: () => void }): ReactElement {
  const style = intro.accent ? ({ '--title-accent': intro.accent } as CSSProperties) : undefined;
  // Phones get the on-screen controls, never keyboard keys.
  const controls = useMemo(() => (isTouchScreen() ? touchHints(intro.controls) : intro.controls), [intro.controls]);
  return (
    <div className="title-card" role="dialog" aria-modal="false" aria-labelledby="title-card-title" style={style}>
      <div className="title-card__body">
        <h2 id="title-card-title" className="title-card__title">
          {intro.title}
        </h2>
        {intro.tagline && <p className="title-card__tagline">{intro.tagline}</p>}
        {intro.objective && <p className="title-card__objective">{intro.objective}</p>}
        {controls.length > 0 && (
          <ul className="title-card__controls" aria-label="Controls">
            {controls.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        )}
        <div className="title-card__actions">
          <button type="button" className="btn btn--primary title-card__start" onClick={onStart} autoFocus>
            <Icon name="play" /> Start
          </button>
          <button type="button" className="btn btn--ghost title-card__exit" onClick={onExit}>
            Back to editor
          </button>
        </div>
      </div>
    </div>
  );
});

/**
 * The title card overlay while a play session is held (every kind of world,
 * block worlds included): Start releases the game, Back to editor stops it.
 */
export const TitleCard = memo(function TitleCard(): ReactElement | null {
  const studio = useStudio();
  const world = useWorld();
  const mode = useUI((s) => s.mode);
  const showing = useUI((s) => s.game.intro);
  if (mode !== 'play' || !showing || !world.intro) return null;
  return <TitleCardView intro={world.intro} onStart={() => studio.startGame()} onExit={() => void studio.togglePlay()} />;
});

/**
 * Crosshair and the use prompt ("E · Open drawer") in play mode: a small dot
 * always, the prompt only while the crosshair is on something usable.
 */
export const InteractPromptView = memo(function InteractPromptView(): ReactElement | null {
  const mode = useUI((s) => s.mode);
  const prompt = useUI((s) => s.interact);
  const photo = useUI((s) => s.arch.photo);
  const intro = useUI((s) => s.game.intro);
  if (mode !== 'play' || photo || intro) return null;
  return (
    <div className="interact" aria-live="polite" data-testid="interact">
      <span className={`interact__dot${prompt ? ' is-active' : ''}`} aria-hidden="true" />
      {prompt && (
        <span className="interact__prompt" role="status">
          <kbd>{prompt.key}</kbd> {prompt.verb} {prompt.noun}
          {prompt.hint && <span className="interact__hint">{prompt.hint}</span>}
        </span>
      )}
    </div>
  );
});

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
  // The title card (rendered by the viewport) covers the held game: no HUD under it.
  if (game.intro && world.intro) return null;
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
          <kbd>E</kbd> Open · use
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
                <Icon name="refresh" /> {game.status === 'won' ? 'Play again' : 'Try again'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
});
