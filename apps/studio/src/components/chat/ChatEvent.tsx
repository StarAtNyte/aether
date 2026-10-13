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
    case 'done':
      return event.calls > 0 ? (
        <div className="ev ev--done">
          {event.calls} model call{event.calls === 1 ? '' : 's'} · {compactCount(event.inputTokens)} in / {compactCount(event.outputTokens)} out tokens
        </div>
      ) : null;
  }
});
