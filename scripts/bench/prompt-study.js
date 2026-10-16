import { isWinnableKind, playtest } from './autoplay';
import { fidelity, isDefaultFallback, recordingProvider, runAgent, structure } from './world-eval';
function playRow(r) {
    return { won: r.won, seconds: r.seconds, jumpPickups: r.jumpPickups, why: r.won ? '' : r.summary.slice(0, 320) };
}
/** Run one prompt. `provider` must be fresh (call budgets are per provider). */
export async function runPrompt(q, provider, sandbox, withPlaytest = true) {
    const run = await runAgent(q.prompt, { provider, sandbox });
    const world = run.world;
    const hasWin = isWinnableKind(world);
    const st = structure(q.kind, world, hasWin);
    const fid = fidelity(world, q.mustHave);
    let playFirst;
    let playFinal;
    if (withPlaytest && hasWin) {
        const final = await playtest(world);
        playFinal = playRow(final);
        playFirst = run.firstPass === world ? playFinal : isWinnableKind(run.firstPass) ? playRow(await playtest(run.firstPass)) : { won: false, seconds: 0, jumpPickups: 0, why: 'no win condition' };
    }
    const row = {
        id: q.id,
        kind: q.kind,
        prompt: q.prompt,
        stretch: q.stretch === true,
        flagship: q.flagship === true,
        entities: Object.keys(world.entities).length,
        worldName: world.name,
        fallback: isDefaultFallback(world),
        structureOk: st.ok,
        structureWhy: st.why,
        fidelity: Math.round(fid.score * 100) / 100,
        missing: fid.missing,
        verifyFirst: run.firstPassVerified,
        verifyFinal: run.verdicts.length > 0 ? run.verdicts[run.verdicts.length - 1] : false,
        repairTurns: run.repairs,
        calls: run.calls,
        outputTokens: run.outputTokens,
        inputTokens: run.inputTokens,
        patchesRejected: run.patchesRejected,
        ms: Math.round(run.ms),
        ...(run.error ? { error: run.error } : {}),
        hasWin,
        ...(playFirst ? { playFirst } : {}),
        ...(playFinal ? { playFinal } : {}),
    };
    return { row, world };
}
/** Convenience: run a prompt with a fresh recording wrapper around `make()`. */
export function freshProvider(make, maxCalls = Infinity) {
    return recordingProvider(make(), maxCalls);
}
