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
/** After this long (ms) from the reveal the gate offers "Start now" (the light copies, the rest keeps loading). */
export const START_NOW_AFTER_MS = 6000;
/** No progress for this long (ms): the status adds that the device is slow and the visitor may start now. */
export const SLOW_AFTER_MS = 8000;
/** How long (ms) an armed tour shows "Ready" before it sets off. */
export const READY_BEAT_MS = 700;

/** What the gate reads, once a frame. */
export interface GateInput {
  /** Milliseconds (any steady clock). */
  now: number;
  /** Full-model upgrades: copies settled and copies queued (`WorldRenderer.modelUpgradeProgress`). */
  upgrades: { done: number; total: number };
  /**
   * The same upgrades as a weighted fraction, 0..1 (`WorldRenderer.modelUpgradeFraction`: files count for their bytes, a
   * file in progress for its stage). Omitted: `done / total`.
   */
  fraction?: number;
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
  /** What it is doing now (see {@link prepStatus}); null once ready. */
  step: PrepStep | null;
  /** Full-model copies settled and queued (for the status line's "3 of 13"). */
  done: number;
  total: number;
  /** "Start now" may be offered (waited {@link START_NOW_AFTER_MS}, not ready, not already pressed). */
  canSkip: boolean;
  /** The visitor pressed "Start now": the tour starts as soon as the guide is ready, whatever is still loading. */
  skipped: boolean;
  /** No progress for {@link SLOW_AFTER_MS}. */
  slow: boolean;
}

/** The step the wait is on: the full models loading, the guide getting ready, or the last preparations. */
export type PrepStep = 'models' | 'guide' | 'finishing';

/**
 * Plain words for what the wait is doing, from the gate's state: `text` names the step (read out when it changes),
 * `count` its progress ("3 of 13", shown but not read out), `slow` the added note for a slow device. Pure.
 */
export function prepStatus(prep: TourPrep, guideName = 'The guide'): { text: string; count: string | null; slow: string | null } | null {
  if (prep.ready && !prep.starting) return null;
  if (prep.starting) return { text: 'Ready', count: null, slow: null };
  const slow = prep.slow && prep.step !== null ? 'This device is taking a while. You can start now with a lighter look; it improves as the rest loads.' : null;
  if (prep.skipped) return { text: `Starting as soon as ${guideName} is ready`, count: null, slow: null };
  if (prep.step === 'models') return { text: 'Loading the models in full detail', count: prep.total > 0 ? `${Math.min(prep.done, prep.total)} of ${prep.total}` : null, slow };
  if (prep.step === 'guide') return { text: `${guideName} is getting ready`, count: null, slow };
  return { text: 'Almost there', count: null, slow };
}

export class TourGate {
  private since: number | null = null;
  private readyNow = false;
  private armedAt: number | null = null;
  private readyAt = 0;
  /** The highest percent shown: the number never goes back (more files queued late, a file restarting). */
  private peak = 0;
  private skipped = false;
  private guideOk = false;
  /** When the percent or the step last changed (the slow note's clock). */
  private movedAt: number | null = null;
  private lastStep: PrepStep | null = null;
  private last: TourPrep = { ready: false, percent: 0, armed: false, starting: false, step: 'models', done: 0, total: 0, canSkip: false, skipped: false, slow: false };

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
    this.guideOk = i.guideReady;
    // "Start now" waits for the guide only (her body in, the stops' viewpoints found), not for the full models.
    if (!this.readyNow && ((settled && !i.busy && i.guideReady) || (this.skipped && i.guideReady) || i.now - this.since >= TOUR_WAIT_MS)) {
      this.readyNow = true;
      this.readyAt = i.now;
    }
    // The guide counts as one more step, so a hall with nothing to upgrade still reads short of 100% until she is ready.
    // The models' steps are worth their weighted fraction (the bar moves while a file loads; a settled copy is whole in
    // it); without one, the copies settled.
    const steps = total + 1;
    const frac = total === 0 ? 0 : settled ? 1 : i.fraction === undefined ? done / total : Math.min(1, Math.max(0, i.fraction));
    const raw = Math.min(99, Math.floor((100 * (frac * total + (i.guideReady ? 1 : 0))) / steps));
    this.peak = Math.max(this.peak, raw);
    const percent = this.readyNow ? 100 : this.peak;
    const step: PrepStep | null = this.readyNow ? null : !settled ? 'models' : !i.guideReady ? 'guide' : 'finishing';
    if (this.movedAt === null || percent !== this.last.percent || step !== this.lastStep) this.movedAt = i.now;
    this.lastStep = step;
    let go = false;
    let armed = this.armedAt !== null;
    if (armed && this.readyNow && !i.hold && i.now - Math.max(this.readyAt, this.armedAt!) >= (this.skipped ? 0 : READY_BEAT_MS)) {
      this.armedAt = null;
      armed = false;
      go = true;
    }
    this.last = {
      ready: this.readyNow,
      percent,
      armed,
      starting: armed && this.readyNow,
      step,
      done,
      total,
      canSkip: !this.readyNow && !this.skipped && i.now - this.since >= START_NOW_AFTER_MS,
      skipped: this.skipped && !this.readyNow,
      slow: !this.readyNow && i.now - this.movedAt >= SLOW_AFTER_MS,
    };
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

  /**
   * The visitor presses "Start now": the tour starts with whatever has loaded (the light copies; the rest keeps upgrading).
   * True when it may start at once (the guide is ready); otherwise it is armed and {@link update} starts it the moment she
   * is. Skips the "Ready" beat.
   */
  skip(now: number): boolean {
    if (this.readyNow && this.armedAt === null) return true;
    this.skipped = true;
    this.armedAt ??= now;
    if (this.guideOk) {
      this.readyNow = true;
      this.readyAt = now;
      this.armedAt = null;
      this.last = { ...this.last, ready: true, percent: 100, armed: false, starting: false, step: null, canSkip: false, skipped: false, slow: false };
      return true;
    }
    this.last = { ...this.last, armed: true, canSkip: false, skipped: true };
    return false;
  }

  /** Forget an armed tour (the visitor chose to explore, or asked something else). */
  disarm(): void {
    this.armedAt = null;
    this.skipped = false;
    this.last = { ...this.last, armed: false, starting: false, skipped: false };
  }
}
