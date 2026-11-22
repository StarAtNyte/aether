/**
 * When the guided tour may start. The world opens early (the large library models as their light copies, the guide
 * greeting at once: the visitor looks round and asks her things), but the tour waits for everything: every full model
 * downloaded, transcoded, uploaded and swapped in, nothing left to prepare, and the guide ready (her body in, the stops'
 * viewpoints found). Until then the tour buttons read "Preparing the tour… 62%"; pressing one arms the tour, which then
 * starts by itself the moment all is ready, after a short "Ready". A stalled upgrade (a file that never comes) does not
 * hold it longer than {@link TOUR_WAIT_MS} after the reveal. Pure: the controller feeds it once a frame.
 */

/** Longest (ms) after the reveal the tour waits for the full models and the guide. */
export const TOUR_WAIT_MS = 60_000;
/** How long (ms) an armed tour shows "Ready" before it sets off. */
export const READY_BEAT_MS = 700;

/** What the gate reads, once a frame. */
export interface GateInput {
  /** Milliseconds (any steady clock). */
  now: number;
  /** Full-model upgrades: copies settled and copies queued (`WorldRenderer.modelUpgradeProgress`). */
  upgrades: { done: number; total: number };
  /** The renderer still prepares something (`processingStage !== null`). */
  busy: boolean;
  /** The guide is ready (body in, viewpoints found). */
  guideReady: boolean;
  /** The visitor is typing or waiting for an answer: an armed tour waits (still armed) until they are done. */
  hold?: boolean;
}

/** What the tour buttons show. */
export interface TourPrep {
  /** The tour may start now. */
  ready: boolean;
  /** Progress, 0..100 (100 only once ready). */
  percent: number;
  /** The visitor asked for the tour: it starts by itself once ready. */
  armed: boolean;
  /** Armed and ready: the short "Ready" before it sets off. */
  starting: boolean;
}

export class TourGate {
  private since: number | null = null;
  private readyNow = false;
  private armedAt: number | null = null;
  private readyAt = 0;
  private last: TourPrep = { ready: false, percent: 0, armed: false, starting: false };

  /** The latest state. */
  get prep(): TourPrep {
    return this.last;
  }

  /**
   * Read the world's state (call once a frame from the reveal on). Returns true once when an armed tour should set off
   * (its "Ready" shown for {@link READY_BEAT_MS}).
   */
  update(i: GateInput): boolean {
    this.since ??= i.now;
    const { done, total } = i.upgrades;
    const settled = done >= total;
    if (!this.readyNow && ((settled && !i.busy && i.guideReady) || i.now - this.since >= TOUR_WAIT_MS)) {
      this.readyNow = true;
      this.readyAt = i.now;
    }
    // The guide counts as one more step, so a hall with nothing to upgrade still reads short of 100% until she is ready.
    const steps = total + 1;
    const percent = this.readyNow ? 100 : Math.min(99, Math.floor((100 * (Math.min(done, total) + (i.guideReady ? 1 : 0))) / steps));
    let go = false;
    let armed = this.armedAt !== null;
    if (armed && this.readyNow && !i.hold && i.now - Math.max(this.readyAt, this.armedAt!) >= READY_BEAT_MS) {
      this.armedAt = null;
      armed = false;
      go = true;
    }
    this.last = { ready: this.readyNow, percent, armed, starting: armed && this.readyNow };
    return go;
  }

  /**
   * The visitor asks for the tour at `now`: true when it may start at once (ready, nothing armed); otherwise it is armed
   * and {@link update} says when to start.
   */
  request(now: number): boolean {
    if (this.readyNow && this.armedAt === null) return true;
    this.armedAt ??= now;
    // Already ready (a press during the "Ready" beat): the beat counts from the first press.
    this.last = { ...this.last, armed: true, starting: this.readyNow };
    return false;
  }

  /** Forget an armed tour (the visitor chose to explore, or asked something else). */
  disarm(): void {
    this.armedAt = null;
    this.last = { ...this.last, armed: false, starting: false };
  }
}
