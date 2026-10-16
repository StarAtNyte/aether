/** True when `proof` carries a sealed bot run (cheap, no engine). */
export function carriesBotRun(proof) {
    return typeof proof === 'object' && proof !== null && 'playtest' in proof && typeof proof.playtest === 'object';
}
/** Re-simulate `world` and compare with `proof` (both untrusted). The returned check explains every step. */
export async function recheckProof(proof, world, signal, onNote) {
    const { checkProof } = await import('@aether/verifier');
    let playtest;
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
                if (out.cancelled)
                    throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
                throw new Error(out.error);
            }
            return { passed: out.report.status === 'passed' && out.report.worldHash === evidence.worldHash, detail: `${Math.round(out.report.seconds)} s of play${out.report.status === 'passed' ? '' : `; ${out.report.summary}`}` };
        };
    }
    return checkProof(proof, world, { ...(signal ? { signal } : {}), ...(playtest ? { playtest } : {}) });
}
