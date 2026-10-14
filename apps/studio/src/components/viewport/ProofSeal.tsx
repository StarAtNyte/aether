/**
 * The proof seal: after a verification run, a small stamp settles over the
 * top of the viewport — a ring that draws itself closed around a check
 * ("Proved", n of n checks, seconds simulated) — while the ghost replay of
 * the run plays in the world. A failed run gets a quieter chip that points
 * at the Checks panel. It dismisses itself; "Replay" plays the motion again.
 * Announced to screen readers through a polite live region.
 */
import { memo, useEffect, type ReactElement } from 'react';
import { useStudio, useUI } from '../../app/context';
import { Icon } from '../Icon';

/** Seconds the seal stays before it dismisses itself. */
export const SEAL_SECONDS = 6;

/** One-line summary of a seal (also the live-region text). Pure. */
export function sealText(seal: { passed: boolean; tests: number; passedTests: number; seconds: number }): { title: string; detail: string } {
  const sim = seal.seconds > 0 ? ` · ${seal.seconds.toFixed(1)} s simulated` : '';
  if (seal.passed) {
    const checks = seal.tests === 0 ? 'Settles cleanly' : `${seal.passedTests} of ${seal.tests} check${seal.tests === 1 ? '' : 's'}`;
    return { title: 'Proved', detail: `${checks}${sim}` };
  }
  const failed = Math.max(0, seal.tests - seal.passedTests);
  return { title: 'Not proved yet', detail: `${failed > 0 ? `${failed} of ${seal.tests} check${seal.tests === 1 ? '' : 's'} failed` : 'Physics problems found'}${sim}` };
}

/** The seal (renders nothing when there is none). */
export const ProofSeal = memo(function ProofSeal(): ReactElement | null {
  const studio = useStudio();
  const seal = useUI((s) => s.proofSeal);
  const playing = useUI((s) => s.mode === 'play');
  const id = seal?.id ?? 0;
  useEffect(() => {
    if (id === 0) return;
    let t: ReturnType<typeof setTimeout>;
    // Stays while its replay runs, then dismisses itself.
    const expire = (): void => {
      if (studio.simulation?.renderer.proofActive) {
        t = setTimeout(expire, 1000);
        return;
      }
      const cur = studio.store.getState().proofSeal;
      if (cur?.id === id) studio.store.getState().setProofSeal(null);
    };
    t = setTimeout(expire, SEAL_SECONDS * 1000);
    return () => clearTimeout(t);
  }, [id, studio]);
  if (!seal || playing) return null;
  const { title, detail } = sealText(seal);
  return (
    <div key={seal.id} className={`proof-seal${seal.passed ? ' is-passed' : ' is-failed'}`} role="status" aria-live="polite">
      <span className="proof-seal__mark" aria-hidden="true">
        {seal.passed ? (
          <svg viewBox="0 0 40 40" width="40" height="40" focusable="false">
            <circle className="proof-seal__ring" cx="20" cy="20" r="17" pathLength="1" />
            <circle className="proof-seal__ticks" cx="20" cy="20" r="13.5" pathLength="1" />
            <path className="proof-seal__check" d="M13 20.5l5 5 9-10" pathLength="1" />
          </svg>
        ) : (
          <Icon name="alert" size={18} />
        )}
      </span>
      <span className="proof-seal__text">
        <span className="proof-seal__title">{title}</span>
        <span className="proof-seal__detail">{detail}</span>
      </span>
      {seal.passed && seal.replay ? (
        <button type="button" className="proof-seal__btn" onClick={() => void studio.presentProof()} aria-label="Replay the physics proof" data-tip="Replay the proof">
          <Icon name="refresh" />
        </button>
      ) : !seal.passed ? (
        <button type="button" className="proof-seal__btn proof-seal__btn--text" onClick={() => studio.store.getState().showLeftView('verify')}>
          Details
        </button>
      ) : null}
      <button type="button" className="proof-seal__btn" onClick={() => studio.dismissProof()} aria-label="Dismiss the proof seal">
        <Icon name="x" />
      </button>
    </div>
  );
});
