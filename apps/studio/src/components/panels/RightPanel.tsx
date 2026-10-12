import { memo, type ReactElement } from 'react';
import { useUI, useStudio } from '../../app/context';
import type { RightTab } from '../../state/store';
import { Icon, type IconName } from '../Icon';
import { HistoryPanel } from './HistoryPanel';
import { Inspector } from './Inspector';
import { LogicPanel } from './LogicPanel';
import { Outliner } from './Outliner';
import { VerifyPanel } from './VerifyPanel';

const TABS: ReadonlyArray<[RightTab, string, IconName]> = [
  ['outliner', 'Outliner', 'list'],
  ['inspector', 'Inspector', 'sliders'],
  ['logic', 'Logic', 'zap'],
  ['verify', 'Verify', 'shield'],
  ['history', 'History', 'history'],
];

/** Right panel: tabbed Outliner / Inspector / Logic / Verify / History. */
export const RightPanel = memo(function RightPanel(): ReactElement {
  const studio = useStudio();
  const tab = useUI((s) => s.rightTab);
  const failing = useUI((s) => (s.verify.status === 'failed' ? s.verify.results.filter((r) => !r.passed).length + s.verify.diagnostics.filter((d) => d.severity === 'error').length : 0));
  return (
    <aside className="panel panel--right" aria-label="Inspector panels">
      <div className="tabs" role="tablist" aria-label="Panels">
        {TABS.map(([id, label, icon]) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`tabpanel-${id}`}
            className={`tab${tab === id ? ' is-active' : ''}`}
            onClick={() => studio.store.getState().setRightTab(id)}
            title={label}
          >
            <Icon name={icon} size={14} />
            <span className="tab__label">{label}</span>
            {id === 'verify' && failing > 0 && <span className="tab__badge">{failing}</span>}
          </button>
        ))}
      </div>
      <div className="tabpanel" role="tabpanel" id={`tabpanel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'outliner' && <Outliner />}
        {tab === 'inspector' && <Inspector />}
        {tab === 'logic' && <LogicPanel />}
        {tab === 'verify' && <VerifyPanel />}
        {tab === 'history' && <HistoryPanel />}
      </div>
    </aside>
  );
});
