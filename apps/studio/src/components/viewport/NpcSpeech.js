import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Play-mode speech for NPCs: bubbles above characters, the "press E to talk"
 * hint and the dialogue card with numbered choices. Everything is plain text
 * (never HTML). Keys 1-6 and E are handled by the logic runtime; the buttons
 * here are the pointer and touch route to the same actions.
 */
import { memo, useEffect, useMemo, useState } from 'react';
import { useSimulation, useStudio, useUI } from '../../app/context';
import { NPC_CHAT_MAX_LINE } from '../../engine/npcChat';
/** Characters revealed per second by the typewriter. */
const TYPE_CPS = 70;
/** The text of a node, revealed progressively (all at once for reduced motion). */
export function useTypewriter(text, key) {
    const [shown, setShown] = useState(0);
    useEffect(() => {
        const reduce = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduce) {
            setShown(text.length);
            return undefined;
        }
        setShown(0);
        const start = performance.now();
        const id = window.setInterval(() => {
            const n = Math.min(text.length, Math.ceil(((performance.now() - start) / 1000) * TYPE_CPS));
            setShown(n);
            if (n >= text.length)
                window.clearInterval(id);
        }, 33);
        return () => window.clearInterval(id);
    }, [text, key]);
    return text.slice(0, shown);
}
/** "Say something…": a free line to the character through the connected model. */
function SayBox({ chat }) {
    const [line, setLine] = useState('');
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState('');
    const avail = chat.availability();
    const submit = (e) => {
        e.preventDefault();
        if (busy || !avail.ok || line.trim().length === 0)
            return;
        setBusy(true);
        setNote('');
        void chat.send(line).then((r) => {
            setBusy(false);
            if (r.ok)
                setLine('');
            else
                setNote(r.reason);
        });
    };
    return (_jsxs("form", { className: "npc-say", onSubmit: submit, children: [_jsx("input", { className: "npc-say__input", "aria-label": "Say something", placeholder: avail.ok ? 'Say something…' : avail.reason, title: avail.ok ? undefined : avail.reason, maxLength: NPC_CHAT_MAX_LINE, value: line, disabled: !avail.ok || busy, autoComplete: "off", spellCheck: false, onChange: (e) => setLine(e.target.value), onKeyDown: (e) => e.stopPropagation() }), _jsx("button", { type: "submit", className: "npc-say__send", disabled: !avail.ok || busy || line.trim().length === 0, children: busy ? '…' : 'Say' }), note && _jsx("span", { className: "npc-say__note", role: "status", children: note })] }));
}
function DialogueCard({ d, actions, chat }) {
    const text = useTypewriter(d.text, d.version);
    const done = text.length >= d.text.length;
    return (_jsxs("div", { className: `npc-card${d.mode === 'trade' ? ' is-trade' : ''}`, role: "dialog", "aria-label": `Conversation with ${d.speaker}`, "aria-live": "polite", children: [_jsxs("div", { className: "npc-card__head", children: [_jsx("span", { className: "npc-card__speaker", children: d.speaker }), d.mode === 'trade' && _jsx("span", { className: "npc-card__tag", children: "trade" }), _jsx("button", { type: "button", className: "npc-card__close", "aria-label": "End conversation", onClick: () => actions?.npcClose(), children: "\u00D7" })] }), _jsx("p", { className: "npc-card__text", children: text }), done && d.choices.length > 0 && (_jsx("ol", { className: "npc-card__choices", children: d.choices.map((c, i) => (_jsx("li", { children: _jsxs("button", { type: "button", className: "npc-choice", onClick: () => actions?.npcChoose(i), children: [_jsx("kbd", { children: i + 1 }), _jsx("span", { children: c })] }) }, `${d.version}-${i}`))) })), done && d.choices.length === 0 && (_jsxs("button", { type: "button", className: "npc-card__more", onClick: () => actions?.npcAdvance(), children: [_jsx("kbd", { children: "E" }), " Continue"] })), d.chat && chat && _jsx(SayBox, { chat: chat })] }));
}
/** Presentational overlay: used by the studio (store) and the standalone player (state). */
export const NpcSpeechView = memo(function NpcSpeechView({ frame, actions, chat = null }) {
    if (!frame)
        return null;
    const talking = frame.dialogue !== null;
    return (_jsxs("div", { className: "npc-layer", "data-testid": "npc-layer", children: [frame.bubbles.map((b) => (_jsxs("div", { className: "npc-bubble", style: { left: `${(b.x * 100).toFixed(2)}%`, top: `${(b.y * 100).toFixed(2)}%` }, role: "status", children: [_jsx("span", { className: "npc-bubble__name", children: b.name }), _jsx("span", { className: "npc-bubble__text", children: b.text })] }, b.id))), !talking && frame.prompt && (_jsxs("button", { type: "button", className: "npc-prompt", onClick: () => actions?.npcAdvance(), children: [_jsx("kbd", { children: "E" }), " Talk to ", frame.prompt.name] })), frame.dialogue && _jsx(DialogueCard, { d: frame.dialogue, actions: actions, chat: chat })] }));
});
/** The studio's NPC overlay (reads the store, acts on the running simulation). */
export const NpcSpeech = memo(function NpcSpeech() {
    const frame = useUI((s) => s.npc);
    const mode = useUI((s) => s.mode);
    const sim = useSimulation();
    const studio = useStudio();
    const port = useMemo(() => ({ availability: () => studio.npcChat.availability(), send: (line) => studio.npcSay(line) }), [studio]);
    if (mode !== 'play')
        return null;
    return _jsx(NpcSpeechView, { frame: frame, actions: sim, chat: port });
});
