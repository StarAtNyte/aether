import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { memo, useEffect, useRef, useState } from 'react';
import { useStudio, useUI } from '../../app/context';
import { MAX_PROMPT_CHARS } from '../../config';
import { Icon } from '../Icon';
/**
 * Tweak the world while playing: a small prompt over the game. The edit is
 * applied as a precise patch (only what is named changes) and play resumes
 * where the world restarts, so a game can be fine-tuned without leaving it.
 * Pause with Esc (which also frees the mouse) and click "Tweak".
 */
export const PlayTweak = memo(function PlayTweak() {
    const studio = useStudio();
    const mode = useUI((s) => s.mode);
    const busy = useUI((s) => s.agentBusy);
    const titleHeld = useUI((s) => s.game.intro);
    const [open, setOpen] = useState(false);
    const [text, setText] = useState('');
    const input = useRef(null);
    useEffect(() => {
        if (open)
            input.current?.focus();
    }, [open]);
    useEffect(() => {
        if (mode !== 'play')
            setOpen(false);
    }, [mode]);
    // The title card owns the screen until Start: no Tweak pill over its buttons.
    if (mode !== 'play' || titleHeld)
        return null;
    const submit = (e) => {
        e.preventDefault();
        const t = text.trim();
        if (!t || busy)
            return;
        setText('');
        setOpen(false);
        void studio.send(t, { intent: 'refine', resumePlay: true });
    };
    return (_jsx("div", { className: "play-tweak", "data-testid": "play-tweak", children: open ? (_jsxs("form", { className: "play-tweak__form", onSubmit: submit, children: [_jsx("input", { ref: input, className: "input play-tweak__input", value: text, maxLength: MAX_PROMPT_CHARS, placeholder: "Tweak the game: \u201Cmake the enemies slower\u201D, \u201Cmore time\u201D\u2026", "aria-label": "Tweak the game", onChange: (e) => setText(e.target.value), onKeyDown: (e) => {
                        e.stopPropagation();
                        if (e.key === 'Escape')
                            setOpen(false);
                    } }), _jsx("button", { type: "submit", className: "btn btn--sm btn--primary", disabled: busy || text.trim() === '', children: "Apply" })] })) : (_jsxs("button", { type: "button", className: "btn btn--sm play-tweak__open", onClick: () => setOpen(true), disabled: busy, "data-tip": "Change something by describing it. Play restarts with the change.", children: [_jsx(Icon, { name: "pencil" }), " Tweak"] })) }));
});
