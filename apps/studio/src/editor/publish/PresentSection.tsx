/**
 * The publish dialog's Presentation section: the kind and start mode the world is published with (the AI's suggestion
 * from the content, changeable here), its short film (written by the AI director, else by film grammar) and the
 * pre-publish shot review (the frames a visitor meets, judged and fixed; what is left is listed). State and work live in
 * `studio.presentation` (engine/presentation.ts). Kept apart from targets.tsx.
 */
import { memo, useEffect, type ReactElement } from 'react';
import { useStore } from 'zustand';
import type { PresentKind, PresentStart } from '@aether/agent';
import { useStudio, useWorld } from '../../app/context';
import { Icon } from '../../components/Icon';
import '../../styles/present.css';

const KINDS: ReadonlyArray<[PresentKind, string]> = [
  ['game', 'Game'],
  ['walkthrough', 'Walkthrough'],
  ['showcase', 'Showcase'],
  ['city', 'City'],
  ['story', 'Story'],
  ['vr', 'VR'],
];
const STARTS: ReadonlyArray<[PresentStart, string]> = [
  ['play', 'Play'],
  ['walkthrough', 'Walkthrough'],
  ['orbit', 'Orbit camera'],
  ['story', 'Short film (P plays, Tab explores)'],
];

export const PresentSection = memo(function PresentSection(): ReactElement {
  const studio = useStudio();
  const world = useWorld();
  const st = useStore(studio.presentation.state);
  const cur = studio.presentation.current();
  // A world with no stored presentation is suggested one when the dialog opens.
  useEffect(() => {
    if (!cur.stored && !st.busy && !st.suggestion) void studio.presentation.suggest();
  }, [cur.stored, st.busy, st.suggestion, studio]);
  // Publishing runs the world-quality pass on the world as it is (once per version).
  useEffect(() => {
    if (cur.stored && !st.busy && !studio.presentation.qualityCurrent()) void studio.presentation.quality();
  }, [cur.stored, st.busy, world, studio]);
  const busy = st.busy !== null;
  const review = st.review;
  return (
    <section className="pub-sec present" aria-label="Presentation" data-testid="present-section">
      <header className="pub-sec__head">
        <h3 className="pub-sec__title">Presentation</h3>
        {busy && (
          <button type="button" className="btn btn--sm" onClick={() => studio.presentation.cancel()} data-testid="present-cancel">
            Stop
          </button>
        )}
      </header>
      <div className="pub-grid">
        <label className="pub-field">
          <span className="pub-field__label">Kind</span>
          <select className="select" value={cur.profile} disabled={busy} onChange={(e) => studio.presentation.choose(e.target.value as PresentKind, cur.startMode)} data-testid="present-kind">
            {KINDS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="pub-field">
          <span className="pub-field__label">Starts in</span>
          <select className="select" value={cur.startMode} disabled={busy} onChange={(e) => studio.presentation.choose(cur.profile, e.target.value as PresentStart)} data-testid="present-start">
            {STARTS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!st.suggestion && cur.stored && (
        <p className="pub-muted" data-testid="present-reason">
          Chosen for this world when it was built. Change it here, or ask for a fresh suggestion.
        </p>
      )}
      {st.suggestion && (
        <p className="pub-muted" data-testid="present-reason">
          {st.suggestion.source === 'ai' ? 'Suggested by the AI: ' : st.suggestion.source === 'user' ? 'Your choice. The suggestion was: ' : 'Suggested from the content: '}
          {st.suggestion.reason}
        </p>
      )}
      <div className="pub-row">
        <button type="button" className="btn btn--sm" disabled={busy} onClick={() => void studio.presentation.suggest(true)} data-testid="present-suggest">
          <Icon name="sparkles" /> Suggest again
        </button>
        <button type="button" className="btn btn--sm" disabled={busy} onClick={() => void studio.presentation.writeStory()} data-testid="present-story">
          <Icon name="film" /> {world.story ? 'Rewrite the film' : 'Write a short film'}
        </button>
        <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => void studio.presentation.quality()} data-testid="present-review">
          <Icon name="eye" /> Quality pass
        </button>
      </div>
      {st.status && (
        <p className="pub-muted" aria-live="polite" data-testid="present-status">
          {st.status}
        </p>
      )}
      {st.error && (
        <p className="pub-job__error" role="alert">
          <Icon name="alert" /> {st.error}
        </p>
      )}
      {st.story && (
        <p className="pub-muted" data-testid="present-story-result">
          Film: {st.story.shots} shots, {st.story.seconds} s, written {st.story.source === 'ai' ? 'by the AI director' : 'by film grammar (no AI connected)'}.
          {st.story.fixed.length > 0 ? ` Repaired: ${st.story.fixed.join('; ')}.` : ''}
          {st.story.remaining.length > 0 ? ` Left: ${st.story.remaining.join('; ')}.` : ''}
        </p>
      )}
      {st.quality && (
        <div className="present-quality" data-testid="present-quality">
          <p className="pub-field__label">World quality {studio.presentation.qualityCurrent() ? '' : '(the world changed since)'}</p>
          {st.quality.fixed.length > 0 && (
            <p className="present-fixed">
              <Icon name="check" /> Fixed: {st.quality.fixed.join('; ')}
            </p>
          )}
          {(st.quality.review?.undone.length ?? 0) > 0 && <p className="pub-muted">Tried and undone (not better when judged again): {st.quality.review?.undone.join('; ')}</p>}
          {st.quality.remaining.length === 0 ? (
            <p className="pub-muted">Every check passes.</p>
          ) : (
            <ul className="present-left">
              {st.quality.remaining.slice(0, 12).map((f, i) => (
                <li key={i} className={`present-finding is-${f.severity}`}>
                  <strong>{f.check}</strong>: {f.note}
                  {f.fix && f.fix.kind === 'route' ? ` (${f.fix.label})` : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {review && (
        <div className="present-review" data-testid="present-review-result">
          <p className="pub-muted">
            {review.summary || 'Reviewed.'} {review.judgedBy === 'model' ? `Judged by the AI (${review.calls} calls, ${review.rounds} rounds).` : 'Judged from measurements (no AI connected).'}
          </p>
          {review.fixed.length > 0 && (
            <p className="present-fixed" data-testid="present-fixed">
              <Icon name="check" /> Fixed: {review.fixed.join('; ')}
            </p>
          )}
          <div className="present-frames">
            {review.frames.map((f) => (
              <figure key={f.name} className={`present-frame${f.issues.length > 0 && f.fixed.length === 0 ? ' is-bad' : ''}`} data-testid={`present-frame-${f.name}`}>
                {f.image ? <img src={f.image} alt={f.label} /> : <div className="present-frame__none">No render</div>}
                <figcaption>
                  <strong>{f.name}</strong>
                  {f.fixed.length > 0 && <span className="present-frame__fixed"> fixed</span>}
                  {f.issues.length === 0 ? <span> ok</span> : f.issues.slice(0, 2).map((x, i) => <span key={i}> · {x.check}: {x.note}</span>)}
                </figcaption>
              </figure>
            ))}
          </div>
          {review.remaining.length > 0 && (
            <div className="present-left" data-testid="present-remaining">
              <p className="pub-field__label">For you to look at</p>
              <ul>
                {review.remaining.slice(0, 8).map((x, i) => (
                  <li key={i}>
                    {x.frame}: {x.check}, {x.note}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
});
