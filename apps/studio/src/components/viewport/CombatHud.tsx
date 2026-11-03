import { memo, type ReactElement } from 'react';
import { useUI } from '../../app/context';
import type { CombatHud as CombatState } from '../../engine/Simulation';

/**
 * The shooter HUD of a world with a player weapon (`player.weapon`): a crosshair with a hit marker (white for a hit,
 * yellow for a head shot, red for a kill), the magazine and reserve, a reload bar and the player's health as a bar.
 * The studio's play mode and the published player both draw it ({@link CombatHudView}).
 */
export const CombatHud = memo(function CombatHud(): ReactElement | null {
  const mode = useUI((s) => s.mode);
  const combat = useUI((s) => s.combat);
  const intro = useUI((s) => s.game.intro);
  const status = useUI((s) => s.game.status);
  const health = useUI((s) => s.game.hud['health']);
  if (mode !== 'play' || !combat || intro || status !== 'playing') return null;
  return <CombatHudView combat={combat} health={health} />;
});

/** The shooter HUD for a weapon snapshot and the formatted `health` HUD value (absent: no health bar). */
export const CombatHudView = memo(function CombatHudView({ combat, health }: { combat: CombatState; health: string | undefined }): ReactElement {
  const hp = Number(health);
  const hpShown = health !== undefined && Number.isFinite(hp) ? Math.max(0, Math.min(100, hp)) : null;
  const low = combat.ammo <= Math.max(1, Math.floor(combat.magazine * 0.2));
  return (
    <div className="combat" aria-live="off" data-testid="combat-hud">
      <div className="combat__cross" aria-hidden="true">
        <span className="combat__tick combat__tick--n" />
        <span className="combat__tick combat__tick--s" />
        <span className="combat__tick combat__tick--w" />
        <span className="combat__tick combat__tick--e" />
        {combat.hits > 0 && <span key={`h${combat.hits}`} className={`combat__marker${combat.head ? ' is-head' : ''}`} />}
        {combat.kills > 0 && <span key={`k${combat.kills}`} className="combat__marker is-kill" />}
      </div>
      {hpShown !== null && (
        <div className={`combat__health${hpShown <= 30 ? ' is-low' : ''}`} role="meter" aria-label="Health" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(hpShown)}>
          <span className="combat__label">Health</span>
          <span className="combat__bar">
            <span className="combat__fill" style={{ width: `${hpShown}%` }} />
          </span>
          <span className="combat__hp">{Math.round(hpShown)}</span>
        </div>
      )}
      <div className={`combat__ammo${low ? ' is-low' : ''}`} data-testid="combat-ammo">
        <span className="combat__weapon">{combat.name}</span>
        <span className="combat__rounds">
          <strong>{combat.ammo}</strong>
          <span className="combat__reserve">/ {combat.reserve}</span>
        </span>
        {combat.reloading ? (
          <span className="combat__reload" aria-label="Reloading">
            <span style={{ width: `${Math.round(combat.reload * 100)}%` }} />
          </span>
        ) : (
          combat.ammo === 0 && <span className="combat__hint">{combat.reserve > 0 ? 'R to reload' : 'Out of ammo'}</span>
        )}
      </div>
    </div>
  );
});

/** The final score and the best run on this device, on a win or game-over screen. */
export const ScoreLine = memo(function ScoreLine({ score, best, record }: { score: number; best?: number | undefined; record?: boolean | undefined }): ReactElement {
  return (
    <p className="game-over__score" data-testid="game-over-score">
      Score <strong>{score}</strong>
      {best !== undefined && (record ? <span className="game-over__best"> · New best!</span> : <span className="game-over__best"> · Best {best}</span>)}
    </p>
  );
});
