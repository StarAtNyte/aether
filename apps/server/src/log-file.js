/**
 * Rotating log file for the detached local server (`aether start`): lines
 * are appended to `<file>`; once it passes `maxBytes` it becomes `<file>.1`
 * (older copies shift up to `<file>.<keep>`, the oldest is dropped). Writes
 * are synchronous appends (a local app logs a few lines per request, and a
 * crash must not lose the last lines). The file is created with mode 0600.
 *
 * Lines arrive already scrubbed of secrets by the logger.
 */
import { appendFileSync, chmodSync, existsSync, renameSync, rmSync, statSync } from 'node:fs';
/** Rotate `file` now: `file` → `file.1` → … → `file.<keep>` (dropped beyond). */
export function rotateLogFile(file, keep) {
    try {
        rmSync(`${file}.${keep}`, { force: true });
        for (let i = keep - 1; i >= 1; i--)
            if (existsSync(`${file}.${i}`))
                renameSync(`${file}.${i}`, `${file}.${i + 1}`);
        if (existsSync(file))
            renameSync(file, `${file}.1`);
    }
    catch {
        /* best effort: keep appending to the current file */
    }
}
/** A line sink appending to `file` with size-based rotation. Never throws. */
export function createRotatingSink(file, opts = {}) {
    const maxBytes = Math.max(4096, opts.maxBytes ?? 5 * 1024 * 1024);
    const keep = Math.max(1, Math.min(20, opts.keep ?? 3));
    let size = 0;
    try {
        size = statSync(file).size;
    }
    catch {
        size = 0;
    }
    return (line) => {
        const text = `${line}\n`;
        try {
            if (size + text.length > maxBytes && size > 0) {
                rotateLogFile(file, keep);
                size = 0;
            }
            const fresh = size === 0 && !existsSync(file);
            appendFileSync(file, text, { mode: 0o600 });
            if (fresh)
                chmodSync(file, 0o600);
            size += Buffer.byteLength(text);
        }
        catch {
            /* the disk is full or the folder vanished: logging must never crash the server */
        }
    };
}
