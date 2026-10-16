import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * The standalone player of published games: no editor, no agent. Loads the
 * game (share-link fragment or `game.json`), shows a title screen over a
 * slow cinematic fly-through of the world, then plays it with a HUD, a
 * pause menu (Esc, or Start on a controller), settings (volume, music, look
 * sensitivity, graphics quality — remembered in this browser), credits
 * generated from the assets the world uses, touch controls on phones and
 * controller support. Block worlds get the full block-game HUD.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { History } from '@aether/core';
import { creditsFor, loadCatalog, setCatalog } from '@aether/assets';
import { createWorkerSandbox } from '@aether/procgen';
import { Simulation } from '../engine/Simulation';
import { formatStateValue } from '../lib/format';
import { VoxelHudView } from '../components/viewport/VoxelHud';
import { NpcSpeechView } from '../components/viewport/NpcSpeech';
import { TouchControlsView } from '../components/viewport/TouchControls';
import { isTouchScreen, touchControlsLine } from '../lib/touchHints';
import { playMusic, musicSeed } from '../publish/video/music';
import { ProofBadge } from './ProofBadge';
import { loadGame, loadSave, registerBundledImports } from './source';
import { browserSettingsStorage, defaultSettings, loadSettings, qualityPlan, QUALITIES, saveSettings } from './settings';
function clock(t) {
    const s = Math.max(0, Math.floor(t));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function createSandbox() {
    try {
        return typeof Worker !== 'undefined' ? createWorkerSandbox({ poolSize: 1 }) : null;
    }
    catch {
        return null;
    }
}
/** Library files live next to this page (sub-path hosting: itch.io, GitHub Pages, the local library). */
async function relativeLibrary() {
    const c = await loadCatalog();
    const base = new URL('assets/lib/', document.baseURI).pathname;
    if (c.base !== base) {
        try {
            setCatalog({ ...c, base });
        }
        catch {
            /* keep the default base */
        }
    }
}
const Button = ({ children, primary, onClick, autoFocus, testId }) => (_jsx("button", { type: "button", className: `pl-btn${primary ? ' pl-btn--primary' : ''}`, onClick: onClick, autoFocus: autoFocus, "data-testid": testId, children: children }));
const SettingsPanel = memo(function SettingsPanel({ settings, onChange, onBack, hasMusic }) {
    const slider = (label, key, min, max, step, fmt) => (_jsxs("label", { className: "pl-field", children: [_jsx("span", { className: "pl-field__label", children: label }), _jsx("input", { type: "range", min: min, max: max, step: step, value: settings[key], onChange: (e) => onChange({ ...settings, [key]: Number(e.target.value) }) }), _jsx("span", { className: "pl-field__value", children: fmt(settings[key]) })] }));
    return (_jsxs("div", { className: "pl-panel", role: "group", "aria-label": "Settings", children: [_jsx("h2", { className: "pl-panel__title", children: "Settings" }), slider('Sound effects', 'volume', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`), hasMusic && slider('Music', 'music', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`), slider('Look sensitivity', 'sensitivity', 0.25, 3, 0.05, (v) => `${v.toFixed(2)}×`), _jsxs("div", { className: "pl-field", children: [_jsx("span", { className: "pl-field__label", children: "Graphics" }), _jsx("div", { className: "pl-seg", role: "radiogroup", "aria-label": "Graphics quality", children: QUALITIES.map((q) => (_jsx("button", { type: "button", role: "radio", "aria-checked": settings.quality === q, className: `pl-seg__item${settings.quality === q ? ' is-on' : ''}`, onClick: () => onChange({ ...settings, quality: q }), children: q === 'low' ? 'Low' : q === 'medium' ? 'Medium' : 'High' }, q))) })] }), _jsx("div", { className: "pl-panel__actions", children: _jsx(Button, { onClick: onBack, autoFocus: true, children: "Back" }) })] }));
});
const CreditsPanel = memo(function CreditsPanel({ game, credits, onBack }) {
    return (_jsxs("div", { className: "pl-panel pl-panel--scroll", role: "group", "aria-label": "Credits", children: [_jsx("h2", { className: "pl-panel__title", children: "Credits" }), _jsxs("p", { className: "pl-credit", children: [_jsx("b", { children: game.title }), game.author ? _jsxs(_Fragment, { children: [" by ", game.author] }) : null] }), credits.length === 0 ? (_jsx("p", { className: "pl-muted", children: "Everything in this world is procedural: no third-party assets." })) : (credits.map((c) => (_jsxs("p", { className: "pl-credit", children: [_jsx("b", { children: c.source }), " by ", c.author, " \u00B7 ", c.licence, _jsxs("span", { className: "pl-muted", children: [" \u2014 ", c.assets.slice(0, 6).join(', '), c.assets.length > 6 ? ` and ${c.assets.length - 6} more` : ''] })] }, c.source)))), _jsx("p", { className: "pl-muted pl-made", children: "Made with Aether \u00B7 rendered with three.js \u00B7 physics by Rapier" }), _jsx("div", { className: "pl-panel__actions", children: _jsx(Button, { onClick: onBack, autoFocus: true, children: "Back" }) })] }));
});
/** The running game: canvas, title screen, HUD and menus. */
const GameView = memo(function GameView({ game }) {
    const hostRef = useRef(null);
    const simRef = useRef(null);
    const musicRef = useRef(null);
    const musicTimer = useRef(null);
    const [phase, setPhase] = useState('booting');
    const phaseRef = useRef('booting');
    const [panel, setPanel] = useState('main');
    const [loading, setLoading] = useState('Starting the renderer…');
    const [fatal, setFatal] = useState(null);
    const [hud, setHud] = useState({});
    const [time, setTime] = useState(0);
    const [over, setOver] = useState(null);
    const [voxelHud, setVoxelHud] = useState(null);
    const [npc, setNpc] = useState(null);
    const [interact, setInteract] = useState(null);
    const [toasts, setToasts] = useState([]);
    const [credits, setCredits] = useState([]);
    const storage = useMemo(() => browserSettingsStorage(), []);
    const [settings, setSettings] = useState(() => {
        const mem = navigator.deviceMemory;
        return loadSettings(storage, defaultSettings(mem));
    });
    const settingsRef = useRef(settings);
    settingsRef.current = settings;
    const world = game.world;
    const go = useCallback((p) => {
        phaseRef.current = p;
        setPhase(p);
    }, []);
    const toast = useCallback((text) => {
        const id = Date.now() + Math.random();
        setToasts((t) => [...t.slice(-3), { id, text: text.slice(0, 300) }]);
        setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
    }, []);
    const stopMusic = useCallback(() => {
        if (musicTimer.current)
            clearTimeout(musicTimer.current);
        musicTimer.current = null;
        musicRef.current?.stop();
        musicRef.current = null;
    }, []);
    const startMusic = useCallback(() => {
        stopMusic();
        const mood = game.music;
        const vol = settingsRef.current.music;
        if (!mood || vol <= 0)
            return;
        const seconds = 240;
        musicRef.current = playMusic(mood, seconds, { seed: musicSeed(world.name), volume: vol });
        // Loop: a fresh score when this one ends.
        musicTimer.current = setTimeout(() => startMusic(), (seconds - 0.5) * 1000);
    }, [game.music, stopMusic, world.name]);
    const applySettings = useCallback((s) => {
        const sim = simRef.current;
        if (!sim)
            return;
        const q = qualityPlan(s.quality);
        sim.setLowMemory(q.lowMemory);
        sim.renderer.setPixelRatioCap(q.pixelRatioCap);
        sim.setVolume(s.volume);
        sim.setLookSensitivity(s.sensitivity);
    }, []);
    const updateSettings = useCallback((s) => {
        const musicChanged = s.music !== settingsRef.current.music;
        setSettings(s);
        settingsRef.current = s;
        saveSettings(storage, s);
        applySettings(s);
        if (musicChanged && (phaseRef.current === 'playing' || phaseRef.current === 'paused'))
            startMusic();
    }, [applySettings, startMusic, storage]);
    const attract = useCallback(async () => {
        const sim = simRef.current;
        if (!sim)
            return;
        await sim.frameWorld();
        // A slow cinematic loop behind the title screen, starting from the framed view.
        setTimeout(() => {
            if (phaseRef.current === 'title' && simRef.current === sim)
                sim.renderer.startTour(60);
        }, 900);
    }, []);
    const start = useCallback(async () => {
        const sim = simRef.current;
        if (!sim || (phaseRef.current !== 'title' && phaseRef.current !== 'over'))
            return;
        go('starting');
        sim.renderer.stopTour();
        sim.renderer.stopGhost();
        setOver(null);
        setHud({});
        setTime(0);
        if (sim.mode === 'play')
            await sim.restart();
        else
            await sim.play();
        if (sim.mode !== 'play') {
            go('title');
            return;
        }
        go('playing');
        startMusic();
    }, [go, startMusic]);
    const pause = useCallback((on) => {
        const sim = simRef.current;
        if (!sim)
            return;
        if (on && phaseRef.current === 'playing') {
            sim.setPaused(true);
            setPanel('main');
            go('paused');
        }
        else if (!on && phaseRef.current === 'paused') {
            sim.setPaused(false);
            go('playing');
        }
    }, [go]);
    const quitToTitle = useCallback(async () => {
        const sim = simRef.current;
        if (!sim)
            return;
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
        if (!sim)
            return;
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
        if (!host)
            return;
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
                const sim = await Simulation.create(canvas, history, {
                    onHud: (values, t) => {
                        const out = {};
                        for (const k of Object.keys(values))
                            out[k] = formatStateValue(values[k]);
                        setHud(out);
                        setTime(Math.floor(t));
                    },
                    onMessage: (text) => toast(text),
                    onNpc: (frame) => setNpc(frame),
                    onInteract: (prompt) => setInteract(prompt),
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
                }, {
                    backend: 'auto',
                    shadows: s0.quality !== 'low',
                    lowMemory: q.lowMemory,
                    statsWhileEditing: false,
                    pointerLock: world.player.mode === 'firstPerson',
                    saveBase: `game-${musicSeed(JSON.stringify(world.voxel ?? world.name)).toString(36)}`,
                    ...(sandbox ? { sandbox } : {}),
                    onProgress: (msg) => setLoading(msg),
                });
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
                    }
                    catch {
                        done = false;
                    }
                    if (!done) {
                        const bytes = await loadSave(game.save);
                        if (bytes) {
                            try {
                                await sim.voxel.importSave(bytes);
                                localStorage.setItem(marker, '1');
                            }
                            catch {
                                toast('The bundled save could not be loaded; starting fresh.');
                            }
                        }
                    }
                }
                const catalog = await loadCatalog();
                setCredits(creditsFor(world, catalog));
                if (disposed)
                    return;
                go('title');
                void attract();
            }
            catch (err) {
                if (disposed)
                    return;
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
        const onKey = (e) => {
            const p = phaseRef.current;
            if (e.key === 'Escape') {
                if (p === 'playing' && !world.voxel) {
                    e.preventDefault();
                    pause(true);
                }
                else if (p === 'paused') {
                    e.preventDefault();
                    pause(false);
                }
            }
            else if (e.key === 'Enter' && p === 'title' && document.activeElement === document.body) {
                void start();
            }
        };
        // Losing pointer lock (Esc in first person) pauses the game.
        const onLock = () => {
            if (!document.pointerLockElement && phaseRef.current === 'playing' && world.player.mode === 'firstPerson' && !world.voxel)
                pause(true);
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
    const menu = (inGame) => {
        if (panel === 'settings')
            return _jsx(SettingsPanel, { settings: settings, onChange: updateSettings, onBack: () => setPanel('main'), hasMusic: game.music !== null });
        if (panel === 'credits')
            return _jsx(CreditsPanel, { game: game, credits: credits, onBack: () => setPanel('main') });
        return inGame ? (_jsxs("div", { className: "pl-panel", role: "group", "aria-label": "Paused", children: [_jsx("h2", { className: "pl-panel__title", children: "Paused" }), _jsxs("div", { className: "pl-stack", children: [_jsx(Button, { primary: true, onClick: () => pause(false), autoFocus: true, testId: "pl-resume", children: "Resume" }), _jsx(Button, { onClick: () => void restart(), children: "Restart" }), _jsx(Button, { onClick: () => setPanel('settings'), children: "Settings" }), _jsx(Button, { onClick: () => setPanel('credits'), children: "Credits" }), _jsx(Button, { onClick: () => void quitToTitle(), children: "Quit to title" })] })] })) : (_jsxs("div", { className: "pl-stack pl-stack--row", children: [_jsx(Button, { primary: true, onClick: () => void start(), autoFocus: true, testId: "pl-play", children: "\u25B6 Play" }), _jsx(Button, { onClick: () => setPanel('settings'), children: "Settings" }), _jsx(Button, { onClick: () => setPanel('credits'), children: "Credits" })] }));
    };
    const playing = phase === 'playing' || phase === 'paused' || phase === 'over';
    const sim = simRef.current;
    return (_jsxs("div", { className: `pl-root is-${phase}`, ref: hostRef, children: [phase === 'booting' && (_jsxs("div", { className: "pl-loading", role: "status", children: [_jsx("span", { className: "pl-spinner", "aria-hidden": "true" }), _jsx("span", { children: loading })] })), phase === 'failed' && (_jsx("div", { className: "pl-center", children: _jsxs("div", { className: "pl-panel", children: [_jsx("h2", { className: "pl-panel__title", children: "Something went wrong" }), _jsx("p", { className: "pl-muted", children: fatal }), _jsx("div", { className: "pl-panel__actions", children: _jsx(Button, { primary: true, onClick: () => location.reload(), children: "Reload" }) })] }) })), (phase === 'title' || phase === 'starting') && (_jsxs("div", { className: "pl-title", "data-testid": "pl-title", children: [_jsx("div", { className: "pl-title__scrim", "aria-hidden": "true" }), panel === 'main' ? (_jsxs("div", { className: "pl-title__body", children: [_jsx("h1", { className: "pl-title__name", children: game.title }), game.author && _jsxs("p", { className: "pl-title__by", children: ["by ", game.author] }), game.description && _jsx("p", { className: "pl-title__desc", children: game.description }), menu(false), game.proof !== undefined && _jsx(ProofBadge, { proof: game.proof, world: world, sim: sim }), _jsx("p", { className: "pl-title__controls", children: isTouchScreen() ? touchControlsLine(game.controls) : game.controls }), _jsx("p", { className: "pl-title__made", children: "Made with Aether" })] })) : (_jsx("div", { className: "pl-center", children: menu(false) }))] })), playing && !world.voxel && (_jsxs("div", { className: "pl-hud", "aria-live": "polite", children: [world.hud.map((b) => (_jsxs("div", { className: "pl-stat", children: [_jsx("span", { className: "pl-stat__label", children: b.label }), _jsx("span", { className: "pl-stat__value", children: hud[b.key] ?? '–' })] }, b.key))), _jsxs("div", { className: "pl-stat", children: [_jsx("span", { className: "pl-stat__label", children: "Time" }), _jsx("span", { className: "pl-stat__value", children: clock(time) })] })] })), playing && world.voxel && voxelHud && _jsx(VoxelHudView, { hud: voxelHud, play: sim?.voxel?.game ?? null, toast: (t) => toast(t) }), phase === 'playing' && !world.voxel && _jsx(NpcSpeechView, { frame: npc, actions: sim }), phase === 'playing' && !world.voxel && (_jsxs("div", { className: "interact", "aria-live": "polite", children: [_jsx("span", { className: `interact__dot${interact ? ' is-active' : ''}`, "aria-hidden": "true" }), interact && (_jsxs("span", { className: "interact__prompt", role: "status", children: [_jsx("kbd", { children: interact.key }), " ", interact.verb, " ", interact.noun, interact.hint && _jsx("span", { className: "interact__hint", children: interact.hint })] }))] })), phase === 'playing' && !world.voxel && _jsx(TouchControlsView, { sim: sim }), phase === 'playing' && (_jsx("button", { type: "button", className: "pl-pausebtn", "aria-label": "Pause", onClick: () => pause(true), children: "\u275A\u275A" })), _jsx("div", { className: "pl-toasts", "aria-live": "polite", children: toasts.map((t) => (_jsx("div", { className: "pl-toast", children: t.text }, t.id))) }), phase === 'paused' && _jsx("div", { className: "pl-center pl-dim", children: menu(true) }), phase === 'over' && over && (_jsx("div", { className: "pl-center pl-dim", children: _jsxs("div", { className: "pl-panel", role: "dialog", "aria-label": "Game over", children: [_jsx("h2", { className: `pl-over ${over.win ? 'is-win' : 'is-lose'}`, children: over.win ? 'You win!' : 'Game over' }), over.text && _jsx("p", { className: "pl-muted", children: over.text }), _jsxs("ul", { className: "pl-stats", "aria-label": "Your run", children: [world.hud.map((b) => (_jsxs("li", { children: [_jsx("span", { children: b.label }), _jsx("strong", { children: hud[b.key] ?? '–' })] }, b.key))), _jsxs("li", { children: [_jsx("span", { children: "Time" }), _jsx("strong", { children: clock(time) })] })] }), _jsxs("div", { className: "pl-stack pl-stack--row", children: [_jsx(Button, { primary: true, onClick: () => void restart(), autoFocus: true, children: over.win ? 'Play again' : 'Try again' }), _jsx(Button, { onClick: () => setPanel('credits'), children: "Credits" }), _jsx(Button, { onClick: () => void quitToTitle(), children: "Title screen" })] }), panel === 'credits' && _jsx(CreditsPanel, { game: game, credits: credits, onBack: () => setPanel('main') })] }) }))] }));
});
/** The player page. */
export function PlayerApp() {
    const [source, setSource] = useState(null);
    useEffect(() => {
        // Another link pasted into this tab: start over with it.
        const onHash = () => location.reload();
        window.addEventListener('hashchange', onHash);
        return () => window.removeEventListener('hashchange', onHash);
    }, []);
    useEffect(() => {
        let alive = true;
        void loadGame(location.hash).then((s) => {
            if (!alive)
                return;
            setSource(s);
            if (s.kind === 'game')
                document.title = s.game.title;
        });
        return () => {
            alive = false;
        };
    }, []);
    if (!source)
        return (_jsx("div", { className: "pl-root", children: _jsxs("div", { className: "pl-loading", role: "status", children: [_jsx("span", { className: "pl-spinner", "aria-hidden": "true" }), _jsx("span", { children: "Opening the world\u2026" })] }) }));
    if (source.kind === 'game')
        return _jsx(GameView, { game: source.game });
    return (_jsx("div", { className: "pl-root", children: _jsx("div", { className: "pl-center", children: _jsxs("div", { className: "pl-panel", "data-testid": "pl-error", children: [_jsx("h2", { className: "pl-panel__title", children: source.kind === 'none' ? 'Nothing to play here' : 'This link cannot be opened' }), _jsx("p", { className: "pl-muted", children: source.kind === 'none' ? 'This page plays worlds shared from Aether. Open a share link, or publish a world from the studio.' : source.message }), _jsx("div", { className: "pl-panel__actions", children: _jsx("a", { className: "pl-btn pl-btn--primary", href: "./", children: "Open the studio" }) })] }) }) }));
}
