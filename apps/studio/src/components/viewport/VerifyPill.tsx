import { memo, type ReactElement } from 'react';
import { useHistoryState, useStudio, useUI } from '../../app/context';
import { Icon } from '../Icon';

/** "Physics check" pill: latest verification result; click to (re)run and open the Verify tab. */
export const VerifyPill = memo(function VerifyPill(): ReactElement | null {
  const studio = useStudio();
  const verify = useUI((s) => s.verify);
  const mode = useUI((s) => s.mode);
  const { head } = useHistoryState();
  if (mode === 'play') return null;
  const stale = verify.head !== null && verify.head !== head;
  let cls = 'pill--idle';
  let text = 'Physics check';
  if (verify.status === 'running') {
    cls = 'pill--running';
    text = 'Checking physics…';
  } else if (verify.status === 'passed') {
    cls = stale ? 'pill--idle' : 'pill--ok';
    text = stale ? 'Physics check (outdated)' : 'Physics check ✓';
  } else if (verify.status === 'failed' || verify.status === 'error') {
    cls = stale ? 'pill--idle' : 'pill--bad';
    const failing = verify.results.filter((r) => !r.passed).length;
    text = stale ? 'Physics check (outdated)' : failing > 0 ? `${failing} check${failing === 1 ? '' : 's'} failing` : 'Physics check ✗';
  }
  return (
    <button
      type="button"
      className={`pill pill--button ${cls}`}
      onClick={() => {
        const st = studio.store.getState();
        if (!st.panels.right) st.togglePanel('right');
        st.setRightTab('verify');
        void studio.runVerify();
      }}
      title="Run the world's physics tests headless"
      disabled={verify.status === 'running'}
    >
      {verify.status === 'running' ? <span className="spinner" aria-hidden="true" /> : <Icon name={verify.status === 'failed' && !stale ? 'alert' : 'shield'} size={13} />}
      {text}
    </button>
  );
});
