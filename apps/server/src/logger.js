/**
 * Tiny structured JSON logger (one line per event) with secret scrubbing.
 *
 * Never pass request/response bodies to it. Free text that may contain
 * upstream data (error messages) is scrubbed of configured secrets and of
 * anything that looks like an API key or bearer token.
 */
const ORDER = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
/** Patterns for credentials that must never appear in logs. */
const SECRET_PATTERNS = [
    /sk-[A-Za-z0-9_-]{8,}/g, // OpenAI / Anthropic style keys
    /(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi,
    /((?:x-api-key|api[_-]?key|authorization)["'\s:=]+)[^\s"',}]{6,}/gi,
];
/**
 * Replace configured secrets and credential-looking substrings with "[redacted]".
 * Also bounds the output length so a hostile upstream cannot flood the logs.
 */
export function scrub(text, secrets = [], maxLength = 500) {
    let out = text.length > maxLength * 4 ? text.slice(0, maxLength * 4) : text;
    for (const s of secrets) {
        if (s.length >= 4)
            out = out.split(s).join('[redacted]');
    }
    for (const re of SECRET_PATTERNS) {
        out = out.replace(re, (_m, prefix) => (typeof prefix === 'string' ? `${prefix}[redacted]` : '[redacted]'));
    }
    return out.length > maxLength ? `${out.slice(0, maxLength)}…` : out;
}
const defaultSink = (line, level) => {
    (level === 'warn' || level === 'error' ? process.stderr : process.stdout).write(`${line}\n`);
};
/** Create a JSON-lines logger. */
export function createLogger(opts = {}) {
    const min = ORDER[opts.level ?? 'info'];
    const secrets = opts.secrets ?? [];
    const sink = opts.sink ?? defaultSink;
    const now = opts.now ?? Date.now;
    const write = (level, msg, fields) => {
        if (ORDER[level] < min)
            return;
        const rec = { level, time: new Date(now()).toISOString(), msg: scrub(msg, secrets) };
        if (fields) {
            for (const key of Object.keys(fields)) {
                const v = fields[key];
                if (v === undefined || key === '__proto__')
                    continue;
                rec[key] = typeof v === 'string' ? scrub(v, secrets) : v;
            }
        }
        sink(JSON.stringify(rec), level);
    };
    return {
        debug: (m, f) => write('debug', m, f),
        info: (m, f) => write('info', m, f),
        warn: (m, f) => write('warn', m, f),
        error: (m, f) => write('error', m, f),
    };
}
/** A logger that discards everything (tests). */
export const silentLogger = createLogger({ level: 'silent' });
