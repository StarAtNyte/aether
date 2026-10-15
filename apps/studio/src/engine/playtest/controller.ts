/**
 * The Verified-playable flow of the studio.
 *
 * After the agent builds a game or a house (or on demand) an autonomous bot
 * plays or walks it — in a worker, with progress — and the result is a
 * verdict the UI can trust: a green badge exists only for a real run that
 * passed on exactly the world on screen (same history entry, same gameplay
 * hash). When the bot finds a defect it proposes the smallest patch, applies
 * it as an ordinary undoable history entry, and plays again (a few rounds at
 * most); the user gets one plain sentence about what was found or fixed.
 *
 * The bot's winning run is replayed over the real rendered world as a ghost
 * player with speed and scrub controls. The proof (verdict + compact trace +
 * a hash of the gameplay content) travels with share links and published
 * builds.
 */
import type { WorldDoc } from '@aether/core';
import type { PlaytestKind, PlaytestReport, PlaytestTrace, Proof } from '@aether/playtest';
import { playtestKindOf } from '@aether/playtest/proof';
import type { Studio } from '../Studio';
import { PlaytestClient, type PlaytestRunOptions } from './client';
import type { PlaytestFindingView, PlaytestObjectiveView } from '../../state/store';

/** Options of {@link PlaytestController.run}. */
export interface PlaytestStartOptions {
  /** Propose and apply fixes when the bot finds defects (default true). */
  repair?: boolean;
  /** Started by the app after a build, not by the user: stay silent when there is nothing to play. */
  auto?: boolean;
}

/** Most repair rounds one run applies. */
export const MAX_REPAIR_ROUNDS = 3;
const MAX_VIEW_FINDINGS = 12;
const MAX_VIEW_OBJECTIVES = 60;
const POLL_MS = 100;

export { playtestKindOf };

/** Findings and objectives of a report as compact views for the store. */
export function reportViews(report: PlaytestReport): { findings: PlaytestFindingView[]; objectives: PlaytestObjectiveView[] } {
  const order = { error: 0, warning: 1, info: 2 } as const;
  const findings = [...report.findings]
    .filter((f) => f.severity !== 'info' || f.code === 'fell')
    .sort((a, b) => order[a.severity] - order[b.severity])
    .slice(0, MAX_VIEW_FINDINGS)
    .map((f): PlaytestFindingView => ({ severity: f.severity, code: f.code, message: f.message, entities: f.entities.slice(0, 4), ...(f.position ? { position: [f.position[0], f.position[1], f.position[2]] as [number, number, number] } : {}) }));
  const objectives = report.objectives.slice(0, MAX_VIEW_OBJECTIVES).map((o): PlaytestObjectiveView => ({ id: o.id, label: o.label, kind: o.kind, status: o.status, required: o.required, ...(o.at !== undefined ? { at: o.at } : {}), ...(o.reason ? { reason: o.reason } : {}) }));
  return { findings, objectives };
}

/** Runs the bot, applies repairs, shows the replay. One per studio. */
export class PlaytestController {
  private readonly client: PlaytestClient;
  private abort: AbortController | null = null;
  private report: PlaytestReport | null = null;
  private reportHead = -1;
  private gen = 0;
  private poll: ReturnType<typeof setInterval> | null = null;
  private replayStarted = false;
  private resumeAfterPlay: PlaytestStartOptions | null = null;
  private resumeOptions: PlaytestStartOptions = {};
  private disposed = false;
  private readonly cleanups: Array<() => void> = [];

  constructor(private readonly studio: Studio) {
    this.client = new PlaytestClient({
      mainThread: async (world, opts) => {
        const bot = await import('@aether/playtest');
        const play = opts.kind === 'walkthrough' ? bot.walkthrough : bot.playtest;
        return play(world, {
          ...(opts.maxSimSeconds !== undefined ? { maxSimSeconds: opts.maxSimSeconds } : {}),
          ...(opts.budgetMs !== undefined ? { budgetMs: opts.budgetMs } : {}),
          ...(opts.trace !== undefined ? { trace: opts.trace } : {}),
          ...(opts.signal ? { signal: opts.signal } : {}),
          ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
        });
      },
    });
    this.cleanups.push(
      studio.history.subscribe(() => {
        // An edit makes the replay stale (the ghost walks a world that is gone).
        if (this.studio.store.getState().replay && this.studio.history.head !== this.reportHead && !this.studio.store.getState().agentBusy) this.stopReplay();
      }),
      studio.store.subscribe((s, prev) => {
        // A playing ghost moves the scene every frame, so the studio still would restart its refinement
        // forever (progress stays at 0): choosing Studio render pauses the replay (play resumes it).
        if (s.arch.quality === 'studio' && prev.arch.quality !== 'studio' && s.replay?.playing) {
          const r = this.studio.simulation?.renderer;
          if (r) {
            r.pauseGhost();
            this.refreshReplay();
          }
        }
        if (s.mode === 'play' && prev.mode !== 'play') {
          // The user started playing: the bot steps aside (it resumes when they come back).
          this.stopReplay();
          if (this.abort) {
            this.resumeAfterPlay = this.resumeOptions;
            this.cancel();
          }
        } else if (s.mode === 'edit' && prev.mode === 'play' && this.resumeAfterPlay && !this.disposed) {
          const again = this.resumeAfterPlay;
          this.resumeAfterPlay = null;
          void this.run(again);
        }
      }),
    );
  }

  /** Prefetch the bot in the worker (idle time). */
  warm(): void {
    this.client.warm();
  }

  /** True while a run is in flight. */
  get running(): boolean {
    return this.abort !== null;
  }

  /** The current verdict is a real pass on the world on screen. */
  get verified(): boolean {
    const st = this.studio.store.getState().playtest;
    return st.status === 'passed' && st.proven && st.head === this.studio.history.head;
  }

  /** The last report (with its trace), or null. */
  get lastReport(): PlaytestReport | null {
    return this.report;
  }

  /** Stop a running playtest. */
  cancel(): void {
    this.gen++;
    const was = this.abort;
    this.abort = null;
    was?.abort();
    if (was) {
      this.studio.simulation?.renderer.ghostLive(null);
      const st = this.studio.store.getState();
      if (st.playtest.status === 'running') st.setPlaytest({ status: 'idle', progress: null });
    }
  }

  /**
   * The compact proof of the last passed run, only while it still describes
   * the world on screen (same gameplay hash); null otherwise. Sealing embeds
   * it in the replay proof (`@aether/verifier`), so the seal and the bot's run
   * travel as one proof.
   */
  async proof(): Promise<Proof | null> {
    // A run in flight is about to give the verdict a seal would want: wait for it (bounded).
    const until = performance.now() + 60_000;
    while (this.abort !== null && performance.now() < until && !this.disposed) await new Promise((r) => setTimeout(r, 150));
    const report = this.report;
    if (!report || report.status !== 'passed' || this.disposed) return null;
    // The light proof module only (no physics) is needed here.
    const { hashWorld, toProof } = await import('@aether/playtest/proof');
    if (hashWorld(this.studio.history.current) !== report.worldHash) return null;
    return toProof(report);
  }

  /**
   * Play or walk the world and publish the verdict. Never throws; at most
   * one run at a time (a newer run replaces a running one).
   */
  async run(opts: PlaytestStartOptions = {}): Promise<void> {
    if (this.disposed) return;
    const store = this.studio.store;
    if (store.getState().mode === 'play') return;
    this.cancel();
    const gen = ++this.gen;
    const ctrl = new AbortController();
    this.abort = ctrl;
    const history = this.studio.history;
    const startHead = history.head;
    this.resumeOptions = opts;
    this.resumeAfterPlay = null;
    const repair = opts.repair !== false;
    const kind = playtestKindOf(history.current);
    this.stopReplay();
    store.getState().setPlaytest({ status: 'running', kind, head: startHead, progress: { fraction: 0, note: 'getting ready', seconds: 0, round: 0 }, sentence: '', repairs: [], findings: [], objectives: [], replay: false, proven: false });
    try {
      const bot = await import('@aether/playtest');
      let round = 0;
      const run = async (w: WorldDoc, r: number): Promise<PlaytestReport> => {
        round = Math.max(round, r);
        const ro: PlaytestRunOptions = {
          kind,
          trace: r >= 0,
          signal: ctrl.signal,
          onProgress: (p) => {
            if (gen !== this.gen) return;
            store.getState().setPlaytest({ progress: { fraction: p.fraction, note: p.note, seconds: p.seconds, round: Math.max(0, round) } });
            // The bot shows up in the world while it plays.
            if (r >= 0 && p.position && p.phase === 'play' && store.getState().arch.quality !== 'studio') this.studio.simulation?.renderer.ghostLive(p.position);
          },
        };
        const out = await this.client.run(w, ro);
        if (!out.ok) throw out.cancelled ? Object.assign(new Error('playtest cancelled'), { name: 'AbortError' }) : new Error(out.error);
        return out.report;
      };
      const result = await bot.selfRepair(history.current, {
        kind,
        maxRounds: repair ? MAX_REPAIR_ROUNDS : 1,
        signal: ctrl.signal,
        run,
        apply: (proposal, w) => {
          // A repair is an ordinary, undoable history entry; never over the user's own newer edit.
          if (history.current !== w || gen !== this.gen || store.getState().mode === 'play') return null;
          const res = history.commit(proposal.patches, `Playtest fix: ${proposal.sentence}`.slice(0, 140), 'agent');
          return res.errors.length === 0 && res.applied.length > 0 ? history.current : null;
        },
        onRound: (r, i) => {
          if (gen !== this.gen) return;
          if (r.repair) store.getState().setPlaytest({ progress: { fraction: 0.05, note: r.repair.sentence, seconds: 0, round: i + 1 }, repairs: [...store.getState().playtest.repairs, r.repair.sentence] });
        },
      });
      if (gen !== this.gen) return;
      this.studio.simulation?.renderer.ghostLive(null);
      const report = result.report;
      const quiet = opts.auto === true && (report.status === 'unsupported' || (report.status === 'inconclusive' && /^Nothing to (play|walk)/.test(report.summary)));
      this.report = report;
      this.reportHead = history.head;
      const currentHash = bot.hashWorld(history.current);
      const proven = report.status === 'passed' && report.worldHash === currentHash;
      const { findings, objectives } = reportViews(report);
      const sentence = result.sentence;
      store.getState().setPlaytest({
        status: quiet ? 'idle' : report.status,
        kind,
        head: history.head,
        progress: null,
        sentence: quiet ? '' : sentence,
        repairs: result.applied.map((a) => a.sentence),
        findings,
        objectives,
        seconds: report.seconds,
        ms: report.wallMs,
        replay: report.trace !== undefined,
        proven,
        worker: this.client.usesWorkers,
      });
      if (!quiet) {
        this.announce(sentence, report.status === 'passed');
        this.seal(report, proven);
      }
      if (proven && report.trace) void this.startReplay(gen);
    } catch (err) {
      this.studio.simulation?.renderer.ghostLive(null);
      if (gen !== this.gen) return;
      const e = err instanceof Error ? err : new Error(String(err));
      if (e.name === 'AbortError') {
        store.getState().setPlaytest({ status: 'idle', progress: null });
      } else {
        store.getState().setPlaytest({ status: 'error', progress: null, sentence: `Could not run the playtest: ${e.message.slice(0, 200)}`, proven: false, replay: false });
      }
    } finally {
      if (this.abort === ctrl) this.abort = null;
    }
  }

  /** The seal over the viewport: the bot's verdict, with its replay. */
  private seal(report: PlaytestReport, proven: boolean): void {
    const store = this.studio.store;
    const done = report.objectives.filter((o) => o.status === 'done').length;
    const walk = report.kind === 'walkthrough';
    const seconds = Math.round(report.seconds * 10) / 10;
    const good = proven && report.status === 'passed';
    const first = report.findings.find((f) => f.severity === 'error') ?? report.findings.find((f) => f.severity === 'warning');
    store.getState().setProofSeal({
      id: Date.now() % 1_000_000_000,
      passed: good,
      tests: report.objectives.length,
      passedTests: done,
      seconds,
      replay: good && report.trace !== undefined,
      kind: 'playtest',
      title: good ? (walk ? 'Verified walkable' : 'Verified playable') : report.status === 'inconclusive' ? 'Not verified yet' : 'Could not verify',
      detail: good ? `${walk ? 'Reached' : 'Won with'} ${done} of ${report.objectives.length} ${walk ? 'rooms' : 'goals'} in ${seconds} s` : (first?.message ?? report.summary).slice(0, 120),
    });
  }

  /** One short line in the chat: what the bot found or fixed. */
  private announce(text: string, good: boolean): void {
    const s = this.studio.store.getState();
    const id = s.startAssistant();
    s.pushEvent(id, { type: 'notice', tone: good ? 'info' : 'warning', text: text.slice(0, 400) });
    s.finishAssistant(id, 'done');
  }

  // ---------------------------------------------------------------------------
  // Replay
  // ---------------------------------------------------------------------------

  /** Replay the bot's run over the world (from the last run). Resolves once the ghost is shown. */
  async startReplay(gen: number = this.gen): Promise<void> {
    const trace = this.report?.trace;
    const sim = this.studio.simulation;
    if (!trace || !sim || this.disposed) return;
    // Let grow-in and camera flights finish first (bounded).
    const giveUpAt = performance.now() + 5000;
    while (sim.renderer.animating && performance.now() < giveUpAt && gen === this.gen && !this.disposed) await new Promise((r) => setTimeout(r, 120));
    if (gen !== this.gen || this.disposed || this.studio.simulation !== sim || this.studio.store.getState().mode === 'play') return;
    this.frameTrace(trace);
    const ok = sim.renderer.startGhost(trace, { autoplay: true, speed: 1, onEnd: () => this.refreshReplay() });
    if (!ok) return;
    this.replayStarted = true;
    this.refreshReplay();
    if (this.poll === null) this.poll = setInterval(() => this.refreshReplay(), POLL_MS);
  }

  /** Replay a proof that arrived from outside (a share link, a published build) with this trace. */
  async replayTrace(trace: PlaytestTrace): Promise<boolean> {
    const sim = this.studio.simulation;
    if (!sim || this.disposed) return false;
    this.frameTrace(trace);
    const ok = sim.renderer.startGhost(trace, { autoplay: true, speed: 1, onEnd: () => this.refreshReplay() });
    if (!ok) return false;
    this.replayStarted = true;
    this.refreshReplay();
    if (this.poll === null) this.poll = setInterval(() => this.refreshReplay(), POLL_MS);
    return true;
  }

  private frameTrace(trace: PlaytestTrace): void {
    const sim = this.studio.simulation;
    if (!sim) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < trace.frames; i++) {
      const x = trace.poses[i * 4] as number, y = trace.poses[i * 4 + 1] as number, z = trace.poses[i * 4 + 2] as number;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    const r = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2;
    sim.renderer.frameSphere([(minX + maxX) / 2, (minY + maxY) / 2 + 0.8, (minZ + maxZ) / 2], Math.max(4, r * 0.9), [0.55, 0.85, 0.75], 0.9);
  }

  private refreshReplay(): void {
    const sim = this.studio.simulation;
    const st = this.studio.store.getState();
    if (!sim || !this.replayStarted) {
      if (st.replay) st.setReplay(null);
      return;
    }
    const g = sim.renderer.ghostState;
    if (!g.active) {
      this.replayStarted = false;
      if (this.poll !== null) clearInterval(this.poll);
      this.poll = null;
      if (st.replay) st.setReplay(null);
      return;
    }
    const cur = st.replay;
    if (!cur || cur.playing !== g.playing || Math.abs(cur.time - g.time) > 1e-3 || cur.length !== g.length || cur.speed !== g.speed) st.setReplay({ playing: g.playing, time: g.time, length: g.length, speed: g.speed });
  }

  /** Remove the ghost. */
  stopReplay(): void {
    this.replayStarted = false;
    this.studio.simulation?.renderer.stopGhost();
    if (this.poll !== null) clearInterval(this.poll);
    this.poll = null;
    if (this.studio.store.getState().replay) this.studio.store.getState().setReplay(null);
  }

  /** Play or pause the ghost (restarts it from the beginning when it had finished). */
  toggleReplay(): void {
    const r = this.studio.simulation?.renderer;
    if (!r) return;
    if (r.ghostState.playing) r.pauseGhost();
    else r.playGhost();
    this.refreshReplay();
  }

  /** Scrub the ghost to a time in seconds (pauses it). */
  seekReplay(t: number): void {
    const r = this.studio.simulation?.renderer;
    if (!r) return;
    r.pauseGhost();
    r.seekGhost(t);
    this.refreshReplay();
  }

  /** Playback speed of the ghost. */
  setReplaySpeed(v: number): void {
    this.studio.simulation?.renderer.setGhostSpeed(v);
    this.refreshReplay();
  }

  /** Free the worker and timers. */
  dispose(): void {
    this.disposed = true;
    this.cancel();
    if (this.poll !== null) clearInterval(this.poll);
    this.poll = null;
    for (const c of this.cleanups.splice(0)) c();
    this.client.dispose();
  }
}
