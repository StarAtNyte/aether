/** The run's verdict no longer describes the world (it was edited since). */
export function isStale(pt, head) {
    return pt.head !== null && pt.head !== head;
}
/** Badge for the current playtest state. */
export function badgeOf(pt, head) {
    const walk = pt.kind === 'walkthrough';
    if (pt.status === 'running') {
        const pct = pt.progress ? Math.round(pt.progress.fraction * 100) : 0;
        const fixing = (pt.progress?.round ?? 0) > 0;
        return { tone: 'running', text: `${fixing ? 'Re-checking' : walk ? 'Walking it' : 'Playing it'}… ${pct}%`, tip: pt.progress?.note ?? 'The bot is checking the world', verified: false };
    }
    if (pt.status === 'idle')
        return { tone: 'idle', text: walk ? 'Check walkability' : 'Check playability', tip: 'An AI bot plays or walks your world and proves it works', verified: false };
    if (isStale(pt, head))
        return { tone: 'idle', text: 'Check again', tip: 'The world changed since the bot last played it', verified: false };
    switch (pt.status) {
        case 'passed':
            // Green needs a real pass that was proven for this exact world content.
            if (!pt.proven)
                return { tone: 'idle', text: 'Check again', tip: 'The result could not be tied to this world', verified: false };
            return { tone: 'ok', text: walk ? 'Verified walkable' : 'Verified playable', tip: pt.sentence || 'The bot completed it', verified: true };
        case 'failed':
            return { tone: 'bad', text: 'Could not verify', tip: pt.sentence, verified: false };
        case 'inconclusive':
            return { tone: 'warn', text: 'Not verified yet', tip: pt.sentence, verified: false };
        case 'unsupported':
            return { tone: 'idle', text: 'Bot cannot play this', tip: pt.sentence, verified: false };
        default:
            return { tone: 'bad', text: 'Playtest error', tip: pt.sentence, verified: false };
    }
}
/** "1:05" / "41 s" style clock for replay times. */
export function clock(seconds) {
    const s = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0));
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
}
/** Replay speeds offered in the bar. */
export const REPLAY_SPEEDS = [0.5, 1, 2, 4, 8];
/** Next speed in the cycle. */
export function nextSpeed(current) {
    const i = REPLAY_SPEEDS.findIndex((v) => Math.abs(v - current) < 1e-6);
    return REPLAY_SPEEDS[(i + 1) % REPLAY_SPEEDS.length];
}
/** Plain label of an objective status. */
export function objectiveStatusText(status, at) {
    switch (status) {
        case 'done':
            return at !== undefined ? `done at ${clock(at)}` : 'done';
        case 'unreachable':
            return 'cannot be reached';
        case 'blocked':
            return 'blocked';
        case 'untouched':
            return 'reached, did not trigger';
        default:
            return 'not checked';
    }
}
