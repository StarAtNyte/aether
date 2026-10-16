/**
 * `aether logs`: the last lines of the server log, pretty-printed, and
 * `--follow` (polls the file, survives rotation). Lines are the server's
 * JSON log records (already scrubbed of secrets); anything else prints as is.
 */
import { closeSync, openSync, readSync, statSync } from 'node:fs';
/** Read at most the last `maxBytes` of a file as text ('' when missing). */
export function readTail(file, maxBytes = 512 * 1024) {
    let fd;
    try {
        fd = openSync(file, 'r');
    }
    catch {
        return '';
    }
    try {
        const size = statSync(file).size;
        const start = Math.max(0, size - maxBytes);
        const buf = Buffer.alloc(size - start);
        readSync(fd, buf, 0, buf.length, start);
        const text = buf.toString('utf8');
        // Drop a partial first line when we started mid-file.
        return start > 0 ? text.slice(text.indexOf('\n') + 1) : text;
    }
    finally {
        closeSync(fd);
    }
}
/** The last `n` non-empty lines of `text`. */
export function lastLines(text, n) {
    const lines = text.split('\n').filter((l) => l.length > 0);
    return lines.slice(Math.max(0, lines.length - n));
}
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f\u001b]/g;
/** Pretty-print one log line: `HH:MM:SS level msg key=value …`. */
export function formatLogLine(line) {
    const clean = line.replace(CONTROL, '');
    if (!clean.startsWith('{'))
        return clean.slice(0, 2000);
    let rec;
    try {
        rec = JSON.parse(clean);
    }
    catch {
        return clean.slice(0, 2000);
    }
    if (typeof rec !== 'object' || rec === null || Array.isArray(rec))
        return clean.slice(0, 2000);
    const r = rec;
    const time = typeof r['time'] === 'string' ? r['time'].slice(11, 19) : '        ';
    const level = typeof r['level'] === 'string' ? r['level'].toUpperCase().padEnd(5) : 'INFO ';
    const msg = typeof r['msg'] === 'string' ? r['msg'] : '';
    const rest = Object.entries(r)
        .filter(([k]) => k !== 'time' && k !== 'level' && k !== 'msg')
        .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
        .join(' ');
    return `${time} ${level} ${msg}${rest ? `  ${rest}` : ''}`.replace(CONTROL, '').slice(0, 2000);
}
/** Follow a file: calls `onLine` for every new line until `signal` aborts. Handles rotation and truncation. */
export async function follow(file, onLine, signal, intervalMs = 500) {
    let offset = 0;
    try {
        offset = statSync(file).size;
    }
    catch {
        offset = 0;
    }
    let pending = '';
    while (!signal.aborted) {
        await new Promise((r) => {
            const t = setTimeout(r, intervalMs);
            signal.addEventListener('abort', () => {
                clearTimeout(t);
                r();
            }, { once: true });
        });
        if (signal.aborted)
            break;
        let size;
        try {
            size = statSync(file).size;
        }
        catch {
            continue;
        }
        // Rotated or truncated: start again from the top of the new file.
        if (size < offset)
            offset = 0;
        if (size === offset)
            continue;
        const len = Math.min(size - offset, 4 * 1024 * 1024);
        const buf = Buffer.alloc(len);
        let fd;
        try {
            fd = openSync(file, 'r');
        }
        catch {
            continue;
        }
        try {
            readSync(fd, buf, 0, len, offset);
        }
        finally {
            closeSync(fd);
        }
        offset += len;
        pending += buf.toString('utf8');
        const parts = pending.split('\n');
        pending = parts.pop() ?? '';
        for (const p of parts)
            if (p.length > 0)
                onLine(p);
    }
}
