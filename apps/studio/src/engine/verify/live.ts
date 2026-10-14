/**
 * Feeds live verification progress into the studio store: the Verify panel
 * lists every test immediately and fills each one in as a worker decides
 * it. Store writes are coalesced (at most one per {@link FLUSH_MS}), so a
 * burst of results never causes a burst of React renders.
 */
import type { WorldDoc } from '@aether/core';
import type { TestResult } from '@aether/physics';
import { toDiagnostics, toTestResults, type DiagnosticView, type TestResultView } from '../../lib/chat';
import type { LiveVerify, VerifyState } from '../../state/store';
import type { VerificationRun, VerifyProgressListener } from '../AgentBridge';

/** Minimum interval between store writes (ms). */
export const FLUSH_MS = 60;
/** Tests shown live (the rest still verify; the final report lists them). */
const MAX_LIVE_TESTS = 200;

/** Store access needed by {@link LiveVerifyFeed}. */
export interface LiveVerifySink {
  get(): VerifyState;
  set(patch: Partial<VerifyState>): void;
  /** History head the run belongs to. */
  head(): number;
}

function view(r: TestResult): TestResultView {
  return { id: String(r.id).slice(0, 80), kind: String(r.kind).slice(0, 40), passed: r.passed === true, message: String(r.message).slice(0, 400) };
}

/** Coalescing progress listener for one studio. */
export class LiveVerifyFeed implements VerifyProgressListener {
  private live: LiveVerify | null = null;
  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly sink: LiveVerifySink) {}

  start(world: WorldDoc): void {
    const tests = world.tests.slice(0, MAX_LIVE_TESTS).map((t) => ({ id: t.id.slice(0, 80), kind: t.kind }));
    this.live = { tests, results: tests.map(() => null), lanes: 1, worker: false };
    this.cancelTimer();
    this.sink.set({ status: 'running', summary: '', head: this.sink.head(), live: this.live });
  }

  plan(plan: { lanes: number; worker: boolean }): void {
    if (!this.live) return;
    // A re-plan (worker fell back to the main thread) starts the list over.
    this.live = { ...this.live, results: this.live.results.map(() => null), lanes: plan.lanes, worker: plan.worker };
    // Published at once (a one-off transition, not a progress burst): a run that ends before the
    // next coalesced flush — or while the page is busy — must still have shown where it ran.
    this.dirty = false;
    if (this.sink.get().status === 'running') this.sink.set({ live: { ...this.live, results: this.live.results.slice() } });
  }

  result(index: number, result: TestResult): void {
    const live = this.live;
    if (!live || !Number.isInteger(index) || index < 0 || index >= live.results.length) return;
    live.results[index] = view(result);
    this.schedule();
  }

  /**
   * Write the final result (status, report, timing, lanes) and stop
   * streaming. A cancelled run returns the panel to idle.
   * @returns the diagnostics shown (for the viewport overlay)
   */
  end(run: VerificationRun, ms: number): DiagnosticView[] {
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

  private schedule(): void {
    this.dirty = true;
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, FLUSH_MS);
  }

  private flush(): void {
    if (!this.dirty || !this.live) return;
    this.dirty = false;
    if (this.sink.get().status !== 'running') return;
    // A new object per flush so selectors see the change.
    this.sink.set({ live: { ...this.live, results: this.live.results.slice() } });
  }

  private cancelTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
