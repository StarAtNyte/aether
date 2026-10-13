/** Slim icon rail that switches the left panel's view (and collapses it when the active view is clicked again). */
import { memo, type ReactElement } from 'react';
import { useStudio, useUI } from '../app/context';
import type { LeftView } from '../state/store';
import { Icon, type IconName } from '../components/Icon';

/** Rail entries in order: id, label, icon, Alt+digit shortcut. */
export const LEFT_VIEWS: ReadonlyArray<{ id: LeftView; label: string; icon: IconName }> = [
  { id: 'agent', label: 'Agent', icon: 'sparkles' },
  { id: 'objects', label: 'Objects', icon: 'layers' },
  { id: 'assets', label: 'Assets', icon: 'shapes' },
  { id: 'logic', label: 'Logic', icon: 'zap' },
  { id: 'verify', label: 'Checks', icon: 'shield' },
  { id: 'history', label: 'History', icon: 'history' },
];

/** Count of failing checks (for the rail badge). */
export function useFailingChecks(): number {
  return useUI((s) => (s.verify.status === 'failed' ? s.verify.results.filter((r) => !r.passed).length + s.verify.diagnostics.filter((d) => d.severity === 'error').length : 0));
}

/** The icon rail. */
export const IconRail = memo(function IconRail(): ReactElement {
  const studio = useStudio();
  const view = useUI((s) => s.leftView);
  const open = useUI((s) => s.panels.left);
  const failing = useFailingChecks();
  const busy = useUI((s) => s.agentBusy);
  return (
    <nav className="rail" aria-label="Panels">
      <div className="rail__group" role="tablist" aria-orientation="vertical" aria-label="Left panel">
        {LEFT_VIEWS.map((v, i) => {
          const active = open && view === v.id;
          return (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls="left-panel"
              id={`rail-${v.id}`}
              className={`rail__btn${active ? ' is-active' : ''}`}
              aria-label={v.label}
              data-tip={v.label}
              data-kbd={`Alt+${i + 1}`}
              data-tip-pos="right"
              onClick={() => {
                const st = studio.store.getState();
                if (st.panels.left && st.leftView === v.id) st.togglePanel('left');
                else st.showLeftView(v.id);
              }}
            >
              <Icon name={v.icon} />
              {v.id === 'verify' && failing > 0 && <span className="rail__badge">{failing > 9 ? '9+' : failing}</span>}
              {v.id === 'agent' && busy && <span className="rail__pulse" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      <div className="rail__group">
        <button type="button" className="rail__btn" aria-label="Settings" data-tip="Settings" data-tip-pos="right" onClick={() => studio.store.getState().setSettingsOpen(true)}>
          <Icon name="settings" />
        </button>
      </div>
    </nav>
  );
});
