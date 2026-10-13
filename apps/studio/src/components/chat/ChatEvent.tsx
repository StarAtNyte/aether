import { memo, useState, type ReactElement } from 'react';
import type { ChatEventView } from '../../lib/chat';
import { patchChips } from '../../lib/patchSummary';
import { compactCount } from '../../lib/format';
import { CodeBlock } from '../CodeBlock';
import { Icon } from '../Icon';
import { RichText } from '../RichText';

/** Expandable diff chip row for a patch batch. */
const PatchesView = memo(function PatchesView({ event }: { event: Extract<ChatEventView, { type: 'patches' }> }): ReactElement {
  const [open, setOpen] = useState(false);
  const s = event.summary;
  const chips = patchChips(s);
  const lists: Array<[string, string[], number]> = [
    ['Added', s.added, s.addedCount],
    ['Changed', s.updated, s.updatedCount],
    ['Removed', s.removed, s.removedCount],
  ];
  return (
    <div className="ev ev--patches">
      <button type="button" className="diff-chips" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Icon name="cube" className="diff-chips__icon" />
        <span className="diff-chips__msg" title={event.message || 'World edit'}>
          {event.message || 'World edit'}
        </span>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} className="diff-chips__chev" />
        <span className="diff-chips__list">
          {chips.length === 0 ? <span className="chip">no changes</span> : chips.map((c) => <span key={c} className={`chip${c.startsWith('＋') ? ' chip--add' : c.startsWith('−') ? ' chip--remove' : c.startsWith('✎') ? ' chip--edit' : ''}`}>{c}</span>)}
        </span>
      </button>
      {open && (
        <div className="diff-detail">
          {lists.map(([label, ids, count]) =>
            count > 0 ? (
              <div key={label} className="diff-detail__row">
                <span className="diff-detail__label">{label}</span>
                <span className="diff-detail__ids">
                  {ids.join(', ')}
                  {count > ids.length ? ` +${count - ids.length} more` : ''}
                </span>
              </div>
            ) : null,
          )}
          {s.generators.length > 0 && (
            <div className="diff-detail__row">
              <span className="diff-detail__label">Generators</span>
              <span className="diff-detail__ids">{s.generators.join(', ')}</span>
            </div>
          )}
          {s.scripts.length > 0 && (
            <div className="diff-detail__row">
              <span className="diff-detail__label">Scripts</span>
              <span className="diff-detail__ids">{s.scripts.join(', ')}</span>
            </div>
          )}
        </div>
      )}
      {event.errors.length > 0 && (
        <ul className="ev-errors">
          {event.errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
});

/** Verification result card with per-test badges. */
const VerifyView = memo(function VerifyView({ event }: { event: Extract<ChatEventView, { type: 'verify' }> }): ReactElement {
  const [open, setOpen] = useState(!event.passed);
  const passed = event.results.filter((r) => r.passed).length;
  return (
    <div className={`ev ev--verify ${event.passed ? 'is-pass' : 'is-fail'}`}>
      <button type="button" className="verify-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className={`status-chip is-${event.passed ? 'ok' : 'bad'}`}>{event.passed ? 'Checks passed' : 'Checks failed'}</span>
        {event.results.length > 0 && (
          <span className="ev__meta">
            {passed}/{event.results.length} tests
          </span>
        )}
        {event.diagnostics.length > 0 && <span className="ev__meta">{event.diagnostics.length} notes</span>}
        <Icon name={open ? 'chevronUp' : 'chevronDown'} />
      </button>
      {open && (
        <ul className="test-list">
          {event.results.map((r, i) => (
            <li key={`${r.id}-${i}`} className={r.passed ? 'is-pass' : 'is-fail'}>
              <Icon name={r.passed ? 'check' : 'x'} />
              <span className="test-list__id">{r.id}</span>
              <span className="test-list__msg">{r.message}</span>
            </li>
          ))}
          {event.diagnostics.map((d, i) => (
            <li key={`d${i}`} className={`sev-${d.severity}`}>
              <Icon name={d.severity === 'info' ? 'info' : 'alert'} />
              <span className="test-list__id">{d.code}</span>
              <span className="test-list__msg">{d.message}</span>
            </li>
          ))}
          {event.results.length === 0 && event.diagnostics.length === 0 && <li className="test-list__empty">{event.summary || 'No tests defined.'}</li>}
        </ul>
      )}
    </div>
  );
});

/** Renders one agent event. LLM text goes through the safe RichText renderer only. */
export const ChatEvent = memo(function ChatEvent({ event, live }: { event: ChatEventView; live: boolean }): ReactElement | null {
  switch (event.type) {
    case 'status':
      return (
        <div className={`ev ev--status${live ? ' is-live' : ''}`}>
          <span>{event.text}</span>
        </div>
      );
    case 'plan':
      return (
        <div className="ev ev--plan">
          <div className="ev__label">
            <Icon name="list" /> Plan
          </div>
          <RichText text={event.text} />
        </div>
      );
    case 'message':
      return (
        <div className="ev ev--message">
          <RichText text={event.text} />
        </div>
      );
    case 'error':
      return (
        <div className="ev ev--error" role="alert">
          <Icon name="alert" /> <span>{event.text}</span>
        </div>
      );
    case 'repair':
      return (
        <div className="ev ev--repair">
          <span className="status-chip is-warn">Repair {event.attempt}</span>
          <span className="ev__text">{event.text}</span>
        </div>
      );
    case 'patches':
      return <PatchesView event={event} />;
    case 'verify':
      return <VerifyView event={event} />;
    case 'generator':
      return (
        <div className="ev ev--generator">
          <div className="ev__label">
            <Icon name="code" /> Generator <code className="inline-code">{event.id}</code>
            <span className={`status-chip is-${event.ok ? 'ok' : 'bad'}`}>{event.ok ? 'Sandbox ok' : 'Rejected'}</span>
          </div>
          {event.description && <p className="ev__desc">{event.description}</p>}
          <CodeBlock code={event.source} lang="js" title={`${event.id}.js`} />
          {event.error && <p className="ev-errors">{event.error}</p>}
        </div>
      );
    case 'done': {
      const parts: string[] = [];
      if (event.via) parts.push(event.via);
      if (event.models && event.models.length > 0) parts.push(`answered by ${event.models.join(', ')}`);
      if (event.ms !== undefined) parts.push(formatElapsed(event.ms));
      if (event.calls > 0) parts.push(`${event.calls} model call${event.calls === 1 ? '' : 's'}`, `${compactCount(event.inputTokens)} in / ${compactCount(event.outputTokens)} out tokens`);
      return parts.length > 0 ? <div className="ev ev--done">{parts.join(' · ')}</div> : null;
    }
    case 'notice':
      return (
        <div className={`ev ev--notice${event.tone === 'warning' ? ' is-warning' : ''}`} role="status">
          <Icon name={event.tone === 'warning' ? 'alert' : 'info'} /> <span>{event.text}</span>
        </div>
      );
    case 'quality':
      return <QualityView event={event} />;
  }
});

/** "12 s" / "1 min 05 s". */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
}

/** Quality score with an expandable rubric breakdown. */
const QualityView = memo(function QualityView({ event }: { event: Extract<ChatEventView, { type: 'quality' }> }): ReactElement {
  const [open, setOpen] = useState(false);
  const grade = event.score >= 85 ? 'ok' : event.score >= 72 ? 'fair' : 'low';
  const title = event.round === 0 ? 'Quality review' : `Quality after refinement ${event.round}`;
  return (
    <div className={`ev ev--quality is-${grade}`}>
      <button type="button" className="quality__head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="quality__score" aria-label={`Quality score ${event.score} of 100`}>
          {event.score}
        </span>
        <span className="quality__text">
          <span className="quality__title">{title}</span>
          <span className="quality__summary">{event.applied.length > 0 ? `Improved: ${event.applied.join(', ')}.` : event.summary}</span>
        </span>
        <span className="quality__source">{event.source === 'heuristic' ? 'measured' : 'measured + model review'}</span>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} className="quality__chev" />
      </button>
      {open && (
        <ul className="quality__rubric">
          {event.criteria.map((c) => (
            <li key={c.id} className="quality__row">
              <span className="quality__label">{c.label}</span>
              <span className="quality__bar" aria-hidden="true">
                <span className="quality__fill" style={{ width: `${Math.round(c.score * 10)}%` }} />
              </span>
              <span className="quality__value">{c.score.toFixed(1)}</span>
              {c.note && <span className="quality__note">{c.note}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
