import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { memo } from 'react';
import { useUI } from '../../app/context';
import { compactCount } from '../../lib/format';
/** Shown once the scene holds this many triangles at full detail… */
export const BADGE_MIN_SCENE_TRIANGLES = 5_000_000;
/** …and the renderer draws at least this many times fewer. */
export const BADGE_MIN_RATIO = 8;
/** Whether the geometry badge applies to these counts. */
export function showGeometryBadge(sceneTriangles, drawnTriangles) {
    return sceneTriangles >= BADGE_MIN_SCENE_TRIANGLES && sceneTriangles / Math.max(1, drawnTriangles) >= BADGE_MIN_RATIO;
}
/**
 * Scene triangles vs triangles actually drawn, for worlds rendered through
 * scatter fields (culled level-of-detail instances) and virtual geometry
 * (view-dependent cluster cuts). Stats arrive at 4 Hz.
 */
export const GeometryBadge = memo(function GeometryBadge() {
    const scene = useUI((s) => s.stats.sceneTriangles);
    const drawn = useUI((s) => s.stats.triangles);
    const fieldInstances = useUI((s) => s.stats.fieldInstances);
    const fieldDrawn = useUI((s) => s.stats.fieldDrawn);
    const virtualInstances = useUI((s) => s.stats.virtualInstances);
    if (!showGeometryBadge(scene, drawn))
        return null;
    const ratio = scene / Math.max(1, drawn);
    const detail = [
        fieldInstances > 0 ? `${compactCount(fieldDrawn)} of ${compactCount(fieldInstances)} instances drawn` : null,
        virtualInstances > 0 ? `${virtualInstances} virtual-geometry ${virtualInstances === 1 ? 'mesh' : 'meshes'}` : null,
    ].filter((x) => x !== null);
    return (_jsxs("div", { className: "geo-badge", role: "status", "aria-label": `${compactCount(scene)} triangles in the scene, ${compactCount(drawn)} drawn`, title: "Huge scatter layers are culled per chunk with automatic levels of detail, and high-detail sculptures draw a view-dependent cut of their cluster hierarchy, so the frame cost follows the screen, not the scene.", children: [_jsxs("div", { className: "geo-badge__row", children: [_jsx("strong", { children: compactCount(scene) }), _jsx("span", { children: "triangles in scene" })] }), _jsxs("div", { className: "geo-badge__row", children: [_jsx("strong", { children: compactCount(drawn) }), _jsxs("span", { children: ["drawn \u00B7 ", ratio >= 100 ? Math.round(ratio) : ratio.toFixed(0), "\u00D7 fewer"] })] }), detail.length > 0 && _jsx("div", { className: "geo-badge__detail", children: detail.join(' · ') })] }));
});
