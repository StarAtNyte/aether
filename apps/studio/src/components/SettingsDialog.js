import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Settings: appearance, viewport, play, performance, AI connection and the
 * keyboard reference. Shared by the home page (app settings) and the editor
 * (studio settings, plus renderer details); the caller supplies the values
 * and the update function.
 */
import { lazyBoundary } from './ErrorBoundary';
import { memo, useEffect, useState } from 'react';
// Lazy: the AI pane pulls in the agent package; the home page must not pay for it up front.
const AiConnectionPane = lazyBoundary(async () => ({ default: (await import('./ai/AiConnectionPane')).AiConnectionPane }), { what: 'connection settings', fallback: _jsx("div", { className: "settings__pane", "aria-busy": "true" }), variant: 'inline' });
import { SHORTCUTS } from '../app/useShortcuts';
import { EFFECT_SETTINGS } from '../lib/storage';
import { Toggle } from './fields';
import { Dialog } from './ui/Dialog';
import { Segmented } from './ui/Segmented';
const VIEWPORT_OPTIONS = [
    ['showPerf', 'Performance overlay', 'Frame rate, draw calls and memory over the viewport.'],
    ['showLabels', 'Object labels', 'Name labels over the main objects in the viewport.'],
    ['showColliders', 'Show colliders', 'Wireframe physics colliders.'],
    ['shadows', 'Shadows', 'Soft shadows (applies after reload).'],
    ['showNavHint', 'Navigation hint', 'Mouse and touch controls shown over an idle viewport.'],
];
const TIER_CHOICES = [
    ['auto', 'Auto'],
    ['low', 'Low'],
    ['medium', 'Medium'],
    ['high', 'High'],
    ['ultra', 'Ultra'],
];
/** Effects the tiers switch on, in the order they are listed (id, label, what it does). */
const EFFECT_LABELS = {
    ao: ['Ambient occlusion', 'Contact shadows in corners and under objects.'],
    gi: ['Bounced light (experimental)', 'Screen-space bounce of lit surfaces; noisy, so off in every tier. Interiors already get a warm floor-bounce fill.'],
    taa: ['Temporal anti-aliasing', 'Smooth edges and shimmer-free foliage.'],
    ssr: ['Reflections', 'Glass, water, polished floors and metal mirror the scene.'],
    shafts: ['Sun shafts', 'Light beams through gaps and shadows.'],
    halation: ['Glow', 'A wide warm bloom around bright lights.'],
    aberration: ['Lens fringing', 'A trace of colour fringing towards the corners.'],
    grain: ['Film grain', 'Fine grain that also hides colour banding in skies.'],
};
/** Effects each tier runs by default (mirrors the renderer's tier table; used to show the state of the switches). */
export const TIER_EFFECTS = {
    low: [],
    medium: ['grain'],
    high: ['ao', 'taa', 'grain'],
    ultra: ['ao', 'taa', 'ssr', 'shafts', 'halation', 'aberration', 'grain'],
};
const LOW_MEMORY_CHOICES = [
    ['auto', 'Auto'],
    ['on', 'On'],
    ['off', 'Off'],
];
const BACKEND_CHOICES = [
    ['auto', 'Auto'],
    ['webgpu', 'WebGPU'],
    ['webgl2', 'WebGL2'],
];
/** Settings dialog. */
export const SettingsDialog = memo(function SettingsDialog({ open, onClose, settings, update, context = {}, initialTab = 'general', ai, }) {
    const [tab, setTab] = useState(initialTab);
    useEffect(() => {
        if (open)
            setTab(initialTab);
    }, [open, initialTab]);
    const { memory, gpu } = context;
    return (_jsxs(Dialog, { open: open, onClose: onClose, title: "Settings", size: "md", className: "settings", children: [_jsx(Segmented, { label: "Settings section", value: tab, onChange: setTab, options: [
                    ['general', 'General'],
                    ['ai', 'AI connection'],
                    ['shortcuts', 'Shortcuts'],
                ], stretch: true }), tab === 'general' && (_jsxs("div", { className: "settings__pane", children: [_jsxs("section", { className: "settings__group", children: [_jsx("h3", { className: "settings__heading", children: "Appearance" }), _jsxs("div", { className: "setting-row", children: [_jsxs("span", { className: "setting-row__text", children: [_jsx("span", { className: "setting-row__label", children: "Theme" }), _jsx("span", { className: "setting-row__hint", children: "Follows your system until you choose." })] }), _jsx(Segmented, { label: "Theme", value: settings.darkTheme ? 'dark' : 'light', onChange: (v) => update({ darkTheme: v === 'dark' }), options: [
                                            ['light', 'Light'],
                                            ['dark', 'Dark'],
                                        ] })] }), _jsx(Toggle, { label: "Interface sounds", hint: "Quiet cues when a prompt is sent, a proof passes and play starts.", checked: settings.uiSounds, onChange: (v) => update({ uiSounds: v }) })] }), _jsxs("section", { className: "settings__group", children: [_jsx("h3", { className: "settings__heading", children: "Viewport" }), VIEWPORT_OPTIONS.map(([key, label, hint]) => (_jsx(Toggle, { label: label, hint: hint, checked: settings[key], onChange: (v) => update({ [key]: v }) }, key)))] }), _jsxs("section", { className: "settings__group", children: [_jsx("h3", { className: "settings__heading", children: "Play" }), _jsx(Toggle, { label: "Full-window play", hint: "Side panels step aside while you play, so the world fills the window.", checked: settings.immersivePlay, onChange: (v) => update({ immersivePlay: v }) }), _jsx(Toggle, { label: "Capture the mouse", hint: "Click the viewport in play mode to lock the pointer for mouse-look.", checked: settings.pointerLock, onChange: (v) => update({ pointerLock: v }) })] }), _jsxs("section", { className: "settings__group", children: [_jsx("h3", { className: "settings__heading", children: "Graphics" }), _jsxs("div", { className: "setting-row", children: [_jsxs("span", { className: "setting-row__text", children: [_jsx("span", { className: "setting-row__label", children: "Quality" }), _jsxs("span", { className: "setting-row__hint", children: [gpu?.render ? `In effect: ${gpu.render.tier}${settings.renderTier === 'auto' ? ' (chosen for this GPU)' : ''}. ` : '', "Higher tiers add ambient occlusion, reflections and sun shafts; the Render still dialog has a Final render mode."] })] }), _jsx(Segmented, { label: "Graphics quality", value: settings.renderTier, onChange: (v) => update({ renderTier: v }), options: TIER_CHOICES })] }), EFFECT_SETTINGS.map((key) => {
                                const tier = settings.renderTier === 'auto' ? (gpu?.render?.auto ?? 'medium') : settings.renderTier;
                                const byTier = (TIER_EFFECTS[tier] ?? TIER_EFFECTS.medium).includes(key);
                                const [label, hint] = EFFECT_LABELS[key];
                                return (_jsx(Toggle, { label: label, hint: hint, checked: settings.effects[key] ?? byTier, onChange: (v) => {
                                        const next = { ...settings.effects };
                                        // Matching the tier's own choice drops the override, so the switch follows the tier again.
                                        if (v === byTier)
                                            delete next[key];
                                        else
                                            next[key] = v;
                                        update({ effects: next });
                                    } }, key));
                            })] }), _jsxs("section", { className: "settings__group", children: [_jsx("h3", { className: "settings__heading", children: "Performance" }), _jsxs("div", { className: "setting-row", children: [_jsxs("span", { className: "setting-row__text", children: [_jsx("span", { className: "setting-row__label", children: "Low memory mode" }), _jsxs("span", { className: "setting-row__hint", children: [memory ? (memory.lowMemory ? `On${memory.reason ? ` — ${memory.reason}` : ''}. ` : 'Off. ') : '', "Lower resolution, no bloom, smaller shadows and caches."] })] }), _jsx(Segmented, { label: "Low memory mode", value: settings.lowMemory, onChange: (v) => update({ lowMemory: v }), options: LOW_MEMORY_CHOICES })] }), _jsxs("div", { className: "setting-row", children: [_jsxs("span", { className: "setting-row__text", children: [_jsx("span", { className: "setting-row__label", children: "Renderer" }), _jsxs("span", { className: "setting-row__hint", children: ["Auto uses WebGPU where it is reliable, WebGL2 elsewhere.", gpu?.description ? ` GPU: ${gpu.description}.` : ''] })] }), _jsx(Segmented, { label: "Renderer", value: settings.backend, onChange: (v) => update({ backend: v }), options: BACKEND_CHOICES })] })] })] })), tab === 'ai' && (_jsx(AiConnectionPane, { prefs: ai.prefs, update: ai.update, repairs: settings.repairs, setRepairs: (n) => update({ repairs: n }) })), tab === 'shortcuts' && (_jsx("div", { className: "settings__pane", children: _jsx("dl", { className: "shortcut-list", children: SHORTCUTS.map(([keys, what]) => (_jsxs("div", { className: "shortcut-list__row", children: [_jsx("dt", { children: what }), _jsx("dd", { children: _jsx("kbd", { children: keys }) })] }, keys))) }) }))] }));
});
