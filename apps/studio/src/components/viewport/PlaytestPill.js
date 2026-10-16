import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { memo } from 'react';
import { useHistoryState, useStudio, useUI } from '../../app/context';
import { badgeOf } from '../../lib/playtestView';
/**
 * The "Verified playable" badge: green only after a real passing run of the
 * bot on exactly this world. Click to open the details (or to run the bot).
 */
export const PlaytestPill = memo(function PlaytestPill() {
    const studio = useStudio();
    const pt = useUI((s) => s.playtest);
    const mode = useUI((s) => s.mode);
    const viewer = useUI((s) => s.viewer);
    const { head } = useHistoryState();
    if (mode === 'play' || viewer)
        return null;
    const badge = badgeOf(pt, head);
    const state = badge.tone === 'warn' ? 'bad' : badge.tone;
    return (_jsxs("button", { type: "button", className: `vp-btn vp-btn--label playtest-pill is-${state}${badge.verified ? ' is-verified' : ''}`, onClick: () => {
            studio.store.getState().showLeftView('verify');
            if (pt.status === 'running')
                return;
            if (pt.status === 'idle' || badge.tone === 'idle')
                void studio.playtest.run({ repair: true });
            else if (studio.playtest.lastReport?.trace && studio.store.getState().replay === null && badge.verified)
                void studio.playtest.startReplay();
        }, "data-tip": badge.tip || 'Let a bot play your world', "data-tip-align": "end", "data-testid": "playtest-pill", "data-verified": badge.verified ? 'true' : 'false', "data-tone": badge.tone, children: [_jsx("span", { className: "vp-btn__status", "aria-hidden": "true" }), _jsx("span", { children: badge.text })] }));
});
