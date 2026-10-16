import { toDiagnostics, toTestResults } from '../../lib/chat';
/** Minimum interval between store writes (ms). */
export const FLUSH_MS = 60;
/** Tests shown live (the rest still verify; the final report lists them). */
const MAX_LIVE_TESTS = 200;
function view(r) {
    return { id: String(r.id).slice(0, 80), kind: String(r.kind).slice(0, 40), passed: r.passed === true, message: String(r.message).slice(0, 400) };
}
/** Coalescing progress listener for one studio. */
export class LiveVerifyFeed {
    sink;
    live = null;
    dirty = false;
    timer = null;
    constructor(sink) {
        this.sink = sink;
    }
    start(world) {
        const tests = world.tests.slice(0, MAX_LIVE_TESTS).map((t) => ({ id: t.id.slice(0, 80), kind: t.kind }));
        this.live = { tests, results: tests.map(() => null), lanes: 1, worker: false };
        this.cancelTimer();
        this.sink.set({ status: 'running', summary: '', head: this.sink.head(), live: this.live });
    }
    plan(plan) {
        if (!this.live)
            return;
        // A re-plan (worker fell back to the main thread) starts the list over.
        this.live = { ...this.live, results: this.live.results.map(() => null), lanes: plan.lanes, worker: plan.worker };
        // Published at once (a one-off transition, not a progress burst): a run that ends before the
        // next coalesced flush — or while the page is busy — must still have shown where it ran.
        this.dirty = false;
        if (this.sink.get().status === 'running')
            this.sink.set({ live: { ...this.live, results: this.live.results.slice() } });
    }
    result(index, result) {
        const live = this.live;
        if (!live || !Number.isInteger(index) || index < 0 || index >= live.results.length)
            return;
        live.results[index] = view(result);
        this.schedule();
    }
    /**
     * Write the final result (status, report, timing, lanes) and stop
     * streaming. A cancelled run returns the panel to idle.
     * @returns the diagnostics shown (for the viewport overlay)
     */
    end(run, ms) {
        this.cancelTimer();
        this.live = null;
        this.dirty = false;
        if (run.cancelled) {
            this.sink.set({ status: 'idle', summary: '', results: [], diagnostics: [], live: null, ms: 0 });
            return [];
        }
        const results = toTestResults(run.report);
        const diagnostics = toDiagnostics(run.report);
        const crashed = 'error' in run.report;
        this.sink.set({
            status: crashed ? 'error' : run.passed ? 'passed' : 'failed',
            summary: run.summary,
            results,
            diagnostics,
            live: null,
            ms,
            lanes: run.lanes,
            worker: run.worker,
            simulatedSeconds: 'simulatedSeconds' in run.report ? run.report.simulatedSeconds : 0,
        });
        return diagnostics;
    }
    schedule() {
        this.dirty = true;
        if (this.timer !== null)
            return;
        this.timer = setTimeout(() => {
            this.timer = null;
            this.flush();
        }, FLUSH_MS);
    }
    flush() {
        if (!this.dirty || !this.live)
            return;
        this.dirty = false;
        if (this.sink.get().status !== 'running')
            return;
        // A new object per flush so selectors see the change.
        this.sink.set({ live: { ...this.live, results: this.live.results.slice() } });
    }
    cancelTimer() {
        if (this.timer !== null)
            clearTimeout(this.timer);
        this.timer = null;
    }
}
