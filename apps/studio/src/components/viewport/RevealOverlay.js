import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * The paper of the plan reveal: the ground-floor plan drawn in ink (walls as
 * heavy poché, openings, furniture outlines, room names and areas) that fades
 * into the 3D view as the walls rise. Click, any key or Esc skips to the end.
 * Everything drawn comes from the document through `inkPlan` (texts cleaned,
 * strokes capped); nothing is interpreted as markup.
 */
import { memo, useEffect, useMemo } from 'react';
import { floorPlan2d } from '@aether/arch';
import { useStudio, useUI, useWorld } from '../../app/context';
import { inkPlan, revealPhase, strokeProgress } from '../../lib/reveal';
const INK = '#23201b';
const PAPER = '#efe9dc';
function pathOf(s) {
    const [first, ...rest] = s.pts;
    if (!first)
        return '';
    return `M${first[0].toFixed(3)} ${first[1].toFixed(3)}${rest.map((p) => `L${p[0].toFixed(3)} ${p[1].toFixed(3)}`).join('')}${s.closed ? 'Z' : ''}`;
}
/** The ink-on-paper overlay while a reveal runs. */
export const RevealOverlay = memo(function RevealOverlay() {
    const studio = useStudio();
    const world = useWorld();
    const progress = useUI((s) => s.arch.reveal);
    const building = useUI((s) => s.arch.building);
    const active = progress !== null && building !== null;
    const ink = useMemo(() => {
        if (!active || !building)
            return null;
        const plan = floorPlan2d(world, building, 0);
        return plan ? inkPlan(plan) : null;
        // The plan is read once per reveal: the world does not change while it runs.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active, building]);
    useEffect(() => {
        if (!active)
            return undefined;
        const skip = () => studio.arch.cancelReveal();
        window.addEventListener('keydown', skip, true);
        return () => window.removeEventListener('keydown', skip, true);
    }, [active, studio]);
    if (!active || !ink)
        return null;
    const phase = revealPhase(progress);
    if (phase.paper <= 0.002)
        return null;
    const [x0, z0, x1, z1] = ink.bounds;
    const pad = Math.max(x1 - x0, z1 - z0) * 0.12;
    const unit = Math.max(x1 - x0, z1 - z0) / 55;
    const widths = { wall: unit * 0.1, opening: unit * 0.07, fine: unit * 0.045 };
    return (_jsxs("div", { className: "reveal", style: { opacity: phase.paper, background: PAPER }, onPointerDown: () => studio.arch.cancelReveal(), "data-testid": "reveal", role: "img", "aria-label": "Floor plan being drawn", children: [_jsxs("svg", { className: "reveal__svg", viewBox: `${x0 - pad} ${z0 - pad} ${x1 - x0 + 2 * pad} ${z1 - z0 + 2 * pad}`, preserveAspectRatio: "xMidYMid meet", children: [ink.strokes.map((s, i) => {
                        const p = strokeProgress(s, phase.ink);
                        if (p <= 0)
                            return null;
                        return (_jsx("path", { d: pathOf(s), fill: s.fill && p >= 1 ? INK : 'none', fillOpacity: s.fill ? Math.min(1, Math.max(0, (p - 0.85) / 0.15)) * 0.92 : 0, stroke: INK, strokeWidth: widths[s.weight], strokeLinejoin: "round", strokeLinecap: "round", strokeDasharray: s.length, strokeDashoffset: s.length * (1 - p) }, i));
                    }), _jsx("g", { opacity: Math.max(0, Math.min(1, (phase.ink - 0.7) / 0.3)), fill: INK, fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace", textAnchor: "middle", children: ink.labels.map((l, i) => (_jsxs("g", { children: [_jsx("text", { x: l.at[0], y: l.at[1], fontSize: unit * 0.9, letterSpacing: unit * 0.08, children: l.text.toUpperCase() }), _jsx("text", { x: l.at[0], y: l.at[1] + unit * 1.15, fontSize: unit * 0.62, opacity: 0.7, children: l.detail })] }, i))) })] }), _jsx("span", { className: "reveal__hint", children: "Click to skip" })] }));
});
