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
 * orbit and viewpoints; a city on a street-level view, then a drone tour. P plays any of them as the character, Tab or
 * O explores (the explore controller and bar load lazily), Esc pauses.
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
  startMode: 'play' | 'walkthrough' | 'orbit' | null;
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
  const exp = useMemo(() => experienceFor(game.startMode, game.profile, hasBuilding(world)), [game.startMode, game.profile, world]);
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
  }, [enterExplore, exp.kind]);

  const start = useCallback(async () => {
    const sim = simRef.current;
    const from = phaseRef.current;
    if (!sim || (from !== 'title' && from !== 'over' && from !== 'exploring' && !(from === 'paused' && pausedFrom.current === 'exploring'))) return;
    // Play from explore mode: a walk hands its spot over (the character stands where the visitor stood).
    const standing = exploreRef.current?.standing ?? null;
    leaveExplore();
    go('starting');
    sim.renderer.stopTour();
    sim.renderer.stopGhost();
    setOver(null);
    setHud({});
    setTime(0);
    if (sim.mode === 'play') await sim.restart();
    else await sim.play();
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
    go('playing');
    startMusic();
  }, [enterExplore, exp.kind, go, leaveExplore, startMusic]);

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
    if (p !== 'playing') return;
    const feet = sim.playerPosition;
    const from = feet ? { feet: [feet[0], feet[1], feet[2]] as [number, number, number], yaw: (-sim.playerHeading() * Math.PI) / 180 } : null;
    stopMusic();
    setCombat(null);
    await sim.stop();
    await enterExplore(false, from);
  }, [enterExplore, stopMusic]);

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
            ...(game.startMode === 'play' ? { preloadPlayer: true } : {}),
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
  }, [exp, pause, start, toExplore, world]);

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
      start: () => void start(),
      enterExplore: () => void toExplore(),
    };
    return () => {
      delete window.__aetherPlayer;
    };
  }, [exp, game.title, start, toExplore, world]);

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
