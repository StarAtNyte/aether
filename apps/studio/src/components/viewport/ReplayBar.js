import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { memo } from 'react';
import { useStudio, useUI } from '../../app/context';
import { clock, nextSpeed } from '../../lib/playtestView';
import { Icon } from '../Icon';
/**
 * Controls of the ghost replay of the bot's run: play / pause, speed and a
 * scrub bar with a tick for every pickup, door and the goal.
 */
export const ReplayBar = memo(function ReplayBar() {
    const studio = useStudio();
    const replay = useUI((s) => s.replay);
    const mode = useUI((s) => s.mode);
    if (!replay || mode === 'play')
        return null;
    const events = studio.playtest.lastReport?.trace?.events ?? [];
    const ticks = replay.length > 0 ? events.filter((e) => e.kind === 'pickup' || e.kind === 'goal' || e.kind === 'door' || e.kind === 'win' || e.kind === 'room') : [];
    const done = replay.length > 0 && replay.time >= replay.length - 1e-3;
    return (_jsxs("div", { className: "replay-bar", role: "group", "aria-label": "Replay of the bot's run", "data-testid": "replay-bar", children: [_jsx("button", { type: "button", className: "replay-bar__btn", onClick: () => studio.playtest.toggleReplay(), "aria-label": replay.playing ? 'Pause the replay' : done ? 'Replay from the start' : 'Play the replay', "data-testid": "replay-toggle", children: _jsx(Icon, { name: replay.playing ? 'pause' : done ? 'refresh' : 'play' }) }), _jsxs("div", { className: "replay-bar__track", children: [_jsx("input", { type: "range", className: "replay-bar__scrub", min: 0, max: Math.max(0.01, replay.length), step: 0.05, value: replay.time, "aria-label": "Scrub the replay", "aria-valuetext": `${clock(replay.time)} of ${clock(replay.length)}`, onChange: (e) => studio.playtest.seekReplay(Number(e.currentTarget.value)), "data-testid": "replay-scrub" }), _jsx("div", { className: "replay-bar__ticks", "aria-hidden": "true", children: ticks.slice(0, 80).map((e, i) => (_jsx("span", { className: `replay-bar__tick is-${e.kind}`, style: { left: `${(e.t / replay.length) * 100}%` }, title: e.label }, `${e.t}-${i}`))) })] }), _jsxs("span", { className: "replay-bar__time", "data-testid": "replay-time", children: [clock(replay.time), " / ", clock(replay.length)] }), _jsxs("button", { type: "button", className: "replay-bar__speed", onClick: () => studio.playtest.setReplaySpeed(nextSpeed(replay.speed)), "aria-label": `Replay speed ${replay.speed}×; click to change`, "data-testid": "replay-speed", children: [replay.speed, "\u00D7"] }), _jsx("button", { type: "button", className: "replay-bar__btn", onClick: () => studio.playtest.stopReplay(), "aria-label": "Close the replay", "data-testid": "replay-close", children: _jsx(Icon, { name: "x" }) })] }));
});
