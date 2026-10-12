import { memo, useEffect, useRef, type ReactElement } from 'react';
import { useStudio, useUI } from '../../app/context';
import { Icon } from '../Icon';
import { PerfHud } from './PerfHud';
import { PlayHud } from './PlayHud';
import { VerifyPill } from './VerifyPill';

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
  }, [studio]);

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
      {mode === 'edit' && !loading && !fatal && (
        <div className="viewport__hint" aria-hidden="true">
          Drag to orbit · scroll to zoom · click to select · <kbd>F</kbd> focus
        </div>
      )}
      {loading && !fatal && (
        <div className="viewport__loading" role="status">
          <span className="spinner spinner--lg" aria-hidden="true" />
          <span>{loading}</span>
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
