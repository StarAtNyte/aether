import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Error boundaries and retryable lazy chunks. A failed chunk download (offline, a deploy replaced the files) or a
 * render exception never leaves a blank page: the boundary shows what happened in plain words with a retry, and
 * the page-level variant also offers the way back to the projects.
 */
import { Component, lazy, Suspense, useMemo, useState } from 'react';
/** Classify a thrown value: a failed chunk download (offline or stale deploy) or a real crash. Pure. */
export function classifyFailure(error, online = typeof navigator === 'undefined' ? true : navigator.onLine) {
    const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
    const chunk = /ChunkLoadError|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Loading chunk .* failed|Unable to preload CSS|net::ERR_/i.test(text);
    if (chunk)
        return online ? 'chunk' : 'offline';
    return 'crash';
}
/** Title and text shown for a failure. Pure. */
export function failureCopy(kind, what) {
    if (kind === 'offline')
        return { title: 'You appear to be offline', text: `The ${what} could not load. Check your connection and try again; your projects are safe on this device.` };
    if (kind === 'chunk')
        return { title: `The ${what} could not load`, text: 'A part of the app failed to download. Try again; if it keeps failing, reload the page (the app may have been updated).' };
    return { title: 'Something went wrong', text: `The ${what} hit an unexpected error. Your projects are saved on this device. Try again, or go back to the projects.` };
}
/** Catches render and chunk-load errors below it. */
export class ErrorBoundary extends Component {
    state = { error: null, failed: false };
    static getDerivedStateFromError(error) {
        return { error, failed: true };
    }
    componentDidCatch(error, info) {
        this.props.onError?.(error);
        console.error('[aether] a screen failed', error, info.componentStack ?? '');
    }
    retry = () => {
        this.props.onRetry?.();
        this.setState({ error: null, failed: false });
    };
    render() {
        if (!this.state.failed)
            return this.props.children;
        const what = this.props.what ?? 'app';
        const kind = classifyFailure(this.state.error);
        const copy = failureCopy(kind, what);
        const inline = this.props.variant === 'inline';
        return (_jsx("div", { className: inline ? 'error-inline' : 'page-center', role: "alert", "data-testid": "error-boundary", "data-kind": kind, children: _jsxs("div", { className: "empty-state", children: [_jsx("h3", { className: "empty-state__title", children: copy.title }), _jsx("p", { className: "empty-state__text", children: copy.text }), _jsxs("div", { className: "empty-state__actions", children: [_jsx("button", { type: "button", className: "btn btn--primary", onClick: this.retry, "data-testid": "error-retry", children: "Try again" }), !inline && (_jsx("button", { type: "button", className: "btn", onClick: () => location.reload(), children: "Reload page" })), !inline && (_jsx("a", { className: "btn", href: "#/", children: "Back to projects" }))] })] }) }));
    }
}
/**
 * A lazy-loaded component wrapped in a boundary and Suspense. Retrying re-runs the dynamic import (React caches a
 * rejected lazy forever, so each attempt creates a new lazy).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the same bound React.lazy uses, so memo() components infer
export function lazyBoundary(load, opts) {
    return function LazyBoundary(props) {
        const [attempt, setAttempt] = useState(0);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- a new lazy per attempt is the point
        const Comp = useMemo(() => lazy(load), [attempt]);
        return (_jsx(ErrorBoundary, { what: opts.what, variant: opts.variant ?? 'page', onRetry: () => setAttempt((a) => a + 1), children: _jsx(Suspense, { fallback: opts.fallback, children: _jsx(Comp, { ...props }) }) }, attempt));
    };
}
