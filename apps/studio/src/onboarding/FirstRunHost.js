import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Mounts the first-run flow at the app root: probes once on start-up, then
 * lazy-loads the screen only if it has to show (the agent package and the
 * screen stay out of the first paint), and offers the quiet "Sign in" chip.
 */
import { lazyBoundary } from '../components/ErrorBoundary';
import { memo, useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { browserStorage } from '../lib/storage';
import { decideFirstRun, firstRunStore, hostedBuildFlag, openFirstRun, probeFirstRun, useFirstRun } from './firstRun';
const FirstRun = lazyBoundary(async () => ({ default: (await import('./FirstRun')).FirstRun }), { what: 'sign-in screen', fallback: null, variant: 'inline' });
let probed = false;
/** Run the start-up probe once per page (StrictMode mounts effects twice). */
export function startFirstRun(fetchImpl = (i, init) => globalThis.fetch(i, init)) {
    if (probed)
        return Promise.resolve();
    probed = true;
    return probeFirstRun(fetchImpl, browserStorage(), hostedBuildFlag()).then((facts) => {
        const d = decideFirstRun(facts);
        firstRunStore.setState({ ready: true, open: d.show, variant: d.variant, marker: facts.marker });
    });
}
/** The first-run screen host (render once, at the app root). */
export const FirstRunHost = memo(function FirstRunHost() {
    const open = useFirstRun((s) => s.open);
    const [mounted, setMounted] = useState(false);
    useEffect(() => {
        void startFirstRun();
    }, []);
    useEffect(() => {
        if (open)
            setMounted(true);
    }, [open]);
    if (!mounted)
        return null;
    return (_jsx(FirstRun, {}));
});
/** Quiet "Sign in" chip while the user chose to stay offline. */
export const SignInChip = memo(function SignInChip() {
    const show = useFirstRun((s) => s.ready && !s.open && s.marker?.choice === 'offline');
    if (!show)
        return null;
    return (_jsxs("button", { type: "button", className: "signin-chip", "data-testid": "signin-chip", onClick: openFirstRun, "data-tip": "Connect your AI account or key", children: [_jsx("span", { className: "signin-chip__dot", "aria-hidden": "true" }), _jsx(Icon, { name: "user" }), _jsx("span", { className: "signin-chip__label", children: "Sign in" })] }));
});
