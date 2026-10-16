/**
 * Small-edit eval: 180+ cases over the bundled default projects, scored on
 * target accuracy, over-edit rate and latency, for
 *   - the unassisted offline planner (before),
 *   - the local fast path alone and with the planner behind it (after),
 *   - a careless recorded model with the minimal-patch guard off and on.
 *
 *   npm run eval:edits                              # table + failures
 *   npm run eval:edits -- --engine fast --only a-sofa    # one engine, ids containing "a-sofa"
 *   npm run eval:edits -- --set holdout              # the wording the parser was not tuned on
 */
import { loadCatalog } from '@aether/assets';
import { CASES } from '../packages/agent/test/fine/cases';
import { HOLDOUT } from '../packages/agent/test/fine/cases-holdout';
import { agentEngine, baselineEngine, fastEngine, recordedModelEngine, runCase, summarise } from '../packages/agent/test/fine/harness';
const args = process.argv.slice(2);
const flag = (name) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
};
const only = flag('only');
const which = flag('engine');
const verbose = args.includes('--verbose');
const engines = [baselineEngine, fastEngine, agentEngine, recordedModelEngine(false), recordedModelEngine(true)].filter((e) => !which || e.name.startsWith(which));
const set = flag('set') === 'holdout' ? HOLDOUT : flag('set') === 'tuned' ? CASES : [...CASES, ...HOLDOUT];
const cases = set.filter((c) => !only || c.id.includes(only));
/** Cases a model would be asked to answer with patches (the recorded-model engines skip questions, declines, undo, walls). */
const modelCases = cases.filter((c) => (c.expect.t?.length ?? 0) > 0 && !c.expect.wall && !c.prior && !c.selection && c.world !== 'blocks' && !c.expect.added);
await loadCatalog();
const pct = (n) => `${(n * 100).toFixed(0)}%`;
for (const engine of engines) {
    const vs = [];
    for (const c of engine.name.startsWith('model') ? modelCases : cases) {
        const v = await runCase(engine, c);
        vs.push(v);
        if (verbose || v.ms > 2000)
            console.log(`  ${engine.name.split(' ')[0]} ${c.id} ${v.ok ? 'ok' : 'FAIL'} ${v.ms.toFixed(0)} ms ${v.why}`);
    }
    const s = summarise(engine.name, vs);
    console.log(`${s.engine.padEnd(40)} pass ${String(s.passed).padStart(3)}/${s.total}  target ${pct(s.targetAccuracy).padStart(4)}  over-edit ${pct(s.overEditRate).padStart(4)}  p50 ${s.p50.toFixed(1).padStart(7)} ms  p95 ${s.p95.toFixed(1).padStart(7)} ms  model calls/edit ${s.llmCallsPerEdit.toFixed(2)}`);
    if (args.includes('--causes')) {
        const causes = new Map();
        const bump = (k) => void causes.set(k, (causes.get(k) ?? 0) + 1);
        for (const v of vs.filter((x) => !x.ok)) {
            if (/did not (change|remove)|added 0|unchanged|no change matching|not recognised|did not ask|no wall face/.test(v.why))
                bump('missed: nothing (or the wrong thing) changed');
            if (/also changed/.test(v.why) || v.overEdit.length > 0)
                bump('over-edit: other things changed or moved');
            if (/guessed instead of asking/.test(v.why))
                bump('guessed instead of asking which one');
            if (/wrong faces/.test(v.why))
                bump('wrong wall faces');
            if (/changed the world/.test(v.why))
                bump('changed the world when it should not have');
        }
        for (const [k, n] of [...causes].sort((a, b) => b[1] - a[1]))
            console.log(`    ${String(n).padStart(3)}  ${k}`);
    }
    if (!args.includes('--quiet'))
        for (const v of vs.filter((x) => !x.ok))
            console.log(`    FAIL ${v.id}: ${v.why}`);
}
