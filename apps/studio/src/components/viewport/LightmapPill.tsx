import { memo, type ReactElement } from 'react';
import { useStudio, useUI } from '../../app/context';
import { Icon } from '../Icon';

/**
 * The baked-light status: shown while the renderer path-traces the building's lightmap (a worker, seconds to a minute), with
 * a way to stop it. The building keeps its probe light the whole time, so nothing waits on it.
 */
export const LightmapPill = memo(function LightmapPill(): ReactElement | null {
  const studio = useStudio();
  const lm = useUI((s) => s.lightmap);
  if (!lm || (lm.state !== 'baking' && lm.state !== 'waiting')) return null;
  const pct = Math.round(lm.progress * 100);
  const text = lm.state === 'waiting' ? 'Baking light…' : `Baking light ${pct}%`;
  return (
    <span className="vp-btn vp-btn--label lightmap-pill is-warn" role="status" aria-live="polite" data-testid="lightmap-pill" data-state={lm.state} data-tip={`${lm.message || 'Baking the interior light'} (${lm.quality}, ${lm.samples} rays per texel). The room keeps its probe light meanwhile.`} data-tip-align="end">
      <span className="vp-btn__status" aria-hidden="true" />
      <span>{text}</span>
      <button type="button" className="icon-btn icon-btn--sm" aria-label="Cancel the light bake" data-tip="Cancel the light bake" onClick={() => studio.cancelLightBake()} data-testid="lightmap-cancel">
        <Icon name="x" />
      </button>
    </span>
  );
});
