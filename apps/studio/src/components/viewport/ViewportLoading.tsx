/** Loading feedback shared by the editor chunk fallback and the live viewport: the poster, three steps and a bar. */
import type { ReactElement } from 'react';
import { LOAD_STEPS, loadProgress, useLoadPoster } from '../../lib/loadPoster';

export function ViewportLoading({ text, poster, leaving = false }: { text: string; poster?: string | null; leaving?: boolean }): ReactElement {
  const shared = useLoadPoster();
  const img = poster === undefined ? shared : poster;
  const { step, fraction } = loadProgress(text);
  return (
    <div className={`vp-loading${leaving ? ' is-leaving' : ''}`} role="status" aria-live="polite" data-step={step}>
      <span className="vp-loading__surface skeleton" aria-hidden="true" />
      {img ? <img className="vp-loading__poster" src={img} alt="" decoding="async" fetchPriority="high" /> : null}
      <span className="vp-loading__content">
        <span className="spinner" aria-hidden="true" />
        <span className="vp-loading__text">{text}</span>
        <span className="vp-loading__bar" aria-hidden="true">
          <span style={{ width: `${Math.round(fraction * 100)}%` }} />
        </span>
        <span className="vp-loading__steps" aria-label={`Step ${step} of ${LOAD_STEPS.length}: ${LOAD_STEPS[step - 1]}`}>
          {LOAD_STEPS.map((s, i) => (
            <span key={s} className={i + 1 < step ? 'is-done' : i + 1 === step ? 'is-now' : undefined}>
              {s}
            </span>
          ))}
        </span>
      </span>
    </div>
  );
}
