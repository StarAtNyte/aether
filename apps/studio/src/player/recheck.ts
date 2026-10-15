/**
 * Re-check a game's replay proof on this device. The replay engine
 * (`@aether/verifier`: physics, rules, hashing) is loaded only when a viewer
 * asks, so a page that never checks pays nothing for it. A proof that carries
 * the playtest bot's winning run also has the bot play the game again here
 * (in the playtest worker; the main thread when workers cannot run), so the
 * viewer sees the same bot win on their own device.
 */
import type { WorldDoc } from '@aether/core';
import type { ProofCheck } from '@aether/verifier';

/** True when `proof` carries a sealed bot run (cheap, no engine). */
export function carriesBotRun(proof: unknown): boolean {
  return typeof proof === 'object' && proof !== null && 'playtest' in proof && typeof (proof as { playtest?: unknown }).playtest === 'object';
}

/** Re-simulate `world` and compare with `proof` (both untrusted). The returned check explains every step. */
export async function recheckProof(proof: unknown, world: WorldDoc, signal?: AbortSignal, onNote?: (note: string) => void): Promise<ProofCheck> {
  const { checkProof } = await import('@aether/verifier');
  let playtest: NonNullable<Parameters<typeof checkProof>[2]>['playtest'];
  if (carriesBotRun(proof)) {
    const [{ PlaytestClient }, bot] = await Promise.all([import('../engine/playtest/client'), import('@aether/playtest')]);
    const client = new PlaytestClient({
      mainThread: async (w, o) => (o.kind === 'walkthrough' ? bot.walkthrough : bot.playtest)(w, { trace: false, ...(o.signal ? { signal: o.signal } : {}), ...(o.onProgress ? { onProgress: o.onProgress } : {}) }),
    });
    playtest = async (w, evidence, sig) => {
      onNote?.('A bot is playing it…');
      const out = await client.run(w, { kind: evidence.kind, trace: false, ...(sig ? { signal: sig } : {}), onProgress: (p) => onNote?.(p.note) });
      client.dispose();
      if (!out.ok) {
        if (out.cancelled) throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
        throw new Error(out.error);
      }
      return { passed: out.report.status === 'passed' && out.report.worldHash === evidence.worldHash, detail: `${Math.round(out.report.seconds)} s of play${out.report.status === 'passed' ? '' : `; ${out.report.summary}`}` };
    };
  }
  return checkProof(proof, world, { ...(signal ? { signal } : {}), ...(playtest ? { playtest } : {}) });
}
