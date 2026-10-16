import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * The sections of the Publish hub (see PublishHub.tsx): one view per
 * target plus the history. Every action calls into `studio.publish`; the
 * views hold only form drafts. Nothing here renders untrusted HTML: titles,
 * links and log lines are text, the QR code is a path of numbers.
 */
import { memo, useEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';
import { listBuildings, listLevels } from '@aether/arch';
import { useStudio, useWorld } from '../../app/context';
import { Icon } from '../../components/Icon';
import { Toggle } from '../../components/fields';
import { Segmented } from '../../components/ui/Segmented';
import { formatRelative } from '../../lib/relativeTime';
import { PRESETS, PRESET_IDS } from '../../publish/cameraPath';
import { linkSizeLabel, MAX_FRAGMENT_CHARS } from '../../publish/share';
import { MOODS, MOOD_LABELS, playMusic, musicSeed } from '../../publish/video/music';
import { MAX_STILL_SIDE, STILL_PRESETS, VIDEO_PRESETS } from '../../engine/publish';
import { encodeQr, qrPath } from '../../publish/qr';
import { siteSlug } from '../../publish/hosting';
const Section = ({ title, children, aside, hint }) => (_jsxs("section", { className: "pub-sec", children: [_jsxs("header", { className: "pub-sec__head", children: [_jsx("h3", { className: "pub-sec__title", children: title }), aside] }), hint && _jsx("p", { className: "pub-sec__hint", children: hint }), children] }));
const Field = ({ label, children, wide }) => (_jsxs("label", { className: `pub-field${wide ? ' pub-field--wide' : ''}`, children: [_jsx("span", { className: "pub-field__label", children: label }), children] }));
const Primary = ({ icon, children, onClick, disabled, testId, hint }) => (_jsxs("div", { className: "pub-primary", children: [_jsxs("button", { type: "button", className: "btn btn--primary pub-primary__btn", onClick: onClick, disabled: disabled, "data-testid": testId, children: [_jsx(Icon, { name: icon }), " ", children] }), hint && _jsx("p", { className: "pub-primary__hint", children: hint })] }));
function useBusy() {
    const studio = useStudio();
    return useStore(studio.publish.state, (s) => s.job?.running === true);
}
/** Title-screen fields shared by games and share links. */
const MetaFields = memo(function MetaFields({ compact }) {
    const studio = useStudio();
    const meta = useStore(studio.publish.state, (s) => s.meta);
    const music = useStore(studio.publish.state, (s) => s.music);
    return (_jsxs("div", { className: "pub-grid", children: [_jsx(Field, { label: "Title", wide: true, children: _jsx("input", { className: "input", value: meta.title, maxLength: 80, onChange: (e) => studio.publish.setMeta({ title: e.target.value }), "data-testid": "publish-title" }) }), !compact && (_jsx(Field, { label: "Author", children: _jsx("input", { className: "input", value: meta.author, maxLength: 60, placeholder: "Your name", onChange: (e) => studio.publish.setMeta({ author: e.target.value }) }) })), _jsx(Field, { label: "Music", wide: compact === true, children: _jsxs("select", { className: "select", value: music ?? '', onChange: (e) => studio.publish.setMusic(e.target.value ? e.target.value : null), children: [_jsx("option", { value: "", children: "None" }), MOODS.map((m) => (_jsx("option", { value: m, children: MOOD_LABELS[m] }, m)))] }) }), _jsx(Field, { label: "Description", wide: true, children: _jsx("textarea", { className: "input pub-textarea", rows: compact ? 2 : 3, maxLength: 600, value: meta.description, placeholder: "What is it, and what is the goal?", onChange: (e) => studio.publish.setMeta({ description: e.target.value }) }) }), !compact && (_jsx(Field, { label: "Controls", wide: true, children: _jsx("input", { className: "input", value: meta.controls, maxLength: 300, onChange: (e) => studio.publish.setMeta({ controls: e.target.value }) }) }))] }));
});
/** Copy-able command line. */
const Cmd = ({ text }) => {
    const studio = useStudio();
    return (_jsxs("span", { className: "pub-cmd", children: [_jsx("code", { children: text }), _jsx("button", { type: "button", className: "icon-btn icon-btn--xs", "aria-label": "Copy command", onClick: () => void studio.publish.copy(text, 'Command'), children: _jsx(Icon, { name: "copy", size: 14 }) })] }));
};
const HostRow = memo(function HostRow({ t, defaultName }) {
    const studio = useStudio();
    const busy = useBusy();
    const deploying = useStore(studio.publish.state, (s) => s.hosting.deploying);
    const [name, setName] = useState(defaultName);
    const [itch, setItch] = useState('');
    useEffect(() => setName(defaultName), [defaultName]);
    const needsName = t.id !== 'itch';
    const valid = t.id === 'itch' ? /^[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-]{1,64}$/.test(itch) : /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/.test(name);
    return (_jsxs("div", { className: `pub-host${t.signedIn ? ' is-ready' : ''}`, "data-testid": `publish-host-${t.id}`, children: [_jsxs("div", { className: "pub-host__head", children: [_jsx("span", { className: "pub-host__name", children: t.label }), _jsx("span", { className: `chip chip--xs ${t.signedIn ? 'chip--action' : 'chip--quiet'}`, children: !t.installed ? 'Not installed' : t.signedIn ? (t.account ? `Signed in · ${t.account}` : 'Signed in') : 'Not signed in' })] }), t.signedIn ? (_jsxs("div", { className: "pub-host__form", children: [needsName ? (_jsx("input", { className: "input input--sm", value: name, onChange: (e) => setName(e.target.value.toLowerCase()), "aria-label": `${t.label} name`, placeholder: "site-name" })) : (_jsx("input", { className: "input input--sm", value: itch, onChange: (e) => setItch(e.target.value.trim()), "aria-label": "itch.io user/game", placeholder: "user/game (create the page first)" })), _jsx("button", { type: "button", className: "btn btn--sm btn--primary", disabled: busy || !valid, onClick: () => void studio.publish.deploy(t.id, t.id === 'itch' ? { itch } : { name }), children: deploying === t.id ? 'Publishing…' : 'Publish' })] })) : (_jsx("p", { className: "pub-host__hint", children: t.hint ?? '' }))] }));
});
const Hosting = memo(function Hosting() {
    const studio = useStudio();
    const hosting = useStore(studio.publish.state, (s) => s.hosting);
    const title = useStore(studio.publish.state, (s) => s.meta.title);
    const busy = useBusy();
    const lan = hosting.lan;
    const lanQr = useMemo(() => {
        const u = lan?.urls[0];
        const code = u ? encodeQr(u, { ecc: 'M' }) : null;
        return code ? { d: qrPath(code), n: code.size + 8 } : null;
    }, [lan]);
    if (hosting.local === null)
        return _jsx("p", { className: "pub-muted", children: hosting.checking ? 'Looking for the local app…' : '' });
    if (!hosting.local)
        return (_jsxs("div", { className: "pub-note", children: [_jsx(Icon, { name: "info" }), _jsxs("span", { children: ["Publishing to your own Netlify, Vercel, GitHub Pages or itch.io account, and sharing on your local network, run in the Aether app on your computer \u2014 with the logins of your own command-line tools, never ours. Start it with ", _jsx(Cmd, { text: "npx aether start --open" }), ", or keep using this page: run ", _jsx(Cmd, { text: `npx aether start --origin ${location.origin}` }), " and pair it in Settings \u2192 AI connection. Downloading the game works everywhere."] })] }));
    return (_jsxs(_Fragment, { children: [hosting.via === 'bridge' && _jsx("p", { className: "pub-muted", children: "Through the Aether app on your computer (paired bridge)." }), _jsxs("div", { className: "pub-hosts", children: [(hosting.targets ?? []).map((t) => (_jsx(HostRow, { t: t, defaultName: siteSlug(title) }, t.id))), _jsxs("button", { type: "button", className: "btn btn--ghost btn--sm", onClick: () => void studio.publish.checkHosting(true), disabled: hosting.checking, children: [_jsx(Icon, { name: "refresh" }), " ", hosting.checking ? 'Checking…' : 'Check again'] })] }), hosting.log.length > 0 && (_jsx("ol", { className: "pub-log", "aria-label": "Deploy log", children: hosting.log.slice(-10).map((e) => (_jsx("li", { className: `pub-log__line is-${e.kind}`, children: e.text }, e.seq))) })), _jsxs(Section, { title: "Share on your local network", hint: "Phones, tablets and computers on the same Wi-Fi can play it \u2014 no internet needed. Anyone on this network with the link can open it while sharing is on; it turns itself off after two hours.", children: [_jsx(Toggle, { label: lan?.on ? 'Sharing on this network' : 'Share on this network', checked: lan?.on === true, disabled: busy, onChange: (on) => void studio.publish.setLan(on) }), lan?.on && (_jsxs("div", { className: "pub-lan", children: [lanQr && (_jsxs("svg", { className: "pub-qr pub-qr--sm", viewBox: `0 0 ${lanQr.n} ${lanQr.n}`, role: "img", "aria-label": "QR code of the network link", children: [_jsx("rect", { width: lanQr.n, height: lanQr.n, fill: "#fff" }), _jsx("path", { d: lanQr.d, fill: "#000" })] })), _jsxs("div", { className: "pub-lan__links", children: [lan.urls.length === 0 && _jsx("p", { className: "pub-muted", children: "No network address found (are you on Wi-Fi?)." }), lan.urls.map((u) => (_jsxs("span", { className: "pub-cmd", children: [_jsx("code", { children: u }), _jsx("button", { type: "button", className: "icon-btn icon-btn--xs", "aria-label": "Copy network link", onClick: () => void studio.publish.copy(u, 'Network link'), children: _jsx(Icon, { name: "copy", size: 14 }) })] }, u))), lan.until && _jsxs("p", { className: "pub-muted", children: ["Until ", new Date(lan.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })] })] })] }))] })] }));
});
/** Replay seal: what it is, whether it is on, and what the last seal said. */
export const SealSection = memo(function SealSection() {
    const studio = useStudio();
    const seal = useStore(studio.publish.state, (s) => s.seal);
    return (_jsxs(Section, { title: "Replay seal", hint: "Re-simulates your world's physics and rules headless and ships the result with it, so anyone can re-run the check on their own device. It is a deterministic replay check, not a formal proof.", children: [_jsx(Toggle, { label: "Seal this world when publishing", hint: "Adds a verifiable replay proof to the game and to share links", checked: seal.on, onChange: (v) => studio.publish.setSeal({ on: v }) }), seal.on && _jsx(Toggle, { label: "Sign with this browser's key", hint: "Shows later seals come from the same browser. It does not prove who you are", checked: seal.sign, onChange: (v) => studio.publish.setSeal({ sign: v }) }), seal.on && seal.note && (_jsxs("p", { className: `pub-muted${seal.status === 'failed' ? ' field-error' : ''}`, role: "status", "data-testid": "publish-seal-note", children: [seal.note, seal.hash ? ` · ${seal.hash}` : '', seal.keyId ? ` · key ${seal.keyId}` : ''] }))] }));
});
/** Game: download, your own hosting, your network. */
export const GameTarget = memo(function GameTarget() {
    const studio = useStudio();
    const world = useWorld();
    const busy = useBusy();
    const includeSave = useStore(studio.publish.state, (s) => s.game.includeSave);
    return (_jsxs(_Fragment, { children: [_jsxs(Section, { title: "Title screen", hint: "Shown before play, with a slow fly-through of your world behind it. The published game also has a pause menu, settings, credits, touch and controller support.", children: [_jsx(MetaFields, {}), world.voxel && _jsx(Toggle, { label: "Include my block-world save", hint: "Players start from the world as you left it in play mode", checked: includeSave, onChange: (v) => studio.publish.setGame({ includeSave: v }) })] }), _jsx(SealSection, {}), _jsx(Primary, { icon: "download", onClick: () => void studio.publish.downloadGame(), disabled: busy, testId: "publish-game-download", hint: "A complete static website: index.html, the player, your world and its assets. Upload it to itch.io (HTML game), GitHub Pages, Netlify or any static host. Plays offline and installs as an app.", children: "Download game (.zip)" }), _jsx(Section, { title: "Publish to your own hosting", children: _jsx(Hosting, {}) })] }));
});
/** Music preview button. */
const MusicPreview = memo(function MusicPreview({ mood, volume }) {
    const world = useWorld();
    const [player, setPlayer] = useState(null);
    useEffect(() => () => player?.stop(), [player]);
    return (_jsxs("button", { type: "button", className: "btn btn--sm", disabled: !mood, onClick: () => {
            if (player) {
                player.stop();
                setPlayer(null);
                return;
            }
            if (!mood)
                return;
            const p = playMusic(mood, 10, { seed: musicSeed(world.name), volume });
            setPlayer(p);
            if (p)
                setTimeout(() => setPlayer((cur) => (cur === p ? null : cur)), 10_500);
        }, children: [_jsx(Icon, { name: player ? 'stop' : 'music' }), " ", player ? 'Stop' : 'Listen'] }));
});
/** Video: the shot (camera path), output, titles and music. */
export const VideoTarget = memo(function VideoTarget() {
    const studio = useStudio();
    const busy = useBusy();
    const path = useStore(studio.publish.state, (s) => s.path);
    const video = useStore(studio.publish.state, (s) => s.video);
    const directing = useStore(studio.publish.state, (s) => s.directing);
    const note = useStore(studio.publish.state, (s) => s.directNote);
    const showPath = useStore(studio.publish.state, (s) => s.showPath);
    const [prompt, setPrompt] = useState('');
    return (_jsxs(_Fragment, { children: [_jsxs(Section, { title: "Direct the shot", hint: "Describe the camera move, pick a preset, or add keyframes from the view on the timeline below the viewport.", children: [_jsxs("form", { className: "pub-direct", onSubmit: (e) => {
                            e.preventDefault();
                            void studio.publish.direct(prompt);
                        }, children: [_jsx("input", { className: "input", value: prompt, maxLength: 600, placeholder: "slow dolly through the living room, then rise above the roof", onChange: (e) => setPrompt(e.target.value), "aria-label": "Describe the camera move", "data-testid": "publish-direct-input" }), _jsxs("button", { type: "submit", className: "btn btn--primary btn--sm", disabled: directing || prompt.trim() === '', "data-testid": "publish-direct", children: [_jsx(Icon, { name: "sparkles" }), " ", directing ? 'Directing…' : 'Direct'] })] }), note && _jsx("p", { className: "pub-muted", "data-testid": "publish-direct-note", children: note }), _jsx("div", { className: "pub-chips", role: "group", "aria-label": "Camera presets", children: PRESET_IDS.map((id) => (_jsx("button", { type: "button", className: "chip chip--action", onClick: () => studio.publish.applyPreset(id), "data-tip": PRESETS[id].hint, "data-testid": `publish-preset-${id}`, children: PRESETS[id].label }, id))) }), _jsxs("div", { className: "pub-row", children: [_jsxs("span", { className: "pub-muted", children: [path.keys.length, " keyframe", path.keys.length === 1 ? '' : 's', " \u00B7 ", path.duration.toFixed(1), " s"] }), _jsx(Toggle, { label: "Show path", checked: showPath, onChange: (v) => studio.publish.setShowPath(v) })] })] }), _jsx(Section, { title: "Output", children: _jsxs("div", { className: "pub-grid", children: [_jsx(Field, { label: "Size", wide: true, children: _jsx(Segmented, { label: "Video size", stretch: true, size: "sm", value: video.preset, options: Object.keys(VIDEO_PRESETS).map((k) => [k, VIDEO_PRESETS[k].label.split(' ')[0]]), titles: Object.fromEntries(Object.keys(VIDEO_PRESETS).map((k) => [k, `${VIDEO_PRESETS[k].width} × ${VIDEO_PRESETS[k].height}`])), onChange: (v) => studio.publish.setVideo({ preset: v }) }) }), _jsx(Field, { label: "Frame rate", children: _jsx(Segmented, { label: "Frame rate", stretch: true, size: "sm", value: String(video.fps), options: [['24', '24'], ['30', '30'], ['60', '60']], onChange: (v) => studio.publish.setVideo({ fps: Number(v) }) }) }), _jsx(Field, { label: "Format", children: _jsxs("select", { className: "select", value: video.format, onChange: (e) => studio.publish.setVideo({ format: e.target.value }), children: [_jsx("option", { value: "auto", children: "Best available" }), _jsx("option", { value: "mp4", children: "MP4 (H.264)" }), _jsx("option", { value: "webm", children: "WebM (VP9)" })] }) }), _jsx(Field, { label: "Smoothing", wide: true, children: _jsx(Segmented, { label: "Temporal smoothing", stretch: true, size: "sm", value: String(video.quality), options: [['1', 'Fast'], ['2', 'Smooth'], ['4', 'Best']], titles: { '1': 'One render per frame', '2': 'Two renders per frame (softer edges)', '4': 'Four renders per frame (slowest)' }, onChange: (v) => studio.publish.setVideo({ quality: Number(v) }) }) })] }) }), _jsxs(Section, { title: "Titles and music", children: [_jsxs("div", { className: "pub-grid", children: [_jsx(Field, { label: "Opening title", wide: true, children: _jsx("input", { className: "input", value: video.titles.title, maxLength: 80, onChange: (e) => studio.publish.setTitles({ title: e.target.value }) }) }), _jsx(Field, { label: "Subtitle", wide: true, children: _jsx("input", { className: "input", value: video.titles.subtitle, maxLength: 120, placeholder: "optional", onChange: (e) => studio.publish.setTitles({ subtitle: e.target.value }) }) }), _jsx(Field, { label: "End card", wide: true, children: _jsx("input", { className: "input", value: video.titles.endText, maxLength: 80, placeholder: "optional, e.g. Made with Aether", onChange: (e) => studio.publish.setTitles({ endText: e.target.value }) }) })] }), _jsx(Toggle, { label: "Cinematic bars (2.39:1)", checked: video.titles.letterbox, onChange: (v) => studio.publish.setTitles({ letterbox: v }) }), _jsx(Toggle, { label: "Fade in and out", checked: video.titles.fades, onChange: (v) => studio.publish.setTitles({ fades: v }) }), _jsxs("div", { className: "pub-row", children: [_jsxs("select", { className: "select select--sm", value: video.music ?? '', onChange: (e) => studio.publish.setVideo({ music: e.target.value ? e.target.value : null }), "aria-label": "Soundtrack", children: [_jsx("option", { value: "", children: "No music" }), MOODS.map((m) => (_jsxs("option", { value: m, children: [MOOD_LABELS[m], " score"] }, m)))] }), _jsx("input", { className: "slider", type: "range", min: 0, max: 1, step: 0.05, value: video.volume, onChange: (e) => studio.publish.setVideo({ volume: Number(e.target.value) }), "aria-label": "Music volume", disabled: !video.music }), _jsx(MusicPreview, { mood: video.music, volume: video.volume })] })] }), _jsx(Primary, { icon: "film", onClick: () => void studio.publish.exportVideo(), disabled: busy || path.keys.length < 2, testId: "publish-video-export", hint: path.keys.length < 2 ? 'Add a second keyframe, pick a preset or direct a shot first.' : 'Every frame is rendered offline at full quality — the result never drops frames.', children: "Render video" })] }));
});
/** Render: a still image. */
export const RenderTarget = memo(function RenderTarget() {
    const studio = useStudio();
    const busy = useBusy();
    const still = useStore(studio.publish.state, (s) => s.still);
    const keys = useStore(studio.publish.state, (s) => s.path.keys.length);
    const sim = studio.simulation;
    const photorealAvailable = sim?.renderer.studioQualityAvailable ?? false;
    return (_jsxs(_Fragment, { children: [_jsxs(Section, { title: "Image", children: [_jsxs("div", { className: "pub-grid", children: [_jsx(Field, { label: "Size", wide: true, children: _jsxs("select", { className: "select", value: still.preset, onChange: (e) => studio.publish.setStill({ preset: e.target.value }), "data-testid": "publish-still-preset", children: [Object.keys(STILL_PRESETS).map((k) => (_jsx("option", { value: k, children: STILL_PRESETS[k].label }, k))), _jsx("option", { value: "custom", children: "Custom\u2026" })] }) }), still.preset === 'custom' && (_jsxs(_Fragment, { children: [_jsx(Field, { label: "Width", children: _jsx("input", { className: "input", type: "number", min: 64, max: MAX_STILL_SIDE, value: still.width, onChange: (e) => studio.publish.setStill({ width: Number(e.target.value) }) }) }), _jsx(Field, { label: "Height", children: _jsx("input", { className: "input", type: "number", min: 64, max: MAX_STILL_SIDE, value: still.height, onChange: (e) => studio.publish.setStill({ height: Number(e.target.value) }) }) })] })), _jsx(Field, { label: "Format", wide: true, children: _jsx(Segmented, { label: "Image format", stretch: true, size: "sm", value: still.format, options: [['png', 'PNG'], ['jpeg', 'JPEG'], ['webp', 'WebP']], onChange: (v) => studio.publish.setStill({ format: v }) }) }), _jsx(Field, { label: "Camera", wide: true, children: _jsx(Segmented, { label: "Camera", stretch: true, size: "sm", value: still.source, options: [['view', 'Current view'], ['shot', 'First keyframe']], disabled: keys === 0, onChange: (v) => studio.publish.setStill({ source: v }) }) })] }), _jsx(Toggle, { label: "Photoreal", hint: photorealAvailable ? 'Ambient occlusion, reflections, sun shafts, soft shadows and 24 accumulated samples per pixel — for architecture and stills' : 'Needs the studio render, which this device cannot run', checked: still.photoreal && photorealAvailable, disabled: !photorealAvailable, onChange: (v) => studio.publish.setStill({ photoreal: v }) }), _jsx(Toggle, { label: "Path traced (beta)", hint: "Global illumination, soft area lights and real glass, accumulated sample by sample like Blender Cycles. Slow, and the first one in a session compiles a large shader; cancel any time.", checked: still.pathTraced, onChange: (v) => studio.publish.setStill({ pathTraced: v }) }), still.pathTraced && (_jsx(Field, { label: "Quality", wide: true, children: _jsx(Segmented, { label: "Path tracing samples", stretch: true, size: "sm", value: String(still.samples), options: [['64', 'Draft 64'], ['256', 'Good 256'], ['1024', 'Best 1024']], onChange: (v) => studio.publish.setStill({ samples: Number(v) }) }) })), _jsx(Toggle, { label: "Final render", hint: "Adds depth of field (and, for a raster render, 48 samples per pixel with 2\u00D7 supersampling). Slower: the cleanest result the renderer can make.", checked: still.final && (still.pathTraced || (still.photoreal && photorealAvailable)), disabled: !still.pathTraced && (!photorealAvailable || !still.photoreal), onChange: (v) => studio.publish.setStill({ final: v }) })] }), _jsx(Primary, { icon: "image", onClick: () => void studio.publish.exportStill(), disabled: busy, testId: "publish-still-export", hint: `${still.width} × ${still.height}. Larger images render in tiles, so even 4K never needs a 4K screen.`, children: "Render still" })] }));
});
/** 3D model. */
export const ModelTarget = memo(function ModelTarget() {
    const studio = useStudio();
    const busy = useBusy();
    const model = useStore(studio.publish.state, (s) => s.model);
    return (_jsxs(_Fragment, { children: [_jsx(Section, { title: "3D model", hint: "Everything you see in the viewport \u2014 meshes with their PBR materials and textures, imported and library models, procedural and architecture geometry \u2014 for Blender, Unity, Unreal, Sketchfab or any glTF viewer.", children: _jsx(Segmented, { label: "Model format", stretch: true, value: model.binary ? 'glb' : 'gltf', options: [['glb', 'GLB (one file)'], ['gltf', 'glTF (JSON)']], onChange: (v) => studio.publish.setModel({ binary: v === 'glb' }) }) }), _jsx(Primary, { icon: "box3d", onClick: () => void studio.publish.exportModel(), disabled: busy, testId: "publish-model-export", children: "Export 3D model" })] }));
});
/** Floor plan of a building. */
export const PlanTarget = memo(function PlanTarget() {
    const studio = useStudio();
    const world = useWorld();
    const busy = useBusy();
    const plan = useStore(studio.publish.state, (s) => s.plan);
    const buildings = useMemo(() => listBuildings(world), [world]);
    const building = plan.building && buildings.some((b) => b.id === plan.building) ? plan.building : (buildings[0]?.id ?? null);
    const levels = useMemo(() => (building ? listLevels(world, building) : []), [world, building]);
    if (buildings.length === 0)
        return (_jsxs("div", { className: "empty-state", children: [_jsx("span", { className: "empty-state__icon", children: _jsx(Icon, { name: "plan", size: 20 }) }), _jsx("h3", { className: "empty-state__title", children: "No building in this world" }), _jsx("p", { className: "empty-state__text", children: "Floor plans come from buildings. Ask for one \u2014 \u201Ca modern two-bedroom apartment\u201D \u2014 or start from an architecture template." })] }));
    return (_jsxs(_Fragment, { children: [_jsx(Section, { title: "Floor plan", hint: "Walls, doors with swings, windows, stairs, furniture, room names and areas, dimensions, a scale bar and a north arrow \u2014 print-ready at 1:50 or 1:100.", children: _jsxs("div", { className: "pub-grid", children: [_jsx(Field, { label: "Building", wide: true, children: _jsx("select", { className: "select", value: building ?? '', onChange: (e) => studio.publish.setPlan({ building: e.target.value, level: 0 }), children: buildings.map((b) => (_jsx("option", { value: b.id, children: b.name }, b.id))) }) }), _jsx(Field, { label: "Storey", children: _jsx("select", { className: "select", value: plan.level, onChange: (e) => studio.publish.setPlan({ level: Number(e.target.value) }), children: levels.map((l) => (_jsx("option", { value: l.index, children: l.name }, l.id))) }) }), _jsx(Field, { label: "Scale", children: _jsx(Segmented, { label: "Scale", stretch: true, size: "sm", value: String(plan.scale), options: [['50', '1:50'], ['100', '1:100']], onChange: (v) => studio.publish.setPlan({ scale: Number(v) }) }) }), _jsx(Field, { label: "Format", wide: true, children: _jsx(Segmented, { label: "Plan format", stretch: true, size: "sm", value: plan.format, options: [['svg', 'SVG'], ['pdf', 'PDF']], onChange: (v) => studio.publish.setPlan({ format: v }) }) })] }) }), _jsx(Primary, { icon: "plan", onClick: () => void studio.publish.exportPlan(), disabled: busy, testId: "publish-plan-export", children: "Export floor plan" })] }));
});
/** Which player share links open (this studio, or a hosted copy when this one runs locally). */
const PlayerAddress = memo(function PlayerAddress() {
    const studio = useStudio();
    const base = useStore(studio.publish.state, (s) => s.playerBase);
    const local = useStore(studio.publish.state, (s) => s.playerLocal);
    const [draft, setDraft] = useState(base);
    const [error, setError] = useState(null);
    const [editing, setEditing] = useState(false);
    useEffect(() => setDraft(base), [base]);
    if (!local && !editing)
        return (_jsxs("p", { className: "pub-muted", children: ["Links open in the player at ", base, ".", ' ', _jsx("button", { type: "button", className: "link", onClick: () => setEditing(true), children: "Change" })] }));
    return (_jsxs(Section, { title: "Player address", hint: local ? 'This studio runs on your computer, so its links only open here. Enter the address of a hosted copy of Aether (any static deployment of the studio) to share links with anyone.' : 'The player share links open in.', children: [_jsxs("form", { className: "pub-direct", onSubmit: (e) => {
                    e.preventDefault();
                    const err = studio.publish.setPlayerBase(draft);
                    setError(err);
                    if (!err)
                        setEditing(false);
                }, children: [_jsx("input", { className: "input", value: draft, onChange: (e) => setDraft(e.target.value), placeholder: "https://your-aether.example/play", "aria-label": "Player address" }), _jsx("button", { type: "submit", className: "btn btn--sm", children: "Use" })] }), error && _jsx("p", { className: "field-error", children: error })] }));
});
/** Share link with QR code and embed snippet. */
export const ShareTarget = memo(function ShareTarget() {
    const studio = useStudio();
    const share = useStore(studio.publish.state, (s) => s.share);
    const meta = useStore(studio.publish.state, (s) => s.meta);
    const link = share.value ? studio.publish.shareLink() : null;
    const embed = share.value ? studio.publish.embedSnippet() : null;
    useEffect(() => {
        if (!share.value) {
            const t = setTimeout(() => void studio.publish.makeShareLink(), 250);
            return () => clearTimeout(t);
        }
        return undefined;
    }, [share.value, meta, studio]);
    const fill = Math.min(1, share.chars / MAX_FRAGMENT_CHARS);
    return (_jsxs(_Fragment, { children: [_jsx(Section, { title: "Title screen", children: _jsx(MetaFields, { compact: true }) }), _jsx(PlayerAddress, {}), _jsx(SealSection, {}), _jsxs(Section, { title: "Link", hint: "The whole world travels inside the link, after the #. Browsers never send that part to a server, so nothing is uploaded or stored anywhere \u2014 the link is the game.", children: [_jsxs("div", { className: "pub-link", children: [_jsx("input", { className: "input input--mono", readOnly: true, value: link ?? (share.fits ? 'Making the link…' : 'Too large for a link'), "aria-label": "Share link", "data-testid": "publish-share-link", onFocus: (e) => e.target.select() }), _jsxs("button", { type: "button", className: "btn btn--primary btn--sm", disabled: !link, onClick: () => void studio.publish.copyShareLink(), "data-testid": "publish-share-copy", children: [_jsx(Icon, { name: "copy" }), " Copy"] }), _jsxs("a", { className: `btn btn--sm${link ? '' : ' is-disabled'}`, href: link ?? undefined, target: "_blank", rel: "noopener noreferrer", "aria-disabled": !link, children: [_jsx(Icon, { name: "external" }), " Open"] })] }), _jsx("div", { className: "pub-meter", "aria-label": "Link size", children: _jsx("div", { className: `pub-meter__fill${!share.fits ? ' is-over' : fill > 0.04 ? ' is-long' : ''}`, style: { width: `${Math.max(1, fill * 100)}%` } }) }), _jsxs("p", { className: "pub-muted", "data-testid": "publish-share-size", children: [linkSizeLabel(share.chars), " of 1.5 MB", share.note ? ` · ${share.note}` : ''] }), share.qr && (_jsxs("div", { className: "pub-qrbox", children: [_jsxs("svg", { className: "pub-qr", viewBox: `0 0 ${share.qrSize} ${share.qrSize}`, role: "img", "aria-label": "QR code of the share link", "data-testid": "publish-share-qr", children: [_jsx("rect", { width: share.qrSize, height: share.qrSize, fill: "#fff" }), _jsx("path", { d: share.qr, fill: "#000" })] }), _jsx("p", { className: "pub-muted", children: "Scan to play on a phone." })] }))] }), _jsx(Section, { title: "Remix link", hint: "Opens this world read-only in the studio; visitors can play it or press Remix to get their own editable copy. Like the player link, the world travels in the link.", children: _jsxs("button", { type: "button", className: "btn btn--sm", onClick: () => void studio.share(), "data-testid": "publish-share-remix", children: [_jsx(Icon, { name: "copy" }), " Copy remix link"] }) }), embed && (_jsxs(Section, { title: "Embed", hint: "Paste into a web page, a blog or a portfolio to play it in place.", children: [_jsx("textarea", { className: "input input--mono pub-textarea", readOnly: true, rows: 3, value: embed, onFocus: (e) => e.target.select(), "aria-label": "Embed code" }), _jsxs("button", { type: "button", className: "btn btn--sm", onClick: () => void studio.publish.copy(embed, 'Embed code'), children: [_jsx(Icon, { name: "copy" }), " Copy embed code"] })] }))] }));
});
const KIND_ICON = { game: 'gamepad', video: 'film', render: 'image', model: 'box3d', plan: 'plan', link: 'link', hosting: 'globe', lan: 'wifi' };
const HistoryRow = memo(function HistoryRow({ item }) {
    const studio = useStudio();
    return (_jsxs("li", { className: "pub-hist", children: [item.thumb ? _jsx("img", { className: "pub-hist__thumb", src: item.thumb, alt: "" }) : _jsx("span", { className: "pub-hist__thumb pub-hist__thumb--icon", children: _jsx(Icon, { name: KIND_ICON[item.kind] }) }), _jsxs("span", { className: "pub-hist__text", children: [_jsxs("span", { className: "pub-hist__title", children: [_jsx(Icon, { name: KIND_ICON[item.kind], size: 14 }), " ", item.title] }), _jsx("span", { className: "pub-hist__detail", children: item.detail }), _jsx("span", { className: "pub-hist__time", children: formatRelative(item.createdAt) })] }), _jsxs("span", { className: "pub-hist__actions", children: [item.hasBlob && (_jsx("button", { type: "button", className: "icon-btn icon-btn--sm", "aria-label": "Download again", "data-tip": "Download again", onClick: () => void studio.publish.downloadItem(item), children: _jsx(Icon, { name: "download" }) })), item.url && (_jsx("a", { className: "icon-btn icon-btn--sm", href: item.url, target: "_blank", rel: "noopener noreferrer", "aria-label": "Open", "data-tip": "Open", children: _jsx(Icon, { name: "external" }) })), _jsx("button", { type: "button", className: "icon-btn icon-btn--sm", "aria-label": "Remove from history", "data-tip": "Remove from history", onClick: () => void studio.publish.removeItem(item.id), children: _jsx(Icon, { name: "trash" }) })] })] }));
});
/** Publish history and saved versions of this project. */
export const HistoryTarget = memo(function HistoryTarget() {
    const studio = useStudio();
    const history = useStore(studio.publish.state, (s) => s.history);
    const versions = useStore(studio.publish.state, (s) => s.versions);
    const [label, setLabel] = useState('');
    return (_jsxs(_Fragment, { children: [_jsxs(Section, { title: "Versions", hint: "Snapshots of this project. Publishing saves one automatically; restoring is one Undo away.", children: [studio.projectId ? (_jsxs("form", { className: "pub-direct", onSubmit: (e) => {
                            e.preventDefault();
                            void studio.publish.snapshot(label || 'Saved version').then((ok) => {
                                if (ok)
                                    setLabel('');
                                studio.store.getState().toast(ok ? 'Version saved.' : 'This world is too large to keep as a version.', ok ? 'success' : 'error', 3);
                            });
                        }, children: [_jsx("input", { className: "input", value: label, maxLength: 80, placeholder: "Name this version", onChange: (e) => setLabel(e.target.value), "aria-label": "Version name" }), _jsxs("button", { type: "submit", className: "btn btn--sm", "data-testid": "publish-save-version", children: [_jsx(Icon, { name: "plus" }), " Save version"] })] })) : (_jsx("p", { className: "pub-muted", children: "Versions are kept for projects." })), _jsxs("ul", { className: "pub-versions", children: [versions.map((v) => (_jsxs("li", { className: "pub-version", children: [_jsxs("span", { className: "pub-version__text", children: [_jsx("span", { className: "pub-version__label", children: v.label }), _jsxs("span", { className: "pub-muted", children: [formatRelative(v.createdAt), " \u00B7 ", v.entityCount, " objects"] })] }), _jsx("button", { type: "button", className: "btn btn--sm", onClick: () => void studio.publish.restoreVersion(v.id), children: "Restore" }), _jsx("button", { type: "button", className: "icon-btn icon-btn--sm", "aria-label": "Delete version", onClick: () => void studio.publish.removeVersion(v.id), children: _jsx(Icon, { name: "trash" }) })] }, v.id))), versions.length === 0 && studio.projectId && _jsx("li", { className: "pub-muted", children: "No versions yet." })] })] }), _jsx(Section, { title: "Published", hint: "Everything published from this project in this browser. Files up to 120 MB stay here so you can download them again.", children: history.length === 0 ? (_jsx("p", { className: "pub-muted", children: "Nothing published yet." })) : (_jsx("ul", { className: "pub-history", "data-testid": "publish-history", children: history.map((item) => (_jsx(HistoryRow, { item: item }, item.id))) })) })] }));
});
