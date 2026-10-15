/**
 * The shape and one-line text of a diff line ("Sofa · colour: grey → dark
 * green"). Dependency-free so the chat can render diffs without loading the
 * edit engine.
 */

/** One line of the diff. */
export interface DiffLine {
  /** Entity id, or '' for the world. */
  id: string;
  /** "Sofa", "World", "Rule". */
  subject: string;
  /** "colour", "position", … */
  property: string;
  /** Short text of the old value. */
  from?: string;
  /** Short text of the new value. */
  to?: string;
  /** Hex colours for swatches. */
  fromColor?: string;
  toColor?: string;
  kind: 'change' | 'add' | 'remove';
}

/** One-line text of a diff line. */
export function diffLineText(l: DiffLine): string {
  if (l.kind === 'add') return `${l.subject} · added`;
  if (l.kind === 'remove') return `${l.subject} · removed`;
  if (!l.property) return l.subject;
  const arrow = l.from !== undefined && l.to !== undefined ? `${l.from} → ${l.to}` : l.from !== undefined ? `${l.from} → default` : (l.to ?? '');
  return `${l.subject} · ${l.property}${arrow ? `: ${arrow}` : ''}`;
}
