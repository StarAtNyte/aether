import { memo, type ReactElement } from 'react';
import { useHistoryState, useStudio, useUI } from '../../app/context';
import type { DiagnosticView } from '../../lib/chat';
import { formatMs } from '../../lib/format';
import { Icon } from '../Icon';
import { RichText } from '../RichText';

function describeDiagnostic(d: DiagnosticView): string {
  const who = d.entities.length > 0 ? ` (${d.entities.join(', ')})` : '';
  return `${d.code}${who}: ${d.message}${d.suggestion ? ` Suggestion: ${d.suggestion}` : ''}`;
}

/** Verify tab: run headless physics tests, show results + diagnostics, repair with AI. */
export const VerifyPanel = memo(function VerifyPanel(): ReactElement {
  const studio = useStudio();
  const verify = useUI((s) => s.verify);
  const busy = useUI((s) => s.agentBusy);
  const playing = useUI((s) => s.mode === 'play');
  const { head } = useHistoryState();
  const stale = verify.head !== null && verify.head !== head;
  const running = verify.status === 'running';
  const failing = verify.results.filter((r) => !r.passed);

  return (
    <div className="verify">
      <div className="panel-toolbar">
        <button type="button" className="btn btn--primary btn--sm" disabled={running || playing} onClick={() => void studio.runVerify()}>
          <Icon name="shield" /> {running ? 'Checking…' : 'Run checks'}
        </button>
        {verify.status !== 'idle' && !running && (
          <span className={`status-chip is-${stale ? 'idle' : verify.status === 'passed' ? 'ok' : 'bad'}`}>
            {stale ? 'outdated' : verify.status === 'passed' ? 'passed' : verify.status === 'error' ? 'error' : 'failed'}
          </span>
        )}
        {verify.ms > 0 && !running && <span className="panel-toolbar__count">{formatMs(verify.ms)}</span>}
      </div>

      {verify.status === 'idle' && (
        <div className="panel-empty panel-empty--center">
          <span className="panel-empty__icon">
            <Icon name="shield" size={20} />
          </span>
          <p>Simulates the world headless with its rules and runs every test — stability, overlaps, reachability — plus static diagnostics.</p>
        </div>
      )}

      {verify.summary && verify.status !== 'running' && (
        <details className="verify-summary">
          <summary>Report summary</summary>
          <RichText text={verify.summary} />
        </details>
      )}

      {verify.results.length > 0 && (
        <section className="logic-section">
          <h3 className="section-title">
            Tests{' '}
            <span className="muted">
              {verify.results.length - failing.length}/{verify.results.length} passing
            </span>
          </h3>
          <ul className="test-list">
            {verify.results.map((r, i) => (
              <li key={`${r.id}-${i}`} className={r.passed ? 'is-pass' : 'is-fail'}>
                <Icon name={r.passed ? 'check' : 'x'} />
                <span className="test-list__id">{r.id}</span>
                <span className="test-list__msg">{r.message}</span>
                {!r.passed && (
                  <button type="button" className="btn btn--sm" disabled={busy || playing} onClick={() => studio.fixWithAI(`test "${r.id}" (${r.kind}) failed: ${r.message}`)}>
                    <Icon name="wand" /> Fix with AI
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {verify.diagnostics.length > 0 && (
        <section className="logic-section">
          <h3 className="section-title">
            Diagnostics <span className="muted">{verify.diagnostics.length}</span>
          </h3>
          <ul className="diag-list">
            {verify.diagnostics.map((d, i) => (
              <li key={i} className={`diag sev-${d.severity}`}>
                <div className="diag__head">
                  <span className={`sev-badge sev-badge--${d.severity}`}>{d.severity}</span>
                  <span className="diag__code">{d.code}</span>
                  {d.entities.slice(0, 4).map((id) => (
                    <button
                      key={id}
                      type="button"
                      className="tag tag--link"
                      onClick={() => {
                        studio.pick(id);
                        studio.focus(id);
                      }}
                    >
                      {id}
                    </button>
                  ))}
                </div>
                <p className="diag__msg">{d.message}</p>
                {d.suggestion && <p className="diag__hint">{d.suggestion}</p>}
                {d.severity !== 'info' && (
                  <button type="button" className="btn btn--sm" disabled={busy || playing} onClick={() => studio.fixWithAI(describeDiagnostic(d))}>
                    <Icon name="wand" /> Fix with AI
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {verify.status !== 'idle' && !running && verify.results.length === 0 && verify.diagnostics.length === 0 && (
        <p className="panel-empty">No tests or problems found. Ask the agent to “add physics tests” for stronger guarantees.</p>
      )}
    </div>
  );
});
