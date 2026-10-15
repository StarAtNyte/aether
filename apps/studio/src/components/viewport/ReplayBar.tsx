import { memo, type ReactElement } from 'react';
import { useStudio, useUI } from '../../app/context';
import { clock, nextSpeed } from '../../lib/playtestView';
import { Icon } from '../Icon';

/**
 * Controls of the ghost replay of the bot's run: play / pause, speed and a
 * scrub bar with a tick for every pickup, door and the goal.
 */
export const ReplayBar = memo(function ReplayBar(): ReactElement | null {
  const studio = useStudio();
  const replay = useUI((s) => s.replay);
  const mode = useUI((s) => s.mode);
  if (!replay || mode === 'play') return null;
  const events = studio.playtest.lastReport?.trace?.events ?? [];
  const ticks = replay.length > 0 ? events.filter((e) => e.kind === 'pickup' || e.kind === 'goal' || e.kind === 'door' || e.kind === 'win' || e.kind === 'room') : [];
  const done = replay.length > 0 && replay.time >= replay.length - 1e-3;
  return (
    <div className="replay-bar" role="group" aria-label="Replay of the bot's run" data-testid="replay-bar">
      <button type="button" className="replay-bar__btn" onClick={() => studio.playtest.toggleReplay()} aria-label={replay.playing ? 'Pause the replay' : done ? 'Replay from the start' : 'Play the replay'} data-testid="replay-toggle">
        <Icon name={replay.playing ? 'pause' : done ? 'refresh' : 'play'} />
      </button>
      <div className="replay-bar__track">
        <input
          type="range"
          className="replay-bar__scrub"
          min={0}
          max={Math.max(0.01, replay.length)}
          step={0.05}
          value={replay.time}
          aria-label="Scrub the replay"
          aria-valuetext={`${clock(replay.time)} of ${clock(replay.length)}`}
          onChange={(e) => studio.playtest.seekReplay(Number(e.currentTarget.value))}
          data-testid="replay-scrub"
        />
        <div className="replay-bar__ticks" aria-hidden="true">
          {ticks.slice(0, 80).map((e, i) => (
            <span key={`${e.t}-${i}`} className={`replay-bar__tick is-${e.kind}`} style={{ left: `${(e.t / replay.length) * 100}%` }} title={e.label} />
          ))}
        </div>
      </div>
      <span className="replay-bar__time" data-testid="replay-time">
        {clock(replay.time)} / {clock(replay.length)}
      </span>
      <button type="button" className="replay-bar__speed" onClick={() => studio.playtest.setReplaySpeed(nextSpeed(replay.speed))} aria-label={`Replay speed ${replay.speed}×; click to change`} data-testid="replay-speed">
        {replay.speed}×
      </button>
      <button type="button" className="replay-bar__btn" onClick={() => studio.playtest.stopReplay()} aria-label="Close the replay" data-testid="replay-close">
        <Icon name="x" />
      </button>
    </div>
  );
});
