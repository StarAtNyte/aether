import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { memo, useMemo } from 'react';
import { useStudio, useUI, useWorld } from '../../app/context';
import { isTouchScreen, touchHints } from '../../lib/touchHints';
import { Icon } from '../Icon';
function formatClock(t) {
    const s = Math.max(0, Math.floor(t));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
/**
 * Title card: the world's title screen over the live scene (held until the
 * player starts). Everything is rendered as plain text.
 */
const TitleCardView = memo(function TitleCardView({ intro, onStart, onExit }) {
    const style = intro.accent ? { '--title-accent': intro.accent } : undefined;
    // Phones get the on-screen controls, never keyboard keys.
    const controls = useMemo(() => (isTouchScreen() ? touchHints(intro.controls) : intro.controls), [intro.controls]);
    return (_jsx("div", { className: "title-card", role: "dialog", "aria-modal": "false", "aria-labelledby": "title-card-title", style: style, children: _jsxs("div", { className: "title-card__body", children: [_jsx("h2", { id: "title-card-title", className: "title-card__title", children: intro.title }), intro.tagline && _jsx("p", { className: "title-card__tagline", children: intro.tagline }), intro.objective && _jsx("p", { className: "title-card__objective", children: intro.objective }), controls.length > 0 && (_jsx("ul", { className: "title-card__controls", "aria-label": "Controls", children: controls.map((c) => (_jsx("li", { children: c }, c))) })), _jsxs("div", { className: "title-card__actions", children: [_jsxs("button", { type: "button", className: "btn btn--primary title-card__start", onClick: onStart, autoFocus: true, children: [_jsx(Icon, { name: "play" }), " Start"] }), _jsx("button", { type: "button", className: "btn btn--ghost title-card__exit", onClick: onExit, children: "Back to editor" })] })] }) }));
});
/**
 * The title card overlay while a play session is held (every kind of world,
 * block worlds included): Start releases the game, Back to editor stops it.
 */
export const TitleCard = memo(function TitleCard() {
    const studio = useStudio();
    const world = useWorld();
    const mode = useUI((s) => s.mode);
    const showing = useUI((s) => s.game.intro);
    if (mode !== 'play' || !showing || !world.intro)
        return null;
    return _jsx(TitleCardView, { intro: world.intro, onStart: () => studio.startGame(), onExit: () => void studio.togglePlay() });
});
/**
 * Crosshair and the use prompt ("E · Open drawer") in play mode: a small dot
 * always, the prompt only while the crosshair is on something usable.
 */
export const InteractPromptView = memo(function InteractPromptView() {
    const mode = useUI((s) => s.mode);
    const prompt = useUI((s) => s.interact);
    const photo = useUI((s) => s.arch.photo);
    const intro = useUI((s) => s.game.intro);
    if (mode !== 'play' || photo || intro)
        return null;
    return (_jsxs("div", { className: "interact", "aria-live": "polite", "data-testid": "interact", children: [_jsx("span", { className: `interact__dot${prompt ? ' is-active' : ''}`, "aria-hidden": "true" }), prompt && (_jsxs("span", { className: "interact__prompt", role: "status", children: [_jsx("kbd", { children: prompt.key }), " ", prompt.verb, " ", prompt.noun, prompt.hint && _jsx("span", { className: "interact__hint", children: prompt.hint })] }))] }));
});
/** Play-mode HUD: bound state values, timer, controls hint and the win/lose overlay. */
export const PlayHud = memo(function PlayHud() {
    const studio = useStudio();
    const world = useWorld();
    const mode = useUI((s) => s.mode);
    const game = useUI((s) => s.game);
    const building = useUI((s) => s.arch.building !== null);
    const photo = useUI((s) => s.arch.photo);
    // The end screen credits the people behind the assets (required for CC-BY, a courtesy for CC0).
    const credits = useMemo(() => (mode === 'play' ? studio.assets.credits() : []), [mode, world, studio]);
    if (mode !== 'play')
        return null;
    // The title card (rendered by the viewport) covers the held game: no HUD under it.
    if (game.intro && world.intro)
        return null;
    const over = game.status !== 'playing';
    if (building && world.hud.length === 0) {
        // Building walkthrough: no score or clock, just the controls.
        return photo ? (_jsx("span", { className: "photo-badge", children: "Photo mode \u00B7 P to leave" })) : (_jsxs("div", { className: "walk-hint", "aria-hidden": "true", children: [_jsxs("span", { children: [_jsx("kbd", { children: "W" }), _jsx("kbd", { children: "A" }), _jsx("kbd", { children: "S" }), _jsx("kbd", { children: "D" }), " Walk"] }), _jsxs("span", { children: [_jsx("kbd", { children: "E" }), " Open \u00B7 use"] }), _jsxs("span", { children: [_jsx("kbd", { children: "L" }), " All lights"] }), _jsxs("span", { children: [_jsx("kbd", { children: "R" }), " Swap finish"] }), _jsxs("span", { children: [_jsx("kbd", { children: "1" }), "\u2013", _jsx("kbd", { children: "4" }), " Time of day"] }), _jsxs("span", { children: [_jsx("kbd", { children: "V" }), " View"] }), _jsxs("span", { children: [_jsx("kbd", { children: "P" }), " Photo"] }), _jsxs("span", { children: [_jsx("kbd", { children: "Esc" }), " Stop"] })] }));
    }
    return (_jsxs(_Fragment, { children: [_jsxs("div", { className: "play-hud", "aria-live": "polite", children: [world.hud.map((b) => (_jsxs("div", { className: "play-hud__stat", children: [_jsx("span", { className: "play-hud__label", children: b.label }), _jsx("span", { className: "play-hud__value", children: game.hud[b.key] ?? '–' })] }, b.key))), _jsxs("div", { className: "play-hud__stat play-hud__stat--time", children: [_jsx("span", { className: "play-hud__label", children: "Elapsed" }), _jsx("span", { className: "play-hud__value", children: formatClock(game.time) })] })] }), !over && (_jsxs("div", { className: "play-hint", "aria-hidden": "true", children: [_jsxs("span", { children: [_jsx("kbd", { children: "W" }), _jsx("kbd", { children: "A" }), _jsx("kbd", { children: "S" }), _jsx("kbd", { children: "D" }), " Move"] }), _jsxs("span", { children: [_jsx("kbd", { children: "Space" }), " Jump"] }), _jsxs("span", { children: [_jsx("kbd", { children: "E" }), " Act"] }), _jsxs("span", { children: [_jsx("kbd", { children: "Esc" }), " Stop"] })] })), over && (_jsx("div", { className: `game-over ${game.status === 'won' ? 'is-win' : 'is-lose'}`, role: "dialog", "aria-modal": "false", "aria-label": "Game over", children: _jsxs("div", { className: "game-over__card", children: [_jsx("span", { className: "game-over__icon", children: _jsx(Icon, { name: game.status === 'won' ? 'check' : 'alert', size: 20 }) }), _jsx("h2", { children: game.status === 'won' ? 'You win!' : 'Game over' }), game.text && _jsx("p", { children: game.text }), credits.length > 0 && (_jsxs("p", { className: "game-over__credits", children: ["Assets: ", credits.slice(0, 3).map((c) => `${c.source} (${c.licence})`).join(', '), credits.length > 3 ? ` and ${credits.length - 3} more` : '', ".", ' ', _jsx("button", { type: "button", className: "link-btn", onClick: () => studio.assets.setCreditsOpen(true), children: "Full credits" })] })), _jsxs("div", { className: "game-over__actions", children: [_jsx("button", { type: "button", className: "btn", onClick: () => void studio.togglePlay(), children: "Back to editor" }), _jsxs("button", { type: "button", className: "btn btn--primary", onClick: () => void studio.restart(), autoFocus: true, children: [_jsx(Icon, { name: "refresh" }), " ", game.status === 'won' ? 'Play again' : 'Try again'] })] })] }) }))] }));
});
