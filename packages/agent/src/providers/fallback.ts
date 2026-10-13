/**
 * Automatic fallback: use `primary` until it fails with a connection-class
 * error (bridge offline, not logged in, CLI missing, rate limited, timeout,
 * unusable replies…), then switch to `fallback` (the offline planner) for the
 * rest of this provider's life and report why. Caller aborts never fall back.
 *
 * Create one instance per agent run so every run starts on the primary again.
 */
import type { CompletionRequest, CompletionResponse, Provider } from '../types';
import { errorMessage, isAbortError, ProviderError } from './errors';

/** Why a fallback happened. */
export interface FallbackNotice {
  /** Primary provider name. */
  from: string;
  /** Fallback provider name. */
  to: string;
  /** ProviderError code ('network', 'auth', …) or 'error'. */
  code: string;
  /** Backend-specific reason (bridge error code, 'bridge_offline'…), when known. */
  reason: string | undefined;
  message: string;
}

/** Options of {@link createFallbackProvider}. */
export interface FallbackProviderOptions {
  primary: Provider;
  fallback: Provider;
  /** Called once, when the switch happens. */
  onFallback?: (notice: FallbackNotice) => void;
  /** Override which errors switch over (default: everything except caller aborts). */
  shouldFallback?: (err: unknown) => boolean;
}

/** A provider that falls back once and stays on the fallback. */
export interface FallbackProvider extends Provider {
  /** The notice, once the fallback has been used. */
  readonly fellBack: FallbackNotice | null;
}

/** Wrap `primary` with an automatic switch to `fallback`. */
export function createFallbackProvider(opts: FallbackProviderOptions): FallbackProvider {
  let notice: FallbackNotice | null = null;
  const should = opts.shouldFallback ?? ((err: unknown) => !isAbortError(err));
  return {
    get name(): string {
      return notice ? opts.fallback.name : opts.primary.name;
    },
    get fellBack(): FallbackNotice | null {
      return notice;
    },
    async complete(req: CompletionRequest, signal?: AbortSignal): Promise<CompletionResponse> {
      if (notice) return opts.fallback.complete(req, signal);
      try {
        return await opts.primary.complete(req, signal);
      } catch (err) {
        if (signal?.aborted || !should(err)) throw err;
        notice = {
          from: opts.primary.name,
          to: opts.fallback.name,
          code: err instanceof ProviderError ? err.code : 'error',
          reason: err instanceof ProviderError ? err.reason : undefined,
          message: errorMessage(err).slice(0, 300),
        };
        opts.onFallback?.(notice);
        return opts.fallback.complete(req, signal);
      }
    },
  };
}
