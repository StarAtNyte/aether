import { memo, type ReactElement } from 'react';

/**
 * The Aether mark: a small luminous sphere lit in the current world's
 * colors (see `worldChroma`), with an orbiting ring that spins up while the
 * agent is building. Pure CSS — decorative, hidden from assistive tech.
 */
export const Orb = memo(function Orb({ size = 28, className = '' }: { size?: number; className?: string }): ReactElement {
  return (
    <span className={`orb ${className}`.trim()} style={{ ['--orb' as string]: `${size}px` }} aria-hidden="true">
      <span className="orb__halo" />
      <span className="orb__core" />
      <span className="orb__ring" />
    </span>
  );
});
