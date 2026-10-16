import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Keyframe timeline of the video shot, docked along the bottom of the
 * viewport while the Publish hub shows Video: play / pause the shot in the
 * viewport, scrub, add a keyframe from the current view, drag keyframes in
 * time, and edit the selected key (easing, field of view, set to view,
 * delete). The camera path itself is drawn in 3D by the renderer.
 */
import { memo, useRef } from 'react';
import { useStore } from 'zustand';
import { useStudio } from '../../app/context';
import { Icon } from '../../components/Icon';
const EASES = [
    ['linear', 'Smooth'],
    ['ease', 'Ease in-out'],
    ['easeIn', 'Ease in'],
    ['easeOut', 'Ease out'],
    ['cut', 'Cut (hold)'],
];
/** The timeline. */
export const CameraTimeline = memo(function CameraTimeline() {
    const studio = useStudio();
    const pub = studio.publish;
    const path = useStore(pub.state, (s) => s.path);
    const playhead = useStore(pub.state, (s) => s.playhead);
    const previewing = useStore(pub.state, (s) => s.previewing);
    const selected = useStore(pub.state, (s) => s.selected);
    const busy = useStore(pub.state, (s) => s.job?.running === true);
    const trackRef = useRef(null);
    const drag = useRef(null);
    const d = path.duration;
    const timeAt = (clientX) => {
        const r = trackRef.current?.getBoundingClientRect();
        if (!r || r.width <= 0)
            return 0;
        return Math.min(d, Math.max(0, ((clientX - r.left) / r.width) * d));
    };
    const onTrackDown = (e) => {
        if (e.button !== 0)
            return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { kind: 'head', index: -1, id: e.pointerId, moved: false };
        pub.scrub(timeAt(e.clientX));
    };
    const onKeyDown = (e, i) => {
        if (e.button !== 0)
            return;
        e.stopPropagation();
        trackRef.current?.setPointerCapture(e.pointerId);
        drag.current = { kind: 'key', index: i, id: e.pointerId, moved: false };
        pub.selectKey(i);
    };
    const onMove = (e) => {
        const g = drag.current;
        if (!g || g.id !== e.pointerId)
            return;
        g.moved = true;
        if (g.kind === 'head')
            pub.scrub(timeAt(e.clientX));
        else {
            const t = Math.round(timeAt(e.clientX) * 20) / 20;
            pub.retime(g.index, t);
            const sel = pub.state.getState().selected;
            if (sel !== null)
                g.index = sel;
        }
    };
    const onUp = (e) => {
        if (drag.current?.id === e.pointerId)
            drag.current = null;
    };
    const ticks = [];
    const step = d > 60 ? 10 : d > 20 ? 5 : d > 8 ? 2 : 1;
    for (let t = 0; t <= d + 1e-6; t += step)
        ticks.push(t);
    const key = selected !== null ? path.keys[selected] : undefined;
    return (_jsxs("div", { className: "tl", role: "group", "aria-label": "Camera timeline", "data-testid": "camera-timeline", children: [_jsxs("div", { className: "tl__bar", children: [_jsx("button", { type: "button", className: "icon-btn", onClick: () => pub.togglePreview(), disabled: path.keys.length < 2 || busy, "aria-label": previewing ? 'Pause preview' : 'Play preview', "data-tip": previewing ? 'Pause' : 'Play the shot in the viewport', "data-testid": "timeline-play", children: _jsx(Icon, { name: previewing ? 'pause' : 'play' }) }), _jsxs("span", { className: "tl__time", children: [playhead.toFixed(1), " ", _jsxs("span", { className: "tl__time-total", children: ["/ ", d.toFixed(1), " s"] })] }), _jsxs("button", { type: "button", className: "btn btn--sm", onClick: () => pub.addKeyFromView(), disabled: busy, "data-tip": "Add a keyframe at the playhead from the current view", "data-testid": "timeline-add-key", children: [_jsx(Icon, { name: "diamond", size: 14 }), " Add keyframe"] }), _jsxs("label", { className: "tl__dur", children: [_jsx("span", { children: "Length" }), _jsx("input", { className: "input input--sm", type: "number", min: 0.5, max: 300, step: 0.5, value: Math.round(d * 10) / 10, onChange: (e) => pub.setDuration(Number(e.target.value)), "aria-label": "Shot length in seconds" })] }), _jsxs("button", { type: "button", className: "btn btn--ghost btn--sm", onClick: () => pub.resetPath(), disabled: busy, "data-tip": "Start over from the current view", children: [_jsx(Icon, { name: "refresh" }), " Reset"] })] }), _jsxs("div", { className: "tl__track", ref: trackRef, onPointerDown: onTrackDown, onPointerMove: onMove, onPointerUp: onUp, onPointerCancel: onUp, children: [ticks.map((t) => (_jsx("span", { className: "tl__tick", style: { left: `${(t / d) * 100}%` }, children: _jsxs("span", { className: "tl__tick-label", children: [t, "s"] }) }, t))), path.keys.map((k, i) => (_jsx("button", { type: "button", className: `tl__key${selected === i ? ' is-selected' : ''}${k.ease === 'cut' ? ' is-cut' : ''}`, style: { left: `${(k.t / d) * 100}%` }, onPointerDown: (e) => onKeyDown(e, i), "aria-label": `Keyframe ${i + 1} at ${k.t.toFixed(1)} seconds`, "aria-pressed": selected === i }, `${i}-${k.t}`))), _jsx("span", { className: "tl__head", style: { left: `${(playhead / d) * 100}%` }, "aria-hidden": "true" })] }), key && selected !== null && (_jsxs("div", { className: "tl__key-edit", children: [_jsxs("span", { className: "tl__key-name", children: ["Key ", selected + 1, " \u00B7 ", key.t.toFixed(2), " s"] }), _jsx("select", { className: "select select--sm", value: key.ease, onChange: (e) => pub.setKeyEase(selected, e.target.value), "aria-label": "Easing to the next key", children: EASES.map(([v, l]) => (_jsx("option", { value: v, children: l }, v))) }), _jsxs("label", { className: "tl__fov", children: [_jsx("span", { children: "Lens" }), _jsx("input", { className: "slider", type: "range", min: 12, max: 100, step: 1, value: key.fov, onChange: (e) => pub.setKeyFov(selected, Number(e.target.value)), "aria-label": "Field of view" }), _jsxs("span", { className: "tl__fov-value", children: [Math.round(key.fov), "\u00B0"] })] }), _jsxs("button", { type: "button", className: "btn btn--sm", onClick: () => pub.updateKeyFromView(selected), "data-tip": "Move this keyframe to the current view", children: [_jsx(Icon, { name: "camera" }), " Set to view"] }), _jsx("button", { type: "button", className: "icon-btn icon-btn--sm", onClick: () => pub.deleteKey(selected), disabled: path.keys.length <= 1, "aria-label": "Delete keyframe", "data-tip": "Delete keyframe", children: _jsx(Icon, { name: "trash" }) })] }))] }));
});
