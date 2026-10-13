/**
 * Logic panel: rules as readable WHEN / IF / THEN cards that open into a
 * visual editor (trigger and action dropdowns with typed fields, conditions
 * and actions added / removed), world variables, physics tests that are
 * editable with a "Run checks" button, and the live rule trace while
 * playing. Every edit is validated against the World IR and committed as
 * one undoable change.
 */
import { memo, useMemo, useState, type ReactElement } from 'react';
import { patchesBetween, type Action, type Condition, type Rule, type Trigger, type WorldDoc, type WorldTest } from '@aether/core';
import { useSimulation, useStudio, useUI, useWorld } from '../../app/context';
import { formatRule, formatTest, formatValue } from '../../lib/ruleFormat';
import { ACTION_FIELDS, ACTION_LABELS, defaultAction, defaultTest, defaultTrigger, OPS, parseLiteral, literalText, TEST_FIELDS, TEST_LABELS, TRIGGER_FIELDS, TRIGGER_LABELS, validateRule, validateTest } from '../../lib/ruleFields';
import { Icon } from '../Icon';
import { SelectField, Switch, TextField } from '../fields';
import { KindForm } from './logic/KindForm';

const MAX_LOG_LINES = 40;
const TRIGGER_KINDS = Object.keys(TRIGGER_FIELDS) as Array<Trigger['on']>;
const ACTION_KINDS = Object.keys(ACTION_FIELDS) as Array<Action['do']>;
const TEST_KINDS = Object.keys(TEST_FIELDS) as Array<WorldTest['kind']>;

type Rec = Record<string, unknown>;

/** Commit a world with replaced rules / tests as the minimal patches. */
function commitWorld(studio: ReturnType<typeof useStudio>, next: WorldDoc, message: string): string | null {
  const patches = patchesBetween(studio.history.current, next);
  return patches.length > 0 ? studio.commitUser(patches, message) : null;
}

/** Visual editor of one rule. */
const RuleEditor = memo(function RuleEditor({ rule, entityIds, onClose }: { rule: Rule; entityIds: readonly string[]; onClose: () => void }): ReactElement {
  const studio = useStudio();
  const [draft, setDraft] = useState<Rule>(rule);
  const [error, setError] = useState<string | null>(null);
  const save = (): void => {
    const v = validateRule(draft);
    if (!v.ok) {
      setError(v.error);
      return;
    }
    const world = studio.history.current;
    const rules = world.rules.map((r) => (r.id === rule.id ? v.rule : r));
    const err = commitWorld(studio, { ...world, rules }, `Edit rule ${rule.id}`);
    setError(err);
    if (!err) onClose();
  };
  const setCond = (i: number, c: Condition): void => setDraft({ ...draft, if: draft.if.map((x, j) => (j === i ? c : x)) });
  const setAction = (i: number, a: Action): void => setDraft({ ...draft, then: draft.then.map((x, j) => (j === i ? a : x)) });
  return (
    <div className="rule-editor" data-testid="rule-editor">
      <div className="rule-editor__block">
        <span className="kw kw--when">When</span>
        <SelectField<Trigger['on']>
          label="Trigger"
          value={draft.when.on}
          options={TRIGGER_KINDS}
          onChange={(on) => setDraft({ ...draft, when: defaultTrigger(on) })}
        />
        <span className="rule-editor__hint">{TRIGGER_LABELS[draft.when.on]}</span>
        <KindForm fields={TRIGGER_FIELDS[draft.when.on]} value={draft.when as unknown as Rec} entityIds={entityIds} onChange={(t) => setDraft({ ...draft, when: t as unknown as Trigger })} />
      </div>
      <div className="rule-editor__block">
        <span className="kw kw--if">If</span>
        {draft.if.length === 0 && <span className="rule-editor__hint">always</span>}
        {draft.if.map((c, i) => (
          <div key={i} className="rule-editor__cond">
            <TextField label="Variable" value={c.key} mono placeholder="score" onCommit={(k) => setCond(i, { ...c, key: k })} />
            <SelectField label="Compare" raw value={c.op} options={OPS} onChange={(op) => setCond(i, { ...c, op })} />
            <TextField label="Value" value={literalText(c.value)} mono onCommit={(t) => setCond(i, { ...c, value: parseLiteral(t) })} />
            <button type="button" className="icon-btn icon-btn--xs" aria-label="Remove condition" onClick={() => setDraft({ ...draft, if: draft.if.filter((_, j) => j !== i) })}>
              <Icon name="x" />
            </button>
          </div>
        ))}
        <button type="button" className="btn btn--xs" onClick={() => setDraft({ ...draft, if: [...draft.if, { key: 'score', op: '>=', value: 1 }] })}>
          <Icon name="plus" size={14} /> Condition
        </button>
      </div>
      <div className="rule-editor__block">
        <span className="kw kw--then">Then</span>
        {draft.then.map((a, i) => (
          <div key={i} className="rule-editor__action">
            <div className="rule-editor__action-head">
              <span className="rule-editor__select" data-tip={ACTION_LABELS[a.do]}>
                <SelectField<Action['do']> label="Action" value={a.do} options={ACTION_KINDS} onChange={(kind) => setAction(i, defaultAction(kind))} />
              </span>
              <button type="button" className="icon-btn icon-btn--xs" disabled={draft.then.length <= 1} aria-label="Remove action" onClick={() => setDraft({ ...draft, then: draft.then.filter((_, j) => j !== i) })}>
                <Icon name="x" />
              </button>
            </div>
            <KindForm fields={ACTION_FIELDS[a.do]} value={a as unknown as Rec} entityIds={entityIds} onChange={(next) => setAction(i, next as unknown as Action)} />
          </div>
        ))}
        <button type="button" className="btn btn--xs" onClick={() => setDraft({ ...draft, then: [...draft.then, defaultAction('message')] })}>
          <Icon name="plus" size={14} /> Action
        </button>
      </div>
      <div className="rule-editor__footer">
        <label className="rule-editor__flag">
          <Switch label="Only once" checked={draft.once} onChange={(once) => setDraft({ ...draft, once })} />
          <span>Only once</span>
        </label>
        <TextField label="Description" value={draft.description ?? ''} placeholder="What it does (optional)" onCommit={(d) => setDraft({ ...draft, description: d.trim() ? d.slice(0, 200) : undefined } as Rule)} />
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <div className="add-row add-row--end">
        <button type="button" className="btn btn--sm" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn btn--sm btn--primary" onClick={save} data-testid="rule-save">
          Save rule
        </button>
      </div>
    </div>
  );
});

/** One rule as a readable "WHEN … → …" card that opens into the editor. */
const RuleCard = memo(function RuleCard({ rule, disabled, entityIds }: { rule: Rule; disabled: boolean; entityIds: readonly string[] }): ReactElement {
  const studio = useStudio();
  const [editing, setEditing] = useState(false);
  const c = useMemo(() => formatRule(rule), [rule]);
  const toggle = (): void => void studio.commitUser([{ op: 'updateRule', id: rule.id, set: { enabled: !rule.enabled } }], `${rule.enabled ? 'Disable' : 'Enable'} rule ${rule.id}`);
  const remove = (): void => void studio.commitUser([{ op: 'removeRule', id: rule.id }], `Delete rule ${rule.id}`);
  return (
    <article className={`rule-card${c.enabled ? '' : ' is-disabled'}${editing ? ' is-editing' : ''}`} data-rule={rule.id}>
      <header className="rule-card__head">
        <span className="rule-card__id">{c.id}</span>
        {c.once && <span className="chip chip--quiet chip--xs">once</span>}
        <button type="button" className="icon-btn icon-btn--xs" disabled={disabled} onClick={() => setEditing((e) => !e)} title="Edit rule" aria-label={`Edit ${c.id}`} data-testid={`rule-edit-${rule.id}`}>
          <Icon name="pencil" />
        </button>
        <button type="button" className="icon-btn icon-btn--xs" disabled={disabled} onClick={toggle} title={c.enabled ? 'Disable rule' : 'Enable rule'} aria-label={c.enabled ? `Disable ${c.id}` : `Enable ${c.id}`}>
          <Icon name={c.enabled ? 'eye' : 'eyeOff'} />
        </button>
        <button type="button" className="icon-btn icon-btn--xs" disabled={disabled} onClick={remove} title="Delete rule" aria-label={`Delete ${c.id}`}>
          <Icon name="trash" />
        </button>
      </header>
      {editing && !disabled ? (
        <RuleEditor rule={rule} entityIds={entityIds} onClose={() => setEditing(false)} />
      ) : (
        <>
          {c.description && <p className="rule-card__desc">{c.description}</p>}
          <div className="rule-line">
            <span className="kw kw--when">When</span>
            <span>{c.when}</span>
          </div>
          {c.conditions.length > 0 && (
            <div className="rule-line">
              <span className="kw kw--if">If</span>
              <span>{c.conditions.join(' and ')}</span>
            </div>
          )}
          <div className="rule-line">
            <span className="kw kw--then">Then</span>
            <span className="rule-actions">
              {c.actions.map((a, i) => (
                <span key={i} className="action-chip">
                  {a}
                </span>
              ))}
            </span>
          </div>
        </>
      )}
    </article>
  );
});

/** One test: kind + fields, last result, edit / delete. */
const TestRow = memo(function TestRow({ test, result, disabled, entityIds }: { test: WorldTest; result: { passed: boolean; message: string } | undefined; disabled: boolean; entityIds: readonly string[] }): ReactElement {
  const studio = useStudio();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<WorldTest>(test);
  const [error, setError] = useState<string | null>(null);
  const save = (): void => {
    const v = validateTest(draft);
    if (!v.ok) {
      setError(v.error);
      return;
    }
    const world = studio.history.current;
    const err = commitWorld(studio, { ...world, tests: world.tests.map((t) => (t.id === test.id ? v.test : t)) }, `Edit test ${test.id}`);
    setError(err);
    if (!err) setEditing(false);
  };
  return (
    <li className={`test-item${result ? (result.passed ? ' is-pass' : ' is-fail') : ''}`}>
      <div className="test-list__row">
        <Icon name={result ? (result.passed ? 'check' : 'x') : 'shield'} />
        <span className="test-list__id">{test.id}</span>
        <span className="test-list__msg">{result ? result.message : formatTest(test)}</span>
        <button type="button" className="icon-btn icon-btn--xs" disabled={disabled} aria-label={`Edit ${test.id}`} onClick={() => {
          setDraft(test);
          setEditing((e) => !e);
        }}>
          <Icon name="pencil" />
        </button>
        <button type="button" className="icon-btn icon-btn--xs" disabled={disabled} aria-label={`Delete ${test.id}`} onClick={() => void studio.commitUser([{ op: 'removeTest', id: test.id }], `Delete test ${test.id}`)}>
          <Icon name="trash" />
        </button>
      </div>
      {editing && !disabled && (
        <div className="rule-editor">
          <SelectField<WorldTest['kind']> label="Test kind" value={draft.kind} options={TEST_KINDS} onChange={(k) => setDraft(defaultTest(k, test.id))} />
          <span className="rule-editor__hint">{TEST_LABELS[draft.kind]}</span>
          <KindForm fields={TEST_FIELDS[draft.kind]} value={draft as unknown as Rec} entityIds={entityIds} onChange={(next) => setDraft(next as unknown as WorldTest)} />
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <div className="add-row add-row--end">
            <button type="button" className="btn btn--sm" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button type="button" className="btn btn--sm btn--primary" onClick={save}>
              Save test
            </button>
          </div>
        </div>
      )}
    </li>
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

function freeId(existing: readonly string[], base: string): string {
  if (!existing.includes(base)) return base;
  for (let n = 2; n < 10_000; n++) if (!existing.includes(`${base}-${n}`)) return `${base}-${n}`;
  return `${base}-${Date.now()}`;
}

/** Logic tab: rules (editable), state, tests (editable, runnable), live trace. */
export const LogicPanel = memo(function LogicPanel(): ReactElement {
  const studio = useStudio();
  const world = useWorld();
  const playing = useUI((s) => s.mode === 'play');
  const results = useUI((s) => s.verify.results);
  const verifying = useUI((s) => s.verify.status === 'running');
  const resultById = useMemo(() => new Map(results.map((r) => [r.id, r])), [results]);
  const stateKeys = Object.keys(world.state);
  const entityIds = useMemo(() => {
    const all = Object.values(world.entities);
    return [...all.filter((e) => e.template).map((e) => e.id), ...all.filter((e) => !e.template).map((e) => e.id)].slice(0, 500);
  }, [world.entities]);
  const addRule = (): void => {
    const id = freeId(world.rules.map((r) => r.id), 'rule');
    const v = validateRule({ id, when: { on: 'start' }, then: [{ do: 'message', text: 'The game begins!' }] });
    if (v.ok) studio.commitUser([{ op: 'addRule', rule: v.rule }], `Add rule ${id}`);
  };
  const addTest = (): void => {
    const id = freeId(world.tests.map((t) => t.id), 'check');
    studio.commitUser([{ op: 'addTest', test: defaultTest('stable', id) }], `Add test ${id}`);
  };
  return (
    <div className="logic">
      <LiveLog />
      <section className="logic-section">
        <h3 className="section-title">
          Rules <span className="muted">{world.rules.length}</span>
          <button type="button" className="btn btn--xs section-title__action" disabled={playing} onClick={addRule} data-testid="rule-add">
            <Icon name="plus" size={14} /> Rule
          </button>
        </h3>
        {world.rules.length === 0 ? <p className="muted small">No rules yet. Add one, or try “add a score that goes up when I touch a coin”.</p> : world.rules.map((r) => <RuleCard key={r.id} rule={r} disabled={playing} entityIds={entityIds} />)}
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
          <span className="section-title__action">
            <button type="button" className="btn btn--xs" disabled={playing} onClick={addTest}>
              <Icon name="plus" size={14} /> Test
            </button>
            <button type="button" className="btn btn--xs btn--primary" disabled={playing || verifying} onClick={() => void studio.runVerify()} data-testid="run-checks">
              <Icon name="play" size={14} /> {verifying ? 'Checking…' : 'Run checks'}
            </button>
          </span>
        </h3>
        {world.tests.length === 0 ? (
          <p className="muted small">No physics tests. Add one, or the agent adds them when it builds contraptions.</p>
        ) : (
          <ul className="test-list">
            {world.tests.map((t) => (
              <TestRow key={t.id} test={t} result={resultById.get(t.id)} disabled={playing} entityIds={entityIds} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
});
