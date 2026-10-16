import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Home hero: the prompt bar front and centre ("speak a world into being"),
 * one-tap example prompts, and a stage of example worlds that drift through
 * on their own (cross-fade with a slow push-in; still with reduced motion,
 * paused while the tab is hidden). Submitting creates a project and the
 * editor sends the prompt.
 */
import { memo, useEffect, useRef, useState } from 'react';
import { MAX_PROMPT_CHARS } from '../config';
import { FEATURED_TEMPLATES, TEMPLATES, templateThumbnail } from '../lib/examples';
import { Icon } from '../components/Icon';
/** Seconds each example world stays on the stage. */
export const STAGE_SECONDS = 4.5;
/** Slugs the stage prefers, when they are still shown. */
const STAGE_PREFERRED = ['lakeside-camp', 'coin-island', 'domino-run', 'haunted-forest', 'medieval-village', 'canyon-of-colossi'];
/** Most worlds on the stage. */
const STAGE_MAX = 6;
/**
 * The worlds the stage cycles through: the preferred ones that are still shown, topped up with the featured templates,
 * so curating the gallery can never leave the stage empty (an empty grey box on the home page).
 */
export function stageTemplates(shown, featured) {
    const out = [];
    for (const slug of STAGE_PREFERRED) {
        const t = shown.find((x) => x.slug === slug);
        if (t)
            out.push(t);
    }
    for (const t of [...featured, ...shown])
        if (out.length < STAGE_MAX && !out.includes(t))
            out.push(t);
    return out.slice(0, STAGE_MAX);
}
/** Example worlds on the stage, in order. */
const STAGE = stageTemplates(TEMPLATES, FEATURED_TEMPLATES);
/** One-tap example prompts under the bar. */
export const HERO_EXAMPLES = Object.freeze([
    'A coin collecting game on a tropical island',
    'A domino run that knocks over a bell tower',
    'A cozy lakeside camp at sunset with fireflies',
    'A two-storey villa with a pool',
]);
function prefersReducedMotion() {
    try {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
    catch {
        return false;
    }
}
/** Index of the stage slide shown at `elapsed` seconds (wraps). Pure. */
export function stageIndex(elapsed, count, seconds = STAGE_SECONDS) {
    if (count <= 0 || !Number.isFinite(elapsed) || elapsed < 0)
        return 0;
    return Math.floor(elapsed / seconds) % count;
}
/** The cycling stage of example worlds. */
const Stage = memo(function Stage({ onPick }) {
    const [index, setIndex] = useState(0);
    useEffect(() => {
        if (prefersReducedMotion() || STAGE.length < 2)
            return;
        let timer = null;
        const start = () => {
            if (timer === null)
                timer = setInterval(() => setIndex((i) => (i + 1) % STAGE.length), STAGE_SECONDS * 1000);
        };
        const stop = () => {
            if (timer !== null)
                clearInterval(timer);
            timer = null;
        };
        const onVis = () => (document.visibilityState === 'hidden' ? stop() : start());
        start();
        document.addEventListener('visibilitychange', onVis);
        return () => {
            stop();
            document.removeEventListener('visibilitychange', onVis);
        };
    }, []);
    const current = STAGE[index] ?? STAGE[0];
    if (STAGE.length === 0)
        return null;
    return (_jsxs("figure", { className: "hero-stage", "aria-label": "Example worlds", children: [_jsxs("div", { className: "hero-stage__frame", children: [STAGE.map((t, i) => (_jsx("img", { className: `hero-stage__img${i === index ? ' is-on' : ''}`, src: templateThumbnail(t.slug), alt: i === index ? `${t.title}: ${t.description}` : '', "aria-hidden": i === index ? undefined : true, width: 640, height: 360, loading: i < 2 ? 'eager' : 'lazy', decoding: "async", draggable: false }, t.slug))), current && (_jsxs("button", { type: "button", className: "hero-stage__open", onClick: () => onPick(current), "aria-label": `Open the ${current.title} template`, children: [_jsxs("span", { className: "hero-stage__prompt", children: ["\u201C", current.prompt, "\u201D"] }), _jsxs("span", { className: "hero-stage__cta", children: ["Open ", _jsx(Icon, { name: "external" })] })] }))] }), _jsx("div", { className: "hero-stage__dots", "aria-hidden": "true", children: STAGE.map((t, i) => (_jsx("span", { className: `hero-stage__dot${i === index ? ' is-on' : ''}` }, t.slug))) })] }));
});
/** The hero. */
export const Hero = memo(function Hero({ onPrompt, onTemplate }) {
    const [draft, setDraft] = useState('');
    const inputRef = useRef(null);
    // Grow with the text (every browser; `field-sizing` is not universal).
    useEffect(() => {
        const el = inputRef.current;
        if (!el)
            return;
        el.style.height = 'auto';
        el.style.height = `${Math.min(Math.max(el.scrollHeight, 24), 96)}px`;
    }, [draft]);
    const submit = (text) => {
        const t = text.trim().slice(0, MAX_PROMPT_CHARS);
        if (!t) {
            inputRef.current?.focus();
            return;
        }
        onPrompt(t);
    };
    return (_jsxs("section", { className: "hero", "aria-labelledby": "hero-title", children: [_jsxs("div", { className: "hero__copy", children: [_jsx("h2", { id: "hero-title", className: "hero__title", children: "Speak a world into being." }), _jsx("p", { className: "hero__lead", children: "Describe it in plain words. Aether builds it in 3D, proves the physics, and makes it playable, right here in your browser. Then keep refining it the same way: \u201Cmake the sofa dark green\u201D, \u201Ca bit more to the left\u201D." }), _jsxs("form", { className: "hero-bar", onSubmit: (e) => {
                            e.preventDefault();
                            submit(draft);
                        }, children: [_jsx(Icon, { name: "sparkles", className: "hero-bar__icon" }), _jsx("textarea", { ref: inputRef, id: "hero-prompt", className: "hero-bar__input", rows: 1, value: draft, maxLength: MAX_PROMPT_CHARS, placeholder: "Describe a world\u2026", "aria-label": "Describe a world", onChange: (e) => setDraft(e.target.value), onKeyDown: (e) => {
                                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                                        e.preventDefault();
                                        submit(draft);
                                    }
                                } }), _jsxs("button", { type: "submit", className: "btn btn--primary hero-bar__go", "data-kbd": "\u21B5", children: ["Build ", _jsx(Icon, { name: "arrowUp", className: "hero-bar__go-icon" })] })] }), _jsx("div", { className: "hero__examples", role: "group", "aria-label": "Example prompts", children: HERO_EXAMPLES.map((p) => (_jsx("button", { type: "button", className: "chip chip--action", onClick: () => submit(p), children: p }, p))) })] }), _jsx(Stage, { onPick: (t) => onTemplate(t.slug) })] }));
});
