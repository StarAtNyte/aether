/**
 * The standalone player of published games: no editor, no agent. Loads the
 * game (share-link fragment or `game.json`), shows a title screen over a
 * slow cinematic fly-through of the world, then plays it with a HUD, a
 * pause menu (Esc, or Start on a controller), settings (volume, music, look
 * sensitivity, graphics quality — remembered in this browser), credits
 * generated from the assets the world uses, touch controls on phones and
 * controller support. Block worlds get the full block-game HUD.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { History, type Json, type WorldDoc } from '@aether/core';
import { creditsFor, loadCatalog, setCatalog, type Credit } from '@aether/assets';
import { createWorkerSandbox, type SandboxRunner } from '@aether/procgen';
import { Simulation } from '../engine/Simulation';
import { formatStateValue } from '../lib/format';
import type { VoxelHudState } from '../voxel/hudState';
import { VoxelHudView } from '../components/viewport/VoxelHud';
import { TouchControlsView } from '../components/viewport/TouchControls';
import { playMusic, musicSeed, type MusicPlayer } from '../publish/video/music';
import type { GameManifest } from '../publish/manifest';
import { loadGame, loadSave, registerBundledImports, type GameSource } from './source';
import { browserSettingsStorage, defaultSettings, loadSettings, qualityPlan, QUALITIES, saveSettings, type PlayerSettings, type Quality } from './settings';

type Phase = 'booting' | 'title' | 'starting' | 'playing' | 'paused' | 'over' | 'failed';
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
  start(): void;
}

declare global {
  interface Window {
    __aetherPlayer?: PlayerHandle;
  }
}

function clock(t: number): string {
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function createSandbox(): SandboxRunner | null {
  try {
    return typeof Worker !== 'undefined' ? createWorkerSandbox({ poolSize: 1 }) : null;
  } catch {
    return null;
  }
}

/** Library files live next to this page (sub-path hosting: itch.io, GitHub Pages, the local library). */
async function relativeLibrary(): Promise<void> {
  const c = await loadCatalog();
  const base = new URL('assets/lib/', document.baseURI).pathname;
  if (c.base !== base) {
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
  const [over, setOver] = useState<{ win: boolean; text: string } | null>(null);
  const [voxelHud, setVoxelHud] = useState<VoxelHudState | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [credits, setCredits] = useState<Credit[]>([]);
  const storage = useMemo(() => browserSettingsStorage(), []);
  const [settings, setSettings] = useState<PlayerSettings>(() => {
    const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    return loadSettings(storage, defaultSettings(mem));
  });
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const world = game.world;

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

  const attract = useCallback(async () => {
    const sim = simRef.current;
    if (!sim) return;
    await sim.frameWorld();
    // A slow cinematic loop behind the title screen, starting from the framed view.
    setTimeout(() => {
      if (phaseRef.current === 'title' && simRef.current === sim) sim.renderer.startTour(60);
    }, 900);
  }, []);

  const start = useCallback(async () => {
    const sim = simRef.current;
    if (!sim || (phaseRef.current !== 'title' && phaseRef.current !== 'over')) return;
    go('starting');
    sim.renderer.stopTour();
    setOver(null);
    setHud({});
    setTime(0);
    if (sim.mode === 'play') await sim.restart();
    else await sim.play();
    if (sim.mode !== 'play') {
      go('title');
      return;
    }
    go('playing');
    startMusic();
  }, [go, startMusic]);

  const pause = useCallback(
    (on: boolean) => {
      const sim = simRef.current;
      if (!sim) return;
      if (on && phaseRef.current === 'playing') {
        sim.setPaused(true);
        setPanel('main');
        go('paused');
      } else if (!on && phaseRef.current === 'paused') {
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
    await sim.stop();
    setOver(null);
    setVoxelHud(null);
    setPanel('main');
    go('title');
    void attract();
  }, [attract, go, stopMusic]);

  const restart = useCallback(async () => {
    const sim = simRef.current;
    if (!sim) return;
    setOver(null);
    setHud({});
    setTime(0);
    await sim.restart();
    sim.setPaused(false);
    go('playing');
  }, [go]);

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
    const history = new History(world, { maxEntries: 4 });
    void (async () => {
      try {
        await relativeLibrary();
        await registerBundledImports(game);
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
            onGameOver: (result, text) => {
              setOver({ win: result === 'win', text });
              go('over');
            },
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
              if (mode === 'edit' && (phaseRef.current === 'playing' || phaseRef.current === 'paused')) {
                stopMusic();
                go('title');
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
            onProgress: (msg) => setLoading(msg),
          },
        );
        if (disposed) {
          sim.dispose();
          return;
        }
        simRef.current = sim;
        sim.renderer.setPixelRatioCap(q.pixelRatioCap);
        sim.setVolume(s0.volume);
        sim.setLookSensitivity(s0.sensitivity);
        setLoading('Building the world…');
        await sim.whenSynced();
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
        go('title');
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
      simRef.current?.dispose();
      simRef.current = null;
      sandbox?.dispose();
      canvas.remove();
    };
    // The game never changes for the lifetime of this view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard: Esc pauses / resumes; Enter starts from the title screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const p = phaseRef.current;
      if (e.key === 'Escape') {
        if (p === 'playing' && !world.voxel) {
          e.preventDefault();
          pause(true);
        } else if (p === 'paused') {
          e.preventDefault();
          pause(false);
        }
      } else if (e.key === 'Enter' && p === 'title' && document.activeElement === document.body) {
        void start();
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
  }, [pause, start, world]);

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
      start: () => void start(),
    };
    return () => {
      delete window.__aetherPlayer;
    };
  }, [game.title, start, world]);

  const menu = (inGame: boolean): ReactElement => {
    if (panel === 'settings') return <SettingsPanel settings={settings} onChange={updateSettings} onBack={() => setPanel('main')} hasMusic={game.music !== null} />;
    if (panel === 'credits') return <CreditsPanel game={game} credits={credits} onBack={() => setPanel('main')} />;
    return inGame ? (
      <div className="pl-panel" role="group" aria-label="Paused">
        <h2 className="pl-panel__title">Paused</h2>
        <div className="pl-stack">
          <Button primary onClick={() => pause(false)} autoFocus testId="pl-resume">
            Resume
          </Button>
          <Button onClick={() => void restart()}>Restart</Button>
          <Button onClick={() => setPanel('settings')}>Settings</Button>
          <Button onClick={() => setPanel('credits')}>Credits</Button>
          <Button onClick={() => void quitToTitle()}>Quit to title</Button>
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

  const playing = phase === 'playing' || phase === 'paused' || phase === 'over';
  const sim = simRef.current;
  return (
    <div className={`pl-root is-${phase}`} ref={hostRef}>
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
              <p className="pl-title__controls">{game.controls}</p>
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
          <div className="pl-stat">
            <span className="pl-stat__label">Time</span>
            <span className="pl-stat__value">{clock(time)}</span>
          </div>
        </div>
      )}
      {playing && world.voxel && voxelHud && <VoxelHudView hud={voxelHud} play={sim?.voxel?.game ?? null} toast={(t) => toast(t)} />}
      {phase === 'playing' && !world.voxel && <TouchControlsView sim={sim} />}
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
            <p className="pl-muted">Time {clock(time)}</p>
            <div className="pl-stack pl-stack--row">
              <Button primary onClick={() => void restart()} autoFocus>
                Play again
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
