/**
 * The "verified playable" badge of the player's title screen. A game that
 * carries a replay proof shows "Sealed playable" (the author's claim) with a
 * "Check it yourself" button; the check re-simulates the world on this
 * device (`@aether/verifier`, loaded only on click) and the badge then shows
 * what that replay found: verified, altered, out of date or not
 * reproducible. Wording never claims more than a deterministic replay check.
 */
import { memo, useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import type { WorldDoc } from '@aether/core';
import { BADGES, PROOF_DISCLAIMER, badgeFor, type BadgeState } from '@aether/verifier/format';
import type { ProofCheck } from '@aether/verifier';
import { recheckProof } from './recheck';

/** What the badge needs to know about a proof before checking it (cheap, no engine). Pure. */
export function claimedPlayable(proof: unknown): boolean {
  if (typeof proof !== 'object' || proof === null) return false;
  const claim = (proof as { claim?: unknown }).claim;
  return typeof claim === 'object' && claim !== null && (claim as { passed?: unknown }).passed === true;
}

/** Badge state from a finished check. Pure. */
export function stateOfCheck(check: ProofCheck): BadgeState {
  return badgeFor(check.status, check.playable);
}

/** Test / debug handle of the last check. */
declare global {
  interface Window {
    __aetherProof?: { state: BadgeState; status: string | null };
  }
}

/** The badge (renders nothing when the game carries no proof). */
export const ProofBadge = memo(function ProofBadge({ proof, world }: { proof: unknown; world: WorldDoc }): ReactElement | null {
  const [state, setState] = useState<BadgeState>('sealed');
  const [check, setCheck] = useState<ProofCheck | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    window.__aetherProof = { state, status: check?.status ?? null };
  }, [state, check]);
  const run = useCallback(async () => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setState('checking');
    try {
      const c = await recheckProof(proof, world, ctrl.signal);
      if (ctrl.signal.aborted) return;
      setCheck(c);
      setState(stateOfCheck(c));
    } catch {
      if (!ctrl.signal.aborted) setState('failed');
    }
  }, [proof, world]);
  if (proof === undefined || proof === null) return null;
  const shown = claimedPlayable(proof) || state !== 'sealed' ? state : 'none';
  const text = BADGES[shown];
  return (
    <div className={`pl-proof pl-proof--${text.tone}`} data-testid="proof-badge" data-state={shown} role="group" aria-label="Verification seal">
      <span className="pl-proof__dot" aria-hidden="true" />
      <span className="pl-proof__label" title={text.detail}>
        {text.label}
      </span>
      <button type="button" className="pl-proof__btn" onClick={() => void run()} disabled={state === 'checking'} data-testid="proof-check">
        {state === 'checking' ? 'Checking…' : check ? 'Check again' : 'Check it yourself'}
      </button>
      <p className="pl-proof__detail" role="status" aria-live="polite" data-testid="proof-detail">
        {check ? check.summary : state === 'checking' ? 'Re-simulating the world on this device…' : `${text.detail.split('. ')[0]}. ${PROOF_DISCLAIMER}`}
      </p>
      {check && (
        <details className="pl-proof__steps">
          <summary>What was checked</summary>
          <ul>
            {check.steps.map((s) => (
              <li key={s.name} data-result={s.result}>
                <b>{s.name}</b> {s.detail}
              </li>
            ))}
            {check.differences.slice(0, 5).map((d) => (
              <li key={d} data-result="fail">
                {d}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
});
