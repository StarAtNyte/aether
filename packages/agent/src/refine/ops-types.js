/** An empty successful outcome to build on. */
export function outcome(partial = {}) {
    return { ok: true, summary: '', targets: [], also: [], cosmetic: true, notes: [], added: [], ...partial };
}
/** A failed outcome that is the answer ("the bookshelf only comes in wood finishes"). */
export function refused(reason, partial = {}) {
    return outcome({ ok: false, failure: reason, final: true, ...partial });
}
/** A failed outcome. */
export function failed(reason, partial = {}) {
    return outcome({ ok: false, failure: reason, ...partial });
}
/** Question outcome for an ambiguous reference. */
export function ask(text, candidates) {
    const shown = candidates.slice(0, 8);
    const cap = text.charAt(0).toUpperCase() + text.slice(1);
    return outcome({ ok: false, failure: cap, question: { text: cap, candidates: shown.map((c, i) => ({ id: c.id, label: distinctLabel(c, shown, i) })) } });
}
/** A label that tells candidates apart: the name, then the room, then the id ("Tent 1"). */
function distinctLabel(item, all, index) {
    const same = all.filter((o) => o.label === item.label);
    if (same.length < 2)
        return item.label;
    const rooms = new Set(same.map((o) => o.roomId));
    if (rooms.size === same.length && item.roomId) {
        const room = item.roomTokens.size > 0 ? [...item.roomTokens].filter((t) => !/^(room|f\d+)$/.test(t)).slice(0, 2).join(' ') : '';
        if (room)
            return `${item.label} · ${room}`;
    }
    const h = item.id.replace(/[-_]+/g, ' ').trim();
    const nice = h.charAt(0).toUpperCase() + h.slice(1);
    return nice.toLowerCase() === item.label.toLowerCase() ? `${item.label} ${index + 1}` : nice;
}
/** Display label of an item with a disambiguating suffix. */
export function labelOf(item) {
    return item.label;
}
const ORDINAL_WORDS = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
/** "the sofa" / "the second chair" / "3 chairs". */
export function describeTargets(items, ref) {
    if (items.length === 0)
        return 'nothing';
    const first = items[0];
    if (items.length === 1) {
        const ord = ref?.ordinal;
        const word = ord === -1 ? 'last' : ord !== undefined ? ORDINAL_WORDS[ord] : undefined;
        return `the ${word ? `${word} ` : ''}${first.label.toLowerCase()}`;
    }
    const kinds = new Set(items.map((i) => i.kind));
    return kinds.size === 1 ? `${items.length} ${first.kind}${first.kind.endsWith('s') ? '' : 's'}` : `${items.length} objects`;
}
