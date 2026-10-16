import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/** Editor loading skeleton (same frame as the editor, so nothing shifts when it arrives). */
export function EditorSkeleton() {
    return (_jsxs("div", { className: "editor editor--skeleton", "aria-busy": "true", "aria-label": "Opening project", children: [_jsx("div", { className: "topbar", children: _jsx("span", { className: "skeleton skeleton--block", style: { width: 120, height: 20 } }) }), _jsx("div", { className: "editor__body", children: _jsx("div", { className: "editor__canvas", children: _jsx("div", { className: "viewport", children: _jsx("span", { className: "vp-loading__surface skeleton" }) }) }) })] }));
}
