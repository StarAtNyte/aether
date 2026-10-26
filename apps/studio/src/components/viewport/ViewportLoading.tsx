/** Lightweight loading feedback shared by the editor chunk fallback and the live viewport. */
import type { ReactElement } from 'react';

export function ViewportLoading({ text }: { text: string }): ReactElement {
  return (
    <div className="vp-loading" role="status" aria-live="polite">
      <span className="vp-loading__surface skeleton" aria-hidden="true" />
      <span className="vp-loading__content">
        <span className="spinner" aria-hidden="true" />
        <span className="vp-loading__text">{text}</span>
      </span>
    </div>
  );
}
