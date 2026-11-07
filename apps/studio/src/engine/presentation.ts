/**
 * How a world is presented when it is published (the publish dialog's Presentation section): its kind and start mode
 * (suggested by the AI from the content, else by the rule, stored in the IR, changed by the user), its short film
 * (written by the AI director over the world's points of interest, else by film grammar) and the pre-publish shot review
 * (the opening view, film or tour frames and the play spawn, judged and fixed). The work is in `@aether/agent`'s
 * `presentation/`; this controller runs it on the studio's agent bridge and keeps its state for the UI.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import { authorStory, defaultPresentation, presentationPatch, reviewShots, runQualityPass, suggestPresentation, type FrameIssue, type LevelToolRunner, type PresentationChoice, type PresentHost, type PresentKind, type PresentStart, type Provider, type QualityHost, type ShotReview, type WorldQualityReport } from '@aether/agent';
import { storyDuration, type History } from '@aether/core';
import { errorMessage } from '../lib/log';

export interface PresentationState {
  /** The last suggestion (null until asked). */
  suggestion: PresentationChoice | null;
  busy: null | 'suggest' | 'story' | 'review' | 'quality';
  /** Progress line. */
  status: string | null;
  /** The film's last authoring outcome. */
  story: { source: 'ai' | 'fallback'; shots: number; seconds: number; fixed: string[]; remaining: string[] } | null;
  review: ShotReview | null;
  /** The last world-quality pass and the world version it checked. */
  quality: WorldQualityReport | null;
  qualityHead: number | null;
  error: string | null;
}

export interface PresentationHost {
  readonly history: History;
  readonly bridge: PresentHost & Partial<Pick<QualityHost, 'sunState' | 'renderStats'>>;
  /** The level tools (ground under the spawn, what floats or sinks), when the host has physics. */
  qualityLevelTools?(): LevelToolRunner | null;
  /** A language model for the director (null: the rules and film grammar only). */
  directorProvider(): Provider | null;
}

export class PresentationController {
  readonly state: StoreApi<PresentationState>;
  private abort: AbortController | null = null;

  constructor(private readonly host: PresentationHost) {
    this.state = createStore<PresentationState>()(() => ({ suggestion: null, busy: null, status: null, story: null, review: null, quality: null, qualityHead: null, error: null }));
  }

  private set(p: Partial<PresentationState>): void {
    this.state.setState(p);
  }

  /** The choice stored in the world, else the rule's (what the dialog shows before anything is asked). */
  current(): { profile: PresentKind; startMode: PresentStart; stored: boolean } {
    const w = this.host.history.current;
    const rule = defaultPresentation(w);
    return { profile: w.profile ?? rule.profile, startMode: w.startMode ?? rule.startMode, stored: w.profile !== undefined || w.startMode !== undefined };
  }

  /** Ask the AI (or the rule) for the kind and start mode; stored when the world has none yet or `store` is set. */
  async suggest(store = false): Promise<void> {
    if (this.state.getState().busy) return;
    const ctrl = this.begin('suggest', 'Reading the world for its kind…');
    try {
      const w = this.host.history.current;
      const choice = await suggestPresentation(this.host.directorProvider(), w, ctrl.signal);
      if (ctrl.signal.aborted) return;
      this.set({ suggestion: choice });
      if (store || (w.profile === undefined && w.startMode === undefined)) this.host.history.commit([presentationPatch(choice)], 'Presentation', 'agent');
    } catch (e) {
      this.set({ error: errorMessage(e) });
    } finally {
      this.end(ctrl);
    }
  }

  /** The user's choice in the dialog (one undo step). */
  choose(profile: PresentKind, startMode: PresentStart): void {
    this.host.history.commit([presentationPatch({ profile, startMode })], 'Presentation', 'user');
    const s = this.state.getState().suggestion;
    this.set({ suggestion: s ? { ...s, source: s.profile === profile && s.startMode === startMode ? s.source : 'user' } : null });
  }

  /** Write the world's short film (the AI director, else film grammar) and start the world on it. */
  async writeStory(): Promise<void> {
    if (this.state.getState().busy) return;
    const ctrl = this.begin('story', 'Finding the points of interest…');
    try {
      const film = await authorStory(this.host.bridge, this.host.directorProvider(), { signal: ctrl.signal, onStatus: (t) => this.set({ status: t }) });
      if (ctrl.signal.aborted) return;
      this.set({ story: { source: film.source, shots: film.story.shots.length, seconds: Math.round(storyDuration(film.story)), fixed: film.fixed, remaining: [...film.notes, ...film.remaining] } });
    } catch (e) {
      this.set({ error: errorMessage(e) });
    } finally {
      this.end(ctrl);
    }
  }

  /** Render, judge and fix the frames a visitor meets; the rest is reported. */
  async review(): Promise<void> {
    if (this.state.getState().busy) return;
    const ctrl = this.begin('review', 'Rendering the frames…');
    try {
      const r = await reviewShots(this.host.bridge, this.host.directorProvider(), { signal: ctrl.signal, onStatus: (t) => this.set({ status: t }) });
      if (ctrl.signal.aborted) return;
      this.set({ review: r });
    } catch (e) {
      this.set({ error: errorMessage(e) });
    } finally {
      this.end(ctrl);
    }
  }

  /** The host the quality pass measures with. */
  private qualityHost(): QualityHost {
    const b = this.host.bridge;
    const lt = this.host.qualityLevelTools?.() ?? null;
    return Object.assign(Object.create(b) as QualityHost, lt ? { levelTools: lt } : {});
  }

  /**
   * The world-quality pass (docs/WORLD-QUALITY.md): the data checks and their fixes, and with `visual` the AI's review
   * of the frames a visitor meets. Runs after the AI builds or edits a world and at publish.
   */
  async quality(opts: { visual?: boolean } = {}): Promise<void> {
    if (this.state.getState().busy) return;
    const ctrl = this.begin('quality', 'World-quality pass…');
    try {
      const r = await runQualityPass(this.qualityHost(), opts.visual === false ? null : this.host.directorProvider(), { visual: opts.visual !== false, signal: ctrl.signal, onStatus: (t) => this.set({ status: t }) });
      if (ctrl.signal.aborted) return;
      this.set({ quality: r, qualityHead: this.host.history.head, ...(r.review ? { review: r.review } : {}) });
    } catch (e) {
      this.set({ error: errorMessage(e) });
    } finally {
      this.end(ctrl);
    }
  }

  /** Whether the last quality pass checked the world as it is now. */
  qualityCurrent(): boolean {
    return this.state.getState().qualityHead === this.host.history.head;
  }

  /** Suggest (when nothing is stored), write the film when the world starts on one and has none, then review. */
  async prepare(): Promise<void> {
    if (!this.current().stored) await this.suggest();
    const w = this.host.history.current;
    if (w.startMode === 'story' && !w.story) await this.writeStory();
    await this.quality();
  }

  cancel(): void {
    this.abort?.abort();
    this.abort = null;
    this.set({ busy: null, status: 'Stopped.' });
  }

  /** Problems left for the user, as lines. */
  remaining(): FrameIssue[] {
    return this.state.getState().review?.remaining ?? [];
  }

  private begin(busy: NonNullable<PresentationState['busy']>, status: string): AbortController {
    const ctrl = new AbortController();
    this.abort = ctrl;
    this.set({ busy, status, error: null });
    return ctrl;
  }

  private end(ctrl: AbortController): void {
    if (this.abort !== ctrl) return;
    this.abort = null;
    this.set({ busy: null, status: null });
  }
}
