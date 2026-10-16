/** Play (or, for a building, walk) `world` headless and return the bot's proof. */
export async function botEvidenceFor(world, opts = {}) {
    const bot = await import('@aether/playtest');
    const kind = bot.playtestKindOf(world);
    const run = kind === 'walkthrough' ? bot.walkthrough : bot.playtest;
    const report = await run(world, { trace: true, ...(opts.signal ? { signal: opts.signal } : {}), ...(opts.budgetMs !== undefined ? { budgetMs: opts.budgetMs } : {}) });
    return { proof: bot.toProof(report), passed: report.status === 'passed', summary: report.summary };
}
/** {@link CheckOptions.playtest} backed by the bot in this process. */
export const rerunBot = async (world, evidence, signal) => {
    const bot = await import('@aether/playtest');
    const run = evidence.kind === 'walkthrough' ? bot.walkthrough : bot.playtest;
    const report = await run(world, { trace: false, ...(signal ? { signal } : {}) });
    const same = report.worldHash === evidence.worldHash;
    return { passed: report.status === 'passed' && same, detail: report.status === 'passed' && !same ? 'the gameplay content differs' : `${Math.round(report.seconds)} s of play`.concat(report.status === 'passed' ? '' : `; ${report.summary}`) };
};
