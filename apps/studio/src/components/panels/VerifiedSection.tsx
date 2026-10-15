import { memo, type ReactElement } from 'react';
import { useHistoryState, useStudio, useUI } from '../../app/context';
import { badgeOf, clock, isStale, objectiveStatusText } from '../../lib/playtestView';
import { Icon } from '../Icon';

/**
 * "Verified playable" at the top of the Checks tab: the bot's verdict in
 * plain words, the objectives it reached, what it found or fixed, and the
 * replay of its run. A green seal exists only for a real pass on this world.
 */
export const VerifiedSection = memo(function VerifiedSection(): ReactElement {
  const studio = useStudio();
  const pt = useUI((s) => s.playtest);
  const replay = useUI((s) => s.replay);
  const busy = useUI((s) => s.agentBusy);
  const playing = useUI((s) => s.mode === 'play');
  const { head } = useHistoryState();
  const badge = badgeOf(pt, head);
  const running = pt.status === 'running';
  const stale = isStale(pt, head);
  const walk = pt.kind === 'walkthrough';
  const objectives = pt.objectives;
  const doneCount = objectives.filter((o) => o.status === 'done').length;
  const problems = pt.findings.filter((f) => f.severity !== 'info');
  const show = (pos: [number, number, number] | undefined): void => {
    if (pos) studio.simulation?.renderer.frameSphere(pos, 5, [0.6, 0.8, 0.7], 0.6);
  };
  return (
    <section className={`logic-section verified is-${badge.tone}`} data-testid="verified-section" data-verified={badge.verified ? 'true' : 'false'}>
      <h3 className="section-title">{walk ? 'Verified walkable' : 'Verified playable'}</h3>
      <div className="verified__head">
        <span className={`verified__mark is-${badge.tone}`} aria-hidden="true">
          <Icon name={badge.verified ? 'check' : running ? 'bot' : badge.tone === 'bad' || badge.tone === 'warn' ? 'alert' : walk ? 'walk' : 'gamepad'} size={16} />
        </span>
        <div className="verified__text">
          <strong data-testid="verified-title">{badge.text}</strong>
          <p className="verified__sentence" data-testid="verified-sentence" aria-live="polite">
            {running ? (pt.progress?.note ?? 'Working…') : pt.status === 'idle' ? 'A bot plays your game (or walks through your building) and shows the proof.' : pt.sentence}
          </p>
        </div>
      </div>
      {running && (
        <div className="verified__bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((pt.progress?.fraction ?? 0) * 100)}>
          <span style={{ width: `${Math.round((pt.progress?.fraction ?? 0) * 100)}%` }} />
        </div>
      )}
      <div className="panel-toolbar">
        <button type="button" className="btn btn--primary btn--sm" disabled={running || playing || busy} onClick={() => void studio.playtest.run({ repair: true })} data-testid="playtest-run">
          <Icon name="bot" /> {running ? 'Playing…' : pt.status === 'idle' || stale ? (walk ? 'Walk it' : 'Play it') : 'Play it again'}
        </button>
        {running && (
          <button type="button" className="btn btn--sm" onClick={() => studio.playtest.cancel()}>
            Stop
          </button>
        )}
        {!running && pt.replay && badge.verified && (
          <button type="button" className="btn btn--sm" onClick={() => (replay ? studio.playtest.toggleReplay() : void studio.playtest.startReplay())} data-testid="playtest-replay">
            <Icon name={replay?.playing ? 'pause' : 'play'} /> {replay ? (replay.playing ? 'Pause' : 'Play') : 'Watch the run'}
          </button>
        )}
        {!running && pt.repairs.length > 0 && !stale && (
          <button type="button" className="btn btn--sm" onClick={() => studio.undo()} data-tip="Undo the latest fix (each fix is one undo step)" data-testid="playtest-undo-fix">
            <Icon name="undo" /> Undo fix
          </button>
        )}
        {pt.ms > 0 && !running && !stale && (
          <span className="panel-toolbar__count" data-testid="playtest-meta">
            {pt.seconds.toFixed(pt.seconds >= 10 ? 0 : 1)} s of play in {pt.ms >= 1000 ? `${(pt.ms / 1000).toFixed(1)} s` : `${pt.ms} ms`}
            {pt.worker ? ' · background worker' : ''}
          </span>
        )}
      </div>

      {pt.repairs.length > 0 && !running && (
        <ul className="verified__repairs" data-testid="playtest-repairs">
          {pt.repairs.map((r, i) => (
            <li key={i}>
              <Icon name="wand" size={13} /> {r}
            </li>
          ))}
        </ul>
      )}

      {problems.length > 0 && !running && !stale && (
        <ul className="verified__findings" data-testid="playtest-findings">
          {problems.map((f, i) => (
            <li key={i} className={`is-${f.severity}`}>
              <span className={`sev-badge sev-badge--${f.severity}`}>{f.severity}</span>
              <span className="verified__finding">{f.message}</span>
              {f.position && (
                <button type="button" className="btn btn--sm" onClick={() => show(f.position)} aria-label="Show where in the world">
                  <Icon name="target" /> Show
                </button>
              )}
              {f.severity === 'error' && (
                <button type="button" className="btn btn--sm" disabled={busy || playing} onClick={() => studio.fixWithAI(`The playtest bot found: ${f.message}`)}>
                  <Icon name="wand" /> Fix with AI
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {objectives.length > 0 && !running && !stale && (
        <details className="verified__objectives" open={objectives.length <= 8}>
          <summary>
            {walk ? 'Rooms' : 'Goals'} <span className="muted">{doneCount}/{objectives.length} reached</span>
          </summary>
          <ul className="test-list">
            {objectives.map((o) => (
              <li key={o.id} className={o.status === 'done' ? 'is-pass' : o.required ? 'is-fail' : 'is-pending'}>
                <Icon name={o.status === 'done' ? 'check' : 'x'} />
                <span className="test-list__id">{o.label}</span>
                <span className="test-list__msg">{o.reason && o.status !== 'done' ? o.reason : objectiveStatusText(o.status, o.at)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {replay && (
        <p className="verified__replay muted" aria-live="off">
          Ghost replay: {clock(replay.time)} of {clock(replay.length)}
        </p>
      )}
    </section>
  );
});
