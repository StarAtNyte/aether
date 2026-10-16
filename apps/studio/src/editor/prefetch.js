/**
 * Intent-based prefetch of the editor code: called when the pointer or
 * keyboard focus reaches something that opens the editor (project and
 * template cards, "New project"), so the chunk is usually loaded before the
 * click lands. Loads at most once; failures are ignored (the real
 * navigation retries through React.lazy).
 */
let started = false;
/** Start loading the editor chunk (idempotent). */
export function prefetchEditor() {
    if (started)
        return;
    started = true;
    void import('./EditorRoute').catch(() => {
        started = false;
    });
}
