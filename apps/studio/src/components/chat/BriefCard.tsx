import { memo, useState, type ReactElement } from 'react';
import { useStudio, useUI } from '../../app/context';
import type { BriefEventView } from '../../lib/chat';
import { Icon } from '../Icon';

const WORD: Record<BriefEventView['elaboration'], string> = { elaborate: 'Elaborate', moderate: 'Moderate', minimal: 'Minimal' };

const REFERENCE_NOTE: Record<BriefEventView['reference']['decision'], string> = {
  generated: 'Generated reference image (AI-made, for ideas; not stored in the project)',
  skipped: 'No reference image',
  unavailable: 'No reference image (no image model connected)',
  failed: 'Reference image could not be made',
};

/**
 * The plan a new world is built from: collapsible, and editable before the build when the user asked to review it
 * (counts can change, elements can go, and a note can be added). Otherwise it is only a record.
 */
export const BriefCard = memo(function BriefCard({ event }: { event: BriefEventView }): ReactElement {
  const studio = useStudio();
  // Waiting only while a run is active: a plan left over from a stopped run has nobody to answer.
  const running = useUI((s) => s.agentRun !== null);
  const waiting = event.editable && running;
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  const [notes, setNotes] = useState('');
  const total = event.elements.reduce((n, e) => n + (removed.has(e.name) ? 0 : (counts[e.name] ?? e.count)), 0);

  const build = (): void => {
    const raw = event.raw as { elements?: Array<{ name: string; count: number }> } | undefined;
    const changed = removed.size > 0 || Object.keys(counts).length > 0;
    const brief = changed && raw?.elements ? { ...raw, elements: raw.elements.filter((e) => !removed.has(e.name)).map((e) => ({ ...e, count: Math.max(1, Math.round(counts[e.name] ?? e.count)) })) } : undefined;
    studio.answerBrief(brief || notes.trim() ? { ...(brief && brief.elements.length > 0 ? { brief } : {}), ...(notes.trim() ? { notes: notes.trim() } : {}) } : null);
  };

  return (
    <details className="ev ev--brief" open={waiting} data-testid="brief-card">
      <summary>
        <Icon name="list" /> Plan: {event.kind} <span className="brief__tag">{WORD[event.elaboration]}</span> <span className="brief__tag">about {event.richness.pieces} pieces, {event.richness.kinds} kinds</span>
      </summary>
      <p className="brief__line">{event.summary}</p>
      <p className="brief__line brief__why">
        {WORD[event.elaboration]} because {event.reason}. Scale: {event.scale}.
      </p>
      <div className="brief__block">
        <strong>Zones</strong>
        <ul>
          {event.zones.map((z) => (
            <li key={z.name}>
              {z.name}
              {z.size ? ` (${z.size})` : ''}: {z.purpose}
            </li>
          ))}
        </ul>
      </div>
      <div className="brief__block">
        <strong>Elements</strong>
        <ul className="brief__elements">
          {event.elements.map((e) => (
            <li key={e.name} className={removed.has(e.name) ? 'is-removed' : undefined}>
              {waiting ? (
                <>
                  <input type="number" min={1} max={5000} aria-label={`Count of ${e.name}`} value={counts[e.name] ?? e.count} disabled={removed.has(e.name)} onChange={(ev) => setCounts((c) => ({ ...c, [e.name]: Number(ev.target.value) }))} />
                  <span> {e.name}</span>
                  <button type="button" className="link" onClick={() => setRemoved((r) => { const n = new Set(r); if (n.has(e.name)) n.delete(e.name); else n.add(e.name); return n; })}>
                    {removed.has(e.name) ? 'Keep' : 'Remove'}
                  </button>
                </>
              ) : (
                <span>
                  {e.count} {e.name}
                </span>
              )}
              {e.size ? <span className="brief__dim"> · {e.size}</span> : null}
              {e.note ? <span className="brief__dim"> · {e.note}</span> : null}
            </li>
          ))}
        </ul>
      </div>
      <p className="brief__line">
        <strong>Materials</strong>: {event.materials.join('; ') || 'as fits'}. <strong>Light</strong>: {event.lighting}
      </p>
      <p className="brief__line brief__dim">
        {REFERENCE_NOTE[event.reference.decision]}: {event.reference.reason}
        {event.reference.prompt ? ` Prompt: ${event.reference.prompt}` : ''}
        {event.reference.provenance ? ` Provenance: ${event.reference.provenance}${event.reference.via ? ` (${event.reference.via})` : ''}.` : ''}
      </p>
      {event.notes ? <p className="brief__line">Your note: {event.notes}</p> : null}
      {waiting && (
        <div className="brief__actions">
          <textarea rows={2} placeholder="Add a note to the plan (optional)" aria-label="Note for the plan" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <button type="button" className="btn btn--primary btn--sm" onClick={build} data-testid="brief-build">
            Build with this plan ({total} pieces listed)
          </button>
        </div>
      )}
    </details>
  );
});
