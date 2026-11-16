/**
 * The publish dialog's Presentation section: the kind and start mode the world is published with (the AI's suggestion
 * from the content, changeable here), its short film (written by the AI director, else by film grammar) and the
 * pre-publish shot review (the frames a visitor meets, judged and fixed; what is left is listed). State and work live in
 * `studio.presentation` (engine/presentation.ts). Kept apart from targets.tsx.
 */
import { memo, useEffect, type ReactElement } from 'react';
import { useStore } from 'zustand';
import type { WorldDoc } from '@aether/core';
import { defaultPresentation, type PresentKind, type PresentStart } from '@aether/agent';
import { useStudio, useWorld } from '../../app/context';
import { Icon, type IconName } from '../../components/Icon';
import '../../styles/present.css';

/** The ways a published world can open, in the order shown (`world.profile`). */
const KINDS: ReadonlyArray<{ id: PresentKind; label: string; line: string; icon: IconName }> = [
  { id: 'walkthrough', label: 'Walk through', line: 'Rooms at eye level', icon: 'walk' },
  { id: 'game', label: 'Play', line: 'With a title screen', icon: 'gamepad' },
  { id: 'showcase', label: 'Showcase', line: 'Fly in, then orbit', icon: 'rotate' },
  { id: 'city', label: 'City tour', line: 'Street, then a drone', icon: 'grid' },
  { id: 'story', label: 'Short film', line: 'A film, then explore', icon: 'film' },
  { id: 'vr', label: 'VR', line: 'On a headset', icon: 'eye' },
];
const STARTS: ReadonlyArray<[PresentStart, string]> = [
  ['play', 'Play'],
  ['walkthrough', 'Walkthrough'],
  ['orbit', 'Orbit camera'],
  ['story', 'Short film (P plays, Tab explores)'],
];

/** The start that goes with a kind picked on its card: the rule's when it picked the same kind (a city with a goal starts in play), else the kind's own. */
function startFor(kind: PresentKind, world: WorldDoc): PresentStart {
  const rule = defaultPresentation(world);
  if (rule.profile === kind) return rule.startMode;
  if (kind === 'game') return 'play';
  if (kind === 'story') return 'story';
  if (kind === 'showcase') return world.story ? 'story' : 'orbit';
  if (kind === 'city') return 'orbit';
  return 'walkthrough';
}

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
  // The card marked Suggested: the AI's or the rule's pick.
  const suggested = st.suggestion?.profile ?? defaultPresentation(world).profile;
  return (
    <section className="pub-sec present" aria-label="How it opens" data-testid="present-section">
      <header className="pub-sec__head">
        <h3 className="pub-sec__title">How it opens</h3>
        {busy && (
          <button type="button" className="btn btn--sm" onClick={() => studio.presentation.cancel()} data-testid="present-cancel">
            Stop
          </button>
        )}
      </header>
      <div className="present-kinds" role="radiogroup" aria-label="How it opens" data-testid="present-kind">
        {KINDS.map((k) => (
          <button key={k.id} type="button" role="radio" aria-checked={cur.profile === k.id} className={`present-kind${cur.profile === k.id ? ' is-active' : ''}`} disabled={st.busy === 'suggest'} onClick={() => studio.presentation.choose(k.id, startFor(k.id, world))} data-testid={`present-kind-${k.id}`}>
            <span className="present-kind__icon">
              <Icon name={k.icon} size={18} />
            </span>
            <span className="present-kind__label">
              {k.label}
              {suggested === k.id && <span className="present-kind__tag">Suggested</span>}
            </span>
            <span className="present-kind__line">{k.line}</span>
          </button>
        ))}
      </div>
      {!st.suggestion && cur.stored && (
        <p className="pub-muted" data-testid="present-reason">
          Chosen for this world when it was built. Pick another to change it.
        </p>
      )}
      {st.suggestion && (
        <p className="pub-muted" data-testid="present-reason">
          {st.suggestion.source === 'ai' ? 'Suggested by the AI: ' : st.suggestion.source === 'user' ? 'Your choice. The suggestion was: ' : 'Suggested from the content: '}
          {st.suggestion.reason}
        </p>
      )}
      <details className="present-options">
        <summary>Start view, short film and quality check</summary>
        <div className="pub-grid">
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
        <div className="pub-row">
          <button type="button" className="btn btn--sm" disabled={busy} onClick={() => void studio.presentation.suggest(true)} data-testid="present-suggest">
            <Icon name="sparkles" /> Suggest again
          </button>
          <button type="button" className="btn btn--sm" disabled={busy} onClick={() => void studio.presentation.writeStory()} data-testid="present-story">
            <Icon name="film" /> {world.story ? 'Rewrite the film' : 'Write a short film'}
          </button>
          <button type="button" className="btn btn--sm" disabled={busy} onClick={() => void studio.presentation.quality()} data-testid="present-review">
            <Icon name="eye" /> Quality check
          </button>
        </div>
      </details>
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
            <>
              {/* The problems first (at most six); the rest are suggestions, folded away. */}
              <ul className="present-left">
                {st.quality.remaining.filter((f) => f.severity !== 'info').slice(0, 6).map((f, i) => (
                  <li key={i} className={`present-finding is-${f.severity}`}>
                    <strong>{f.check}</strong>: {f.note}
                    {f.fix && f.fix.kind === 'route' ? ` (${f.fix.label})` : ''}
                  </li>
                ))}
              </ul>
              {st.quality.remaining.length > Math.min(6, st.quality.remaining.filter((f) => f.severity !== 'info').length) && (
                <details className="present-more">
                  <summary>{st.quality.remaining.length - Math.min(6, st.quality.remaining.filter((f) => f.severity !== 'info').length)} suggestions</summary>
                  <ul className="present-left">
                    {[...st.quality.remaining.filter((f) => f.severity !== 'info').slice(6), ...st.quality.remaining.filter((f) => f.severity === 'info')].slice(0, 20).map((f, i) => (
                      <li key={i} className={`present-finding is-${f.severity}`}>
                        <strong>{f.check}</strong>: {f.note}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
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
