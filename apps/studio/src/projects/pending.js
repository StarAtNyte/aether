/**
 * Prompts waiting to run when a freshly created project opens in the
 * editor ("from template" / "from prompt"). In-memory hand-off only: a
 * reload before the editor starts simply opens the (empty) project.
 */
const pending = new Map();
const MAX_PENDING = 16;
/** Queue a prompt for a project. */
export function queueRun(projectId, run) {
    if (pending.size >= MAX_PENDING) {
        const oldest = pending.keys().next().value;
        if (oldest !== undefined)
            pending.delete(oldest);
    }
    pending.set(projectId, { prompt: run.prompt.slice(0, 4000), offline: run.offline });
}
/** Take (and forget) the queued prompt of a project. */
export function takeRun(projectId) {
    const r = pending.get(projectId) ?? null;
    pending.delete(projectId);
    return r;
}
