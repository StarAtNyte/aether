/**
 * Runs the showroom guide of a world with `guide` (see `GuideSpec`): its person (`person.ts`), the welcome when the
 * visitor comes near, the questions (the site's model through `ask.ts`, the keyword match of `brain.ts` without one), the
 * walk to a product with the visitor's camera gliding to look at it (`place.ts`, the explore controller's `lookAt`), and
 * the guided tour (`brain.ts` `tourStops`: chapters of stops in walking order).
 *
 * On the tour the visitor's view follows the guide at eye level a couple of metres behind her, along the way she walked
 * (the explore controller's `follow`), then eases round to frame the piece while she steps beside it and turns to the
 * visitor; a chapter's intro is said on the way, the stop's line on arrival, as a caption timed by its recording (else
 * by reading time); a short countdown, then on to the next stop. Any move of the visitor pauses it. Pieces can be saved
 * on the way; the end shows them together.
 *
 * Events: on arriving at a product it sends `aether:show-product` (`detail: { id }`; the product card opens; `id: null`
 * closes it as the tour sets off from a stop); it listens for `aether:ask-guide` (`detail: { id }`, the card's Ask the guide) and for
 * a click on its person (`aether:pick-entity`).
 */
import type { GuideSpec, Vec3, WorldDoc } from '@aether/core';
import type { Simulation } from '../../engine/Simulation';
import type { ExploreController, FollowAim } from '../explore';
import { WALK_EYE } from '../walk';
import { askModel } from './ask';
import {
  catalogue,
  COUNTDOWN_S,
  greetingFor,
  keywordAnswer,
  nearestCopy,
  parseReply,
  products,
  requestBody,
  speechSeconds,
  stopLine,
  systemPrompt,
  talkLine,
  TOUR_END,
  TOUR_END_SAVED,
  TOUR_START,
  tourMinutes,
  tourStops,
  type Item,
  type Product,
  type Reply,
  type TourStop,
  type Turn,
} from './brain';
import { GUIDE_ID, GuidePerson } from './person';
import { floorAt, framePiece, openings, viewpoint, walkPath, type ScreenArea, type Viewpoint } from './place';
import { GuideLipSync } from './lipsync';
import { GuideVoice } from './voice';
import { TourGate, type TourPrep } from './tour-gate';

/** The visitor nearer than this (m) is greeted. */
export const GREET_M = 6;
/** Otherwise the greeting comes this long (s) after the guide is in view. */
const GREET_AFTER_S = 4;
/** Longest (ms) the guide waits for her body before saying she is ready anyway (a failed or stalled download). */
export const BODY_WAIT_MS = 20_000;
/** Opening the guide as `aether:ask-guide` names a product. */
export const ASK_EVENT = 'aether:ask-guide';
export const SHOW_EVENT = 'aether:show-product';
const PICK_EVENT = 'aether:pick-entity';
/** The following view keeps this far (m, along her way) behind the guide. */
export const FOLLOW_BACK_M = 2.3;
/** Height (m over her feet) of the guide's head, which the following view keeps in sight. */
const GUIDE_HEAD_M = 1.5;
/**
 * The product card's place at the right of a wide screen (`products.css`, mirrored here to frame pieces left of it):
 * its right margin and width (narrower on mid widths).
 */
const PROD_CARD_RIGHT = 20;
export const productCardWidth = (w: number): number => Math.min(w <= 1180 ? 300 : 360, w - 40);
/** Height kept above the tour bar for the caption (px), and below the top edge for the title. */
const CAPTION_RESERVE_PX = 100;
const FREE_TOP_PX = 84;
/** Farthest (m) the view steps back from a viewpoint to fit a piece in the free screen. */
const MAX_STEP_BACK = 2.5;
/** The view turns to frame the piece when the guide has this little (m) left to walk. */
const FRAME_AT_M = 1.8;

/** One line of the conversation. */
export interface GuideLine {
  id: number;
  who: 'you' | 'guide';
  text: string;
}

/** The guided tour now. */
export interface TourState {
  index: number;
  count: number;
  chapter: string;
  title: string;
  /** The stop shows a product (it can be saved). */
  product: string | null;
  paused: boolean;
  /** The countdown to the next stop runs: its seconds left and a number bumped each time it starts (0: not running). */
  countdown: { seconds: number; seq: number } | null;
}

/** A stop of the progress track. */
export interface TrackStop {
  title: string;
  chapter: string;
  product: string | null;
}

/** A saved piece, for the summary. */
export interface SavedPiece {
  id: string;
  name: string;
  price?: string;
  size?: string;
}

/** What the panel shows. */
export interface GuideSnapshot {
  name: string;
  log: GuideLine[];
  thinking: boolean;
  tour: TourState | null;
  canTour: boolean;
  /** The tour's stops (the track's dots) and its length in minutes. */
  stops: TrackStop[];
  minutes: number;
  /** The welcome card is up (the first greeting). */
  welcome: string | null;
  /** The line being said, as a caption (null: silence). */
  caption: { id: number; text: string } | null;
  /** Product ids saved on the tour. */
  saved: string[];
  /** The end-of-tour card: the saved pieces (null: not shown). */
  summary: SavedPiece[] | null;
  /** Bumped when the guide wants the panel open (Ask the guide, a click on the person, an answer to give). */
  openSeq: number;
  /** The recorded voice: on, off, or none (the world has no recordings). */
  voice: 'on' | 'off' | 'none';
  /** Whether the tour may start yet (tour-gate.ts): the tour buttons read "Preparing the tour… N%" until it may. */
  prep: TourPrep;
}

/** Debug / probe handle (`window.__aetherGuide`). */
export interface GuideHandle {
  snapshot(): GuideSnapshot;
  readonly position: Vec3;
  readonly walking: boolean;
  ask(text: string): Promise<void>;
  startTour(): void;
  startNow(): void;
  route(): string[];
  /** The last walk to a product: the copy, its bounds, the viewpoint and the guide's path (null: none yet). */
  /** How far her mouth is open now (0..1, lip sync). */
  readonly mouth: number;
  readonly lastTrip: { id: string; bounds: { min: Vec3; max: Vec3 }; view: Viewpoint | null; path: Vec3[] | null; ms: number; viewMs: number } | null;
}

declare global {
  interface Window {
    __aetherGuide?: GuideHandle;
  }
}

/** Where the guide walked lately (feet points in a fixed ring, newest last): the following view keeps to it. */
export class Trail {
  private readonly buf: Float64Array;
  private head = 0;
  private n = 0;
  constructor(private readonly max = 96) {
    this.buf = new Float64Array(max * 3);
  }
  /** Point `i` back from the newest (0: newest), into `out`. */
  private at(i: number, out: Vec3): Vec3 {
    const k = ((this.head - 1 - i + this.max * 2) % this.max) * 3;
    out[0] = this.buf[k] as number;
    out[1] = this.buf[k + 1] as number;
    out[2] = this.buf[k + 2] as number;
    return out;
  }
  private readonly _p: Vec3 = [0, 0, 0];
  /** Add the guide's position (once it moved 0.15 m from the last). Nothing is allocated. */
  push(p: Readonly<Vec3>): void {
    if (this.n > 0) {
      const l = this.at(0, this._p);
      if (Math.hypot(p[0] - l[0], p[2] - l[2]) < 0.15) return;
    }
    const k = this.head * 3;
    this.buf[k] = p[0];
    this.buf[k + 1] = p[1];
    this.buf[k + 2] = p[2];
    this.head = (this.head + 1) % this.max;
    this.n = Math.min(this.max, this.n + 1);
  }
  reset(p: Readonly<Vec3>): void {
    this.n = 0;
    this.head = 0;
    this.push(p);
  }
  /** The point `m` metres back along the trail from `from` (the oldest point when it is shorter), into `out`; null: empty. */
  back(from: Readonly<Vec3>, m: number, out: Vec3 = [0, 0, 0]): Vec3 | null {
    if (this.n === 0) return null;
    let left = m;
    let ax = from[0];
    let ay = from[1];
    let az = from[2];
    const b = this._p;
    for (let i = 0; i < this.n; i++) {
      this.at(i, b);
      const d = Math.hypot(b[0] - ax, b[2] - az);
      if (d >= left && d > 1e-6) {
        const k = left / d;
        out[0] = ax + (b[0] - ax) * k;
        out[1] = ay + (b[1] - ay) * k;
        out[2] = az + (b[2] - az) * k;
        return out;
      }
      left -= d;
      ax = b[0];
      ay = b[1];
      az = b[2];
    }
    out[0] = ax;
    out[1] = ay;
    out[2] = az;
    return out;
  }
}

/** Run `fn` when the page is idle (a timeout where the browser has no idle callback). */
const idle = (fn: () => void): void => {
  const w = window as Window & { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(fn, { timeout: 1500 });
  else setTimeout(fn, 60);
};

export class GuideController {
  private readonly person: GuidePerson;
  private readonly list: Product[];
  private readonly items: Item[];
  private readonly ids: Set<string>;
  private readonly system: string;
  private doorPoints: Vec3[] | null = null;
  private readonly skip = new Set([GUIDE_ID]);
  private readonly stops: TourStop[];
  private turns: Turn[] = [];
  private snap: GuideSnapshot;
  private lineId = 0;
  private raf = 0;
  private last = 0;
  private greeted = false;
  private shownFor = 0;
  private hidden = false;
  private typing = false;
  /** The product the visitor is looking at (asked about or a tour stop). */
  private focus: Product | null = null;
  /** Bumped by each walk: a stale arrival does nothing. */
  private trip = 0;
  /**
   * The tour: the stop, paused, its phase (walking there, saying its line, counting down to the next) with the seconds
   * left of the countdown, whether its line was said, and the chapter last introduced.
   */
  private tour: { index: number; paused: boolean; phase: 'walk' | 'talk' | 'count'; left: number; said: boolean; chapter: string | null; seq: number } | null = null;
  private readonly trail = new Trail();
  /** Scratch vectors of the per-frame code (nothing is allocated per frame). */
  private readonly _eye: Vec3 = [0, 0, 0];
  private readonly _back: Vec3 = [0, 0, 0];
  private readonly _head: Vec3 = [0, 0, 0];
  /** Each stop's viewpoint, found once (in idle time ahead of the tour, else on the way), by stop index. */
  private readonly views = new Map<number, Viewpoint | null>();
  /** The guide's way between two stops (`from>to`, stand to stand), found once: a revisit or Back sets off at once. */
  private readonly paths = new Map<string, Vec3[]>();
  /** The stop whose spot the guide stands on (null: elsewhere). */
  private standingAt: number | null = null;
  private precomputing = false;
  private prefetching = false;
  /** The caption's end (ms, performance clock) and a line waiting for it (said once it ends). */
  private captionUntil = 0;
  private captionDone: (() => void) | null = null;
  private queued: { text: string; done?: () => void } | null = null;
  private settle = 0;
  private disposed = false;
  private abort: AbortController | null = null;
  private lastTrip: GuideHandle['lastTrip'] = null;
  private readonly voice: GuideVoice | null;
  /** Her lips, following the line she says. */
  private readonly lips = new GuideLipSync();
  /** The visitor sees the world (the loading screen is gone): only then does she greet. */
  private revealed = false;
  /** Her body is loaded and drawn ready ({@link onReady} called), and since when (ms) it has been waited for. */
  private ready = false;
  private readySince = 0;
  /** The tour waits for the full models and for her (tour-gate.ts); an armed tour came from an answer (`fromAnswer`). */
  private readonly gate = new TourGate();
  private armedFromAnswer = false;
  /** The tour was started with "Start now": full files still loading are held while she walks. */
  private lightStart = false;
  /** Every stop's viewpoint has been looked for (precompute done). */
  private viewsDone = false;

  constructor(
    private readonly sim: Simulation,
    private readonly world: WorldDoc,
    private readonly spec: GuideSpec,
    layer: HTMLElement,
    private readonly explore: () => ExploreController | null,
    private readonly onChange: (s: GuideSnapshot) => void,
    /** Her body has loaded (or will not: it failed) and the scene around her is prepared; the player may reveal the world. */
    private readonly onReady?: () => void,
  ) {
    const name = spec.name || 'Ava';
    this.list = products(world);
    this.items = catalogue(this.list);
    this.ids = new Set(this.list.map((p) => p.id));
    this.system = systemPrompt({ name, ...(spec.about ? { about: spec.about } : {}) }, world.name, this.items);
    const { at, yaw } = this.startPose();
    this.stops = tourStops(world, this.list, spec.tour);
    this.person = new GuidePerson(sim.renderer, layer, name, spec.body ?? 'mio-vrm', at, yaw);
    this.trail.reset(at);
    this.voice = spec.voice ? new GuideVoice(spec.voice) : null;
    if (this.voice) this.voice.onClip = (url) => this.lips.prepare(url);
    this.snap = {
      name,
      log: [],
      thinking: false,
      tour: null,
      canTour: this.stops.length > 1,
      stops: this.stops.map((s) => ({ title: s.title, chapter: s.chapter, product: s.product?.id ?? null })),
      minutes: tourMinutes(this.stops, world.player.spawn),
      welcome: null,
      caption: null,
      saved: [],
      summary: null,
      openSeq: 0,
      voice: this.voice ? 'on' : 'none',
      prep: this.gate.prep,
    };
    window.addEventListener(ASK_EVENT, this.onAskEvent);
    window.addEventListener(PICK_EVENT, this.onPick);
    const canvas = sim.renderer.domElement;
    canvas.addEventListener('pointerdown', this.onVisitorMove);
    canvas.addEventListener('wheel', this.onVisitorMove, { passive: true });
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('pointerdown', this.onBarDown, { capture: true });
    const self = this;
    window.__aetherGuide = {
      snapshot: () => self.snap,
      get position() {
        return [...self.person.pos] as Vec3;
      },
      get walking() {
        return self.person.walking;
      },
      ask: (t) => self.ask(t),
      startTour: () => self.startTour(),
      startNow: () => self.startNow(),
      route: () => self.stops.map((p) => p.id),
      get lastTrip() {
        return self.lastTrip;
      },
      get mouth() {
        return self.lips.value;
      },
    };
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Where the guide stands first: `position` and `yaw`, else 2.5 m in front of the start, facing it. */
  private startPose(): { at: Vec3; yaw: number } {
    const s = this.world.player.spawn;
    const startYaw = ((this.world.player.yaw ?? 0) * Math.PI) / 180;
    let at: Vec3;
    if (this.spec.position) at = [...this.spec.position] as Vec3;
    else at = [s[0] - Math.sin(startYaw) * 2.5, s[1], s[2] - Math.cos(startYaw) * 2.5];
    const yaw = this.spec.yaw ?? Math.atan2(-(s[0] - at[0]), -(s[2] - at[2]));
    return { at, yaw };
  }

  get snapshot(): GuideSnapshot {
    return this.snap;
  }

  private set(patch: Partial<GuideSnapshot>): void {
    this.snap = { ...this.snap, ...patch };
    if (!this.disposed) this.onChange(this.snap);
  }

  private add(who: GuideLine['who'], text: string): void {
    this.set({ log: [...this.snap.log, { id: ++this.lineId, who, text }].slice(-12) });
  }

  /** The guide says a line (bubble and the panel's log). */
  private say(text: string): void {
    this.endCaption();
    this.person.say(text, performance.now());
    this.talk(text);
    this.add('guide', text);
  }

  /** A short line over the person only (not in the log), with its recording. */
  private murmur(text: string): void {
    this.person.say(text, performance.now());
    this.talk(text);
  }

  /**
   * Play the recording of a line (when there is one and the voice is on) and move her lips with it: by its loudness, else
   * at a syllable pace for its reading time. Muted, the lips rest. Same arguments as {@link GuideVoice.play}.
   */
  private talk(text: string, onLength?: (seconds: number) => void, onEnd?: () => void): void {
    const played = this.voice?.play(text, onLength, onEnd) ?? false;
    if (this.voice && !this.voice.enabled) this.lips.stop();
    else this.lips.line(text, played ? this.voice!.current : null, speechSeconds(text), performance.now());
  }

  /**
   * Say a line as a caption (the tour's lines, the welcome): it shows while it is said, as long as its recording plays (else
   * its reading time), and goes in the log. A caption still up holds this one until it ends. `done`: once it has been said.
   */
  private speak(text: string, done?: () => void): void {
    if (performance.now() < this.captionUntil) {
      // The line before finishes first (a chapter intro still being said on arrival); a line waiting is replaced.
      this.queued = { text, ...(done ? { done } : {}) };
      return;
    }
    this.person.hush();
    const t0 = performance.now();
    this.captionUntil = t0 + speechSeconds(text) * 1000 + 400;
    this.captionDone = done ?? null;
    const id = ++this.lineId;
    this.set({ caption: { id, text }, log: [...this.snap.log, { id, who: 'guide' as const, text }].slice(-12) });
    // Timed by the recording when there is one (its length may be known at once: loaded ahead).
    this.talk(
      text,
      (sec) => {
        if (this.snap.caption?.id === id) this.captionUntil = t0 + sec * 1000 + 500;
      },
      () => {
        if (this.snap.caption?.id === id) this.captionUntil = Math.min(this.captionUntil, performance.now() + 350);
      },
    );
  }

  /** Clear the caption now (its `done` runs; a waiting line is dropped). */
  private endCaption(): void {
    this.queued = null;
    this.captionUntil = 0;
    const d = this.captionDone;
    this.captionDone = null;
    if (this.snap.caption) this.set({ caption: null });
    d?.();
  }

  /** Turn the recorded voice on or off. */
  setVoice(on: boolean): void {
    if (!this.voice) return;
    this.voice.setEnabled(on);
    if (!on) this.lips.stop();
    this.set({ voice: on ? 'on' : 'off' });
  }

  /** The panel's text field has focus or a draft: the countdown holds. */
  setTyping(on: boolean): void {
    if (on === this.typing) return;
    this.typing = on;
    this.emitTour();
  }

  /** The world is shown to the visitor (the loading screen gone): the greeting may come. */
  setRevealed(on: boolean): void {
    if (on && !this.revealed) this.shownFor = 0;
    this.revealed = on;
  }

  /**
   * Her body ready: the renderer has her rig and nothing is left to prepare (her programs linked with the rest), or the
   * load gave up on it (the rig never came within {@link BODY_WAIT_MS}). Stands her on the floor, then tells the player.
   */
  private checkReady(now: number): void {
    if (this.ready) return;
    if (this.readySince === 0) this.readySince = now;
    const r = this.sim.renderer;
    const body = !!r.characterRig(GUIDE_ID);
    const idle = r.processingStage === null;
    if (!(body && idle) && now - this.readySince < BODY_WAIT_MS) return;
    this.ready = true;
    if (idle && !this.person.walking) this.standOnFloor();
    this.onReady?.();
  }

  /** Put her feet on the floor under her (the start pose's height is the spawn's, not always the floor's). */
  private standOnFloor(): void {
    const f = floorAt(this.sim.renderer, this.person.pos[0], this.person.pos[2], this.person.pos[1] + 1.2, this.skip);
    if (!f || Math.abs(f.y - this.person.pos[1]) >= 1.2 || Math.abs(f.y - this.person.pos[1]) < 1e-3) return;
    this.person.pos[1] = f.y;
    // Her way starts from where she stands now.
    if (!this.person.walking) this.trail.reset(this.person.pos);
  }

  /** Hide the person and stop greeting (a story playing). */
  setHidden(on: boolean): void {
    this.hidden = on;
    this.person.setVisible(!on);
  }

  private eye(out: Vec3 = [0, 0, 0]): Vec3 {
    const p = this.sim.renderer.camera.position;
    out[0] = p.x;
    out[1] = p.y;
    out[2] = p.z;
    return out;
  }

  /** The bounds of entity `id`: the renderer's once drawn, else a metre round its position. */
  private boundsOf(id: string): { min: Vec3; max: Vec3 } | null {
    const known = this.sim.entityBounds(id);
    if (known) return known;
    const at = this.stops.find((s) => s.id === id)?.position ?? this.list.find((x) => x.id === id)?.position ?? null;
    return at ? { min: [at[0] - 0.5, at[1], at[2] - 0.5], max: [at[0] + 0.5, at[1] + 1, at[2] + 0.5] } : null;
  }

  /**
   * The viewpoint of stop `i`, found once and kept: looked for from the stop before's viewpoint (the visitor comes from
   * there), the first from the start. Undefined while the scene is not drawn yet (nothing is kept then).
   */
  private stopView(i: number): Viewpoint | null | undefined {
    if (this.views.has(i)) return this.views.get(i);
    const st = this.stops[i];
    const b = st && this.sim.entityBounds(st.id);
    if (!st || !b) return undefined;
    const sp = this.world.player.spawn;
    const from = (i > 0 ? this.views.get(i - 1)?.eye : null) ?? ([sp[0], sp[1] + WALK_EYE, sp[2]] as Vec3);
    const vp = viewpoint(this.sim.renderer, st.id, b, from, from[1] - WALK_EYE, this.skip);
    this.views.set(i, vp);
    return vp;
  }

  /** Find the stops' viewpoints ahead of the tour, one per idle moment (the rays never stall a frame). */
  private precompute(): void {
    if (this.precomputing) return;
    this.precomputing = true;
    let i = 0;
    let tries = 0;
    const step = (): void => {
      if (this.disposed) return;
      while (i < this.stops.length && this.views.has(i)) i++;
      if (i >= this.stops.length || tries > 40) {
        this.viewsDone = true;
        return;
      }
      if (this.stopView(i) === undefined) tries++;
      idle(step);
    };
    idle(step);
  }

  /** Find the way from stop `a`'s spot to stop `b`'s while the visitor listens at `a` (spread over frames, kept). */
  private prefetch(a: number, b: number): void {
    const key = `${a}>${b}`;
    const from = this.views.get(a)?.stand;
    const to = this.stopView(b)?.stand;
    if (this.prefetching || this.paths.has(key) || !from || !to) return;
    this.prefetching = true;
    if (!this.doorPoints || this.doorPoints.length === 0) this.doorPoints = openings(this.world, (x) => this.sim.entityBounds(x));
    void walkPath(this.sim.renderer, from, to, this.doorPoints, this.skip, () => this.disposed).then((path) => {
      this.prefetching = false;
      if (path) this.paths.set(key, path);
    });
  }

  // --- questions ----------------------------------------------------------------------------------------------------

  /** Answer the visitor's question (the model, else the keyword match), then walk to what it names. */
  async ask(question: string): Promise<void> {
    const q = question.trim().slice(0, 500);
    if (!q || this.disposed) return;
    this.add('you', q);
    if (this.tour) this.pauseTour();
    if (this.snap.welcome) this.set({ welcome: null });
    this.endCaption();
    this.person.attending = true;
    this.set({ thinking: true });
    this.person.say('…', performance.now(), true);
    const context = this.focus ? `(The visitor is looking at ${this.focus.id}: ${this.focus.name}.)\n` : '';
    this.turns.push({ role: 'user', content: context + q });
    this.abort?.abort();
    const ac = new AbortController();
    this.abort = ac;
    const text = await askModel(requestBody(this.system, this.turns), { signal: ac.signal });
    if (this.disposed || ac.signal.aborted) return;
    this.abort = null;
    const reply: Reply = (text ? parseReply(text, this.ids) : null) ?? keywordAnswer(q, this.items, this.spec);
    this.turns.push({ role: 'assistant', content: JSON.stringify(reply) });
    this.turns = this.turns.slice(-12);
    this.set({ thinking: false });
    // Mid-tour: answer where we stand (no walk away from the stop), then offer to carry on.
    const touring = !!this.tour && reply.goTo !== 'tour';
    this.say(reply.say + (touring ? ' Shall we carry on with the tour?' : ''));
    this.person.attending = !!this.tour;
    if (reply.goTo === 'tour') this.startTour(true);
    else if (reply.goTo && !touring) this.show(reply.goTo);
  }

  /** The product card's Ask the guide: talk about it at once (no model call), then walk there. */
  talkAbout(id: string): void {
    const p = this.list.find((x) => x.id === id);
    if (!p) return;
    if (this.tour) this.pauseTour();
    this.say(talkLine(p));
    this.focus = p;
    this.set({ openSeq: this.snap.openSeq + 1, welcome: null });
    this.show(id, false);
  }

  /** Ask about the saved pieces (the summary's button). */
  askAboutSaved(): void {
    const names = [...new Set(this.snap.saved.map((id) => this.list.find((p) => p.id === id)?.name).filter((n): n is string => !!n))];
    if (names.length === 0) return;
    const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    this.set({ summary: null, openSeq: this.snap.openSeq + 1 });
    void this.ask(`Tell me more about the ${list}.`);
  }

  // --- walking to a stop --------------------------------------------------------------------------------------------

  /**
   * Walk to product `id` (the copy nearest the visitor) and glide the visitor's view in front of it; on arrival the card
   * opens (`aether:show-product`) and `then` runs.
   */
  show(id: string, announce = true, then?: () => void): void {
    const near = nearestCopy(id, this.list, this.eye());
    const p = this.list.find((x) => x.id === near);
    if (!p) return;
    this.focus = p;
    this.visit(p.id, { card: true, announce, follow: false, ...(then ? { then } : {}) });
  }

  /**
   * Walk the guide to entity `id` and bring the visitor's view in front of it. `follow`: the view follows her there at eye
   * level (the tour; else it glides on its own, timed to arrive with her). `card`: open its product card on arrival.
   */
  private visit(id: string, o: { card: boolean; announce: boolean; follow: boolean; then?: () => void; stop?: number }): void {
    const trip = ++this.trip;
    const t0 = performance.now();
    const r = this.sim.renderer;
    const ctrl = this.explore();
    const walkView = !!ctrl && ctrl.snapshot.view === 'walk';
    const camView = !!ctrl && ctrl.snapshot.view !== 'plan';
    const eyeNow = this.eye();
    const floorY = walkView ? eyeNow[1] - WALK_EYE : this.person.pos[1];
    const b = this.boundsOf(id);
    if (!b) {
      o.then?.();
      return;
    }
    // A tour stop's viewpoint is found once (see stopView); anything else from where the visitor is now.
    const kept = o.stop !== undefined ? this.stopView(o.stop) : undefined;
    const vp = kept !== undefined ? kept : viewpoint(r, id, b, eyeNow, floorY, this.skip);
    const fromStop = this.standingAt;
    this.standingAt = null;
    const tView = performance.now();
    const centre: Vec3 = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
    const stand: Vec3 = vp?.stand ?? [centre[0] + 1, floorY, centre[2] + 1];
    // The card opens when the visitor's view arrives (or, without a view move, when the guide does); a guide still on its
    // way a moment later steps to its spot, so it always stands beside the piece while the visitor looks.
    let done = false;
    const stale = (): boolean => trip !== this.trip || this.disposed;
    const arrive = (): void => {
      if (stale() || done) return;
      done = true;
      if (o.card) window.dispatchEvent(new CustomEvent(SHOW_EVENT, { detail: { id } }));
      o.then?.();
      setTimeout(() => {
        if (!stale() && this.person.walking) {
          this.person.place(stand);
          this.trail.reset(stand);
        }
      }, 2500);
    };
    // The openings once the building is drawn (their bounds); found when first needed.
    if (!this.doorPoints || this.doorPoints.length === 0) this.doorPoints = openings(this.world, (x) => this.sim.entityBounds(x));
    // The way is searched over a few frames; the guide sets off once it is known.
    let searched = false;
    this.person.walk([]);
    // The pose that frames the piece in the screen the interface leaves free, found once the view turns to it.
    let shot: { eye: Vec3; look: Vec3 } | null = null;
    const frame = (): { eye: Vec3; look: Vec3 } => (shot ??= vp ? this.framed(vp, b, o.card) : { eye: eyeNow, look: centre });
    const following = o.follow && !!vp && !!ctrl && ctrl.follow((out) => !stale() && this.followAim(frame, searched, out), arrive, this.skip, vp ? frame() : undefined);
    // The way between two stops is kept: from the spot she stands on it is known at once.
    const key = fromStop !== null && o.stop !== undefined ? `${fromStop}>${o.stop}` : null;
    const spot = fromStop !== null ? this.views.get(fromStop)?.stand : undefined;
    const keptPath = key && spot && Math.hypot(spot[0] - this.person.pos[0], spot[2] - this.person.pos[2]) < 0.3 ? this.paths.get(key) : undefined;
    void (keptPath ? Promise.resolve(keptPath) : walkPath(r, this.person.pos, stand, this.doorPoints, this.skip, stale)).then((path) => {
      if (stale()) return;
      searched = true;
      if (path && key && !keptPath) this.paths.set(key, path);
      this.lastTrip = { id, bounds: b, view: vp, path, ms: Math.round(performance.now() - t0), viewMs: Math.round(tView - t0) };
      const seconds = path ? GuidePerson.seconds(this.person.pos, path) : 0;
      const guideArrives = camView && vp ? undefined : arrive;
      if (path) this.person.walk(path, guideArrives);
      else {
        // No clear way: she steps there (the following view fades across).
        this.person.place(stand, guideArrives);
        this.trail.reset(stand);
      }
      if (o.announce && seconds > 1.5 && !this.tour && !this.person.speaking(performance.now())) this.murmur('This way.');
    });
    if (!following && camView && vp && ctrl) {
      // The view sets off a moment after the guide, without waiting for its way to be found, timed by the straight-line
      // walk so the two arrive together.
      const est = Math.hypot(stand[0] - this.person.pos[0], stand[2] - this.person.pos[2]) / 1.3;
      setTimeout(() => {
        if (stale()) return;
        if (!ctrl.lookAt(vp.target, vp.eye, Math.min(7, Math.max(0, est - 0.6)), arrive)) arrive();
      }, 350);
    }
  }

  /**
   * The part of the screen the interface leaves free for the piece (normalised device coordinates), or null on a narrow
   * screen (the card is a bottom sheet there, and the view keeps the plain viewpoint). Left of the product card when one
   * opens (`card`), above the caption and the tour bar, below the title.
   */
  private freeArea(card: boolean): ScreenArea | null {
    const el = this.sim.renderer.domElement;
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (w <= 640 || h < 320) return null;
    const box = el.getBoundingClientRect();
    const right = card ? w - PROD_CARD_RIGHT - productCardWidth(w) - 16 : w - 16;
    const bar = document.querySelector('.pl-gbar')?.getBoundingClientRect();
    const bottom = Math.max(h * 0.4, (bar && bar.height > 0 ? bar.top - box.top : h * 0.66) - CAPTION_RESERVE_PX);
    const top = Math.min(FREE_TOP_PX, h * 0.15);
    if (right - 16 < w * 0.3 || bottom - top < h * 0.2) return null;
    return { x0: -1 + (2 * 16) / w, x1: -1 + (2 * right) / w, y0: 1 - (2 * bottom) / h, y1: 1 - (2 * top) / h };
  }

  /** The viewpoint `vp` turned (and stepped back, room allowing) to frame the piece of `bounds` in the free screen. */
  private framed(vp: Viewpoint, bounds: { min: Vec3; max: Vec3 }, card: boolean): { eye: Vec3; look: Vec3 } {
    const plain = { eye: [...vp.eye] as Vec3, look: [...vp.target] as Vec3 };
    const free = this.freeArea(card);
    if (!free) return plain;
    const r = this.sim.renderer;
    const cam = r.camera as { fov: number; aspect: number };
    // Room behind the eye (away from the piece, in plan), kept clear of walls by half a metre.
    const bx = vp.eye[0] - vp.target[0];
    const bz = vp.eye[2] - vp.target[2];
    const bl = Math.hypot(bx, bz);
    let room = 0;
    if (bl > 1e-3) {
      const hit = r.raycastWorld(vp.eye, [bx / bl, 0, bz / bl], MAX_STEP_BACK + 0.5, this.skip);
      room = Math.max(0, (hit ? Math.hypot(hit.point[0] - vp.eye[0], hit.point[2] - vp.eye[2]) : MAX_STEP_BACK + 0.5) - 0.5);
    }
    const vfov = ((cam.fov || 70) * Math.PI) / 180;
    const aspect = cam.aspect || 16 / 9;
    let shot = framePiece(vp.eye, vp.target, bounds, free, vfov, aspect, room);
    if (Math.hypot(shot.eye[0] - vp.eye[0], shot.eye[2] - vp.eye[2]) > 0.05) {
      // The floor there must be the viewpoint's (not a step down, not a table): else turn only.
      const f = floorAt(r, shot.eye[0], shot.eye[2], shot.eye[1] + 0.3, this.skip);
      if (!f || Math.abs(f.y - (vp.eye[1] - WALK_EYE)) > 0.35) shot = framePiece(vp.eye, vp.target, bounds, free, vfov, aspect, 0);
    }
    return shot;
  }

  /**
   * Where the following view wants to be: a couple of metres behind the guide on the way she walked, looking ahead of her
   * (at her while she is close); once she nears her spot (or before her way is known and she stands), the viewpoint of
   * the piece.
   */
  private followAim(view: () => { eye: Vec3; look: Vec3 }, searched: boolean, out: FollowAim): boolean {
    const g = this.person.pos;
    const { eye, look } = out;
    // Whatever the view does, it never goes through her (nor waits where she walks through it).
    out.avoid = g;
    if (searched && (!this.person.walking || this.person.remaining < FRAME_AT_M)) {
      const v = view();
      for (let i = 0; i < 3; i++) {
        eye[i] = v.eye[i] as number;
        look[i] = v.look[i] as number;
      }
      out.final = true;
      return true;
    }
    out.final = false;
    const cam = this.eye(this._eye);
    const dist = Math.hypot(g[0] - cam[0], g[2] - cam[2]);
    const back = this.trail.back(g, FOLLOW_BACK_M, this._back);
    // Close by (she has just set off, or walks past): stay and watch her; further, keep to her trail.
    if (back && dist > FOLLOW_BACK_M + 0.8) {
      eye[0] = back[0];
      eye[1] = back[1] + WALK_EYE;
      eye[2] = back[2];
      // Behind her on her way: kept in sight of her head (a corner of her way, a wall, the hall's shell between are not
      // followed into; see the explore controller's safeFollowEye).
      const head = this._head;
      head[0] = g[0];
      head[1] = g[1] + GUIDE_HEAD_M;
      head[2] = g[2];
      out.subject = head;
    } else {
      eye[0] = cam[0];
      eye[1] = cam[1];
      eye[2] = cam[2];
    }
    // Ahead of her along her way while she walks (at her while she waits), never right at the eye: someone passing
    // close by is watched over, not looked straight down on.
    const fx = -Math.sin(this.person.yaw);
    const fz = -Math.cos(this.person.yaw);
    const ahead = this.person.walking ? 2.5 : 0;
    look[0] = g[0] + fx * ahead;
    look[1] = g[1] + 1.35;
    look[2] = g[2] + fz * ahead;
    const lx = look[0] - eye[0];
    const lz = look[2] - eye[2];
    const ld = Math.hypot(lx, lz);
    if (ld < 1.5) {
      const ux = ld > 0.2 ? lx / ld : fx;
      const uz = ld > 0.2 ? lz / ld : fz;
      look[0] = eye[0] + ux * 1.5;
      look[2] = eye[2] + uz * 1.5;
    }
    return true;
  }

  // --- the tour -----------------------------------------------------------------------------------------------------

  /**
   * Start the guided tour from the first stop, or, while the full models and the guide are still being prepared
   * (tour-gate.ts), arm it: it then starts by itself once all is ready.
   */
  startTour(fromAnswer = false): void {
    if (this.stops.length === 0) return;
    if (this.tour || this.gate.request(performance.now())) {
      this.beginTour(fromAnswer);
      return;
    }
    this.armedFromAnswer = fromAnswer;
    this.set({ prep: this.gate.prep });
  }

  /**
   * "Start now" while the tour is still being prepared: start from the first stop with whatever has loaded (the light
   * copies); the rest keeps upgrading, its new files held while she walks (see {@link updateGate}). If she is not ready
   * yet, the tour is armed and starts the moment she is.
   */
  startNow(): void {
    if (this.stops.length === 0 || this.tour) return;
    this.lightStart = true;
    this.armedFromAnswer = false;
    if (this.gate.skip(performance.now())) this.beginTour(false);
    this.set({ prep: this.gate.prep });
  }

  /** Set off on the tour (stops the explore bar's own autoplay). */
  private beginTour(fromAnswer: boolean): void {
    const ctrl = this.explore();
    if (ctrl?.snapshot.autoplay) ctrl.setAutoplay(false);
    this.endCaption();
    this.person.hush();
    this.tour = { index: 0, paused: false, phase: 'walk', left: COUNTDOWN_S, said: false, chapter: null, seq: 0 };
    this.set({ welcome: null, summary: null });
    this.precompute();
    if (!fromAnswer && !this.stops[0]?.intro) this.speak(TOUR_START);
    this.goStop(0, false, true);
  }

  /**
   * Go to stop `i`: the chapter's intro on the way (a new chapter), the stop's line on arrival. `quiet`: no lines (its line
   * was said). `keepLine`: the line being said goes on (else it stops).
   */
  goStop(i: number, quiet = false, keepLine = false): void {
    const t = this.tour;
    if (!t) return;
    if (!keepLine) this.endCaption();
    t.index = Math.max(0, Math.min(this.stops.length - 1, i));
    t.paused = false;
    t.phase = 'walk';
    t.said = quiet;
    t.left = COUNTDOWN_S;
    const st = this.stops[t.index] as TourStop;
    this.person.attending = false;
    if (!quiet && st.chapter !== t.chapter) {
      t.chapter = st.chapter;
      if (st.intro) this.speak(st.intro);
    }
    // The stop's line is fetched while the intro plays (the walk there).
    if (!quiet) this.voice?.preload(stopLine(this.stops, t.index));
    const index = t.index;
    // Leaving a stop closes its card: the next stop's opens on arrival (the bar and the card never name different pieces).
    window.dispatchEvent(new CustomEvent(SHOW_EVENT, { detail: { id: null } }));
    this.focus = st.product;
    this.emitTour();
    this.visit(st.id, {
      card: !!st.product,
      announce: false,
      follow: true,
      stop: index,
      then: () => {
        if (this.tour !== t || t.index !== index) return;
        this.standingAt = index;
        this.person.attending = true;
        // While she talks here her way to the next stop is found (spread over frames).
        if (index + 1 < this.stops.length) this.prefetch(index, index + 1);
        t.phase = 'talk';
        this.emitTour();
        const toCount = (): void => {
          if (this.tour !== t || t.index !== index || t.phase !== 'talk') return;
          t.said = true;
          t.phase = 'count';
          t.left = COUNTDOWN_S;
          // Her line said: the next stop's first line is fetched during the countdown (one clip ahead at most).
          this.voice?.preload(this.firstLine(index + 1));
          this.emitTour();
        };
        if (t.said) toCount();
        else this.speak(stopLine(this.stops, t.index), toCount);
      },
    });
  }

  /** The first line said on the way to stop `i` (its chapter's intro, else its line; past the last, the end). */
  private firstLine(i: number): string {
    const st = this.stops[i];
    if (!st) return this.snap.saved.length > 0 ? TOUR_END_SAVED : TOUR_END;
    return st.intro && st.chapter !== this.stops[i - 1]?.chapter ? st.intro : stopLine(this.stops, i);
  }

  /** The countdown is running now (not paused, nobody typing or waiting for an answer). */
  private counting(): boolean {
    const t = this.tour;
    return !!t && t.phase === 'count' && !t.paused && !this.typing && !this.snap.thinking;
  }

  private emitTour(): void {
    const t = this.tour;
    if (!t) {
      if (this.snap.tour) this.set({ tour: null });
      return;
    }
    const st = this.stops[t.index] as TourStop;
    const run = this.counting();
    if (run && !this.snap.tour?.countdown) t.seq++;
    this.set({
      tour: { index: t.index, count: this.stops.length, chapter: st.chapter, title: st.title, product: st.product?.id ?? null, paused: t.paused, countdown: run ? { seconds: t.left, seq: t.seq } : null },
    });
  }

  tourNext(): void {
    const t = this.tour;
    if (!t) return;
    if (t.index >= this.stops.length - 1) this.endTour(true);
    else this.goStop(t.index + 1);
  }

  tourBack(): void {
    const t = this.tour;
    if (t) this.goStop(t.index - 1);
  }

  pauseTour(): void {
    const t = this.tour;
    if (!t || t.paused) return;
    t.paused = true;
    this.explore()?.unfollow();
    this.emitTour();
  }

  /** Carry on from the stop the tour paused at (back in front of it first when the visitor walked away or it was on the way). */
  resumeTour(): void {
    const t = this.tour;
    if (!t) return;
    const st = this.stops[t.index] as TourStop;
    const e = this.eye();
    const away = !st.position || Math.hypot(st.position[0] - e[0], st.position[2] - e[2]) > 5.5;
    if (away || t.phase === 'walk') this.goStop(t.index, t.said);
    else {
      t.paused = false;
      if (t.phase === 'count') t.left = COUNTDOWN_S;
      this.emitTour();
    }
  }

  endTour(finished = false): void {
    if (!this.tour) return;
    this.tour = null;
    this.trip++;
    this.explore()?.unfollow();
    this.person.attending = false;
    // The end card takes the place of the last piece's card.
    window.dispatchEvent(new CustomEvent(SHOW_EVENT, { detail: { id: null } }));
    this.emitTour();
    this.endCaption();
    const saved = this.savedPieces();
    if (finished || saved.length > 0) {
      this.set({ summary: saved });
      this.speak(saved.length > 0 ? TOUR_END_SAVED : TOUR_END);
    } else this.say('All right. Ask me about anything you like.');
  }

  /** Save or unsave the product of the stop shown (or `id`). */
  toggleSaved(id?: string): void {
    const p = id ?? (this.tour ? this.stops[this.tour.index]?.product?.id : undefined);
    if (!p) return;
    const has = this.snap.saved.includes(p);
    this.set({ saved: has ? this.snap.saved.filter((x) => x !== p) : [...this.snap.saved, p] });
    if (this.snap.summary) this.set({ summary: this.savedPieces() });
  }

  private savedPieces(): SavedPiece[] {
    return this.snap.saved
      .map((id) => this.list.find((p) => p.id === id))
      .filter((p): p is Product => !!p)
      .map((p) => ({ id: p.id, name: p.name, ...(p.price ? { price: p.price } : {}), ...(p.size ? { size: p.size } : {}) }));
  }

  /** Close the welcome or the summary card. */
  dismiss(): void {
    this.gate.disarm();
    this.set({ welcome: null, summary: null, prep: this.gate.prep });
  }

  // --- visitor input ------------------------------------------------------------------------------------------------

  /** The visitor moved the view (drag, click, wheel, keys): the tour pauses, never fights them. */
  private readonly onVisitorMove = (): void => {
    if (this.tour && !this.tour.paused) this.pauseTour();
  };

  private readonly onKey = (e: KeyboardEvent): void => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (/^(Key[WASD]|Arrow)/.test(e.code)) this.onVisitorMove();
  };

  /** The explore bar's stops and views move the camera too. */
  private readonly onBarDown = (e: PointerEvent): void => {
    if ((e.target as HTMLElement | null)?.closest?.('.pl-xbar')) this.onVisitorMove();
  };

  private readonly onAskEvent = (e: Event): void => {
    const id = (e as CustomEvent<{ id?: string }>).detail?.id;
    if (typeof id === 'string') this.talkAbout(id);
  };

  /** A click on the guide opens the panel (instead of gliding into it). */
  private readonly onPick = (e: Event): void => {
    if ((e as CustomEvent<{ id?: string }>).detail?.id !== GUIDE_ID) return;
    e.preventDefault();
    this.person.attending = true;
    setTimeout(() => (this.person.attending = !!this.tour), 6000);
    if (!this.greeted) this.greet();
    else {
      this.murmur('Hello again! How can I help?');
      this.set({ openSeq: this.snap.openSeq + 1, welcome: null });
    }
  };

  /** The first greeting: the welcome card (with the tour), else the panel opens. */
  private greet(): void {
    this.greeted = true;
    if (this.snap.canTour) this.precompute();
    const line = greetingFor(this.spec, this.world.name, this.snap.canTour);
    if (this.snap.canTour) {
      this.talk(line);
      this.add('guide', line);
      this.set({ welcome: line });
    } else {
      this.say(line);
      this.set({ openSeq: this.snap.openSeq + 1 });
    }
  }

  // --- frame --------------------------------------------------------------------------------------------------------

  /** Feed the tour's gate (once a frame from the reveal on); an armed tour sets off once it opens. */
  private updateGate(now: number): void {
    const r = this.sim.renderer;
    if (this.snap.canTour) this.precompute();
    const before = this.gate.prep;
    const go = this.gate.update({
      now,
      upgrades: r.modelUpgradeProgress(),
      fraction: r.modelUpgradeFraction(),
      busy: r.processingStage !== null,
      guideReady: this.ready && this.viewsDone,
      hold: this.typing || this.snap.thinking,
    });
    const p = this.gate.prep;
    // A tour started with "Start now" still has full files coming: none starts while she walks (the camera follows her and
    // frames are precious), they carry on when she stops; once all are in the hold is gone.
    if (this.lightStart) {
      const { done, total } = r.modelUpgradeProgress();
      r.holdModelUpgrades(!!this.tour && this.person.walking && done < total);
      if (done >= total) this.lightStart = false;
    }
    if (p.ready && !before.ready) this.voice?.preload(this.stops[0]?.intro || TOUR_START);
    if (p.ready !== before.ready || p.percent !== before.percent || p.armed !== before.armed || p.starting !== before.starting || p.step !== before.step || p.done !== before.done || p.canSkip !== before.canSkip || p.skipped !== before.skipped || p.slow !== before.slow) this.set({ prep: p });
    if (go && !this.tour) this.beginTour(this.armedFromAnswer);
  }

  private readonly frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.25, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    try {
      const eye = this.eye(this._eye);
      this.checkReady(now);
      if (this.revealed) this.updateGate(now);
      // The floor under the guide once the scene is built (the first seconds after it is; not while it loads), while it
      // stands.
      if (this.settle < 12 && !this.person.walking && this.sim.renderer.processingStage === null) {
        this.settle += dt;
        if (Math.floor(this.settle) !== Math.floor(this.settle - dt)) this.standOnFloor();
      }
      this.person.update(dt, now, eye);
      const rig = this.sim.renderer.characterRig(GUIDE_ID);
      const mouth = this.lips.update(dt, now);
      if (rig) rig.mouth = mouth;
      if (mouth > 0) this.sim.renderer.requestRender();
      if (this.person.walking) this.trail.push(this.person.pos);
      if (this.revealed && !this.hidden && !this.greeted && this.sim.mode !== 'play') {
        if (this.shownFor === 0) this.shownFor = now;
        const d = Math.hypot(eye[0] - this.person.pos[0], eye[2] - this.person.pos[2]);
        if (d < GREET_M || now - this.shownFor > GREET_AFTER_S * 1000) this.greet();
      }
      // The caption ends; the line waiting for it is said.
      if (this.snap.caption && now > this.captionUntil) {
        const done = this.captionDone;
        const next = this.queued;
        this.captionDone = null;
        this.queued = null;
        this.set({ caption: null });
        done?.();
        if (next) this.speak(next.text, next.done);
      }
      // The countdown to the next stop (held while the visitor types or waits for an answer).
      const t = this.tour;
      if (t) {
        const run = this.counting();
        if (run !== !!this.snap.tour?.countdown) this.emitTour();
        if (run) {
          t.left -= dt;
          if (t.left <= 0) this.tourNext();
        }
      }
    } catch (err) {
      console.warn('[guide] frame failed', err);
    }
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.abort?.abort();
    this.explore()?.unfollow();
    window.removeEventListener(ASK_EVENT, this.onAskEvent);
    window.removeEventListener(PICK_EVENT, this.onPick);
    const canvas = this.sim.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.onVisitorMove);
    canvas.removeEventListener('wheel', this.onVisitorMove);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('pointerdown', this.onBarDown, { capture: true });
    this.voice?.dispose();
    this.lips.dispose();
    this.person.dispose();
    if (window.__aetherGuide) delete window.__aetherGuide;
  }
}
