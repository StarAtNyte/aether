import { memo, type ReactElement } from 'react';
import { useHistoryState, useStudio, useUI } from '../../app/context';
import type { DiagnosticView } from '../../lib/chat';
import { formatMs } from '../../lib/format';
import { Icon } from '../Icon';
import { RichText } from '../RichText';

/** One line on where and how fast the last run went, e.g. "12 s of physics in 340 ms · 2 parallel workers". */
export function runMeta(v: { ms: number; lanes?: number | undefined; worker?: boolean | undefined; simulatedSeconds?: number | undefined }): string {
  const parts: string[] = [];
  const sim = v.simulatedSeconds ?? 0;
  parts.push(sim > 0 ? `${sim.toFixed(sim >= 10 ? 0 : 1)} s of physics in ${formatMs(v.ms)}` : formatMs(v.ms));
  if (v.worker === true) parts.push((v.lanes ?? 1) > 1 ? `${v.lanes} parallel workers` : 'background worker');
  else if (v.worker === false) parts.push('main thread');
  return parts.join(' · ');
}

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
  const live = running ? (verify.live ?? null) : null;
  const decided = live ? live.results.filter((r) => r !== null).length : 0;

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
        {verify.ms > 0 && !running && (
          <span className="panel-toolbar__count" title={runMeta(verify)} data-testid="verify-meta">
            {runMeta(verify)}
          </span>
        )}
      </div>

      {live && (
        <section className="logic-section verify-live" aria-live="polite" data-testid="verify-live">
          <h3 className="section-title">
            {live.worker ? (live.lanes > 1 ? `Simulating on ${live.lanes} parallel workers` : 'Simulating in a background worker') : 'Simulating'}{' '}
            <span className="muted">
              {decided}/{live.tests.length}
            </span>
          </h3>
          {live.worker && live.lanes > 1 && (
            <div className="verify-lanes" aria-hidden="true">
              {Array.from({ length: live.lanes }, (_, i) => (
                <span key={i} className="verify-lanes__lane" />
              ))}
            </div>
          )}
          <ul className="test-list">
            {live.tests.map((t, i) => {
              const r = live.results[i] ?? null;
              return (
                <li key={`${t.id}-${i}`} className={r ? (r.passed ? 'is-pass' : 'is-fail') : 'is-pending'}>
                  {r ? <Icon name={r.passed ? 'check' : 'x'} /> : <span className="test-list__pending" />}
                  <span className="test-list__id">{t.id}</span>
                  <span className="test-list__msg">{r ? r.message : t.kind}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

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

      {verify.results.length > 0 && !live && (
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

      {verify.diagnostics.length > 0 && !running && (
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
