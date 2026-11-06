/**
 * The procedural shape a generator asset stands for, as the scene mounts it (sync/scene-sync.ts `buildAsset`): the cook's
 * view of `asset` shapes. Null for any other asset, or before the catalog is loaded.
 */
import type { AssetShape, ProceduralShape } from '@aether/core';
import { assetInfo, effectiveAssetId } from '@aether/assets';

export function assetGeneratorShape(shape: AssetShape): ProceduralShape | null {
  const info = assetInfo(effectiveAssetId(shape));
  const g = info?.kind === 'generator' ? info.entry?.generator : undefined;
  return g ? { kind: 'procedural', generator: g.id, params: { ...g.params } } : null;
}
