import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { memo } from 'react';
import { useUI } from '../../app/context';
import { compactCount, formatMs } from '../../lib/format';
/** Performance overlay (stats arrive at 4 Hz from the simulation, never per frame). */
export const PerfHud = memo(function PerfHud() {
    const show = useUI((s) => s.settings.showPerf);
    const stats = useUI((s) => s.stats);
    const backend = useUI((s) => s.backend);
    const mode = useUI((s) => s.mode);
    if (!show || !backend)
        return null;
    const fpsClass = stats.fps >= 50 ? 'is-good' : stats.fps >= 30 ? 'is-ok' : 'is-bad';
    return (_jsxs("div", { className: "perf-hud", "aria-label": "Performance", children: [_jsxs("div", { className: `perf-hud__fps ${fpsClass}`, children: [_jsx("strong", { children: stats.fps > 0 ? Math.round(stats.fps) : '–' }), _jsxs("span", { children: ["fps", mode === 'edit' && stats.fps === 0 ? ' · idle' : ''] })] }), _jsxs("dl", { children: [_jsxs("div", { children: [_jsx("dt", { children: "frame" }), _jsx("dd", { children: formatMs(stats.frameMs) })] }), _jsxs("div", { children: [_jsx("dt", { children: "draws" }), _jsx("dd", { children: compactCount(stats.drawCalls) })] }), _jsxs("div", { children: [_jsx("dt", { children: "tris" }), _jsx("dd", { children: compactCount(stats.triangles) })] }), _jsxs("div", { children: [_jsx("dt", { children: "entities" }), _jsx("dd", { children: compactCount(stats.entities) })] }), mode === 'play' && (_jsxs(_Fragment, { children: [_jsxs("div", { children: [_jsx("dt", { children: "bodies" }), _jsx("dd", { children: compactCount(stats.bodies) })] }), _jsxs("div", { children: [_jsx("dt", { children: "physics" }), _jsx("dd", { children: formatMs(stats.stepMs) })] })] })), _jsxs("div", { children: [_jsx("dt", { children: "gpu" }), _jsx("dd", { children: backend === 'webgpu' ? 'WebGPU' : 'WebGL2' })] }), stats.gpuMB > 0 && (_jsxs("div", { title: "Estimated GPU memory of the drawing buffers and shadow map", children: [_jsx("dt", { children: "vram" }), _jsxs("dd", { children: ["~", compactCount(stats.gpuMB), " MB"] })] })), stats.heapMB > 0 && (_jsxs("div", { title: "JavaScript heap in use", children: [_jsx("dt", { children: "heap" }), _jsxs("dd", { children: [compactCount(stats.heapMB), " MB"] })] }))] })] }));
});
