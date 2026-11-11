/**
 * The standalone player of published games: no editor, no agent. Loads the
 * game (share-link fragment or `game.json`), shows a title screen over a
 * slow cinematic fly-through of the world, then plays it with a HUD, a
 * pause menu (Esc, or Start on a controller), settings (volume, music, look
 * sensitivity, graphics quality — remembered in this browser), credits
 * generated from the assets the world uses, touch controls on phones and
 * controller support. Block worlds get the full block-game HUD.
 *
 * Every kind of world opens its own way (`experience.ts`): a game on its title card; architecture on a hero view and a
 * guided tour of its rooms at eye level (click the floor to glide, dollhouse, plan); a showcase with a fly-in, then
 * orbit and viewpoints; a city on a street-level view, then a drone tour; a world with a story (`world.story`, start mode
 * `story`) plays its short film first, then its end card. P plays any of them as the character, Tab or O explores (the
 * explore controller and bar load lazily), Esc pauses (in a story: skips to the end card).
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { History, type Json, type WorldDoc } from '@aether/core';
import { creditsFor, loadCatalog, setAboBase, setCatalog, setLibraryRemote, type Credit } from '@aether/assets';
import { createWorkerSandbox, generationLanes, type SandboxRunner } from '@aether/procgen';
import { DDC_CODE_VERSION, distrustCookedPackage, openCookedPackage, worldIrHash, type CookedPackage, type CookMismatch } from '@aether/render';
import { prefersReducedMotion, Simulation, type CombatHud } from '../engine/Simulation';
import { CombatHudView, ScoreLine } from '../components/viewport/CombatHud';
import { recordScore } from '../lib/bestScore';
import { formatStateValue } from '../lib/format';
import type { VoxelHudState } from '../voxel/hudState';
import { VoxelHudView } from '../components/viewport/VoxelHud';
import { NpcSpeechView } from '../components/viewport/NpcSpeech';
import { TouchControlsView } from '../components/viewport/TouchControls';
import { isTouchScreen, touchControlsLine } from '../lib/touchHints';
import type { NpcFrame } from '../engine/npcFrame';
import type { InteractPrompt } from '../engine/interaction';
import { playMusic, musicSeed, type MusicPlayer } from '../publish/video/music';
import type { GameManifest } from '../publish/manifest';
import { ProofBadge } from './ProofBadge';
import { loadGame, loadSave, registerBundledImports, templateRoute, type GameSource } from './source';
import { browserSettingsStorage, defaultSettings, loadSettings, qualityPlan, QUALITIES, saveSettings, type PlayerSettings, type Quality } from './settings';
import { experienceFor, keyAction, keyHint, type Experience, type PlayerPhase } from './experience';
import type { ExploreController, ExploreState } from './explore';
import type { CookView, ViewStopPose } from '@aether/render';
import { TIME_PRESETS } from '../state/archUi';
import type { StoryOverlay, StoryRunner } from './story-runner';
import type { StoryAudio } from './story-audio';
import { playStartAfterStory, storyCast } from './story';
import { FilmPanel, type FilmPanelState } from './FilmPanel';
import { filmFileName, type FilmFps } from './film-schedule';

/** Hour of each time-of-day key (Digit1 … Digit4). */
const TIME_PRESETS_BY_DIGIT: Readonly<Record<string, number>> = Object.freeze(Object.fromEntries(TIME_PRESETS.map((p) => [`Digit${p.key}`, p.hour])));

type Phase = PlayerPhase;
/** The lazily loaded explore module (controller and bar). */
type ExploreModule = typeof import('./ExploreUI');

/** The world shows a building (architecture: the dollhouse applies). */
function hasBuilding(world: WorldDoc): boolean {
  for (const id in world.entities) if (world.entities[id]?.arch?.role === 'building') return true;
  return false;
}

/** The focus is in a text field (keys belong to it). */
function typingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}
type Panel = 'main' | 'settings' | 'credits';

interface Toast {
  id: number;
  text: string;
}

/** Debug / test handle (read-mostly). */
interface PlayerHandle {
  readonly phase: Phase;
  readonly title: string;
  readonly entities: number;
  readonly backend: string | null;
  readonly world: WorldDoc;
  /** The running simulation (test drivers: aim, fire, read the game state). */
  readonly simulation: Simulation | null;
  /** How the world is presented (kind, entry, explore camera). */
  readonly experience: Experience;
  /** Explore mode's state (stops, view, autoplay), null outside it. */
  readonly explore: ExploreState | null;
  /** The explore controller (test drivers: stops, dollhouse, glides), null outside explore mode. */
  readonly exploreController: ExploreController | null;
  /** The running story (time, duration), null outside it. */
  readonly story: { time: number; duration: number; overlay: StoryOverlay | null; clearance(): Array<{ shot: number; entity: string; min: number; at: number[] | null }>; audio: string; audioLevel: number } | null;
  /** The film's start card is up (waiting for Watch). */
  readonly storyGate: boolean;
  /** Play the story from `at` seconds (story worlds). */
  playStory(at?: number): void;
  /** Hold the running film at its current time (true) or let it run on (false). */
  pauseStory(on: boolean): void;
  /** The film export module (probes: its offline sound render). */
  filmModule(): Promise<typeof import('./film-export')>;
  framesModule(): Promise<typeof import('./film-frames')>;
  /** The Render video panel (story worlds): its frame rate, the render's progress, the finished file; null when closed. */
  readonly film: FilmPanelState | null;
  start(): void;
  /** Tab: explore mode. */
  enterExplore(): void;
}

/**
 * How this page loaded its world (probes and scripts/cook.ts read it): from a cooked package or live, and why not cooked.
 * In the cook's recording run (`#t=<slug>&cook=record`) it also carries what the cook serializes.
 */
interface CookHandle {
  /** 'cooked': geometry and programs from the package; 'live': generated here. */
  path: 'cooked' | 'live';
  reason: string | null;
  startMode: 'play' | 'walkthrough' | 'orbit' | 'story' | null;
  /** The world is loaded and the first picture is up. */
  ready: boolean;
  /** Recording run only. */
  record?: { irHash: string; genVersion: string; world: WorldDoc };
}

declare global {
  interface Window {
    __aetherPlayer?: PlayerHandle;
    __aetherCook?: CookHandle;
  }
}

/** Open the game's cooked package for `world` (null: none, or missing or stale; the reason goes to the handle). */
async function openCooked(game: GameManifest, world: WorldDoc, handle: CookHandle): Promise<CookedPackage | null> {
  if (!game.cook) {
    handle.reason = 'no cooked package';
    return null;
  }
  const r = await openCookedPackage(game.cook, world);
  if (!r.ok) {
    handle.reason = r.reason;
    console.info(`[player] loading live: ${r.reason}`);
    return null;
  }
  handle.path = 'cooked';
  return r.pkg;
}

function clock(t: number): string {
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function createSandbox(): SandboxRunner | null {
  try {
    return typeof Worker !== 'undefined' ? createWorkerSandbox({ poolSize: generationLanes(), maxQueue: 4096 }) : null;
  } catch {
    return null;
  }
}

/**
 * Library files live next to this page (sub-path hosting: itch.io, GitHub Pages, the local library), and so do the
 * streamed products (Amazon Berkeley Objects) a build carries: the page never fetches them from Hugging Face.
 */
async function relativeLibrary(game: GameManifest): Promise<void> {
  const c = await loadCatalog();
  const base = new URL('assets/lib/', document.baseURI).pathname;
  if (game.packs?.includes('abo')) setAboBase(base);
  if (c.base !== base) {
    setLibraryRemote(null);
    try {
      setCatalog({ ...c, base });
    } catch {
      /* keep the default base */
    }
  }
}

const Button = ({ children, primary, onClick, autoFocus, testId }: { children: ReactNode; primary?: boolean; onClick: () => void; autoFocus?: boolean; testId?: string }): ReactElement => (
  <button type="button" className={`pl-btn${primary ? ' pl-btn--primary' : ''}`} onClick={onClick} autoFocus={autoFocus} data-testid={testId}>
    {children}
  </button>
);

const SettingsPanel = memo(function SettingsPanel({ settings, onChange, onBack, hasMusic }: { settings: PlayerSettings; onChange: (s: PlayerSettings) => void; onBack: () => void; hasMusic: boolean }): ReactElement {
  const slider = (label: string, key: 'volume' | 'music' | 'sensitivity', min: number, max: number, step: number, fmt: (v: number) => string): ReactElement => (
    <label className="pl-field">
      <span className="pl-field__label">{label}</span>
      <input type="range" min={min} max={max} step={step} value={settings[key]} onChange={(e) => onChange({ ...settings, [key]: Number(e.target.value) })} />
      <span className="pl-field__value">{fmt(settings[key])}</span>
    </label>
  );
  return (
    <div className="pl-panel" role="group" aria-label="Settings">
      <h2 className="pl-panel__title">Settings</h2>
      {slider('Sound effects', 'volume', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`)}
      {hasMusic && slider('Music', 'music', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`)}
      {slider('Look sensitivity', 'sensitivity', 0.25, 3, 0.05, (v) => `${v.toFixed(2)}×`)}
      <div className="pl-field">
        <span className="pl-field__label">Graphics</span>
        <div className="pl-seg" role="radiogroup" aria-label="Graphics quality">
          {QUALITIES.map((q: Quality) => (
            <button key={q} type="button" role="radio" aria-checked={settings.quality === q} className={`pl-seg__item${settings.quality === q ? ' is-on' : ''}`} onClick={() => onChange({ ...settings, quality: q })}>
              {q === 'low' ? 'Low' : q === 'medium' ? 'Medium' : 'High'}
            </button>
          ))}
        </div>
      </div>
      <label className="pl-field pl-field--check">
        <span className="pl-field__label">Reduce motion</span>
        <input type="checkbox" checked={settings.reduceMotion} onChange={(e) => onChange({ ...settings, reduceMotion: e.target.checked })} data-testid="pl-reduce-motion" />
        <span className="pl-field__value">{settings.reduceMotion ? 'No shake or flashes' : 'Off'}</span>
      </label>
      <div className="pl-panel__actions">
        <Button onClick={onBack} autoFocus>
          Back
        </Button>
      </div>
    </div>
  );
});

const CreditsPanel = memo(function CreditsPanel({ game, credits, onBack }: { game: GameManifest; credits: Credit[]; onBack: () => void }): ReactElement {
  return (
    <div className="pl-panel pl-panel--scroll" role="group" aria-label="Credits">
      <h2 className="pl-panel__title">Credits</h2>
      <p className="pl-credit">
        <b>{game.title}</b>
        {game.author ? <> by {game.author}</> : null}
      </p>
      {credits.length === 0 ? (
        <p className="pl-muted">Everything in this world is procedural: no third-party assets.</p>
      ) : (
        credits.map((c) => (
          <p key={c.source} className="pl-credit">
            <b>{c.source}</b> by {c.author} · {c.licence}
            <span className="pl-muted"> — {c.assets.slice(0, 6).join(', ')}{c.assets.length > 6 ? ` and ${c.assets.length - 6} more` : ''}</span>
          </p>
        ))
      )}
      {(game.attribution ?? []).map((line) => (
        <p key={line} className="pl-credit pl-muted">
          {line}
        </p>
      ))}
      <p className="pl-muted pl-made">Made with Aether · rendered with three.js · physics by Rapier</p>
      <div className="pl-panel__actions">
        <Button onClick={onBack} autoFocus>
          Back
        </Button>
      </div>
    </div>
  );
});

/**
 * The story's overlay: cinema bars, the title card, subtitle lines and, at the end, the end card. Play, Explore and Skip
 * stay on screen the whole time.
 */
/**
 * The film's start card: browsers hold sound until the visitor acts, so the film waits on the opening view for a click
 * ("Watch (with sound)" starts the score and the ambience in that gesture), or plays muted, or is passed over.
 */
const StoryGate = memo(function StoryGate({ story, title, onWatch, onExplore, onPlay, canPlay }: { story: NonNullable<WorldDoc['story']>; title: string; onWatch: (sound: boolean) => void; onExplore: () => void; onPlay: () => void; canPlay: boolean }): ReactElement {
  return (
    <div className="pl-story is-gate" style={{ ['--lb' as string]: String(story.letterbox) }} data-testid="pl-story-gate">
      <div className="pl-story__bar pl-story__bar--top" aria-hidden="true" />
      <div className="pl-story__bar pl-story__bar--bottom" aria-hidden="true" />
      <div className="pl-story__end pl-story__gate" role="dialog" aria-label="Watch the film">
        <h2>{story.title ?? title}</h2>
        <p>A short film, about {Math.round(story.shots.reduce((t, s) => t + s.duration, 0) / 10) * 10} seconds</p>
        <div className="pl-stack pl-stack--row">
          {/* Explore leads: the world itself is the thing; the film is one click away. */}
          <Button primary onClick={onExplore} autoFocus testId="pl-story-gate-explore">
            Explore
          </Button>
          <Button onClick={() => onWatch(true)} testId="pl-story-watch">
            ▶ Watch (with sound)
          </Button>
          <Button onClick={() => onWatch(false)} testId="pl-story-watch-muted">
            Watch muted
          </Button>
          {canPlay && (
            <Button onClick={onPlay} testId="pl-story-gate-play">
              Play
            </Button>
          )}
        </div>
      </div>
    </div>
  );
});

const StoryView = memo(function StoryView({ story, overlay, title, onSkip, onReplay, onExplore, onPlay, canPlay, muted, onMute, onRender }: { story: NonNullable<WorldDoc['story']>; overlay: StoryOverlay | null; title: string; onSkip: () => void; onReplay: () => void; onExplore: () => void; onPlay: () => void; canPlay: boolean; muted: boolean; onMute: () => void; onRender: () => void }): ReactElement {
  const done = overlay?.done ?? false;
  const end = story.endCard;
  return (
    <div className={`pl-story${done ? ' is-done' : ''}`} style={{ ['--lb' as string]: String(story.letterbox) }} data-testid="pl-story">
      <div className="pl-story__bar pl-story__bar--top" aria-hidden="true" />
      <div className="pl-story__bar pl-story__bar--bottom" aria-hidden="true" />
      {!done && overlay?.title && (
        <div className="pl-story__title" key={`t${overlay.index}`}>
          <h1>{overlay.title}</h1>
          {overlay.subtitle && <p>{overlay.subtitle}</p>}
        </div>
      )}
      {!done && overlay?.caption && (
        <p className="pl-story__caption" key={`c${overlay.index}${overlay.caption}`} aria-live="polite">
          {overlay.caption}
        </p>
      )}
      {done && (
        <div className="pl-story__end" role="dialog" aria-label="The end">
          <h2>{end?.title ?? story.title ?? title}</h2>
          {(end?.lines ?? []).map((l) => (
            <p key={l}>{l}</p>
          ))}
          <div className="pl-stack pl-stack--row">
            {canPlay && (
              <Button primary onClick={onPlay} autoFocus testId="pl-story-play">
                Play
              </Button>
            )}
            <Button onClick={onExplore} testId="pl-story-explore">
              Explore
            </Button>
            <Button onClick={onReplay} testId="pl-story-replay">
              Watch again
            </Button>
            <Button onClick={onMute} testId="pl-story-sound-end">
              {muted ? 'Sound off' : 'Sound on'}
            </Button>
            <Button onClick={onRender} testId="pl-story-render-end">
              Render video
            </Button>
          </div>
        </div>
      )}
      {!done && (
        <div className="pl-story__controls">
          {canPlay && (
            <button type="button" className="pl-story__chip" onClick={onPlay} data-testid="pl-story-play">
              Play <kbd>P</kbd>
            </button>
          )}
          <button type="button" className="pl-story__chip" onClick={onExplore} data-testid="pl-story-explore">
            Explore <kbd>Tab</kbd>
          </button>
          <button type="button" className="pl-story__chip" onClick={onMute} aria-pressed={!muted} data-testid="pl-story-sound">
            {muted ? 'Sound off' : 'Sound on'} <kbd>M</kbd>
          </button>
          <button type="button" className="pl-story__chip" onClick={onRender} data-testid="pl-story-render">
            Render video
          </button>
          <button type="button" className="pl-story__chip" onClick={onSkip} data-testid="pl-story-skip">
            Skip <kbd>Space</kbd>
          </button>
        </div>
      )}
    </div>
  );
});

/** The running game: canvas, title screen, HUD and menus. */
const GameView = memo(function GameView({ game }: { game: GameManifest }): ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<Simulation | null>(null);
  const musicRef = useRef<MusicPlayer | null>(null);
  const musicTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [phase, setPhase] = useState<Phase>('booting');
  const phaseRef = useRef<Phase>('booting');
  const [panel, setPanel] = useState<Panel>('main');
  const [loading, setLoading] = useState('Starting the renderer…');
  const [fatal, setFatal] = useState<string | null>(null);
  const [hud, setHud] = useState<Record<string, string>>({});
  const [time, setTime] = useState(0);
  const [over, setOver] = useState<{ win: boolean; text: string; score?: number; best?: number; record?: boolean } | null>(null);
  const [combat, setCombat] = useState<CombatHud | null>(null);
  const [voxelHud, setVoxelHud] = useState<VoxelHudState | null>(null);
  const [npc, setNpc] = useState<NpcFrame | null>(null);
  const [interact, setInteract] = useState<InteractPrompt | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [credits, setCredits] = useState<Credit[]>([]);
  const storage = useMemo(() => browserSettingsStorage(), []);
  const [settings, setSettings] = useState<PlayerSettings>(() => {
    const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    return loadSettings(storage, defaultSettings(mem, prefersReducedMotion()));
  });
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const world = game.world;
  const exp = useMemo(() => experienceFor(game.startMode, game.profile, hasBuilding(world), !!world.story), [game.startMode, game.profile, world]);
  const [explore, setExplore] = useState<ExploreState | null>(null);
  const [exploreMod, setExploreMod] = useState<ExploreModule | null>(null);
  const exploreRef = useRef<ExploreController | null>(null);
  /** Stops of the cooked package (computed by the cook); the world's own `views` win. */
  const cookedViews = useRef<CookView[] | undefined>(undefined);
  /** Stops once chosen (computing them is a scene search: once per page). */
  const stopsRef = useRef<ViewStopPose[] | null>(null);
  /** The running search of computed stops (`renderer.viewStopsAsync`). */
  const stopsSearch = useRef<Promise<void> | null>(null);
  /** Where the pause menu returns to. */
  const pausedFrom = useRef<'playing' | 'exploring'>('playing');
  /** The story being played (story worlds), its overlay and its fade layer. */
  const storyRef = useRef<StoryRunner | null>(null);
  const [storyOverlay, setStoryOverlay] = useState<StoryOverlay | null>(null);
  const storyOverlayRef = useRef<StoryOverlay | null>(null);
  const storyFadeRef = useRef<HTMLDivElement>(null);
  /** The film's sound (one per run of the film; muted or not is remembered, `aether.player.mute`). */
  const storyAudioRef = useRef<StoryAudio | null>(null);
  /** The sound module, loaded with the start card, so a click can open the audio context inside its own gesture. */
  const storyAudioMod = useRef<typeof import('./story-audio') | null>(null);
  /** A context opened by the start card's click, for the film that click starts. */
  const pendingAudio = useRef<StoryAudio | null>(null);
  /** The start card is up (the film waits for a click; see StoryGate). */
  const [storyGate, setStoryGate] = useState(false);
  const storyGateRef = useRef(false);
  storyGateRef.current = storyGate;
  const [storyMuted, setStoryMuted] = useState(() => {
    try {
      return localStorage.getItem('aether.player.mute') === '1';
    } catch {
      return false;
    }
  });
  const storyMutedRef = useRef(storyMuted);
  storyMutedRef.current = storyMuted;
  const toggleStoryMute = useCallback(() => {
    const m = !storyMutedRef.current;
    storyMutedRef.current = m;
    setStoryMuted(m);
    storyAudioRef.current?.set({ muted: m });
    if (!m) storyAudioRef.current?.resume();
    try {
      localStorage.setItem('aether.player.mute', m ? '1' : '0');
    } catch {
      /* private mode */
    }
  }, []);
  /** The story's views were drawn once (see StoryRunner.prewarm). */
  const storyWarm = useRef(false);

  const go = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  const toast = useCallback((text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, text: text.slice(0, 300) }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  const stopMusic = useCallback(() => {
    if (musicTimer.current) clearTimeout(musicTimer.current);
    musicTimer.current = null;
    musicRef.current?.stop();
    musicRef.current = null;
  }, []);

  const startMusic = useCallback(() => {
    stopMusic();
    const mood = game.music;
    const vol = settingsRef.current.music;
    if (!mood || vol <= 0) return;
    const seconds = 240;
    musicRef.current = playMusic(mood, seconds, { seed: musicSeed(world.name), volume: vol });
    // Loop: a fresh score when this one ends.
    musicTimer.current = setTimeout(() => startMusic(), (seconds - 0.5) * 1000);
  }, [game.music, stopMusic, world.name]);

  const applySettings = useCallback((s: PlayerSettings) => {
    const sim = simRef.current;
    if (!sim) return;
    const q = qualityPlan(s.quality);
    sim.setLowMemory(q.lowMemory);
    sim.renderer.setPixelRatioCap(q.pixelRatioCap);
    sim.setVolume(s.volume);
    sim.setLookSensitivity(s.sensitivity);
    sim.setReducedMotion(s.reduceMotion);
  }, []);

  const updateSettings = useCallback(
    (s: PlayerSettings) => {
      const musicChanged = s.music !== settingsRef.current.music;
      setSettings(s);
      settingsRef.current = s;
      saveSettings(storage, s);
      applySettings(s);
      if (musicChanged && (phaseRef.current === 'playing' || phaseRef.current === 'paused')) startMusic();
    },
    [applySettings, startMusic, storage],
  );

  const leaveExplore = useCallback(() => {
    exploreRef.current?.dispose();
    exploreRef.current = null;
    setExplore(null);
  }, []);

  const leaveStory = useCallback(() => {
    storyRef.current?.dispose();
    storyRef.current = null;
    storyAudioRef.current?.dispose();
    storyAudioRef.current = null;
    storyOverlayRef.current = null;
    setStoryOverlay(null);
  }, []);

  /** The world's short film from `at` seconds (the story's runner and overlay load lazily). */
  const playStory = useCallback(
    async (at = 0) => {
      const sim = simRef.current;
      const story = world.story;
      if (!sim || !story) return;
      const [{ StoryRunner }, { StoryAudio }] = await Promise.all([import('./story-runner'), import('./story-audio')]);
      if (simRef.current !== sim) return;
      leaveExplore();
      leaveStory();
      if (sim.mode === 'play') {
        stopMusic();
        await sim.stop();
      }
      setStoryGate(false);
      const audio = pendingAudio.current ?? new StoryAudio({ volume: settingsRef.current.volume, music: settingsRef.current.music, muted: storyMutedRef.current });
      pendingAudio.current = null;
      storyAudioRef.current = audio;
      const runner = new StoryRunner(sim.renderer, world, story, {
        audio,
        onOverlay: (o) => {
          storyOverlayRef.current = o;
          setStoryOverlay(o);
        },
        fadeEl: () => storyFadeRef.current,
        reduceMotion: settingsRef.current.reduceMotion,
      });
      runner.prepare();
      storyRef.current = runner;
      go('story');
      // The first time, each shot's view is drawn once under the opening fade (no upload stalls on the cuts).
      if (!storyWarm.current) {
        storyWarm.current = true;
        await runner.prewarm();
        if (storyRef.current !== runner) return;
      }
      runner.start(at);
    },
    [go, leaveExplore, leaveStory, stopMusic, world],
  );

  /** The start card's buttons: open the audio context in this click (so the browser lets it play), then the film. */
  const watchStory = useCallback(
    (sound: boolean) => {
      const mod = storyAudioMod.current;
      if (sound && storyMutedRef.current) {
        storyMutedRef.current = false;
        setStoryMuted(false);
        try {
          localStorage.setItem('aether.player.mute', '0');
        } catch {
          /* private mode */
        }
      }
      if (mod) {
        const audio = new mod.StoryAudio({ volume: settingsRef.current.volume, music: settingsRef.current.music, muted: !sound });
        if (sound) audio.resume();
        pendingAudio.current = audio;
      }
      setStoryGate(false);
      void playStory(0);
    },
    [playStory],
  );

  /** Render video (the film offline, `film-export.ts`): the panel, the film's time when it opened, the running render. */
  const [film, setFilm] = useState<FilmPanelState | null>(null);
  const filmRef = useRef<FilmPanelState | null>(null);
  filmRef.current = film;
  const filmAbort = useRef<AbortController | null>(null);
  const filmAt = useRef(0);
  const openFilm = useCallback(() => {
    if (filmRef.current) return;
    // The live film holds (picture and sound) while the panel is up.
    storyRef.current?.pause(true);
    storyAudioRef.current?.set({ muted: true });
    filmAt.current = storyRef.current?.time ?? 0;
    setFilm({ fps: 30, progress: null, done: null, error: null });
  }, []);
  const closeFilm = useCallback(() => {
    filmAbort.current?.abort();
    const f = filmRef.current;
    if (f?.done) URL.revokeObjectURL(f.done.url);
    setFilm(null);
    const r = storyRef.current;
    if (r) {
      r.pause(false);
      storyAudioRef.current?.set({ muted: storyMutedRef.current });
    } else void playStory(filmAt.current);
  }, [playStory]);
  const renderFilm = useCallback(async () => {
    const sim = simRef.current;
    const f = filmRef.current;
    if (!sim || !f || f.progress || !world.story) return;
    if (f.done) URL.revokeObjectURL(f.done.url);
    const ac = new AbortController();
    filmAbort.current = ac;
    setFilm({ ...f, progress: { phase: 'preparing', frame: 0, frames: 0 }, done: null, error: null });
    // The live film stops: the export runs its own runner on the film clock and owns the renderer until it ends.
    leaveStory();
    let last = 0;
    try {
      const { exportStoryFilm } = await import('./film-export');
      const r = await exportStoryFilm(sim.renderer, world, {
        fps: f.fps,
        volume: settingsRef.current.volume,
        music: settingsRef.current.music,
        signal: ac.signal,
        onProgress: (p) => {
          const now = performance.now();
          if (p.phase === 'rendering' && p.frame < p.frames && now - last < 250) return;
          last = now;
          setFilm((s) => (s ? { ...s, progress: p } : s));
        },
      });
      const url = URL.createObjectURL(r.blob);
      const name = filmFileName(world.story.title ?? game.title, r.fps, r.ext);
      const mb = r.blob.size / (1024 * 1024);
      const detail = `${r.width}×${r.height}, ${r.fps} fps, ${r.seconds.toFixed(1)} s, ${r.ext.toUpperCase()}${r.audio ? ' with sound' : ''}, ${mb.toFixed(1)} MB`;
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.append(a);
      a.click();
      a.remove();
      (window as { __aetherFilm?: unknown }).__aetherFilm = { ...r, blob: undefined, size: r.blob.size, name };
      setFilm((s) => (s ? { ...s, progress: null, done: { url, name, detail } } : s));
    } catch (e) {
      const cancelled = e instanceof DOMException && e.name === 'AbortError';
      setFilm((s) => (s ? { ...s, progress: null, error: cancelled ? 'Cancelled.' : `The video could not be made: ${e instanceof Error ? e.message.slice(0, 200) : 'error'}` } : s));
    } finally {
      if (filmAbort.current === ac) filmAbort.current = null;
    }
  }, [game.title, leaveStory, world]);

  /**
   * Explore mode: the kind's camera and the tour bar. `entry`: the kind's opening (hero view and tour, fly-in, street
   * view and drone); `from`: stand there (Tab from play in a walk).
   */
  const enterExplore = useCallback(
    async (entry: boolean, from: { feet: [number, number, number]; yaw: number } | null = null) => {
      const sim = simRef.current;
      if (!sim) return;
      const mod = await import('./ExploreUI');
      if (simRef.current !== sim) return;
      setExploreMod(() => mod);
      leaveExplore();
      // The world's own stops or the cook's at once; computed ones (a scene search of a second or more on a large world)
      // after the entry has started on the hero view alone.
      let pending = false;
      if (!stopsRef.current) {
        const known = mod.pickStops(world.views, cookedViews.current, () => []);
        if (known.length > 0) stopsRef.current = known;
        else pending = true;
      }
      const hero = sim.renderer.openingPose();
      const initial = stopsRef.current ?? (hero ? [{ position: hero.position, target: hero.target, ...(hero.fov !== undefined ? { fov: hero.fov } : {}) }] : []);
      const ctrl = new mod.ExploreController(sim, exp, initial, (st) => setExplore(st), { reduceMotion: settingsRef.current.reduceMotion });
      exploreRef.current = ctrl;
      go('exploring');
      ctrl.start(entry, from);
      if (pending && !stopsSearch.current) {
        // Once per page, in slices that keep the view drawing; whichever explore controller is up then takes them.
        stopsSearch.current = new Promise<void>((done) => setTimeout(done, 700))
          .then(() => sim.renderer.viewStopsAsync(undefined, { street: exp.kind === 'city' || exp.explore === 'drone' }))
          .then((stops) => {
            if (simRef.current !== sim || stops.length === 0) return;
            stopsRef.current = stops;
            exploreRef.current?.setStops(stops);
          });
      }
    },
    [exp, go, leaveExplore, world.views],
  );

  const attract = useCallback(async () => {
    const sim = simRef.current;
    if (!sim) return;
    // Architecture, showcases and cities open in explore mode on their own entry; games on the title card. The cook's
    // recording run stays on the opening view (it measures the load there).
    if (exp.kind !== 'game' && templateRoute(location.hash)?.cook === 'record') {
      await sim.openWorld({ duration: 0 });
      return;
    }
    if (exp.kind === 'story') {
      await sim.openWorld({ duration: 0 });
      // The start card over the film's opening view, in its grade; the modules load meanwhile.
      const first = world.story?.shots[0];
      if (first) {
        sim.renderer.lookAt(first.camera.position, first.camera.target, first.camera.fov);
        if (first.grade) sim.renderer.setShotGrade?.(first.grade);
      }
      storyAudioMod.current = await import('./story-audio');
      void import('./story-runner');
      if (simRef.current !== sim) return;
      go('story');
      setStoryGate(true);
      return;
    }
    if (exp.kind !== 'game') {
      await sim.openWorld({ duration: 0 });
      await enterExplore(true);
      return;
    }
    await sim.frameWorld();
    // A slow cinematic loop behind the title screen, starting from the framed view.
    setTimeout(() => {
      if (phaseRef.current === 'title' && simRef.current === sim) sim.renderer.startTour(60);
    }, 900);
  }, [enterExplore, exp.kind, playStory]);

  const start = useCallback(async () => {
    const sim = simRef.current;
    const from = phaseRef.current;
    if (!sim || (from !== 'title' && from !== 'over' && from !== 'exploring' && from !== 'story' && !(from === 'paused' && pausedFrom.current === 'exploring'))) return;
    // Play from explore mode: a walk hands its spot over (the character stands where the visitor stood); from a story,
    // where its film puts the visitor.
    // After the film: its playFrom, else the spot of the person the last shot followed, else the world's play spawn.
    const afterFilm = from === 'story' ? playStartAfterStory(world) : null;
    const standing = exploreRef.current?.standing ?? afterFilm;
    leaveExplore();
    leaveStory();
    go('starting');
    sim.renderer.stopTour();
    sim.renderer.stopGhost();
    setOver(null);
    setHud({});
    setTime(0);
    // Every kind but a game plays as the human character, even a world whose player is an orbit camera.
    if (sim.mode === 'play') await sim.restart();
    else await sim.play({ onFoot: exp.kind !== 'game' });
    if (sim.mode !== 'play') {
      if (exp.kind === 'game') go('title');
      else void enterExplore(false);
      return;
    }
    if (exp.kind !== 'game') {
      // Any kind plays as the human character, seen from behind (a walkthrough world's first person would hide them).
      if (standing) sim.placePlayer(standing.feet, standing.yawDeg);
      sim.setCameraView('follow');
    }
    // The story's people step aside: the visitor plays the one the film followed.
    for (const id of storyCast(world)) sim.renderer.setEntityProperty(id, 'visible', false);
    go('playing');
    startMusic();
  }, [enterExplore, exp.kind, go, leaveExplore, leaveStory, startMusic, world]);

  /** Tab or O: explore mode from play or from the title card. */
  const toExplore = useCallback(async () => {
    const sim = simRef.current;
    if (!sim) return;
    const p = phaseRef.current;
    if (p === 'title') {
      sim.renderer.stopTour();
      await enterExplore(false);
      return;
    }
    if (p === 'story') {
      leaveStory();
      await enterExplore(false);
      return;
    }
    if (p !== 'playing') return;
    const feet = sim.playerPosition;
    const from = feet ? { feet: [feet[0], feet[1], feet[2]] as [number, number, number], yaw: (-sim.playerHeading() * Math.PI) / 180 } : null;
    stopMusic();
    setCombat(null);
    await sim.stop();
    await enterExplore(false, from);
  }, [enterExplore, leaveStory, stopMusic]);

  const pause = useCallback(
    (on: boolean) => {
      const sim = simRef.current;
      if (!sim) return;
      if (on && phaseRef.current === 'playing') {
        pausedFrom.current = 'playing';
        sim.setPaused(true);
        setPanel('main');
        go('paused');
      } else if (on && phaseRef.current === 'exploring') {
        pausedFrom.current = 'exploring';
        setPanel('main');
        go('paused');
      } else if (!on && phaseRef.current === 'paused') {
        if (pausedFrom.current === 'exploring') {
          go('exploring');
          return;
        }
        sim.setPaused(false);
        go('playing');
      }
    },
    [go],
  );

  const quitToTitle = useCallback(async () => {
    const sim = simRef.current;
    if (!sim) return;
    stopMusic();
    leaveExplore();
    await sim.stop();
    setOver(null);
    setVoxelHud(null);
    setPanel('main');
    if (exp.kind === 'game') go('title');
    void attract();
  }, [attract, exp.kind, go, leaveExplore, stopMusic]);

  const restart = useCallback(async () => {
    const sim = simRef.current;
    if (!sim) return;
    setOver(null);
    setHud({});
    setTime(0);
    setCombat(null);
    if (world.intro || exp.kind !== 'game') {
      // As in the studio: a game with a title card starts every run from it (Play builds a fresh session); other kinds
      // return to explore mode.
      stopMusic();
      sim.setPaused(false);
      await sim.stop();
      setPanel('main');
      if (exp.kind === 'game') {
        go('title');
        void attract();
      } else await enterExplore(false);
      return;
    }
    await sim.restart();
    sim.setPaused(false);
    go('playing');
  }, [attract, enterExplore, exp.kind, go, stopMusic, world.intro]);

  // Boot: renderer, world, attract mode.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    const canvas = document.createElement('canvas');
    canvas.className = 'pl-canvas';
    canvas.setAttribute('aria-label', `${game.title} — 3D view`);
    host.prepend(canvas);
    const sandbox = createSandbox();
    const route = templateRoute(location.hash);
    const cookHandle: CookHandle = { path: 'live', reason: null, startMode: game.startMode ?? null, ready: false };
    window.__aetherCook = cookHandle;
    void (async () => {
      try {
        const [cooked] = await Promise.all([openCooked(game, world, cookHandle), relativeLibrary(game).then(() => registerBundledImports(game))]);
        if (route?.cook === 'record') cookHandle.record = { irHash: await worldIrHash(world), genVersion: DDC_CODE_VERSION, world };
        // The view the cook opened on, where the IR has none of its own (the renderer then skips choosing one).
        const opening = cooked?.manifest.opening;
        cookedViews.current = cooked?.manifest.views;
        const doc: WorldDoc = opening && !world.opening ? { ...world, opening } : world;
        const history = new History(doc, { maxEntries: 4 });
        const s0 = settingsRef.current;
        const q = qualityPlan(s0.quality);
        const sim = await Simulation.create(
          canvas,
          history,
          {
            onHud: (values: Record<string, Json | undefined>, t: number) => {
              const out: Record<string, string> = {};
              for (const k of Object.keys(values)) out[k] = formatStateValue(values[k]);
              setHud(out);
              setTime(Math.floor(t));
            },
            onMessage: (text) => toast(text),
            onNpc: (frame) => setNpc(frame),
            onInteract: (prompt) => setInteract(prompt),
            onGameOver: (result, text) => {
              // A game that keeps a score shows it, with the best run on this device (the studio does the same).
              const raw = simRef.current?.logic?.readState('score');
              const score = typeof raw === 'number' && Number.isFinite(raw) ? Math.round(raw) : undefined;
              const kept = score !== undefined ? recordScore(`${world.id}:${world.name}`, score) : undefined;
              setOver({ win: result === 'win', text, ...(score !== undefined && kept ? { score, best: kept.best, record: kept.record } : {}) });
              go('over');
            },
            onCombat: (c) => setCombat(c),
            onError: (message) => toast(message),
            onFatal: (message) => {
              setFatal(message);
              go('failed');
            },
            onContextLost: () => {
              setFatal('The graphics device was reset. Reload the page to keep playing.');
              go('failed');
            },
            onVoxelHud: (state) => setVoxelHud(state),
            onPauseRequest: () => pause(phaseRef.current === 'playing'),
            onModeChange: (mode) => {
              if (mode === 'edit' && (phaseRef.current === 'playing' || (phaseRef.current === 'paused' && pausedFrom.current === 'playing'))) {
                stopMusic();
                if (exp.kind === 'game') go('title');
                else void enterExplore(false);
              }
            },
          },
          {
            backend: 'auto',
            shadows: s0.quality !== 'low',
            lowMemory: q.lowMemory,
            statsWhileEditing: false,
            pointerLock: world.player.mode === 'firstPerson',
            saveBase: `game-${musicSeed(JSON.stringify(world.voxel ?? world.name)).toString(36)}`,
            ...(sandbox ? { sandbox } : {}),
            ...(cooked ? { cooked } : {}),
            // A viewer never bakes: baked light comes from the cooked package (a re-lightable bake the hour only re-weights).
            bakedLight: 'viewer',
            // The package's geometry differs from what this build makes (a spot check in the generation lanes): remember it
            // and load again, live, once the lanes have removed its entries from the geometry cache.
            ...(cooked
              ? {
                  onCookMismatch: (m: CookMismatch, purged: Promise<void>) => {
                    cookHandle.path = 'live';
                    cookHandle.reason = `cooked geometry failed a spot check (${m.generator}: ${m.expected} cooked, ${m.got} live)`;
                    console.warn(`[player] ${cookHandle.reason}; loading live`);
                    distrustCookedPackage(cooked.manifest.dir);
                    void purged.then(() => {
                      if (!disposed) location.reload();
                    });
                  },
                }
              : {}),
            // A game the visitor plays: the person loads with the world (its programs are drawn behind the load screen).
            ...(game.startMode === 'play' || game.startMode === 'story' ? { preloadPlayer: true } : {}),
            onProgress: (msg) => setLoading(msg),
          },
        );
        if (disposed) {
          sim.dispose();
          return;
        }
        simRef.current = sim;
        if (route?.tier) sim.renderer.setRenderTier(route.tier);
        sim.renderer.setPixelRatioCap(q.pixelRatioCap);
        sim.setVolume(s0.volume);
        sim.setLookSensitivity(s0.sensitivity);
        sim.setReducedMotion(s0.reduceMotion);
        // Big moments (a defeat, an explosion) duck the music for a breath.
        sim.onDuck((depth, seconds) => musicRef.current?.duck?.(depth, seconds));
        setLoading('Building the world…');
        await sim.whenSynced();
        // The title card (and with it Start) waits for the world to be complete: no hitches or pop-in once playing.
        await sim.whenFullyLoaded(150_000, (stage) => {
          if (!disposed) setLoading(stage === 'materials' ? 'Loading models and textures…' : stage === 'scene' ? 'Building the world…' : 'Preparing shaders and geometry…');
        });
        if (disposed) return;
        // A bundled block-world save is imported once per browser.
        if (game.save && sim.voxel) {
          const marker = `aether.player.save.${musicSeed(game.save + world.name).toString(36)}`;
          let done = false;
          try {
            done = localStorage.getItem(marker) === '1';
          } catch {
            done = false;
          }
          if (!done) {
            const bytes = await loadSave(game.save);
            if (bytes) {
              try {
                await sim.voxel.importSave(bytes);
                localStorage.setItem(marker, '1');
              } catch {
                toast('The bundled save could not be loaded; starting fresh.');
              }
            }
          }
        }
        const catalog = await loadCatalog();
        setCredits(creditsFor(world, catalog));
        if (disposed) return;
        if (exp.kind === 'game' || route?.cook === 'record') go('title');
        cookHandle.ready = true;
        void attract();
      } catch (err) {
        if (disposed) return;
        setFatal(`This browser could not start WebGPU or WebGL2 (${err instanceof Error ? err.message.slice(0, 160) : 'error'}).`);
        go('failed');
      }
    })();
    return () => {
      disposed = true;
      stopMusic();
      storyRef.current?.dispose();
      storyRef.current = null;
      exploreRef.current?.dispose();
      exploreRef.current = null;
      simRef.current?.dispose();
      simRef.current = null;
      sandbox?.dispose();
      canvas.remove();
    };
    // The game never changes for the lifetime of this view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard (experience.ts keyAction): Esc pauses / resumes, P plays, Tab or O explores, Enter starts from the title
  // screen; in explore mode ] and [ move between stops, Space autoplays, M the dollhouse, F photo mode, 1–4 the hour.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const p = phaseRef.current;
      const typing = typingTarget(e.target);
      // The Render video panel is up: its buttons only (Escape closes it when no render runs).
      if (filmRef.current) {
        if (e.key === 'Escape' && !filmRef.current.progress) closeFilm();
        return;
      }
      if (e.key === 'Enter' && p === 'title' && document.activeElement === document.body) {
        void start();
        return;
      }
      // Tab moves the focus between buttons; it explores only from the page itself (not from a focused control).
      if (e.code === 'Tab' && document.activeElement && document.activeElement !== document.body && !(document.activeElement instanceof HTMLCanvasElement)) return;
      const action = keyAction(e, p, exp, typing, !!world.voxel);
      if (!action) return;
      const ctrl = exploreRef.current;
      switch (action) {
        case 'skip':
          e.preventDefault();
          if (storyGateRef.current) watchStory(e.code !== 'Escape');
          else storyRef.current?.skip();
          break;
        case 'mute':
          e.preventDefault();
          toggleStoryMute();
          break;
        case 'pause':
          e.preventDefault();
          if (ctrl?.snapshot.photo) ctrl.setPhoto(false);
          else pause(true);
          break;
        case 'resume':
          e.preventDefault();
          pause(false);
          break;
        case 'play':
          e.preventDefault();
          void start();
          break;
        case 'explore':
          e.preventDefault();
          void toExplore();
          break;
        case 'next':
          ctrl?.next();
          break;
        case 'prev':
          ctrl?.prev();
          break;
        case 'autoplay':
          e.preventDefault();
          if (ctrl) ctrl.setAutoplay(!ctrl.snapshot.autoplay);
          break;
        case 'dollhouse':
          ctrl?.toggleDollhouse();
          break;
        case 'photo':
          if (ctrl) ctrl.setPhoto(!ctrl.snapshot.photo);
          break;
        case 'time': {
          const preset = TIME_PRESETS_BY_DIGIT[e.code];
          if (ctrl && preset !== undefined) ctrl.setHour(preset);
          break;
        }
      }
    };
    // Losing pointer lock (Esc in first person) pauses the game.
    const onLock = (): void => {
      if (!document.pointerLockElement && phaseRef.current === 'playing' && world.player.mode === 'firstPerson' && !world.voxel) pause(true);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerlockchange', onLock);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerlockchange', onLock);
    };
  }, [closeFilm, exp, pause, start, toExplore, toggleStoryMute, watchStory, world]);

  // Test / debug handle.
  useEffect(() => {
    window.__aetherPlayer = {
      get phase() {
        return phaseRef.current;
      },
      title: game.title,
      entities: Object.keys(world.entities).length,
      get backend() {
        return simRef.current?.backend ?? null;
      },
      world,
      get simulation() {
        return simRef.current;
      },
      experience: exp,
      get explore() {
        return exploreRef.current?.snapshot ?? null;
      },
      get exploreController() {
        return exploreRef.current;
      },
      get storyGate() {
        return storyGateRef.current;
      },
      get story() {
        const r = storyRef.current;
        return r ? { time: r.time, duration: r.duration, overlay: storyOverlayRef.current, clearance: () => r.clearance(), audio: storyAudioRef.current?.state ?? 'none', audioLevel: storyAudioRef.current?.level() ?? 0 } : null;
      },
      playStory: (at?: number) => void playStory(at),
      pauseStory: (on: boolean) => storyRef.current?.pause(on),
      filmModule: () => import('./film-export'),
      framesModule: () => import('./film-frames'),
      get film() {
        return filmRef.current;
      },
      start: () => void start(),
      enterExplore: () => void toExplore(),
    };
    return () => {
      delete window.__aetherPlayer;
    };
  }, [exp, game.title, playStory, start, toExplore, world]);

  const menu = (inGame: boolean): ReactElement => {
    if (panel === 'settings') return <SettingsPanel settings={settings} onChange={updateSettings} onBack={() => setPanel('main')} hasMusic={game.music !== null} />;
    if (panel === 'credits') return <CreditsPanel game={game} credits={credits} onBack={() => setPanel('main')} />;
    if (inGame && pausedFrom.current === 'exploring')
      return (
        <div className="pl-panel" role="group" aria-label="Menu">
          <h2 className="pl-panel__title">{game.title}</h2>
          <div className="pl-stack">
            <Button primary onClick={() => pause(false)} autoFocus testId="pl-resume">
              Resume
            </Button>
            <Button onClick={() => void start()}>Play as the character</Button>
            {world.story && <Button onClick={() => void playStory(0)}>Watch the story</Button>}
            <Button onClick={() => setPanel('settings')}>Settings</Button>
            <Button onClick={() => setPanel('credits')}>Credits</Button>
            {exp.kind === 'game' && <Button onClick={() => void quitToTitle()}>Title screen</Button>}
          </div>
        </div>
      );
    return inGame ? (
      <div className="pl-panel" role="group" aria-label="Paused">
        <h2 className="pl-panel__title">Paused</h2>
        <div className="pl-stack">
          <Button primary onClick={() => pause(false)} autoFocus testId="pl-resume">
            Resume
          </Button>
          <Button onClick={() => void restart()}>Restart</Button>
          {!world.voxel && <Button onClick={() => void toExplore()}>Explore</Button>}
          <Button onClick={() => setPanel('settings')}>Settings</Button>
          <Button onClick={() => setPanel('credits')}>Credits</Button>
          {exp.kind === 'game' ? <Button onClick={() => void quitToTitle()}>Quit to title</Button> : <Button onClick={() => void quitToTitle()}>Back to the tour</Button>}
        </div>
      </div>
    ) : (
      <div className="pl-stack pl-stack--row">
        <Button primary onClick={() => void start()} autoFocus testId="pl-play">
          ▶ Play
        </Button>
        <Button onClick={() => setPanel('settings')}>Settings</Button>
        <Button onClick={() => setPanel('credits')}>Credits</Button>
      </div>
    );
  };

  const playing = (phase === 'playing' || phase === 'paused' || phase === 'over') && !(phase === 'paused' && pausedFrom.current === 'exploring');
  const sim = simRef.current;
  const touch = isTouchScreen();
  const hint = explore?.photo ? '' : keyHint(phase, exp, touch);
  const showTime = exp.kind === 'game' || world.hud.length > 0;
  return (
    <div className={`pl-root is-${phase}${explore?.photo && phase === 'exploring' ? ' is-photo' : ''}`} ref={hostRef}>
      {phase === 'booting' && (
        <div className="pl-loading" role="status">
          <span className="pl-spinner" aria-hidden="true" />
          <span>{loading}</span>
        </div>
      )}
      {phase === 'failed' && (
        <div className="pl-center">
          <div className="pl-panel">
            <h2 className="pl-panel__title">Something went wrong</h2>
            <p className="pl-muted">{fatal}</p>
            <div className="pl-panel__actions">
              <Button primary onClick={() => location.reload()}>
                Reload
              </Button>
            </div>
          </div>
        </div>
      )}
      {(phase === 'title' || phase === 'starting') && (
        <div className="pl-title" data-testid="pl-title">
          <div className="pl-title__scrim" aria-hidden="true" />
          {panel === 'main' ? (
            <div className="pl-title__body">
              <h1 className="pl-title__name">{game.title}</h1>
              {game.author && <p className="pl-title__by">by {game.author}</p>}
              {game.description && <p className="pl-title__desc">{game.description}</p>}
              {menu(false)}
              {game.proof !== undefined && <ProofBadge proof={game.proof} world={world} sim={sim} />}
              <p className="pl-title__controls">{isTouchScreen() ? touchControlsLine(game.controls) : game.controls}</p>
              <p className="pl-title__made">Made with Aether</p>
            </div>
          ) : (
            <div className="pl-center">{menu(false)}</div>
          )}
        </div>
      )}
      {playing && !world.voxel && (
        <div className="pl-hud" aria-live="polite">
          {world.hud.map((b) => (
            <div key={b.key} className="pl-stat">
              <span className="pl-stat__label">{b.label}</span>
              <span className="pl-stat__value">{hud[b.key] ?? '–'}</span>
            </div>
          ))}
          {showTime && (
            <div className="pl-stat">
              <span className="pl-stat__label">Time</span>
              <span className="pl-stat__value">{clock(time)}</span>
            </div>
          )}
        </div>
      )}
      {phase === 'exploring' && explore && exploreMod && exploreRef.current && (
        <>
          {!explore.photo && (
            <div className="pl-xtitle" aria-hidden={exp.kind === 'game'}>
              <span className="pl-xtitle__name">{game.title}</span>
              {game.author && <span className="pl-xtitle__by">by {game.author}</span>}
            </div>
          )}
          <exploreMod.ExploreBar state={explore} ctrl={exploreRef.current} exp={exp} onPlay={() => void start()} canPlay={!world.voxel} />
          {!explore.photo && (
            <button type="button" className="pl-pausebtn" aria-label="Menu" onClick={() => pause(true)}>
              ☰
            </button>
          )}
        </>
      )}
      {phase === 'story' && world.story && storyGate && (
        <StoryGate story={world.story} title={game.title} onWatch={watchStory} onExplore={() => void toExplore()} onPlay={() => void start()} canPlay={!world.voxel} />
      )}
      {phase === 'story' && world.story && !storyGate && (
        <StoryView story={world.story} overlay={storyOverlay} title={game.title} onSkip={() => storyRef.current?.skip()} onReplay={() => void playStory(0)} onExplore={() => void toExplore()} onPlay={() => void start()} canPlay={!world.voxel} muted={storyMuted} onMute={toggleStoryMute} onRender={openFilm} />
      )}
      {film && <FilmPanel state={film} onFps={(fps) => setFilm((f) => (f ? { ...f, fps } : f))} onStart={() => void renderFilm()} onCancel={() => filmAbort.current?.abort()} onClose={closeFilm} />}
      <div className="pl-story__fade" ref={storyFadeRef} aria-hidden="true" />
      <div className={`pl-fade${explore?.fading && phase === 'exploring' ? ' is-on' : ''}`} aria-hidden="true" />
      {hint && (phase === 'exploring' || phase === 'playing' || phase === 'title') && (
        <p className="pl-hint" data-testid="pl-hint">
          {hint}
        </p>
      )}
      {playing && world.voxel && voxelHud && <VoxelHudView hud={voxelHud} play={sim?.voxel?.game ?? null} toast={(t) => toast(t)} />}
      {phase === 'playing' && !world.voxel && <NpcSpeechView frame={npc} actions={sim} />}
      {phase === 'playing' && !world.voxel && combat && <CombatHudView combat={combat} health={hud['health']} />}
      {phase === 'playing' && !world.voxel && !combat && (
        <div className="interact" aria-live="polite">
          <span className={`interact__dot${interact ? ' is-active' : ''}`} aria-hidden="true" />
          {interact && (
            <span className="interact__prompt" role="status">
              <kbd>{interact.key}</kbd> {interact.verb} {interact.noun}
              {interact.hint && <span className="interact__hint">{interact.hint}</span>}
            </span>
          )}
        </div>
      )}
      {phase === 'playing' && !world.voxel && <TouchControlsView sim={sim} armed={world.player.weapon !== undefined} />}
      {phase === 'playing' && (
        <button type="button" className="pl-pausebtn" aria-label="Pause" onClick={() => pause(true)}>
          ❚❚
        </button>
      )}
      <div className="pl-toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="pl-toast">
            {t.text}
          </div>
        ))}
      </div>
      {phase === 'paused' && <div className="pl-center pl-dim">{menu(true)}</div>}
      {phase === 'over' && over && (
        <div className="pl-center pl-dim">
          <div className="pl-panel" role="dialog" aria-label="Game over">
            <h2 className={`pl-over ${over.win ? 'is-win' : 'is-lose'}`}>{over.win ? 'You win!' : 'Game over'}</h2>
            {over.text && <p className="pl-muted">{over.text}</p>}
            {over.score !== undefined && <ScoreLine score={over.score} best={over.best} record={over.record} />}
            <ul className="pl-stats" aria-label="Your run">
              {world.hud.map((b) => (
                <li key={b.key}>
                  <span>{b.label}</span>
                  <strong>{hud[b.key] ?? '–'}</strong>
                </li>
              ))}
              <li>
                <span>Time</span>
                <strong>{clock(time)}</strong>
              </li>
            </ul>
            <div className="pl-stack pl-stack--row">
              <Button primary onClick={() => void restart()} autoFocus>
                {over.win ? 'Play again' : 'Try again'}
              </Button>
              <Button onClick={() => setPanel('credits')}>Credits</Button>
              <Button onClick={() => void quitToTitle()}>Title screen</Button>
            </div>
            {panel === 'credits' && <CreditsPanel game={game} credits={credits} onBack={() => setPanel('main')} />}
          </div>
        </div>
      )}
    </div>
  );
});

/** The player page. */
export function PlayerApp(): ReactElement {
  const [source, setSource] = useState<GameSource | null>(null);
  useEffect(() => {
    // Another link pasted into this tab: start over with it.
    const onHash = (): void => location.reload();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    let alive = true;
    void loadGame(location.hash).then((s) => {
      if (!alive) return;
      setSource(s);
      if (s.kind === 'game') document.title = s.game.title;
    });
    return () => {
      alive = false;
    };
  }, []);
  if (!source)
    return (
      <div className="pl-root">
        <div className="pl-loading" role="status">
          <span className="pl-spinner" aria-hidden="true" />
          <span>Opening the world…</span>
        </div>
      </div>
    );
  if (source.kind === 'game') return <GameView game={source.game} />;
  return (
    <div className="pl-root">
      <div className="pl-center">
        <div className="pl-panel" data-testid="pl-error">
          <h2 className="pl-panel__title">{source.kind === 'none' ? 'Nothing to play here' : 'This link cannot be opened'}</h2>
          <p className="pl-muted">{source.kind === 'none' ? 'This page plays worlds shared from Aether. Open a share link, or publish a world from the studio.' : source.message}</p>
          <div className="pl-panel__actions">
            <a className="pl-btn pl-btn--primary" href="./">
              Open the studio
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
