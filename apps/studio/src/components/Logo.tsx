import { memo, type ReactElement } from 'react';

/**
 * The Aether logomark: a peak over a horizon line inside a rounded square —
 * "a world" reduced to two strokes. Pure vector, `currentColor` tile with
 * the surface color knocked out, crisp at 16–32 px. Decorative unless a
 * `label` is given.
 */
export const Logomark = memo(function Logomark({ size = 20, label }: { size?: number; label?: string }): ReactElement {
  return (
    <svg className="logomark" width={size} height={size} viewBox="0 0 20 20" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} focusable="false">
      <rect width="20" height="20" rx="5.5" fill="currentColor" />
      <path d="M5 13.25 10 5.75l5 7.5" fill="none" stroke="var(--logo-knockout, #fff)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.75 15.25h10.5" fill="none" stroke="var(--logo-knockout, #fff)" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
});

/** Logomark + wordmark. */
export const Wordmark = memo(function Wordmark({ size = 20 }: { size?: number }): ReactElement {
  return (
    <span className="wordmark">
      <Logomark size={size} />
      <span className="wordmark__text">Aether</span>
    </span>
  );
});
