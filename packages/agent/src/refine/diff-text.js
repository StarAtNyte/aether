/**
 * The shape and one-line text of a diff line ("Sofa · colour: grey → dark
 * green"). Dependency-free so the chat can render diffs without loading the
 * edit engine.
 */
/** One-line text of a diff line. */
export function diffLineText(l) {
    if (l.kind === 'add')
        return `${l.subject} · added`;
    if (l.kind === 'remove')
        return `${l.subject} · removed`;
    if (!l.property)
        return l.subject;
    const arrow = l.from !== undefined && l.to !== undefined ? `${l.from} → ${l.to}` : l.from !== undefined ? `${l.from} → default` : (l.to ?? '');
    return `${l.subject} · ${l.property}${arrow ? `: ${arrow}` : ''}`;
}
