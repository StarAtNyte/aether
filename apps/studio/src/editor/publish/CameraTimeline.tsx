/**
 * Keyframe timeline of the video shot, docked along the bottom of the
 * viewport while the Publish hub shows Video: play / pause the shot in the
 * viewport, scrub, add a keyframe from the current view, drag keyframes in
 * time, and edit the selected key (easing, field of view, set to view,
 * delete). The camera path itself is drawn in 3D by the renderer.
 */
import { memo, useRef, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react';
import { useStore } from 'zustand';
import { useStudio } from '../../app/context';
import { Icon } from '../../components/Icon';
import type { Easing } from '../../publish/cameraPath';

const EASES: ReadonlyArray<[Easing, string]> = [
  ['linear', 'Smooth'],
  ['ease', 'Ease in-out'],
  ['easeIn', 'Ease in'],
  ['easeOut', 'Ease out'],
  ['cut', 'Cut (hold)'],
];

/** The timeline. */
export const CameraTimeline = memo(function CameraTimeline(): ReactElement {
  const studio = useStudio();
  const pub = studio.publish;
  const path = useStore(pub.state, (s) => s.path);
  const playhead = useStore(pub.state, (s) => s.playhead);
  const previewing = useStore(pub.state, (s) => s.previewing);
  const selected = useStore(pub.state, (s) => s.selected);
  const busy = useStore(pub.state, (s) => s.job?.running === true);
  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ kind: 'key' | 'head'; index: number; id: number; moved: boolean } | null>(null);
  const d = path.duration;
  const timeAt = (clientX: number): number => {
    const r = trackRef.current?.getBoundingClientRect();
    if (!r || r.width <= 0) return 0;
    return Math.min(d, Math.max(0, ((clientX - r.left) / r.width) * d));
  };
  const onTrackDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { kind: 'head', index: -1, id: e.pointerId, moved: false };
    pub.scrub(timeAt(e.clientX));
  };
  const onKeyDown = (e: ReactPointerEvent<HTMLButtonElement>, i: number): void => {
    if (e.button !== 0) return;
    e.stopPropagation();
    trackRef.current?.setPointerCapture(e.pointerId);
    drag.current = { kind: 'key', index: i, id: e.pointerId, moved: false };
    pub.selectKey(i);
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const g = drag.current;
    if (!g || g.id !== e.pointerId) return;
    g.moved = true;
    if (g.kind === 'head') pub.scrub(timeAt(e.clientX));
    else {
      const t = Math.round(timeAt(e.clientX) * 20) / 20;
      pub.retime(g.index, t);
      const sel = pub.state.getState().selected;
      if (sel !== null) g.index = sel;
    }
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (drag.current?.id === e.pointerId) drag.current = null;
  };
  const ticks: number[] = [];
  const step = d > 60 ? 10 : d > 20 ? 5 : d > 8 ? 2 : 1;
  for (let t = 0; t <= d + 1e-6; t += step) ticks.push(t);
  const key = selected !== null ? path.keys[selected] : undefined;
  return (
    <div className="tl" role="group" aria-label="Camera timeline" data-testid="camera-timeline">
      <div className="tl__bar">
        <button type="button" className="icon-btn" onClick={() => pub.togglePreview()} disabled={path.keys.length < 2 || busy} aria-label={previewing ? 'Pause preview' : 'Play preview'} data-tip={previewing ? 'Pause' : 'Play the shot in the viewport'} data-testid="timeline-play">
          <Icon name={previewing ? 'pause' : 'play'} />
        </button>
        <span className="tl__time">
          {playhead.toFixed(1)} <span className="tl__time-total">/ {d.toFixed(1)} s</span>
        </span>
        <button type="button" className="btn btn--sm" onClick={() => pub.addKeyFromView()} disabled={busy} data-tip="Add a keyframe at the playhead from the current view" data-testid="timeline-add-key">
          <Icon name="diamond" size={14} /> Add keyframe
        </button>
        <label className="tl__dur">
          <span>Length</span>
          <input className="input input--sm" type="number" min={0.5} max={300} step={0.5} value={Math.round(d * 10) / 10} onChange={(e) => pub.setDuration(Number(e.target.value))} aria-label="Shot length in seconds" />
        </label>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => pub.resetPath()} disabled={busy} data-tip="Start over from the current view">
          <Icon name="refresh" /> Reset
        </button>
      </div>
      <div className="tl__track" ref={trackRef} onPointerDown={onTrackDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        {ticks.map((t) => (
          <span key={t} className="tl__tick" style={{ left: `${(t / d) * 100}%` }}>
            <span className="tl__tick-label">{t}s</span>
          </span>
        ))}
        {path.keys.map((k, i) => (
          <button
            key={`${i}-${k.t}`}
            type="button"
            className={`tl__key${selected === i ? ' is-selected' : ''}${k.ease === 'cut' ? ' is-cut' : ''}`}
            style={{ left: `${(k.t / d) * 100}%` }}
            onPointerDown={(e) => onKeyDown(e, i)}
            aria-label={`Keyframe ${i + 1} at ${k.t.toFixed(1)} seconds`}
            aria-pressed={selected === i}
          />
        ))}
        <span className="tl__head" style={{ left: `${(playhead / d) * 100}%` }} aria-hidden="true" />
      </div>
      {key && selected !== null && (
        <div className="tl__key-edit">
          <span className="tl__key-name">
            Key {selected + 1} · {key.t.toFixed(2)} s
          </span>
          <select className="select select--sm" value={key.ease} onChange={(e) => pub.setKeyEase(selected, e.target.value as Easing)} aria-label="Easing to the next key">
            {EASES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <label className="tl__fov">
            <span>Lens</span>
            <input className="slider" type="range" min={12} max={100} step={1} value={key.fov} onChange={(e) => pub.setKeyFov(selected, Number(e.target.value))} aria-label="Field of view" />
            <span className="tl__fov-value">{Math.round(key.fov)}°</span>
          </label>
          <button type="button" className="btn btn--sm" onClick={() => pub.updateKeyFromView(selected)} data-tip="Move this keyframe to the current view">
            <Icon name="camera" /> Set to view
          </button>
          <button type="button" className="icon-btn icon-btn--sm" onClick={() => pub.deleteKey(selected)} disabled={path.keys.length <= 1} aria-label="Delete keyframe" data-tip="Delete keyframe">
            <Icon name="trash" />
          </button>
        </div>
      )}
    </div>
  );
});
