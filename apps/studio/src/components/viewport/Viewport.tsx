import { memo, useEffect, useRef, useState, type ReactElement } from 'react';
import { useStudio, useUI, useWorld } from '../../app/context';
import { useWorldChroma } from '../../app/useWorldChroma';
import { liveAgentLine } from '../../lib/agentLine';
import { formatHour } from '../../lib/worldChroma';
import { Icon } from '../Icon';
import { Orb } from '../Orb';
import { PerfHud } from './PerfHud';
import { PlayHud } from './PlayHud';
import { VerifyPill } from './VerifyPill';

const SKY_LABEL: Readonly<Record<string, string>> = {
  day: 'Daylight',
  dawn: 'Dawn',
  sunset: 'Golden hour',
  night: 'Night',
  overcast: 'Overcast',
  space: 'Deep space',
  studio: 'Studio',
};

/** Bottom-left caption plate: the world's sky, clock and size, in the world's own colors. */
const WorldCaption = memo(function WorldCaption(): ReactElement | null {
  const world = useWorld();
  const { chroma } = useWorldChroma();
  const mode = useUI((s) => s.mode);
  if (mode === 'play') return null;
  const entities = Object.keys(world.entities).length;
  const rules = world.rules.length;
  return (
    <div className="world-caption" aria-label="World summary">
      <span className="world-caption__swatch" aria-hidden="true" />
      <span className="world-caption__sky">{SKY_LABEL[chroma.preset] ?? chroma.preset}</span>
      {chroma.preset !== 'space' && chroma.preset !== 'studio' && <span className="world-caption__item">{formatHour(chroma.hour)}</span>}
      <span className="world-caption__item">
        {entities} {entities === 1 ? 'entity' : 'entities'}
      </span>
      {rules > 0 && (
        <span className="world-caption__item">
          {rules} {rules === 1 ? 'rule' : 'rules'}
        </span>
      )}
    </div>
  );
});

/**
 * While the agent works: an aurora ring weaves around the viewport with the
 * live progress line. When a turn completes, a light band sweeps across the
 * frame once ("the world materializes").
 */
const WeaveOverlay = memo(function WeaveOverlay(): ReactElement {
  const line = useUI(liveAgentLine);
  const busy = useUI((s) => s.agentBusy);
  const [reveal, setReveal] = useState(0);
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !busy) setReveal((n) => n + 1);
    wasBusy.current = busy;
  }, [busy]);
  return (
    <>
      {busy && (
        <div className="weave" role="status" aria-live="polite">
          <span className="weave__ring" aria-hidden="true" />
          <span className="weave__line">
            <span className="weave__dot" aria-hidden="true" />
            <span className="weave__text">{line}</span>
          </span>
        </div>
      )}
      {reveal > 0 && <span key={reveal} className="reveal" aria-hidden="true" />}
    </>
  );
});

/** Camera view switcher (play mode). */
const CameraToggle = memo(function CameraToggle(): ReactElement | null {
  const studio = useStudio();
  const view = useUI((s) => s.cameraView);
  const mode = useUI((s) => s.mode);
  if (mode !== 'play') return null;
  const views: Array<['orbit' | 'follow' | 'firstPerson', string]> = [
    ['follow', 'Follow'],
    ['firstPerson', 'First person'],
    ['orbit', 'Orbit'],
  ];
  return (
    <div className="segmented segmented--overlay" role="group" aria-label="Camera">
      <Icon name="camera" size={13} />
      {views.map(([v, label]) => (
        <button key={v} type="button" className={`seg-btn${view === v ? ' is-active' : ''}`} aria-pressed={view === v} onClick={() => studio.setCameraView(v)}>
          {label}
        </button>
      ))}
    </div>
  );
});

/**
 * Center viewport. The canvas is created imperatively per mount so a
 * renderer never shares a GPU context with a disposed one (StrictMode
 * double-mount safe). The render loop runs outside React.
 */
export const Viewport = memo(function Viewport(): ReactElement {
  const studio = useStudio();
  const hostRef = useRef<HTMLDivElement>(null);
  const loading = useUI((s) => s.loading);
  const fatal = useUI((s) => s.fatal);
  const mode = useUI((s) => s.mode);
  // A new epoch (context-loss recovery, backend switch) remounts the canvas: a lost context is never reused.
  const epoch = useUI((s) => s.rendererEpoch);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const canvas = document.createElement('canvas');
    canvas.className = 'viewport__canvas';
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', '3D viewport');
    host.appendChild(canvas);
    let teardown: (() => void) | null = null;
    let cancelled = false;
    void studio.attachCanvas(canvas).then((t) => {
      if (cancelled) t();
      else teardown = t;
    });
    return () => {
      cancelled = true;
      teardown?.();
      canvas.remove();
    };
  }, [studio, epoch]);

  return (
    <section className={`viewport${mode === 'play' ? ' is-playing' : ''}`} aria-label="Viewport">
      <div className="viewport__host" ref={hostRef} />
      <div className="viewport__overlay viewport__overlay--tl">
        <PerfHud />
      </div>
      <div className="viewport__overlay viewport__overlay--tr">
        <CameraToggle />
        <VerifyPill />
      </div>
      <PlayHud />
      <span className="viewport__corners" aria-hidden="true" />
      {!loading && !fatal && <WorldCaption />}
      <WeaveOverlay />
      {mode === 'edit' && !loading && !fatal && (
        <div className="viewport__hint" aria-hidden="true">
          Drag to orbit · scroll to zoom · click to select · <kbd>F</kbd> focus
        </div>
      )}
      {loading && !fatal && (
        <div className="viewport__loading" role="status">
          <Orb size={56} className="orb--loading" />
          <span className="viewport__loading-text">{loading}</span>
        </div>
      )}
      {fatal && (
        <div className="viewport__fatal" role="alert">
          <Icon name="alert" size={22} />
          <h3>3D is unavailable</h3>
          <p>{fatal}</p>
          <p className="muted">Try a recent Chrome, Edge, Firefox or Safari with hardware acceleration enabled.</p>
        </div>
      )}
    </section>
  );
});
