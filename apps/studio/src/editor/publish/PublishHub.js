import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * The Publish hub: one panel for every way out of the editor — a playable
 * game (download, your own hosting, your local network), a video along a
 * cinematic camera path, a still render up to 4K, a 3D model, a floor plan
 * and a share link — each with presets, a preview, progress with Cancel,
 * and the publish history. Non-modal: the viewport stays live beside it
 * (camera keys are taken from the current view). State lives in
 * `studio.publish` (engine/publish.ts).
 */
import { memo, useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import { useStudio } from '../../app/context';
import { Icon } from '../../components/Icon';
import { GameTarget, HistoryTarget, ModelTarget, PlanTarget, RenderTarget, ShareTarget, VideoTarget } from './targets';
import '../../styles/publish.css';
const TARGETS = [
    { id: 'game', icon: 'gamepad', label: 'Game', hint: 'Web build' },
    { id: 'video', icon: 'film', label: 'Video', hint: 'Camera path' },
    { id: 'render', icon: 'image', label: 'Render', hint: 'Up to 4K' },
    { id: 'model', icon: 'box3d', label: '3D model', hint: 'glTF / GLB' },
    { id: 'plan', icon: 'plan', label: 'Floor plan', hint: 'SVG / PDF' },
    { id: 'share', icon: 'link', label: 'Share link', hint: 'No upload' },
];
/** Live preview of a running video export (the composited canvas). */
const LiveCanvas = memo(function LiveCanvas({ canvas }) {
    const ref = useRef(null);
    useEffect(() => {
        const host = ref.current;
        if (!host)
            return;
        canvas.classList.add('pub-live__canvas');
        host.appendChild(canvas);
        return () => {
            if (canvas.parentElement === host)
                host.removeChild(canvas);
        };
    }, [canvas]);
    return _jsx("div", { className: "pub-live", ref: ref, "aria-label": "Video being rendered" });
});
/** Progress, cancel and the finished result. */
const JobFooter = memo(function JobFooter() {
    const studio = useStudio();
    const job = useStore(studio.publish.state, (s) => s.job);
    const result = useStore(studio.publish.state, (s) => s.result);
    const canvas = useStore(studio.publish.state, (s) => s.previewCanvas);
    if (!job && !result)
        return null;
    const pct = job?.progress === null || job?.progress === undefined ? null : Math.round(job.progress * 100);
    return (_jsxs("div", { className: "pub-job", "aria-live": "polite", "data-testid": "publish-job", children: [job?.running && (_jsxs(_Fragment, { children: [canvas && _jsx(LiveCanvas, { canvas: canvas }), _jsxs("div", { className: "pub-job__row", children: [_jsx("span", { className: "pub-job__label", children: job.label }), pct !== null && _jsxs("span", { className: "pub-job__pct", children: [pct, "%"] }), _jsx("button", { type: "button", className: "btn btn--sm", onClick: () => studio.publish.cancel(), "data-testid": "publish-cancel", children: "Cancel" })] }), _jsx("div", { className: `progress${pct === null ? ' is-indeterminate' : ''}`, role: "progressbar", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": pct ?? undefined, children: _jsx("div", { className: "progress__fill", style: { width: `${pct ?? 30}%` } }) })] })), !job?.running && job?.error && (_jsxs("p", { className: "pub-job__error", role: "alert", children: [_jsx(Icon, { name: "alert" }), " ", job.error] })), !job?.running && result && (_jsxs("div", { className: "pub-result", "data-testid": "publish-result", children: [result.url && result.kind === 'render' && _jsx("img", { className: "pub-result__media", src: result.url, alt: "Rendered image" }), result.url && result.kind === 'video' && _jsx("video", { className: "pub-result__media", src: result.url, controls: true, playsInline: true, loop: true, muted: false, "data-testid": "publish-video" }), result.url && result.kind === 'plan' && result.mime === 'image/svg+xml' && _jsx("img", { className: "pub-result__media pub-result__media--plan", src: result.url, alt: "Floor plan" }), _jsxs("div", { className: "pub-result__info", children: [_jsxs("span", { className: "pub-result__title", children: [_jsx(Icon, { name: "check" }), " ", result.fileName ?? 'Published'] }), _jsx("span", { className: "pub-result__detail", children: result.detail })] }), _jsxs("div", { className: "pub-result__actions", children: [result.url && result.fileName && (_jsxs("a", { className: "btn btn--primary btn--sm", href: result.url, download: result.fileName, "data-testid": "publish-download", children: [_jsx(Icon, { name: "download" }), " Download"] })), result.link && (_jsxs(_Fragment, { children: [_jsxs("a", { className: "btn btn--sm", href: result.link, target: "_blank", rel: "noopener noreferrer", children: [_jsx(Icon, { name: "external" }), " Open"] }), _jsxs("button", { type: "button", className: "btn btn--sm", onClick: () => void studio.publish.copy(result.link ?? null, 'Link'), children: [_jsx(Icon, { name: "copy" }), " Copy link"] })] }))] })] }))] }));
});
/** The hub panel. */
export const PublishHub = memo(function PublishHub() {
    const studio = useStudio();
    const target = useStore(studio.publish.state, (s) => s.target);
    const running = useStore(studio.publish.state, (s) => s.job?.running === true);
    const historyCount = useStore(studio.publish.state, (s) => s.history.length);
    const close = () => {
        studio.publish.close();
        studio.publish.restoreCamera();
    };
    useEffect(() => {
        const onKey = (e) => {
            if (e.key === 'Escape' && !running && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement))
                close();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    });
    return (_jsxs("aside", { className: "pub", "aria-label": "Publish", "data-testid": "publish-hub", children: [_jsxs("header", { className: "pub__head", children: [_jsxs("div", { className: "pub__titles", children: [_jsxs("h2", { className: "pub__title", children: [_jsx(Icon, { name: "rocket", size: 20 }), " Publish"] }), _jsx("p", { className: "pub__sub", children: "Share what you made \u2014 as a game, a film, a picture or a link." })] }), _jsxs("button", { type: "button", className: `btn btn--ghost btn--sm${target === 'history' ? ' is-active' : ''}`, onClick: () => studio.publish.setTarget('history'), "aria-pressed": target === 'history', "data-tip": "Everything published from this project", children: [_jsx(Icon, { name: "history" }), " History", historyCount > 0 ? ` · ${historyCount}` : ''] }), _jsx("button", { type: "button", className: "icon-btn", onClick: close, "aria-label": "Close publish", "data-tip": "Close", "data-kbd": "Esc", children: _jsx(Icon, { name: "x" }) })] }), _jsx("nav", { className: "pub__targets", "aria-label": "What to publish", children: TARGETS.map((t) => (_jsxs("button", { type: "button", className: `pub-target${target === t.id ? ' is-active' : ''}`, onClick: () => studio.publish.setTarget(t.id), "aria-pressed": target === t.id, "data-testid": `publish-target-${t.id}`, children: [_jsx("span", { className: "pub-target__icon", children: _jsx(Icon, { name: t.icon, size: 20 }) }), _jsx("span", { className: "pub-target__label", children: t.label }), _jsx("span", { className: "pub-target__hint", children: t.hint })] }, t.id))) }), _jsxs("div", { className: "pub__body", children: [target === 'game' && _jsx(GameTarget, {}), target === 'video' && _jsx(VideoTarget, {}), target === 'render' && _jsx(RenderTarget, {}), target === 'model' && _jsx(ModelTarget, {}), target === 'plan' && _jsx(PlanTarget, {}), target === 'share' && _jsx(ShareTarget, {}), target === 'history' && _jsx(HistoryTarget, {})] }), _jsx(JobFooter, {})] }));
});
