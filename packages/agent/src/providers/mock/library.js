import { parseCount, singular } from './lexicon';
import { r2 } from './builder';
const MAX_HITS = 4;
const MAX_COUNT = 12;
function words(text) {
    return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).map(singular);
}
/** Library items named in `text` (whole words, plural-insensitive, longest keyword wins, order of appearance). */
export function findLibraryItems(text, library) {
    if (library.length === 0)
        return [];
    const w = words(text);
    const joined = ` ${w.join(' ')} `;
    const hits = [];
    for (const item of library) {
        let best = null;
        for (const k of item.keywords) {
            const kw = words(k).join(' ');
            if (!kw)
                continue;
            const at = joined.indexOf(` ${kw} `);
            if (at >= 0 && (!best || kw.length > best.kw.length))
                best = { at, kw, original: k.toLowerCase() };
        }
        if (!best)
            continue;
        const before = joined.slice(0, best.at).trim().split(' ').pop();
        const n = parseCount(before);
        hits.push({ item, keyword: best.original, count: Math.max(1, Math.min(MAX_COUNT, n ?? 1)), at: best.at, len: best.kw.length });
    }
    // Drop hits whose keyword sits inside a longer hit ("tank" inside "toy tank").
    const kept = hits.filter((h) => !hits.some((o) => o !== h && o.len > h.len && h.at >= o.at && h.at + h.len <= o.at + o.len));
    kept.sort((a, b) => a.at - b.at);
    return kept.slice(0, MAX_HITS).map(({ item, keyword, count }) => ({ item, keyword, count }));
}
/** Footprint radius (metres) of a library item. */
export function libraryRadius(item) {
    return r2(Math.max(0.4, Math.hypot(item.size[0], item.size[2]) / 2));
}
/** An {@link Asset} that places one instance of a library generator. */
export function libraryAsset(item) {
    const label = item.keywords[0] ?? item.id;
    return {
        label,
        radius: libraryRadius(item),
        make: (b, x, z, color) => b.gen(item.id, item.id, color ? { color } : {}, [x, 0, z], { yaw: r2(b.rand(-25, 25)), physics: 'static', tags: ['library'] }),
    };
}
