import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/** In-app documentation: a short guide to the studio (static content). */
import { memo } from 'react';
import { SHORTCUTS } from '../app/useShortcuts';
const SECTIONS = [
    {
        id: 'start',
        title: 'Getting started',
        body: [
            'Create a project from a template, a blank scene or a prompt. Every project opens in the editor: the agent on the left, the world in the middle and the inspector on the right.',
            'Describe what you want in plain language — “a windmill on a hill at sunset”, “make the ball heavier”, “add a timer and a goal flag”. The agent plans the world, builds it, checks it with real physics and repairs what fails.',
        ],
    },
    {
        id: 'prompts',
        title: 'Writing prompts',
        body: [
            'Name the things, the mood and the rules: objects (“three tents and a campfire”), light (“at night with fog”) and goals (“collect 10 coins in 60 seconds”).',
            'Follow-up prompts edit the current world. Ask for one change at a time for the most predictable results; every change can be undone.',
        ],
    },
    {
        id: 'editing',
        title: 'Editing by hand',
        body: [
            'Click an object in the viewport or in Objects to select it; the inspector shows its transform, shape, material, physics and behaviours. Values commit on Enter.',
            'Assets places ready-made objects (primitives, nature, buildings, gameplay pieces, lights) at the centre of the view. With nothing selected the inspector edits the scene: sky, time of day, fog, light, gravity and the play camera.',
        ],
    },
    {
        id: 'play',
        title: 'Playing',
        body: [
            'Press Play to run the world: physics, rules and behaviours start, and Stop restores everything exactly. Move with WASD or the arrow keys, jump with Space, act with E; drag to look. On touch screens use the on-screen stick and buttons.',
        ],
    },
    {
        id: 'checks',
        title: 'Physics checks',
        body: [
            'Checks simulates the world headless and runs its tests — stability, reachability, overlaps — plus static diagnostics. Failing checks can be sent back to the agent with one click.',
        ],
    },
    {
        id: 'projects',
        title: 'Projects and files',
        body: [
            'Projects are saved automatically in this browser (IndexedDB). Export a project as a .aether.json file to back it up or move it to another browser, and import it from the home page — drag a file anywhere onto the page.',
            'Versions: save a named version of a project from Publish → History and restore any of them later as one undoable change. Every publish saves one automatically.',
        ],
    },
    {
        id: 'publish',
        title: 'Publishing',
        body: [
            'Publish (top bar) turns the open world into a game, a video, a still, a 3D model, a floor plan or a link, with a preview, progress, Cancel and a history you can download from again.',
            'Share link: the whole world travels inside the link, after the #, so nothing is uploaded — the link is the game. Copy it, scan its QR code, or embed it in a page.',
            'Game: download a complete static website (.zip) for itch.io, GitHub Pages, Netlify or any host, with a title screen, pause menu, settings, credits, touch and controller support; it plays offline. In the Aether app on your computer you can also publish it to your own Netlify, Vercel, GitHub Pages or itch.io account, or share it on your local network.',
            'Video: pick a preset or describe the shot ("slow dolly through the living room then rise above the roof"), adjust keyframes on the timeline under the viewport, add titles and music, and render — every frame at full quality.',
            'Render, 3D model and floor plan: stills up to 4K (photoreal for buildings), GLB / glTF with materials, and print-ready SVG / PDF plans with rooms, areas and dimensions.',
        ],
    },
];
/** Documentation page. */
export const Docs = memo(function Docs() {
    return (_jsxs("div", { className: "docs", children: [_jsxs("nav", { className: "docs__toc", "aria-label": "On this page", children: [_jsx("span", { className: "docs__toc-title", children: "On this page" }), SECTIONS.map((s) => (_jsx("a", { href: `#/docs`, onClick: (e) => {
                            e.preventDefault();
                            document.getElementById(`doc-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }, children: s.title }, s.id))), _jsx("a", { href: "#/docs", onClick: (e) => {
                            e.preventDefault();
                            document.getElementById('doc-shortcuts')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }, children: "Keyboard shortcuts" })] }), _jsxs("article", { className: "docs__body", children: [SECTIONS.map((s) => (_jsxs("section", { id: `doc-${s.id}`, className: "docs__section", children: [_jsx("h2", { children: s.title }), s.body.map((p, i) => (_jsx("p", { children: p }, i)))] }, s.id))), _jsxs("section", { id: "doc-shortcuts", className: "docs__section", children: [_jsx("h2", { children: "Keyboard shortcuts" }), _jsx("dl", { className: "shortcut-list", children: SHORTCUTS.map(([keys, what]) => (_jsxs("div", { className: "shortcut-list__row", children: [_jsx("dt", { children: what }), _jsx("dd", { children: _jsx("kbd", { children: keys }) })] }, keys))) })] })] })] }));
});
