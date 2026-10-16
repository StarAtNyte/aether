import { getCatalog, libraryUrl } from '@aether/assets';
/** A resolver over the installed catalog. */
export function photoFinishResolver() {
    return (finish) => {
        const catalog = getCatalog();
        const entry = catalog?.entries.find((e) => e.kind === 'material' && e.material?.finish === finish);
        const m = entry?.material;
        if (!catalog || !m)
            return null;
        return { tile: m.tile, albedo: libraryUrl(m.maps.albedo, catalog), orm: libraryUrl(m.maps.orm, catalog), normal: libraryUrl(m.maps.normal, catalog) };
    };
}
