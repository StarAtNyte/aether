/**
 * Checking a proof: the verifier proper. Given an untrusted proof and the
 * world it claims to be about, it checks in order the proof's own integrity
 * (content hash), its signature, the engine version, the world's content
 * hash, and finally re-simulates the world and compares the outcome. Each
 * step is reported so a viewer can see exactly what was and was not checked.
 *
 * Wording is deliberate: a pass means "an independent replay reproduced the
 * claimed outcome", never "the game is correct".
 */
import { validateWorld, type WorldDoc } from '@aether/core';
import { evidenceSentence, hashWorld as botWorldHash, type Evidence } from '@aether/playtest/proof';
import { hashJson } from './hash';
import { PHYSICS_ENGINE, PROOF_LIMITS, REPLAY_ENGINE, parseProof, type Proof } from './proof';
import { claimHash, diffClaims, resimulate, type ReplaySettings } from './resimulate';
import { keyId, proofBodyHash, verifySignature, worldHash } from './seal';

/** Overall verdict of a check. */
export type ProofStatus =
  /** The replay reproduced the claimed outcome. */
  | 'verified'
  /** Integrity, signature, engine and world hash check out; the outcome was not re-simulated (`replay: false`). */
  | 'intact'
  /** The proof file was altered after sealing (its hash does not match its content). */
  | 'tampered'
  /** The signature does not match the proof. */
  | 'bad-signature'
  /** Sealed by a different replay engine / physics version: not comparable, not necessarily wrong. */
  | 'engine-mismatch'
  /** The world presented is not the world the proof was sealed for. */
  | 'world-mismatch'
  /** The replay produced a different outcome than the proof claims. */
  | 'replay-diverged'
  /** The proof cannot be re-simulated here (needs colliders it does not carry). */
  | 'unverifiable'
  /** The replay did not finish in the time available. */
  | 'inconclusive'
  /** Not a proof, or malformed / oversized. */
  | 'invalid';

/** One step of a check. */
export interface CheckStep {
  name: 'format' | 'content-hash' | 'signature' | 'engine' | 'world' | 'replay' | 'bot';
  /** `ok`, `fail`, or `skip` (not applicable / not reached). */
  result: 'ok' | 'fail' | 'skip';
  detail: string;
}

/** Outcome of {@link checkProof}. */
export interface ProofCheck {
  status: ProofStatus;
  /** True only for `verified`. */
  ok: boolean;
  /** True when verified AND the reproduced claim is that every check passed ("verified playable"). */
  playable: boolean;
  /** One honest sentence for people. */
  summary: string;
  steps: CheckStep[];
  /** Signature state: null when the proof is unsigned. */
  signature: { valid: boolean; keyId: string; publicKey: string } | null;
  /** Differences between the claim and the replay (replay-diverged only). */
  differences: string[];
  /** The proof, when it parsed. */
  proof: Proof | null;
  /** The bot's winning run sealed in the proof (null when the proof carries none). */
  playtest: Evidence | null;
  /** True when a bot re-played the game on this device and won again (see {@link CheckOptions.playtest}). */
  botReproduced: boolean;
  /** Wall time of the check (ms). */
  ms: number;
}

/** Options of {@link checkProof}. */
export interface CheckOptions {
  /** Re-simulate (default true). False checks integrity, signature, engine and world hash only. */
  replay?: boolean;
  /** Public keys (base64url) the caller trusts; a valid signature by another key is reported as unknown signer. */
  trustedKeys?: readonly string[];
  signal?: AbortSignal;
  budgetMs?: number;
  /**
   * Re-plays the game with the playtest bot (`@aether/playtest`) and reports whether it won again.
   * Injected so browsers can run it in a worker and this package does not load the bot's engine.
   * Without it a sealed bot run is checked for freshness but not re-played.
   */
  playtest?: (world: WorldDoc, evidence: Evidence, signal?: AbortSignal) => Promise<{ passed: boolean; detail?: string }>;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Wording of every status: one sentence, plain, never overclaiming. */
export function statusSummary(status: ProofStatus): string {
  switch (status) {
    case 'verified':
      return 'Replay verified: an independent re-simulation reproduced the claimed outcome. This is a deterministic replay check, not a formal proof.';
    case 'intact':
      return 'Integrity checked; the outcome was not re-simulated.';
    case 'tampered':
      return 'This proof was changed after it was sealed. Do not trust it.';
    case 'bad-signature':
      return 'The signature does not match this proof. It was altered or signed by someone else.';
    case 'engine-mismatch':
      return 'This proof was sealed by a different version of the engine, so it cannot be compared here. Seal it again with this version.';
    case 'world-mismatch':
      return 'This proof is about a different version of the world. The world changed after it was sealed.';
    case 'replay-diverged':
      return 'The replay did not reproduce the claimed outcome. The proof is wrong or the world behaves differently here.';
    case 'unverifiable':
      return 'This proof cannot be re-simulated here because it does not carry all the shapes the world needs. Its integrity was checked, but its outcome was not.';
    case 'inconclusive':
      return 'The replay ran out of time before it reached a verdict. Try again on a faster device.';
    case 'invalid':
      return 'This is not a valid Aether proof.';
  }
}

function base(status: ProofStatus, steps: CheckStep[], t0: number, extra: Partial<ProofCheck> = {}): ProofCheck {
  const merged: ProofCheck = { status, ok: status === 'verified', playable: false, summary: statusSummary(status), steps, signature: null, differences: [], proof: null, playtest: null, botReproduced: false, ms: Math.round(now() - t0), ...extra };
  merged.playable = status === 'verified' && merged.proof?.claim.passed === true;
  if (status === 'verified' && !merged.playable) merged.summary = 'Replay verified: an independent re-simulation reproduced the claimed outcome, which is that some checks FAIL. Not a playable seal.';
  return merged;
}

const SKIP = (name: CheckStep['name'], detail: string): CheckStep => ({ name, result: 'skip', detail });

/**
 * Check `proofValue` (untrusted) against `world` (untrusted). Never throws;
 * a world that cannot be validated is reported as a world mismatch.
 */
export async function checkProof(proofValue: unknown, world: WorldDoc | unknown, opts: CheckOptions = {}): Promise<ProofCheck> {
  const t0 = now();
  const steps: CheckStep[] = [];
  const parsed = parseProof(proofValue);
  if (!parsed.ok) {
    steps.push({ name: 'format', result: 'fail', detail: parsed.error });
    return base('invalid', steps, t0);
  }
  const proof = parsed.proof;
  steps.push({ name: 'format', result: 'ok', detail: `aether-proof v${proof.v}` });
  const fail = (status: ProofStatus, rest: CheckStep[], extra: Partial<ProofCheck> = {}): ProofCheck => base(status, [...steps, ...rest], t0, { proof, playtest: proof.playtest ?? null, ...extra });

  // 1. Content hash: the proof is exactly what was sealed (and internally consistent).
  let internal = true;
  let why = '';
  try {
    if (proofBodyHash(proof) !== proof.hash) {
      internal = false;
      why = 'the content hash does not match the proof body';
    } else if (claimHash(proof.claim) !== proof.claim.hash) {
      internal = false;
      why = 'the claim hash does not match the claim';
    } else if (proof.colliders.mode === 'embedded' && hashJson(proof.colliders.entries ?? []) !== proof.colliders.hash) {
      internal = false;
      why = 'the embedded colliders do not match their hash';
    }
  } catch {
    internal = false;
    why = 'the proof could not be hashed';
  }
  if (!internal) return fail('tampered', [{ name: 'content-hash', result: 'fail', detail: why }, SKIP('signature', 'not checked'), SKIP('engine', 'not checked'), SKIP('world', 'not checked'), SKIP('replay', 'not run')]);
  steps.push({ name: 'content-hash', result: 'ok', detail: proof.hash });

  // 2. Signature (optional).
  let signature: ProofCheck['signature'] = null;
  if (proof.signature) {
    const valid = await verifySignature(proof);
    signature = { valid, keyId: keyId(proof.signature.publicKey), publicKey: proof.signature.publicKey };
    if (!valid) return fail('bad-signature', [{ name: 'signature', result: 'fail', detail: `Ed25519 signature by key ${signature.keyId} does not verify` }, SKIP('engine', 'not checked'), SKIP('world', 'not checked'), SKIP('replay', 'not run')], { signature });
    const trusted = opts.trustedKeys ? opts.trustedKeys.includes(proof.signature.publicKey) : null;
    steps.push({ name: 'signature', result: 'ok', detail: `valid Ed25519 signature, key ${signature.keyId}${trusted === null ? '' : trusted ? ' (trusted)' : ' (not in your trusted keys)'}` });
  } else {
    steps.push({ name: 'signature', result: 'skip', detail: 'unsigned (integrity only; anyone could have produced this proof)' });
  }

  // 3. Engine version.
  if (proof.engine.replay !== REPLAY_ENGINE || proof.engine.physics !== PHYSICS_ENGINE) {
    return fail('engine-mismatch', [{ name: 'engine', result: 'fail', detail: `proof: ${proof.engine.replay} / ${proof.engine.physics}; this verifier: ${REPLAY_ENGINE} / ${PHYSICS_ENGINE}` }, SKIP('world', 'not checked'), SKIP('replay', 'not run')], { signature });
  }
  steps.push({ name: 'engine', result: 'ok', detail: `${REPLAY_ENGINE} / ${PHYSICS_ENGINE}` });

  // 4. World hash.
  const v = validateWorld(world);
  let presented: string | null = null;
  if (v.ok) {
    try {
      presented = hashJson(v.world);
    } catch {
      presented = null;
    }
  }
  if (!v.ok || presented === null) return fail('world-mismatch', [{ name: 'world', result: 'fail', detail: 'the world is missing or invalid' }, SKIP('replay', 'not run')], { signature });
  if (presented !== proof.world.hash) {
    return fail('world-mismatch', [{ name: 'world', result: 'fail', detail: `proof is for ${proof.world.hash.slice(0, 19)}…, this world is ${presented.slice(0, 19)}…` }, SKIP('replay', 'not run')], { signature });
  }
  steps.push({ name: 'world', result: 'ok', detail: `${proof.world.name} · ${proof.world.entities} entities · ${proof.world.hash.slice(0, 19)}…` });

  if (opts.replay === false) return base('intact', [...steps, SKIP('replay', 'skipped on request'), ...(proof.playtest ? [SKIP('bot', 'skipped on request')] : [])], t0, { proof, playtest: proof.playtest ?? null, signature });
  if (proof.colliders.mode === 'external') {
    return fail('unverifiable', [{ name: 'replay', result: 'skip', detail: 'the world needs renderer shapes the proof does not carry' }], { signature });
  }

  // 5. Replay.
  const settings: ReplaySettings = { maxSeconds: Math.min(PROOF_LIMITS.MAX_SECONDS, proof.replay.maxSeconds), traceHz: proof.replay.traceHz };
  let fresh;
  try {
    fresh = await resimulate(v.world, {
      settings,
      ...(proof.colliders.mode === 'embedded' && proof.colliders.entries ? { colliders: proof.colliders.entries } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
      ...(opts.budgetMs !== undefined ? { budgetMs: opts.budgetMs } : {}),
    });
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    return fail(aborted ? 'inconclusive' : 'replay-diverged', [{ name: 'replay', result: 'fail', detail: aborted ? 'cancelled' : `the replay failed: ${e instanceof Error ? e.message.slice(0, 200) : 'error'}` }], { signature });
  }
  if (fresh.inconclusive) return fail('inconclusive', [{ name: 'replay', result: 'fail', detail: 'wall-clock budget exhausted before the horizon' }], { signature });
  const differences = diffClaims(proof, fresh);
  if (differences.length > 0) return fail('replay-diverged', [{ name: 'replay', result: 'fail', detail: differences[0] as string }], { signature, differences });
  const passedTests = fresh.claim.tests.filter((t) => t.passed).length;
  steps.push({ name: 'replay', result: 'ok', detail: `${passedTests}/${fresh.claim.tests.length} checks ${fresh.claim.passed ? 'passed' : 'as claimed'} over ${fresh.claim.simulatedSeconds}s of simulation${fresh.trace ? `, ${fresh.trace.bodies} moving bodies matched to 1 mm` : ''}` });

  // 6. The bot's sealed winning run (only when the proof carries one).
  const ev = proof.playtest;
  let botReproduced = false;
  if (ev) {
    if (ev.worldHash !== botWorldHash(v.world)) {
      return fail('replay-diverged', [{ name: 'bot', result: 'fail', detail: "the bot's run was recorded for another version of the gameplay" }], { signature, differences: ["the bot's run was recorded for another version of the gameplay"] });
    }
    if (opts.playtest) {
      try {
        const again = await opts.playtest(v.world, ev, opts.signal);
        if (!again.passed) {
          const why = `the bot could not win it again${again.detail ? `: ${again.detail.slice(0, 200)}` : ''}`;
          return fail('replay-diverged', [{ name: 'bot', result: 'fail', detail: why }], { signature, differences: [why] });
        }
        botReproduced = true;
        steps.push({ name: 'bot', result: 'ok', detail: `a bot played it to the win again on this device${again.detail ? ` (${again.detail.slice(0, 120)})` : ''}` });
      } catch (e) {
        const aborted = e instanceof Error && e.name === 'AbortError';
        return fail(aborted ? 'inconclusive' : 'replay-diverged', [{ name: 'bot', result: 'fail', detail: aborted ? 'cancelled' : `the bot could not run: ${e instanceof Error ? e.message.slice(0, 160) : 'error'}` }], { signature });
      }
    } else {
      steps.push({ name: 'bot', result: 'skip', detail: `${evidenceSentence(ev)} Recorded in the seal; not re-played in this check.` });
    }
  }
  return base('verified', steps, t0, { proof, playtest: ev ?? null, botReproduced, signature });
}

/** The recorded claim in one line, for display next to a status. */
export function describeClaim(proof: Proof): string {
  const tests = proof.claim.tests;
  const ok = tests.filter((t) => t.passed).length;
  const head = proof.claim.passed ? 'Sealed as playable' : 'Sealed with failing checks';
  return `${head}: ${tests.length === 0 ? 'settles cleanly' : `${ok} of ${tests.length} checks`} over ${proof.claim.simulatedSeconds.toFixed(1)} s`;
}
