/**
 * Mounts the first-run flow at the app root: probes once on start-up, then
 * lazy-loads the screen only if it has to show (the agent package and the
 * screen stay out of the first paint), and offers the quiet "Sign in" chip.
 */
import { lazy, memo, Suspense, useEffect, useState, type ReactElement } from 'react';
import { Icon } from '../components/Icon';
import { browserStorage } from '../lib/storage';
import { decideFirstRun, firstRunStore, hostedBuildFlag, openFirstRun, probeFirstRun, useFirstRun } from './firstRun';

const FirstRun = lazy(async () => ({ default: (await import('./FirstRun')).FirstRun }));

let probed = false;

/** Run the start-up probe once per page (StrictMode mounts effects twice). */
export function startFirstRun(fetchImpl: typeof fetch = (i, init) => globalThis.fetch(i, init)): Promise<void> {
  if (probed) return Promise.resolve();
  probed = true;
  return probeFirstRun(fetchImpl, browserStorage(), hostedBuildFlag()).then((facts) => {
    const d = decideFirstRun(facts);
    firstRunStore.setState({ ready: true, open: d.show, variant: d.variant, marker: facts.marker });
  });
}

/** The first-run screen host (render once, at the app root). */
export const FirstRunHost = memo(function FirstRunHost(): ReactElement | null {
  const open = useFirstRun((s) => s.open);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    void startFirstRun();
  }, []);
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);
  if (!mounted) return null;
  return (
    <Suspense fallback={null}>
      <FirstRun />
    </Suspense>
  );
});

/** Quiet "Sign in" chip while the user chose to stay offline. */
export const SignInChip = memo(function SignInChip(): ReactElement | null {
  const show = useFirstRun((s) => s.ready && !s.open && s.marker?.choice === 'offline');
  if (!show) return null;
  return (
    <button type="button" className="signin-chip" data-testid="signin-chip" onClick={openFirstRun} data-tip="Connect your AI account or key">
      <span className="signin-chip__dot" aria-hidden="true" />
      <Icon name="user" />
      <span className="signin-chip__label">Sign in</span>
    </button>
  );
});
