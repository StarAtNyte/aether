const ORDER = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };
let threshold = 'warn';
/** Change the minimum level that is printed (default `'warn'`). */
export function setRenderLogLevel(level) {
    threshold = level;
}
function emit(level, message, detail) {
    if (ORDER[level] < ORDER[threshold])
        return;
    const line = `[aether/render] ${message}`;
    const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
    if (detail === undefined)
        sink(line);
    else
        sink(line, detail);
}
/** Package logger. */
export const log = {
    debug: (message, detail) => emit('debug', message, detail),
    info: (message, detail) => emit('info', message, detail),
    warn: (message, detail) => emit('warn', message, detail),
    error: (message, detail) => emit('error', message, detail),
};
/** Human-readable message of an unknown thrown value. */
export function errorMessage(e) {
    if (e instanceof Error)
        return e.message;
    if (typeof e === 'string')
        return e;
    return 'unknown error';
}
