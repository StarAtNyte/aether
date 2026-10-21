/**
 * Photographed finish maps from the asset library: catalog entries of kind
 * "material" name the finish they texture, their three maps and the tile
 * size. Resolved through the installed catalog (null before it loads).
 */
import type { MaterialFinish } from '@aether/core';
import { getCatalog, libraryUrl } from '@aether/assets';
import type { PhotoResolver } from './finish-textures';

/** A resolver over the installed catalog. */
export function photoFinishResolver(): PhotoResolver {
  return (finish: MaterialFinish) => {
    const catalog = getCatalog();
    const entry = catalog?.entries.find((e) => e.kind === 'material' && e.material?.finish === finish);
    const m = entry?.material;
    if (!catalog || !m) return null;
    return { tile: m.tile, ...(m.small ? { small: { albedo: libraryUrl(m.small.albedo, catalog), orm: libraryUrl(m.small.orm, catalog), normal: libraryUrl(m.small.normal, catalog) } } : {}), albedo: libraryUrl(m.maps.albedo, catalog), orm: libraryUrl(m.maps.orm, catalog), normal: libraryUrl(m.maps.normal, catalog) };
  };
}
