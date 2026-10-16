/**
 * Error boundaries and retryable lazy chunks. A failed chunk download (offline, a deploy replaced the files) or a
 * render exception never leaves a blank page: the boundary shows what happened in plain words with a retry, and
 * the page-level variant also offers the way back to the projects.
 */
import { Component, lazy, type ComponentProps, Suspense, useMemo, useState, type ComponentType, type ErrorInfo, type ReactElement, type ReactNode } from 'react';

/** What went wrong, in the user's terms. */
export type FailureKind = 'offline' | 'chunk' | 'crash';

/** Classify a thrown value: a failed chunk download (offline or stale deploy) or a real crash. Pure. */
export function classifyFailure(error: unknown, online: boolean = typeof navigator === 'undefined' ? true : navigator.onLine): FailureKind {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  const chunk = /ChunkLoadError|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Loading chunk .* failed|Unable to preload CSS|net::ERR_/i.test(text);
  if (chunk) return online ? 'chunk' : 'offline';
  return 'crash';
}

/** Title and text shown for a failure. Pure. */
export function failureCopy(kind: FailureKind, what: string): { title: string; text: string } {
  if (kind === 'offline') return { title: 'You appear to be offline', text: `The ${what} could not load. Check your connection and try again; your projects are safe on this device.` };
  if (kind === 'chunk') return { title: `The ${what} could not load`, text: 'A part of the app failed to download. Try again; if it keeps failing, reload the page (the app may have been updated).' };
  return { title: 'Something went wrong', text: `The ${what} hit an unexpected error. Your projects are saved on this device. Try again, or go back to the projects.` };
}

interface BoundaryProps {
  children: ReactNode;
  /** What the boundary protects, for the message ("editor"). */
  what?: string;
  /** 'page' fills the window; 'inline' is a small notice that keeps the rest of the screen usable. */
  variant?: 'page' | 'inline';
  /** Called by the retry button (re-create a lazy chunk, …); the boundary also clears its error. */
  onRetry?: () => void;
  /** Reported once per caught error (tests, diagnostics). */
  onError?: (error: unknown) => void;
}

interface BoundaryState {
  error: unknown;
  failed: boolean;
}

/** Catches render and chunk-load errors below it. */
export class ErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { error: null, failed: false };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error, failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    this.props.onError?.(error);
    console.error('[aether] a screen failed', error, info.componentStack ?? '');
  }

  private readonly retry = (): void => {
    this.props.onRetry?.();
    this.setState({ error: null, failed: false });
  };

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    const what = this.props.what ?? 'app';
    const kind = classifyFailure(this.state.error);
    const copy = failureCopy(kind, what);
    const inline = this.props.variant === 'inline';
    return (
      <div className={inline ? 'error-inline' : 'page-center'} role="alert" data-testid="error-boundary" data-kind={kind}>
        <div className="empty-state">
          <h3 className="empty-state__title">{copy.title}</h3>
          <p className="empty-state__text">{copy.text}</p>
          <div className="empty-state__actions">
            <button type="button" className="btn btn--primary" onClick={this.retry} data-testid="error-retry">
              Try again
            </button>
            {!inline && (
              <button type="button" className="btn" onClick={() => location.reload()}>
                Reload page
              </button>
            )}
            {!inline && (
              <a className="btn" href="#/">
                Back to projects
              </a>
            )}
          </div>
        </div>
      </div>
    );
  }
}

/**
 * A lazy-loaded component wrapped in a boundary and Suspense. Retrying re-runs the dynamic import (React caches a
 * rejected lazy forever, so each attempt creates a new lazy).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the same bound React.lazy uses, so memo() components infer
export function lazyBoundary<C extends ComponentType<any>>(load: () => Promise<{ default: C }>, opts: { what: string; fallback: ReactElement | null; variant?: 'page' | 'inline' }): ComponentType<ComponentProps<C>> {
  return function LazyBoundary(props: ComponentProps<C>): ReactElement {
    const [attempt, setAttempt] = useState(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new lazy per attempt is the point
    const Comp = useMemo(() => lazy(load), [attempt]);
    return (
      <ErrorBoundary key={attempt} what={opts.what} variant={opts.variant ?? 'page'} onRetry={() => setAttempt((a) => a + 1)}>
        <Suspense fallback={opts.fallback}>
          <Comp {...(props as ComponentProps<typeof Comp>)} />
        </Suspense>
      </ErrorBoundary>
    );
  };
}
