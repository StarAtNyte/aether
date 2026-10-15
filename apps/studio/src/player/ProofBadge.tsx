/**
 * The "verified playable" badge of the player's title screen. A game that
 * carries a replay proof shows "Sealed playable" (the author's claim) with a
 * "Check it yourself" button; the check re-simulates the world on this
 * device (`@aether/verifier`, loaded only on click) and the badge then shows
 * what that replay found: verified, altered, out of date or not
 * reproducible. Wording never claims more than a deterministic replay check.
 *
 * When the seal carries the playtest bot's winning run, the same badge says
 * so in one sentence, offers "Watch the bot's run" (a ghost player over the
 * real world with pause, scrub and speed) and the check also has the bot play
 * the game again on this device. One proof, one badge.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { WorldDoc } from '@aether/core';
import { BADGES, PROOF_DISCLAIMER, badgeFor, type BadgeState } from '@aether/verifier/format';
import type { ProofCheck } from '@aether/verifier';
import { EvidenceWire, evidenceSentence, evidenceTrace, hashWorld, type Evidence } from '@aether/playtest/proof';
import type { Simulation } from '../engine/Simulation';
import { clock, nextSpeed } from '../lib/playtestView';
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

/** The bot's sealed run when the proof carries a well-formed one (cheap, no engine). Pure. */
export function botEvidence(proof: unknown): Evidence | null {
  if (typeof proof !== 'object' || proof === null) return null;
  const r = EvidenceWire.safeParse((proof as { playtest?: unknown }).playtest);
  return r.success ? r.data : null;
}

/** Test / debug handle of the last check. */
declare global {
  interface Window {
    __aetherProof?: { state: BadgeState; status: string | null };
  }
}

/** The badge (renders nothing when the game carries no proof). */
export const ProofBadge = memo(function ProofBadge({ proof, world, sim = null }: { proof: unknown; world: WorldDoc; sim?: Simulation | null }): ReactElement | null {
  const [state, setState] = useState<BadgeState>('sealed');
  const [check, setCheck] = useState<ProofCheck | null>(null);
  const abort = useRef<AbortController | null>(null);
  const [note, setNote] = useState('');
  const [ghost, setGhost] = useState<{ playing: boolean; time: number; length: number; speed: number } | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  const evidence = useMemo(() => botEvidence(proof), [proof]);
  /** The sealed bot run describes the gameplay of exactly this world (a stale one is not offered for replay). */
  const evidenceFresh = useMemo(() => (evidence ? hashWorld(world) === evidence.worldHash : false), [evidence, world]);
  useEffect(
    () => () => {
      abort.current?.abort();
      if (poll.current !== null) clearInterval(poll.current);
      sim?.renderer.stopGhost();
    },
    [sim],
  );
  useEffect(() => {
    window.__aetherProof = { state, status: check?.status ?? null };
  }, [state, check]);
  const run = useCallback(async () => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setState('checking');
    try {
      const c = await recheckProof(proof, world, ctrl.signal, setNote);
      if (ctrl.signal.aborted) return;
      setCheck(c);
      setState(stateOfCheck(c));
    } catch {
      if (!ctrl.signal.aborted) setState('failed');
    }
  }, [proof, world]);
  const refresh = (): void => {
    const g = sim?.renderer.ghostState;
    if (!g || !g.active) {
      setGhost(null);
      if (poll.current !== null) clearInterval(poll.current);
      poll.current = null;
      return;
    }
    setGhost({ playing: g.playing, time: g.time, length: g.length, speed: g.speed });
  };
  const watch = (): void => {
    const trace = evidence ? evidenceTrace(evidence) : null;
    if (!sim || !trace) return;
    sim.renderer.stopTour();
    const lo: [number, number, number] = [Infinity, Infinity, Infinity];
    const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < trace.frames; i++) {
      for (let k = 0; k < 3; k++) {
        const v = trace.poses[i * 4 + k] as number;
        lo[k] = Math.min(lo[k] as number, v);
        hi[k] = Math.max(hi[k] as number, v);
      }
    }
    sim.renderer.frameSphere([(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2 + 0.8, (lo[2] + hi[2]) / 2], Math.max(4, Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) * 0.45), [0.55, 0.85, 0.75], 0.9);
    if (sim.renderer.startGhost(trace, { autoplay: true, speed: 1, onEnd: refresh })) {
      refresh();
      if (poll.current === null) poll.current = setInterval(refresh, 100);
    }
  };
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
        {check ? check.summary : state === 'checking' ? (note ? `${note}…` : 'Re-simulating the world on this device…') : `${text.detail.split('. ')[0]}. ${PROOF_DISCLAIMER}`}
      </p>
      {evidence && (
        <div className="pl-bot" data-testid="bot-evidence" data-fresh={evidenceFresh ? 'true' : 'false'} data-reproduced={check?.botReproduced ? 'true' : 'false'}>
          <p className="pl-bot__line" data-testid="bot-line">
            {evidenceFresh ? evidenceSentence(evidence) : 'The bot\'s run was recorded for an earlier version of this game.'}
            {check?.botReproduced ? ' Re-played on this device: it won again.' : ''}
          </p>
          {evidence.trace && evidenceFresh && !ghost && (
            <button type="button" className="pl-btn pl-btn--small" onClick={watch} data-testid="bot-watch">
              Watch the bot's run
            </button>
          )}
          {ghost && (
            <div className="pl-bot__replay" role="group" aria-label="Replay controls" data-testid="bot-replay">
              <button type="button" className="pl-btn pl-btn--small" onClick={() => (ghost.playing ? sim?.renderer.pauseGhost() : sim?.renderer.playGhost())} aria-label={ghost.playing ? 'Pause' : 'Play'}>
                {ghost.playing ? '❚❚' : '▶'}
              </button>
              <input
                type="range"
                min={0}
                max={Math.max(0.01, ghost.length)}
                step={0.05}
                value={ghost.time}
                aria-label="Scrub the replay"
                onChange={(e) => {
                  sim?.renderer.pauseGhost();
                  sim?.renderer.seekGhost(Number(e.currentTarget.value));
                  refresh();
                }}
              />
              <span className="pl-bot__time">
                {clock(ghost.time)} / {clock(ghost.length)}
              </span>
              <button type="button" className="pl-btn pl-btn--small" onClick={() => sim?.renderer.setGhostSpeed(nextSpeed(ghost.speed))} aria-label="Change speed">
                {ghost.speed}×
              </button>
              <button type="button" className="pl-btn pl-btn--small" onClick={() => { sim?.renderer.stopGhost(); refresh(); }} aria-label="Close the replay">
                ✕
              </button>
            </div>
          )}
        </div>
      )}
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
