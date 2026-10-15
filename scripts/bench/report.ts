/**
 * Markdown rendering of benchmark results and the splice that keeps the
 * results section of docs/BENCHMARK.md in sync with docs/benchmark/results.json.
 */
import type { ArmSummary, CoverageSlice } from './aggregate';
import { formatRate, type Rate } from './metrics';
import type { BenchResults } from './run';

/** Markers around the generated section of docs/BENCHMARK.md. */
export const RESULTS_START = '<!-- bench:results:start -->';
export const RESULTS_END = '<!-- bench:results:end -->';

/** Replace the generated section of `doc` with `section` (the markers are kept; appended if absent). */
export function spliceResults(doc: string, section: string): string {
  const a = doc.indexOf(RESULTS_START);
  const b = doc.indexOf(RESULTS_END);
  const block = `${RESULTS_START}\n${section.trim()}\n${RESULTS_END}`;
  if (a < 0 || b < a) return `${doc.trimEnd()}\n\n${block}\n`;
  return `${doc.slice(0, a)}${block}${doc.slice(b + RESULTS_END.length)}`;
}

/**
 * JSON for a committed results file: the first two levels are indented, every
 * deeper value (a row) sits on one line, so the file stays small and diffs
 * show one changed row per line.
 */
export function compactJson(value: unknown, depth = 0): string {
  const pad = (n: number): string => ' '.repeat(n);
  if (depth >= 2 || value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return `[\n${value.map((v) => `${pad((depth + 1) * 1)}${compactJson(v, depth + 1)}`).join(',\n')}\n${pad(depth)}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return '{}';
  return `{\n${entries.map(([k, v]) => `${pad((depth + 1) * 1)}${JSON.stringify(k)}: ${compactJson(v, depth + 1)}`).join(',\n')}\n${pad(depth)}}`;
}

const pct = (r: Rate): string => (r.n === 0 ? 'n/a' : `${(r.rate * 100).toFixed(0)}%`);
const cell = (r: Rate): string => (r.n === 0 ? 'n/a' : `${r.k}/${r.n} (${pct(r)})`);
const table = (head: readonly string[], rows: ReadonlyArray<ReadonlyArray<string | number>>): string =>
  [`| ${head.join(' | ')} |`, `| ${head.map((_, i) => (i === 0 ? '---' : '---:')).join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');

function armRows(o: ArmSummary, f: ArmSummary, a: ArmSummary): Array<Array<string | number>> {
  return [
    ['Asked change fully made', cell(a.satisfied), cell(o.satisfied), cell(f.satisfied)],
    ['Mean share of the request done', a.completionMean, o.completionMean, f.completionMean],
    ['Edits with unrequested changes', cell(a.withCollateral), 'none by assumption', cell(f.withCollateral)],
    ['Unrequested properties changed, mean (median)', `${a.collateralLeavesMean} (${a.collateralLeavesMedian})`, '0', `${f.collateralLeavesMean} (${f.collateralLeavesMedian})`],
    ['Verification regressions', cell(a.verifyRegressions), cell(o.verifyRegressions), cell(f.verifyRegressions)],
    ['Playability regressions (games)', cell(a.playRegressions), cell(o.playRegressions), cell(f.playRegressions)],
    ['Model output tokens, median (p90)', `${a.outputTokensMedian} (${a.outputTokensP90})`, `${o.outputTokensMedian} (${o.outputTokensP90})`, `${f.outputTokensMedian} (${f.outputTokensP90})`],
    ['Model input tokens, median', a.inputTokensMedian, o.inputTokensMedian, f.inputTokensMedian],
    ['Patch operations, median', a.patchOpsMedian, o.patchOpsMedian, f.patchOpsMedian],
    ['Entities rewritten, median', a.entitiesTouchedMedian, o.entitiesTouchedMedian, f.entitiesTouchedMedian],
    ['Local compute ms, median (p90)', `${a.localMsMedian} (${a.localMsP90})`, `${o.localMsMedian} (${o.localMsP90})`, `${f.localMsMedian} (${f.localMsP90})`],
    ['Projected latency ms at the assumed model speed, median', a.projectedMsMedian, o.projectedMsMedian, f.projectedMsMedian],
  ];
}

function sliceRow(name: string, s: CoverageSlice): Array<string | number> {
  return [name, s.prompts, cell(s.structure), cell(s.fullFidelity), s.fidelityMean.toFixed(2), cell(s.fallback), cell(s.success)];
}

/** Render the results as Markdown. `headlineOnly` prints a short summary (CI). */
export function renderMarkdown(r: BenchResults, opts: { headlineOnly?: boolean } = {}): string {
  const out: string[] = [];
  const w = r.winnability;
  const e = r.edits.summary;
  const s = r.speed.summary;
  const cov = r.coverage;

  out.push(`### Results (${r.mode} run, ${r.prompts.length} prompts, ${e.edits} edits on ${e.bases} worlds, Node ${r.machine.node}, ${r.machine.cpus} cores)`);
  out.push('');

  const rpr = r.repair;
  out.push('**Headline**');
  out.push('');
  out.push(`- Games: a bot wins ${cell(w.inVocabulary.botWonFinal)} of the generated games the planner knows how to make, and ${cell(w.stretch.botWonFinal)} of those outside its vocabulary.`);
  out.push(`- Self-repair: on deliberately broken worlds the loop repaired ${cell(rpr.physicsFaults.verifyOnly.repaired)} physics faults from the test report alone, but ${cell(rpr.winFaults.verifyOnly.repaired)} winnability faults (no test fails); with a playtest in the loop ${cell(rpr.winFaults.withPlaytest.repaired)}.`);
  out.push(`- Edits: Aether made ${cell(e.aether.satisfied)} of the requested edits with a median ${e.aether.outputTokensMedian}-token patch, against ${e.regenOracle.outputTokensMedian} tokens to re-emit the whole world (${e.tokenRatioMedian}x); it changed something unrequested in ${cell(e.aether.withCollateral)} edits, a fresh regeneration in ${cell(e.regenFresh.withCollateral)}.`);
  out.push(`- Where it loses: ${e.aetherMisses} edits not completed, ${e.aether.verifyRegressions.k} that broke a passing verification, ${e.aether.playRegressions.k} that made a winnable game unwinnable.`);
  out.push(`- Speed: the physics proof runs at a median ${s.verifyRealtimeMedian}x real time (slowest ${s.verifyRealtimeMin}x); a fork costs ${s.forkMsMedian} ms and replays exactly (max drift ${s.forkDriftMax} m).`);
  out.push(`- Planner: ${cell(cov.inVocabulary.success)} in-vocabulary prompts come out fully right and verified; ${cell(cov.stretch.success)} of the prompts outside its vocabulary do.`);
  out.push('');

  // 1 -------------------------------------------------------------------------------------------------------------------
  out.push('#### 1. Can a bot win the generated games?');
  out.push('');
  out.push(
    table(
      ['Prompts', 'Games', 'Has a win condition', 'Bot wins, first version', 'Bot wins, after the loop'],
      [
        ['In the planner\'s vocabulary', w.inVocabulary.gamePrompts, cell(w.inVocabulary.withWinCondition), cell(w.inVocabulary.botWonFirst), cell(w.inVocabulary.botWonFinal)],
        ['Outside it (stretch)', w.stretch.gamePrompts, cell(w.stretch.withWinCondition), cell(w.stretch.botWonFirst), cell(w.stretch.botWonFinal)],
        ['Named flagships (template recall)', w.flagship.gamePrompts, cell(w.flagship.withWinCondition), cell(w.flagship.botWonFirst), cell(w.flagship.botWonFinal)],
      ],
    ),
  );
  out.push('');
  out.push(`In-vocabulary games the bot wins: median ${w.inVocabulary.medianWinSeconds} simulated seconds; ${w.inVocabulary.hopGames} of them ${w.inVocabulary.hopGames === 1 ? 'has' : 'have'} pickups a walking player misses unless they jump.`);
  out.push('');
  const rp = r.repair;
  out.push('Self-repair, on worlds that were deliberately broken (scripted model, oracle repairer: a ceiling, not a model score):');
  out.push('');
  out.push(
    table(
      ['Fault family', 'Faults that broke the world', 'Verify only: noticed', 'Verify only: repaired', 'Verify + playtest: noticed', 'Verify + playtest: repaired'],
      [
        ['Physics (a test fails)', rp.physicsFaults.verifyOnly.effective, cell(rp.physicsFaults.verifyOnly.detected), cell(rp.physicsFaults.verifyOnly.repaired), cell(rp.physicsFaults.withPlaytest.detected), cell(rp.physicsFaults.withPlaytest.repaired)],
        ['Winnability (no test fails)', rp.winFaults.verifyOnly.effective, cell(rp.winFaults.verifyOnly.detected), cell(rp.winFaults.verifyOnly.repaired), cell(rp.winFaults.withPlaytest.detected), cell(rp.winFaults.withPlaytest.repaired)],
        ['All', rp.verifyOnly.effective, cell(rp.verifyOnly.detected), cell(rp.verifyOnly.repaired), cell(rp.withPlaytest.detected), cell(rp.withPlaytest.repaired)],
      ],
    ),
  );
  out.push('');
  const lostGames = r.prompts.filter((p) => p.kind === 'game' && !p.stretch && !p.flagship && p.playFinal?.won !== true);
  if (lostGames.length > 0) {
    out.push('In-vocabulary games the bot did not win:');
    out.push('');
    for (const p of lostGames) out.push(`- ${p.id} "${p.prompt}": ${p.hasWin ? (p.playFinal?.why ?? 'bot lost') : 'no win condition in the world'}`);
    out.push('');
  }

  // 2 -------------------------------------------------------------------------------------------------------------------
  out.push('#### 2. Edit versus regenerate');
  out.push('');
  out.push(table(['', 'Aether patch', 'Regenerate, perfect copy (best case)', 'Regenerate, fresh sample'], armRows(e.regenOracle, e.regenFresh, e.aether)));
  out.push('');
  out.push(`Over the edits Aether completed, re-emitting the whole document costs a median ${e.tokenRatioMedian}x the output tokens of the patch and the model must read ${e.inputRatioMedian}x more input.`);
  out.push('');
  if (!opts.headlineOnly) {
    out.push(table(['Edit kind', 'Edits', 'Aether made the change', 'Fresh regeneration made it', 'Aether unrequested changes', 'Fresh regeneration unrequested changes'], e.byKind.map((k) => [k.kind, k.edits, k.aetherSatisfied, k.freshSatisfied, k.aetherCollateral, k.freshCollateral])));
    out.push('');
    const misses = r.edits.rows.filter((x) => !x.aether.satisfied);
    out.push(`Where Aether loses (${misses.length} edits it did not complete, ${e.freshBeatsAether} of which fresh regeneration did):`);
    out.push('');
    for (const m of misses.slice(0, 20)) {
      const done = Math.round(m.aether.collateral.completion * 100);
      const extra = m.aether.collateral.examples.length > 0 ? `; also changed ${m.aether.collateral.examples.join(', ')}` : '';
      out.push(`- ${m.case.baseId}: "${m.case.request}" (${done}% of the request done${extra}${m.regenFresh.satisfied ? '; fresh regeneration did it' : ''})`);
    }
    if (misses.length > 20) out.push(`- ... and ${misses.length - 20} more (see results.json)`);
    out.push('');
    const regress = r.edits.rows.filter((x) => x.aether.verifyRegression || x.aether.playRegression);
    out.push(`Edits that broke something that worked (${regress.length}):`);
    out.push('');
    for (const m of regress) out.push(`- ${m.case.baseId}: "${m.case.request}"${m.aether.verifyRegression ? ' broke verification' : ''}${m.aether.playRegression ? ' made the game unwinnable' : ''}`);
    if (regress.length === 0) out.push('- none');
    out.push('');
    const messy = r.edits.rows.filter((x) => x.aether.collateral.collateralLeaves > 0);
    out.push(`Edits with unrequested property changes (${messy.length}):`);
    out.push('');
    for (const m of messy.slice(0, 12)) out.push(`- ${m.case.baseId}: "${m.case.request}": ${m.aether.collateral.collateralLeaves} (${m.aether.collateral.examples.join(', ')})`);
    if (messy.length === 0) out.push('- none');
    out.push('');
  }

  // 3 -------------------------------------------------------------------------------------------------------------------
  out.push('#### 3. Verification speed');
  out.push('');
  out.push(
    table(
      ['Measure (sampled worlds: ' + s.worlds + ')', 'Median', 'Worst / p90'],
      [
        ['Full proof (diagnostics, tests, rules), ms', s.verifyMsMedian, `p90 ${s.verifyMsP90}`],
        [`Proof speed, simulated seconds per wall second (${s.worldsTimed} worlds with simulated time)`, `${s.verifyRealtimeMedian}x`, `min ${s.verifyRealtimeMin}x`],
        ['Plain physics stepping, simulated seconds per wall second', `${s.stepRealtimeMedian}x`, `min ${s.stepRealtimeMin}x`],
        ['Create a physics world from the document, ms', s.createMsMedian, ''],
        ['Fork a running world (snapshot + restore), ms', s.forkMsMedian, `p90 ${s.forkMsP90}`],
        ['Forks per second', s.forksPerSecondMedian, ''],
        ['Snapshot size, KiB', s.snapshotKbMedian, ''],
        ['Fork replay drift after 5 s, metres', '', `max ${s.forkDriftMax}`],
      ],
    ),
  );
  out.push('');

  // 4 -------------------------------------------------------------------------------------------------------------------
  out.push('#### 4. Offline planner coverage');
  out.push('');
  out.push(table(['Slice', 'Prompts', 'Right kind of world', 'Every expected word present', 'Mean word coverage', 'Fell back to the default meadow', 'Fully right and verified'], [sliceRow('All prompts', cov.all), sliceRow('In vocabulary', cov.inVocabulary), sliceRow('Stretch (outside it)', cov.stretch), sliceRow('Named flagships', cov.flagship)]));
  out.push('');
  if (!opts.headlineOnly) {
    out.push(table(['Kind (flagships excluded)', 'Prompts', 'Right kind of world', 'Every expected word present', 'Mean word coverage', 'Fell back to the default meadow', 'Fully right and verified'], cov.byKind.map((k) => sliceRow(k.kind, k.slice))));
    out.push('');
    const weak = r.prompts.filter((p) => !p.stretch && !p.flagship && (!p.structureOk || p.fidelity < 1));
    out.push(`In-vocabulary prompts that came out incomplete (${weak.length}):`);
    out.push('');
    for (const p of weak) out.push(`- ${p.id} "${p.prompt}": ${p.structureOk ? '' : `${p.structureWhy}; `}${p.missing.length > 0 ? `missing ${p.missing.join(', ')}` : ''} (built "${p.worldName}")`);
    out.push('');
  }
  if (r.provider) {
    out.push(renderModel(r.provider));
    out.push('');
  } else {
    out.push('No model was called: the optional provider column was not requested in this run.');
    out.push('');
  }
  return out.join('\n');
}

/** Render the optional model run next to the offline planner on the same prompts. */
export function renderModel(pv: NonNullable<BenchResults['provider']>): string {
  const head = ['Planner', 'Prompts', 'Right kind of world', 'Every expected word present', 'Mean word coverage', 'Fell back to the default meadow', 'Fully right and verified'];
  const rows = pv.prompts.map((p) => `- ${p.id} "${p.prompt}": ${p.error ? `error: ${p.error}` : `${p.structureOk ? 'right kind' : p.structureWhy}, words ${(p.fidelity * 100).toFixed(0)}%, ${p.calls} calls, ${p.outputTokens} output tokens, ${(p.ms / 1000).toFixed(0)} s`}`);
  return [
    `Model run: ${pv.name}, ${pv.callsUsed} of at most ${pv.maxCalls} calls, ${pv.prompts.length} prompts spread over the suite.`,
    '',
    table(head, [sliceRow(pv.name, pv.coverage.all), sliceRow('offline planner, same prompts', pv.offlineCoverage.all)]),
    '',
    ...rows,
  ].join('\n');
}

export { formatRate };
