import { memo, useReducer, useState, type ReactElement } from 'react';
import { useHistoryState, useStudio, useUI } from '../../app/context';
import { Icon, type IconName } from '../Icon';

const SOURCE_ICON: Record<string, IconName> = { agent: 'sparkles', user: 'user', system: 'cube' };

/** History tab: commit timeline (time travel), undo/redo, branches. */
export const HistoryPanel = memo(function HistoryPanel(): ReactElement {
  const studio = useStudio();
  const [revision, bump] = useReducer((x: number) => x + 1, 0);
  const { entries, head, branches, branch, canUndo, canRedo } = useHistoryState(revision);
  const playing = useUI((s) => s.mode === 'play');
  const agentBusy = useUI((s) => s.agentBusy);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const reversed = [...entries].reverse();

  const createBranch = (): void => {
    const n = name.trim();
    if (!n) return;
    const err = studio.branch(n);
    setError(err);
    if (!err) {
      setName('');
      bump();
    }
  };

  return (
    <div className="history">
      <div className="panel-toolbar">
        <button type="button" className="btn btn--sm" disabled={!canUndo || playing || agentBusy} onClick={() => studio.undo()}>
          <Icon name="undo" /> Undo
        </button>
        <button type="button" className="btn btn--sm" disabled={!canRedo || playing || agentBusy} onClick={() => studio.redo()}>
          <Icon name="redo" /> Redo
        </button>
        <span className="panel-toolbar__count">{entries.length - 1} edits</span>
      </div>

      <section className="logic-section">
        <h3 className="section-title">
          <Icon name="branch" /> Branches
        </h3>
        <div className="branch-list">
          {branches.map((b) => (
            <button key={b} type="button" className={`branch-chip${b === branch ? ' is-active' : ''}`} disabled={playing} onClick={() => studio.switchBranch(b)} aria-pressed={b === branch}>
              {b}
            </button>
          ))}
        </div>
        <form
          className="add-row"
          onSubmit={(e) => {
            e.preventDefault();
            createBranch();
          }}
        >
          <input className="input input--sm" value={name} maxLength={64} placeholder="new-branch-name" aria-label="New branch name" onChange={(e) => setName(e.target.value)} />
          <button type="submit" className="btn btn--sm" disabled={!name.trim() || playing}>
            <Icon name="plus" /> Branch here
          </button>
        </form>
        {error && <p className="field-error">{error}</p>}
      </section>

      <section className="logic-section">
        <h3 className="section-title">Timeline</h3>
        <ol className="timeline">
          {reversed.map((e) => {
            const current = e.id === head;
            return (
              <li key={e.id} className={`timeline__item${current ? ' is-current' : ''}`}>
                <button type="button" className="timeline__btn" disabled={playing || current} onClick={() => studio.checkout(e.id)} title={current ? 'Current state' : 'Jump to this state'}>
                  <span className={`timeline__icon src-${e.source}`}>
                    <Icon name={SOURCE_ICON[e.source] ?? 'cube'} />
                  </span>
                  <span className="timeline__msg">{e.message}</span>
                  <span className="timeline__meta">{e.patchCount > 0 ? `${e.patchCount} ops` : ''}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
});
