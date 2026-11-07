/**
 * The Publish hub: one panel for every way out of the editor — a playable
 * game (download, your own hosting, your local network), a video along a
 * cinematic camera path, a still render up to 4K, a 3D model, a floor plan
 * and a share link — each with presets, a preview, progress with Cancel,
 * and the publish history. Non-modal: the viewport stays live beside it
 * (camera keys are taken from the current view). State lives in
 * `studio.publish` (engine/publish.ts).
 */
import { memo, useEffect, useRef, type ReactElement } from 'react';
import { useStore } from 'zustand';
import { useStudio } from '../../app/context';
import { Icon, type IconName } from '../../components/Icon';
import type { PublishTarget } from '../../engine/publish';
import { PresentSection } from './PresentSection';
import { GameTarget, HistoryTarget, ModelTarget, PlanTarget, RenderTarget, ShareTarget, VideoTarget } from './targets';
import '../../styles/publish.css';

const TARGETS: ReadonlyArray<{ id: Exclude<PublishTarget, 'history'>; icon: IconName; label: string; hint: string }> = [
  { id: 'game', icon: 'gamepad', label: 'Game', hint: 'Web build' },
  { id: 'video', icon: 'film', label: 'Video', hint: 'Camera path' },
  { id: 'render', icon: 'image', label: 'Render', hint: 'Up to 4K' },
  { id: 'model', icon: 'box3d', label: '3D model', hint: 'glTF / GLB' },
  { id: 'plan', icon: 'plan', label: 'Floor plan', hint: 'SVG / PDF' },
  { id: 'share', icon: 'link', label: 'Share link', hint: 'No upload' },
];

/** Live preview of a running video export (the composited canvas). */
const LiveCanvas = memo(function LiveCanvas({ canvas }: { canvas: HTMLCanvasElement }): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    canvas.classList.add('pub-live__canvas');
    host.appendChild(canvas);
    return () => {
      if (canvas.parentElement === host) host.removeChild(canvas);
    };
  }, [canvas]);
  return <div className="pub-live" ref={ref} aria-label="Video being rendered" />;
});

/** Progress, cancel and the finished result. */
const JobFooter = memo(function JobFooter(): ReactElement | null {
  const studio = useStudio();
  const job = useStore(studio.publish.state, (s) => s.job);
  const result = useStore(studio.publish.state, (s) => s.result);
  const canvas = useStore(studio.publish.state, (s) => s.previewCanvas);
  if (!job && !result) return null;
  const pct = job?.progress === null || job?.progress === undefined ? null : Math.round(job.progress * 100);
  return (
    <div className="pub-job" aria-live="polite" data-testid="publish-job">
      {job?.running && (
        <>
          {canvas && <LiveCanvas canvas={canvas} />}
          <div className="pub-job__row">
            <span className="pub-job__label">{job.label}</span>
            {pct !== null && <span className="pub-job__pct">{pct}%</span>}
            <button type="button" className="btn btn--sm" onClick={() => studio.publish.cancel()} data-testid="publish-cancel">
              Cancel
            </button>
          </div>
          <div className={`progress${pct === null ? ' is-indeterminate' : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}>
            <div className="progress__fill" style={{ width: `${pct ?? 30}%` }} />
          </div>
        </>
      )}
      {!job?.running && job?.error && (
        <p className="pub-job__error" role="alert">
          <Icon name="alert" /> {job.error}
        </p>
      )}
      {!job?.running && result && (
        <div className="pub-result" data-testid="publish-result">
          {result.url && result.kind === 'render' && <img className="pub-result__media" src={result.url} alt="Rendered image" />}
          {result.url && result.kind === 'video' && <video className="pub-result__media" src={result.url} controls playsInline loop muted={false} data-testid="publish-video" />}
          {result.url && result.kind === 'plan' && result.mime === 'image/svg+xml' && <img className="pub-result__media pub-result__media--plan" src={result.url} alt="Floor plan" />}
          <div className="pub-result__info">
            <span className="pub-result__title">
              <Icon name="check" /> {result.fileName ?? 'Published'}
            </span>
            <span className="pub-result__detail">{result.detail}</span>
          </div>
          <div className="pub-result__actions">
            {result.url && result.fileName && (
              <a className="btn btn--primary btn--sm" href={result.url} download={result.fileName} data-testid="publish-download">
                <Icon name="download" /> Download
              </a>
            )}
            {result.link && (
              <>
                <a className="btn btn--sm" href={result.link} target="_blank" rel="noopener noreferrer">
                  <Icon name="external" /> Open
                </a>
                <button type="button" className="btn btn--sm" onClick={() => void studio.publish.copy(result.link ?? null, 'Link')}>
                  <Icon name="copy" /> Copy link
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

/** The hub panel. */
export const PublishHub = memo(function PublishHub(): ReactElement {
  const studio = useStudio();
  const target = useStore(studio.publish.state, (s) => s.target);
  const running = useStore(studio.publish.state, (s) => s.job?.running === true);
  const historyCount = useStore(studio.publish.state, (s) => s.history.length);
  const close = (): void => {
    studio.publish.close();
    studio.publish.restoreCamera();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !running && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <aside className="pub" aria-label="Publish" data-testid="publish-hub">
      <header className="pub__head">
        <div className="pub__titles">
          <h2 className="pub__title">
            <Icon name="rocket" size={20} /> Publish
          </h2>
          <p className="pub__sub">Share what you made — as a game, a film, a picture or a link.</p>
        </div>
        <button type="button" className={`btn btn--ghost btn--sm${target === 'history' ? ' is-active' : ''}`} onClick={() => studio.publish.setTarget('history')} aria-pressed={target === 'history'} data-tip="Everything published from this project">
          <Icon name="history" /> History{historyCount > 0 ? ` · ${historyCount}` : ''}
        </button>
        <button type="button" className="icon-btn" onClick={close} aria-label="Close publish" data-tip="Close" data-kbd="Esc">
          <Icon name="x" />
        </button>
      </header>
      <nav className="pub__targets" aria-label="What to publish">
        {TARGETS.map((t) => (
          <button key={t.id} type="button" className={`pub-target${target === t.id ? ' is-active' : ''}`} onClick={() => studio.publish.setTarget(t.id)} aria-pressed={target === t.id} data-testid={`publish-target-${t.id}`}>
            <span className="pub-target__icon">
              <Icon name={t.icon} size={20} />
            </span>
            <span className="pub-target__label">{t.label}</span>
            <span className="pub-target__hint">{t.hint}</span>
          </button>
        ))}
      </nav>
      <div className="pub__body">
        {(target === 'game' || target === 'share') && <PresentSection />}
        {target === 'game' && <GameTarget />}
        {target === 'video' && <VideoTarget />}
        {target === 'render' && <RenderTarget />}
        {target === 'model' && <ModelTarget />}
        {target === 'plan' && <PlanTarget />}
        {target === 'share' && <ShareTarget />}
        {target === 'history' && <HistoryTarget />}
      </div>
      <JobFooter />
    </aside>
  );
});
