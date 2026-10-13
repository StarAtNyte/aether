import { useMemo, type CSSProperties } from 'react';
import { worldChroma, type WorldChroma } from '../lib/worldChroma';
import { useWorld } from './context';

/**
 * The interface palette of the current world plus the matching CSS custom
 * properties (`--w-glow`, `--w-sky`, `--w-deep`, `--w-ink`). Recomputed only
 * when a sky-relevant environment field changes, not on every edit.
 */
export function useWorldChroma(): { chroma: WorldChroma; style: CSSProperties } {
  const env = useWorld().environment;
  const { sky, timeOfDay, sunIntensity, ambientIntensity } = env;
  return useMemo(() => {
    const chroma = worldChroma({ sky, timeOfDay, sunIntensity, ambientIntensity });
    const style = {
      '--w-glow': chroma.glow,
      '--w-sky': chroma.sky,
      '--w-deep': chroma.deep,
      '--w-ink': chroma.ink,
    } as CSSProperties;
    return { chroma, style };
  }, [sky, timeOfDay, sunIntensity, ambientIntensity]);
}
