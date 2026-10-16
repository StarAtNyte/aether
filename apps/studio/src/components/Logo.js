import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { memo } from 'react';
/**
 * The Aether logomark: a peak over a horizon line inside a rounded square —
 * "a world" reduced to two strokes. Pure vector, `currentColor` tile with
 * the surface color knocked out, crisp at 16–32 px. Decorative unless a
 * `label` is given.
 */
export const Logomark = memo(function Logomark({ size = 20, label }) {
    return (_jsxs("svg", { className: "logomark", width: size, height: size, viewBox: "0 0 20 20", role: label ? 'img' : undefined, "aria-label": label, "aria-hidden": label ? undefined : true, focusable: "false", children: [_jsx("rect", { width: "20", height: "20", rx: "5.5", fill: "currentColor" }), _jsx("path", { d: "M5 13.25 10 5.75l5 7.5", fill: "none", stroke: "var(--logo-knockout, #fff)", strokeWidth: "1.75", strokeLinecap: "round", strokeLinejoin: "round" }), _jsx("path", { d: "M4.75 15.25h10.5", fill: "none", stroke: "var(--logo-knockout, #fff)", strokeWidth: "1.75", strokeLinecap: "round" })] }));
});
/** Logomark + wordmark. */
export const Wordmark = memo(function Wordmark({ size = 20 }) {
    return (_jsxs("span", { className: "wordmark", children: [_jsx(Logomark, { size: size }), _jsx("span", { className: "wordmark__text", children: "Aether" })] }));
});
