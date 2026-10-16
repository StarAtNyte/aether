/**
 * Provider chain of one agent run: the chosen connection first, then the
 * user's other signed-in assistants (Codex / Claude Code), and only then the
 * offline planner. Each switch is reported with the precise reason the
 * previous link failed. Failures that would hit every link alike (the bridge
 * or server is down, the pairing expired) skip straight to the offline
 * planner instead of retrying the same dead door.
 */
import { errorMessage, isAbortError, ProviderError } from '@aether/agent';
/** Reasons that mean no other assistant behind the same door can answer either. */
const SHARED_REASONS = new Set(['bridge_offline', 'unauthorized', 'forbidden_origin', 'forbidden_host', 'invalid_url']);
/** Build the chain; `onSwitch` fires once per switch. */
export function createProviderChain(links, offline, onSwitch) {
    let index = 0;
    let offlineNotice = null;
    return {
        get name() {
            return links[index]?.provider.name ?? offline.name;
        },
        get offlineNotice() {
            return offlineNotice;
        },
        active() {
            return links[index] ?? null;
        },
        async complete(req, signal) {
            for (;;) {
                const link = links[index];
                if (!link)
                    return offline.complete(req, signal);
                try {
                    return await link.provider.complete(req, signal);
                }
                catch (err) {
                    if (signal?.aborted || isAbortError(err))
                        throw err;
                    const notice = {
                        from: link.provider.name,
                        to: links[index + 1]?.provider.name ?? offline.name,
                        code: err instanceof ProviderError ? err.code : 'error',
                        reason: err instanceof ProviderError ? err.reason : undefined,
                        message: errorMessage(err).slice(0, 300),
                    };
                    const skip = notice.reason !== undefined && SHARED_REASONS.has(notice.reason);
                    const nextIndex = skip ? links.length : index + 1;
                    const to = links[nextIndex] ?? null;
                    if (!to)
                        offlineNotice = notice;
                    index = nextIndex;
                    onSwitch({ from: link, to, notice });
                }
            }
        },
    };
}
