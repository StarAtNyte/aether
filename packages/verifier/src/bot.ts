/**
 * Node-side glue to the playtest bot (`@aether/playtest`): play a world to
 * obtain the evidence a seal carries, and re-play a sealed run to check it.
 * Imported lazily by `aether-verify` and tests; the browser studio wires the
 * same two operations to its playtest worker instead (no import of this file).
 */
import type { WorldDoc } from '@aether/core';
import type { CheckOptions } from './check';

/** Result of {@link botEvidenceFor}. */
export interface BotRun {
  /** The bot's proof (its report, compact) for the world, whatever the verdict. */
  proof: import('@aether/playtest/proof').Proof;
  passed: boolean;
  summary: string;
}

/** Play (or, for a building, walk) `world` headless and return the bot's proof. */
export async function botEvidenceFor(world: WorldDoc, opts: { signal?: AbortSignal; budgetMs?: number } = {}): Promise<BotRun> {
  const bot = await import('@aether/playtest');
  const kind = bot.playtestKindOf(world);
  const run = kind === 'walkthrough' ? bot.walkthrough : bot.playtest;
  const report = await run(world, { trace: true, ...(opts.signal ? { signal: opts.signal } : {}), ...(opts.budgetMs !== undefined ? { budgetMs: opts.budgetMs } : {}) });
  return { proof: bot.toProof(report), passed: report.status === 'passed', summary: report.summary };
}

/** {@link CheckOptions.playtest} backed by the bot in this process. */
export const rerunBot: NonNullable<CheckOptions['playtest']> = async (world, evidence, signal) => {
  const bot = await import('@aether/playtest');
  const run = evidence.kind === 'walkthrough' ? bot.walkthrough : bot.playtest;
  const report = await run(world, { trace: false, ...(signal ? { signal } : {}) });
  const same = report.worldHash === evidence.worldHash;
  return { passed: report.status === 'passed' && same, detail: report.status === 'passed' && !same ? 'the gameplay content differs' : `${Math.round(report.seconds)} s of play`.concat(report.status === 'passed' ? '' : `; ${report.summary}`) };
};
