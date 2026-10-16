import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * On-screen play controls for touch screens (shown by CSS on coarse
 * pointers only): a virtual stick on the left, Jump and Act buttons on the
 * right. The stick writes straight into the simulation's input (no React
 * render per move); the knob moves with a transform.
 */
import { memo, useRef } from 'react';
import { useSimulation } from '../../app/context';
import { Icon } from '../Icon';
/** Stick travel radius (px). */
const RADIUS = 40;
/** Normalized stick vector for a pointer offset (pure; exported for tests). */
export function stickVector(dx, dy, radius = RADIUS) {
    const len = Math.hypot(dx, dy);
    const k = len > radius ? radius / len : 1;
    const x = dx * k;
    const y = dy * k;
    return { forward: radius > 0 ? -y / radius : 0, right: radius > 0 ? x / radius : 0, x, y };
}
/** Touch controls of the studio's play mode. */
export const TouchControls = memo(function TouchControls() {
    return _jsx(TouchControlsView, { sim: useSimulation() });
});
/** Touch controls driving `sim` (the studio and published games share it). */
export const TouchControlsView = memo(function TouchControlsView({ sim }) {
    const knob = useRef(null);
    const origin = useRef(null);
    const move = (e) => {
        const o = origin.current;
        if (!o || e.pointerId !== o.id)
            return;
        const v = stickVector(e.clientX - o.x, e.clientY - o.y);
        sim?.setVirtualStick(v.forward, v.right);
        if (knob.current)
            knob.current.style.transform = `translate(${v.x}px, ${v.y}px)`;
    };
    const end = () => {
        origin.current = null;
        sim?.setVirtualStick(0, 0);
        if (knob.current)
            knob.current.style.transform = '';
    };
    return (_jsxs("div", { className: "touch", children: [_jsx("div", { className: "touch__stick", "aria-label": "Move", role: "application", onPointerDown: (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    e.currentTarget.setPointerCapture(e.pointerId);
                    const r = e.currentTarget.getBoundingClientRect();
                    origin.current = { x: r.left + r.width / 2, y: r.top + r.height / 2, id: e.pointerId };
                    move(e);
                }, onPointerMove: move, onPointerUp: end, onPointerCancel: end, children: _jsx("span", { className: "touch__knob", ref: knob }) }), _jsxs("div", { className: "touch__buttons", children: [_jsx("button", { type: "button", className: "touch__btn", "aria-label": "Act", onPointerDown: (e) => {
                            e.stopPropagation();
                            sim?.tapVirtual('KeyE');
                        }, children: _jsx(Icon, { name: "hand", size: 20 }) }), _jsx("button", { type: "button", className: "touch__btn touch__btn--primary", "aria-label": "Jump", onPointerDown: (e) => {
                            e.stopPropagation();
                            sim?.tapVirtual('Space');
                        }, children: _jsx(Icon, { name: "jump", size: 20 }) })] })] }));
});
