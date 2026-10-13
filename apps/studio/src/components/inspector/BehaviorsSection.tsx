/**
 * Behaviours with full parameter forms (one typed control per parameter of
 * the behaviour catalog), enable switches, reorder, remove and add.
 */
import { memo, useState, type ReactElement } from 'react';
import type { BehaviorSpec, Entity, Json } from '@aether/core';
import { BEHAVIOR_CATALOG } from '@aether/logic';
import { defaultParams } from '../../lib/entityEdit';
import { Icon } from '../Icon';
import { Section, SelectField, Switch } from '../fields';
import { ParamField, type ParamSpecLike } from './ParamField';

type Update = (set: Record<string, Json>, message: string) => void;
const BEHAVIOR_TYPES = BEHAVIOR_CATALOG.map((b) => b.type);

/** The behaviours section. */
export const BehaviorsSection = memo(function BehaviorsSection({ e, update, disabled }: { e: Entity; update: Update; disabled: boolean }): ReactElement {
  const [adding, setAdding] = useState(BEHAVIOR_TYPES[0] ?? 'spin');
  const [open, setOpen] = useState<number | null>(null);
  const name = e.name || e.id;
  const setList = (list: BehaviorSpec[], message: string): void => update({ behaviors: list as unknown as Json }, message);
  const setParam = (i: number, key: string, v: Json): void => {
    const b = e.behaviors[i];
    if (!b) return;
    setList(e.behaviors.map((x, j) => (j === i ? { ...x, params: { ...x.params, [key]: v } } : x)), `Set ${b.type} ${key} on ${name}`);
  };
  return (
    <Section title="Behaviours" right={<span className="count-badge">{e.behaviors.length}</span>}>
      {e.behaviors.length === 0 && <p className="section__note">No behaviours. Add one below or ask the agent.</p>}
      {e.behaviors.map((b, i) => {
        const entry = BEHAVIOR_CATALOG.find((c) => c.type === b.type);
        const specs = (entry?.params ?? {}) as Record<string, ParamSpecLike>;
        const expanded = open === i;
        return (
          <div key={`${b.type}-${i}`} className={`behavior${b.enabled ? '' : ' is-disabled'}`}>
            <div className="behavior__head">
              <button type="button" className="behavior__toggle" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : i)} title={entry?.description ?? b.type}>
                <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={14} />
                <span className="behavior__type">{b.type}</span>
              </button>
              <Switch label={`Enable ${b.type}`} checked={b.enabled} disabled={disabled} onChange={(v) => setList(e.behaviors.map((x, j) => (j === i ? { ...x, enabled: v } : x)), `${v ? 'Enable' : 'Disable'} ${b.type} on ${name}`)} />
              <button type="button" className="icon-btn icon-btn--sm" disabled={disabled || i === 0} aria-label={`Move ${b.type} up`} data-tip="Move up" onClick={() => setList([...e.behaviors.slice(0, i - 1), b, e.behaviors[i - 1] as BehaviorSpec, ...e.behaviors.slice(i + 1)], `Reorder behaviours of ${name}`)}>
                <Icon name="chevronUp" />
              </button>
              <button type="button" className="icon-btn icon-btn--sm" disabled={disabled} aria-label={`Remove ${b.type}`} data-tip="Remove" onClick={() => setList(e.behaviors.filter((_, j) => j !== i), `Remove ${b.type} from ${name}`)}>
                <Icon name="trash" />
              </button>
            </div>
            {expanded && (
              <div className="behavior__form">
                {entry?.requires && <p className="section__note">Needs {entry.requires}.</p>}
                {Object.keys(specs).length === 0 && <p className="section__note">No parameters.</p>}
                {Object.keys(specs).map((k) => (
                  <ParamField key={k} name={k} spec={specs[k] as ParamSpecLike} value={b.params[k]} disabled={disabled} onCommit={(v) => setParam(i, k, v)} />
                ))}
              </div>
            )}
          </div>
        );
      })}
      <div className="add-row">
        <SelectField label="Behaviour type" value={adding} options={BEHAVIOR_TYPES} disabled={disabled} onChange={setAdding} />
        <button
          type="button"
          className="btn btn--sm"
          disabled={disabled}
          onClick={() => {
            const entry = BEHAVIOR_CATALOG.find((c) => c.type === adding);
            if (!entry) return;
            setList([...e.behaviors, { type: entry.type, params: defaultParams(entry.params), enabled: true }], `Add ${entry.type} to ${name}`);
            setOpen(e.behaviors.length);
          }}
        >
          <Icon name="plus" /> Add
        </button>
      </div>
    </Section>
  );
});
