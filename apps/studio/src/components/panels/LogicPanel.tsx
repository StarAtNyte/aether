import { memo, useMemo, type ReactElement } from 'react';
import type { Rule } from '@aether/core';
import { useSimulation, useStudio, useUI, useWorld } from '../../app/context';
import { formatRule, formatTest, formatValue } from '../../lib/ruleFormat';
import { Icon } from '../Icon';

const MAX_LOG_LINES = 40;

/** One rule as a readable "WHEN … → …" card. */
const RuleCard = memo(function RuleCard({ rule, disabled, onToggle }: { rule: Rule; disabled: boolean; onToggle: (id: string, enabled: boolean) => void }): ReactElement {
  const c = useMemo(() => formatRule(rule), [rule]);
  return (
    <article className={`rule-card${c.enabled ? '' : ' is-disabled'}`}>
      <header className="rule-card__head">
        <span className="rule-card__id">{c.id}</span>
        {c.once && <span className="chip chip--quiet chip--xs">once</span>}
        <button type="button" className="icon-btn icon-btn--xs" disabled={disabled} onClick={() => onToggle(c.id, !c.enabled)} title={c.enabled ? 'Disable rule' : 'Enable rule'} aria-label={c.enabled ? `Disable ${c.id}` : `Enable ${c.id}`}>
          <Icon name={c.enabled ? 'eye' : 'eyeOff'} />
        </button>
      </header>
      {c.description && <p className="rule-card__desc">{c.description}</p>}
      <div className="rule-line">
        <span className="kw kw--when">WHEN</span>
        <span>{c.when}</span>
      </div>
      {c.conditions.length > 0 && (
        <div className="rule-line">
          <span className="kw kw--if">IF</span>
          <span>{c.conditions.join(' and ')}</span>
        </div>
      )}
      <div className="rule-line">
        <span className="kw kw--then">THEN</span>
        <span className="rule-actions">
          {c.actions.map((a, i) => (
            <span key={i} className="action-chip">
              {a}
            </span>
          ))}
        </span>
      </div>
    </article>
  );
});

/** Live rule trace while playing (refreshes with the 4 Hz HUD tick). */
const LiveLog = memo(function LiveLog(): ReactElement | null {
  const sim = useSimulation();
  const time = useUI((s) => s.game.time);
  const playing = useUI((s) => s.mode === 'play');
  if (!playing || !sim?.logic) return null;
  const lines = sim.logic.log.slice(-MAX_LOG_LINES).reverse();
  return (
    <section className="logic-section">
      <h3 className="section-title">
        Live trace <span className="muted">t = {time.toFixed(1)}s</span>
      </h3>
      {lines.length === 0 ? (
        <p className="muted small">Nothing has fired yet.</p>
      ) : (
        <ol className="trace">
          {lines.map((l, i) => (
            <li key={`${l.t}-${i}`}>
              <span className="trace__t">{l.t.toFixed(2)}</span>
              <span className="trace__text">{l.text}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
});

/** Logic tab: world state, rules as cards, tests with last results, live trace. */
export const LogicPanel = memo(function LogicPanel(): ReactElement {
  const studio = useStudio();
  const world = useWorld();
  const playing = useUI((s) => s.mode === 'play');
  const results = useUI((s) => s.verify.results);
  const resultById = useMemo(() => new Map(results.map((r) => [r.id, r])), [results]);
  const onToggle = (id: string, enabled: boolean): void => {
    studio.commitUser([{ op: 'updateRule', id, set: { enabled } }], `${enabled ? 'Enable' : 'Disable'} rule ${id}`);
  };
  const stateKeys = Object.keys(world.state);
  return (
    <div className="logic">
      <LiveLog />
      <section className="logic-section">
        <h3 className="section-title">
          Rules <span className="muted">{world.rules.length}</span>
        </h3>
        {world.rules.length === 0 ? <p className="muted small">No rules yet. Try “add a score that goes up when I touch a coin”.</p> : world.rules.map((r) => <RuleCard key={r.id} rule={r} disabled={playing} onToggle={onToggle} />)}
      </section>
      <section className="logic-section">
        <h3 className="section-title">
          State <span className="muted">{stateKeys.length}</span>
        </h3>
        {stateKeys.length === 0 ? (
          <p className="muted small">No world variables.</p>
        ) : (
          <dl className="kv">
            {stateKeys.map((k) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{formatValue(world.state[k])}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>
      <section className="logic-section">
        <h3 className="section-title">
          Tests <span className="muted">{world.tests.length}</span>
        </h3>
        {world.tests.length === 0 ? (
          <p className="muted small">No physics tests. The agent adds them when it builds contraptions.</p>
        ) : (
          <ul className="test-list">
            {world.tests.map((t) => {
              const r = resultById.get(t.id);
              return (
                <li key={t.id} className={r ? (r.passed ? 'is-pass' : 'is-fail') : ''}>
                  <Icon name={r ? (r.passed ? 'check' : 'x') : 'shield'} />
                  <span className="test-list__id">{t.id}</span>
                  <span className="test-list__msg">{r ? r.message : formatTest(t)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
});
