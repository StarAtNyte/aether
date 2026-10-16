import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Agent panel: the conversation with the world agent. Empty state offers
 * suggestion chips and the template gallery (real rendered thumbnails);
 * the composer takes a prompt, optional reference images and sends with
 * Enter. Streaming turns show skeleton lines, never spinners.
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { MAX_PROMPT_CHARS } from '../config';
import { useStudio, useUI, useWorld } from '../app/context';
import { FEATURED_TEMPLATES, SUGGESTION_CHIPS, TEMPLATES, templateThumbnail } from '../lib/examples';
import { MAX_REFERENCE_IMAGES, prepareReferenceImage } from '../lib/images';
import { followUpChips, remixSuggestions } from '../lib/remix';
import { composerPlaceholder, hasContent, refineChips } from '../lib/refine';
import { isPristineStarter } from '../lib/starterWorld';
import { ChatEvent } from '../components/chat/ChatEvent';
import { Icon } from '../components/Icon';
import { Logomark } from '../components/Logo';
import { DeepBuildToggle, ModelPicker, RefineMenu } from '../components/ai/ComposerControls';
import { formatElapsed } from '../components/chat/ChatEvent';
import { Thumb } from '../home/cards';
import { aiConnection } from '../ai/connection';
import { useAi } from '../ai/useAi';
import { launchPromptFlight } from '../lib/promptFlight';
import { onNextFrame as scheduleScroll } from '../lib/frame';
/** Connection card shown in the empty state: "Connect Codex" until an AI connection is ready. */
const ConnectionCard = memo(function ConnectionCard() {
    const studio = useStudio();
    const provider = useUI((s) => s.provider);
    const local = useAi((s) => s.local);
    const [starting, setStarting] = useState(false);
    const localReady = local.state === 'ready';
    if (localReady || (provider.status !== 'offline' && local.state !== 'not_logged_in'))
        return null;
    const canSignInHere = local.state === 'not_logged_in' && local.backends.some((b) => b.id === 'codex' && b.installed);
    const connect = () => {
        if (canSignInHere) {
            setStarting(true);
            // Start Codex's own device sign-in; the settings pane shows the link and code.
            void aiConnection()
                .localApi.login('codex')
                .catch(() => undefined)
                .finally(() => {
                setStarting(false);
                studio.store.getState().openSettings('ai');
            });
        }
        else
            studio.store.getState().openSettings('ai');
    };
    return (_jsxs("div", { className: "connect-card connect-card--hero", "data-testid": "connect-codex", children: [_jsx("span", { className: "connect-card__icon", children: _jsx(Icon, { name: "link" }) }), _jsxs("span", { className: "connect-card__text", children: [_jsx("span", { className: "connect-card__title", children: "Connect Codex" }), _jsx("span", { className: "connect-card__hint", children: local.state === 'off'
                            ? 'Use your ChatGPT or Claude subscription for open-ended prompts and deep-built assets. Until then, the offline planner runs in your browser.'
                            : 'Sign in with ChatGPT once: Codex then builds worlds and writes new assets on this computer, checking its own work.' })] }), _jsx("button", { type: "button", className: "btn btn--sm btn--primary", onClick: connect, disabled: starting, children: starting ? 'Starting…' : 'Connect Codex' })] }));
});
/** Empty state: greeting, suggestions, templates. */
const EmptyAgent = memo(function EmptyAgent({ onPrompt, onRefine, onTemplate }) {
    const world = useWorld();
    const selection = useUI((s) => s.selection);
    // A project that already has something of the user's in it is refined, not replaced.
    const mine = useMemo(() => hasContent(world) && !isPristineStarter(world), [world]);
    const chips = useMemo(() => refineChips(world, selection), [world, selection]);
    return (_jsxs("div", { className: "agent-empty", children: [_jsx(ConnectionCard, {}), _jsxs("div", { className: "agent-empty__hero", children: [_jsx(Logomark, { size: 28 }), _jsx("h2", { className: "agent-empty__title", children: mine ? 'Refine your world' : 'Let’s build!' }), _jsx("p", { className: "agent-empty__text", children: mine
                            ? 'Say what to change, in plain words: only what you mention changes, and every step is undoable. Select something and say “make it bigger”.'
                            : 'Describe a world. The agent builds it, checks the physics and makes it playable. Then keep refining it in plain words: only what you mention changes, and every step is undoable.' }), _jsx("div", { className: "suggestions", role: "group", "aria-label": "Suggestions", children: mine
                            ? chips.map((c) => (_jsx("button", { type: "button", className: "chip chip--action", onClick: () => onRefine(c.prompt), children: c.label }, c.prompt)))
                            : SUGGESTION_CHIPS.map((s) => (_jsx("button", { type: "button", className: "chip chip--action", onClick: () => onPrompt(s), children: s }, s))) })] }), _jsxs("div", { className: "agent-empty__section", children: [_jsx("div", { className: "agent-empty__head", children: _jsx("span", { className: "agent-empty__label", children: "Templates" }) }), _jsx("div", { className: "agent-templates", children: (FEATURED_TEMPLATES.length > 0 ? FEATURED_TEMPLATES : TEMPLATES).slice(0, 12).map((t) => (_jsxs("button", { type: "button", className: "agent-template", onClick: () => onTemplate(t.prompt), title: t.description, "aria-label": `Build template: ${t.title}`, children: [_jsx(Thumb, { src: templateThumbnail(t.slug), alt: "" }), _jsx("span", { className: "agent-template__title", children: t.title })] }, t.slug))) })] })] }));
});
/** Live progress while the agent works: current step, connection, elapsed time and cancel. */
function ThinkingSkeleton({ text }) {
    const studio = useStudio();
    const run = useUI((s) => s.agentRun);
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(t);
    }, []);
    return (_jsxs("div", { className: "thinking", role: "status", children: [_jsxs("span", { className: "thinking__row", children: [_jsx("span", { className: "thinking__text", children: run?.step || text }), run && (_jsxs("span", { className: "thinking__meta", children: [run.via, " \u00B7 ", formatElapsed(Math.max(0, now - run.startedAt))] })), run && (_jsx("button", { type: "button", className: "link thinking__stop", onClick: () => studio.stopAgent(), children: "Cancel" }))] }), _jsx("span", { className: "skeleton skeleton--line", style: { width: '92%' } }), _jsx("span", { className: "skeleton skeleton--line", style: { width: '74%' } })] }));
}
/** One chat entry. */
const ChatItem = memo(function ChatItem({ entry }) {
    if (entry.role === 'user') {
        return (_jsx("div", { className: "msg msg--user", children: _jsx("div", { className: "msg__bubble", children: entry.text }) }));
    }
    const live = entry.status === 'streaming';
    const last = entry.events[entry.events.length - 1];
    return (_jsxs("div", { className: `msg msg--assistant${live ? ' is-live' : ''}`, children: [entry.events.length === 0 && live && _jsx(ThinkingSkeleton, { text: "Thinking\u2026" }), entry.events.map((ev, i) => 
            // A small edit's card already says what changed: the generic patch summary before it is redundant.
            ev.type === 'patches' && entry.events[i + 1]?.type === 'edit' ? null :
                // While streaming only the newest progress line is relevant.
                ev.type === 'status' && i !== entry.events.length - 1 ? null : ev.type === 'status' && live ? _jsx(ThinkingSkeleton, { text: ev.text }, i) : _jsx(ChatEvent, { event: ev, live: live && i === entry.events.length - 1 }, i)), live && last && last.type !== 'status' && _jsx(ThinkingSkeleton, { text: "Working\u2026" }), entry.status === 'aborted' && entry.events.length === 0 && _jsx("div", { className: "ev ev--status", children: "Stopped." })] }));
});
/** One-tap follow-ups under the latest finished turn. */
const RemixChips = memo(function RemixChips({ onPick }) {
    const world = useWorld();
    const selection = useUI((s) => s.selection);
    const mode = useUI((s) => s.mode);
    const { sky, weather, gravity } = world.environment;
    const remix = useMemo(() => remixSuggestions({ sky, weather, gravity }), [sky, weather, gravity]);
    const refine = useMemo(() => refineChips(world, selection), [world, selection]);
    const all = selection.length > 0 ? refine : [...refine.slice(0, 1), ...remix.map((r) => ({ label: r.prompt, prompt: r.prompt }))];
    const chips = followUpChips(all, selection.length, Object.keys(world.entities).length);
    if (mode !== 'edit' || chips.length === 0)
        return null;
    return (_jsx("div", { className: "remix", role: "group", "aria-label": "Refine it", children: chips.map((c) => (_jsx("button", { type: "button", className: "chip chip--action", onClick: () => onPick(c.prompt), children: c.label }, c.prompt))) }));
});
/** First-run nudge: the world exists, so the next message edits it. Shown until the first small edit. */
const RefineHint = memo(function RefineHint() {
    const edited = useUI((s) => s.chat.some((e) => e.role === 'assistant' && e.events.some((ev) => ev.type === 'edit')));
    const empty = useWorld().entities;
    // "Your world is ready" is only true when there is a world: never after a turn that built nothing.
    if (edited || Object.keys(empty).length === 0)
        return null;
    return (_jsxs("p", { className: "refine-hint", "data-testid": "refine-hint", children: [_jsx(Icon, { name: "info" }), " Your world is ready. Keep going in plain words: every message tweaks it (\u201Cmake the roof red\u201D, \u201Cmove that a bit left\u201D) and only what you name changes. Select something and say \u201Cmake it bigger\u201D."] }));
});
/** Prompt composer with reference images. */
const Composer = memo(function Composer({ onSend, busy }) {
    const studio = useStudio();
    const world = useWorld();
    const selection = useUI((s) => s.selection);
    const [draft, setDraft] = useState('');
    const [images, setImages] = useState([]);
    const inputRef = useRef(null);
    const fileRef = useRef(null);
    useEffect(() => {
        const el = inputRef.current;
        if (!el)
            return;
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    }, [draft]);
    const send = () => {
        const t = draft.trim();
        if (!t || busy)
            return;
        onSend(t, images);
        setDraft('');
        setImages([]);
    };
    // "Recreate this image": rebuild the room in the first attached photo from the photo itself.
    const recreate = () => {
        if (busy || images.length === 0)
            return;
        onSend(draft.trim() || 'Recreate this room from the photo', images, 'recreate');
        setDraft('');
        setImages([]);
    };
    const onKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
        }
    };
    const attach = async (files) => {
        const list = [...(files ?? [])].slice(0, MAX_REFERENCE_IMAGES - images.length);
        for (const f of list) {
            const r = await prepareReferenceImage(f);
            if (r.ok)
                setImages((prev) => (prev.length < MAX_REFERENCE_IMAGES ? [...prev, r.dataUrl] : prev));
            else
                studio.store.getState().toast(r.error, 'error', 5);
        }
    };
    return (_jsxs("form", { className: `composer${busy ? ' is-busy' : ''}`, onSubmit: (e) => {
            e.preventDefault();
            send();
        }, children: [images.length > 0 && (_jsx("div", { className: "composer__images", children: images.map((src, i) => (_jsxs("span", { className: "composer__image", children: [_jsx("img", { src: src, alt: `Reference ${i + 1}`, width: 40, height: 40 }), _jsx("button", { type: "button", className: "composer__image-x", "aria-label": `Remove reference ${i + 1}`, onClick: () => setImages((p) => p.filter((_, j) => j !== i)), children: _jsx(Icon, { name: "x" }) })] }, i))) })), _jsx("textarea", { id: "prompt-input", ref: inputRef, className: "composer__input", value: draft, rows: 2, maxLength: MAX_PROMPT_CHARS, placeholder: composerPlaceholder(world, selection, busy), "aria-label": "Prompt", onChange: (e) => setDraft(e.target.value), onKeyDown: onKeyDown }), _jsxs("div", { className: "composer__bar", children: [_jsx("button", { type: "button", className: "icon-btn icon-btn--sm", "aria-label": "Attach reference images", "data-tip": "Attach reference images", disabled: images.length >= MAX_REFERENCE_IMAGES, onClick: () => fileRef.current?.click(), children: _jsx(Icon, { name: "plus" }) }), _jsx("input", { ref: fileRef, type: "file", accept: "image/png,image/jpeg,image/webp", multiple: true, hidden: true, onChange: (e) => {
                            void attach(e.target.files);
                            e.target.value = '';
                        } }), _jsx(ModelPicker, {}), _jsx(RefineMenu, {}), _jsx(DeepBuildToggle, {}), images.length > 0 && !busy && (_jsxs("button", { type: "button", className: "chip chip--action", onClick: recreate, "data-testid": "recreate-image", "data-tip": "Rebuild the room in this photo: its walls, windows, furniture and colours", children: [_jsx(Icon, { name: "image" }), " Recreate this image"] })), _jsx("span", { className: "spacer" }), busy ? (_jsx("button", { type: "button", className: "send-btn send-btn--stop", onClick: () => studio.stopAgent(), "aria-label": "Stop generating", "data-tip": "Stop", "data-kbd": "Esc", children: _jsx(Icon, { name: "stop" }) })) : (_jsx("button", { type: "submit", className: "send-btn", disabled: draft.trim() === '', "aria-label": "Send", "data-tip": "Send", "data-kbd": "\u21B5", children: _jsx(Icon, { name: "send" }) }))] })] }));
});
/** The agent panel body (header is rendered by the left panel shell). */
export const AgentPanel = memo(function AgentPanel() {
    const studio = useStudio();
    const chat = useUI((s) => s.chat);
    const busy = useUI((s) => s.agentBusy);
    const listRef = useRef(null);
    const stickToBottom = useRef(true);
    const lastEntry = chat[chat.length - 1];
    const lastDone = lastEntry !== undefined && lastEntry.role === 'assistant' && lastEntry.status === 'done';
    useEffect(() => {
        const el = listRef.current;
        if (!el)
            return;
        // The empty state reads top-down; a conversation follows its newest entry. Scrolling
        // waits for the next frame: chat updates stream in from worker and network messages
        // (every verification result), and scrolling inside each of those tasks forced a layout
        // per message; one scroll per frame covers any number of updates.
        const empty = chat.length === 0;
        return scheduleScroll(() => {
            if (empty)
                el.scrollTop = 0;
            else if (stickToBottom.current)
                el.scrollTop = el.scrollHeight;
        });
    }, [chat]);
    const send = (text, images = [], offline = false, intent, photo) => {
        const t = text.trim();
        if (!t || busy)
            return;
        stickToBottom.current = true;
        launchPromptFlight(t, document.getElementById('prompt-input'));
        void studio.send(t, { images, offline, ...(intent ? { intent } : {}), ...(photo ? { photo } : {}) });
    };
    return (_jsxs("div", { className: "agent", children: [_jsxs("div", { className: "agent__list scroll-y", ref: listRef, onScroll: (e) => {
                    const el = e.currentTarget;
                    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
                }, "aria-live": "polite", children: [chat.length === 0 ? _jsx(EmptyAgent, { onPrompt: (p) => send(p, [], false, 'new'), onRefine: (p) => send(p), onTemplate: (p) => send(p, [], true, 'new') }) : chat.map((entry) => _jsx(ChatItem, { entry: entry }, entry.id)), !busy && lastDone && _jsx(RefineHint, {}), !busy && lastDone && _jsx(RemixChips, { onPick: (p) => send(p) })] }), _jsx(Composer, { onSend: (t, imgs, photo) => send(t, imgs, false, undefined, photo), busy: busy })] }));
});
