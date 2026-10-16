/**
 * Resolve an executable on PATH without spawning a shell.
 */
import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';
/**
 * Extensions to try. On Windows an extensionless file next to `codex.cmd`
 * is npm's POSIX shell shim, which Windows cannot execute: only PATHEXT
 * extensions are tried unless the name already carries one.
 */
export function windowsExtensions(name, env, platform) {
    if (platform !== 'win32')
        return [''];
    const list = (env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD').split(';').map((e) => e.trim().toLowerCase()).filter((e) => /^\.[a-z0-9]{1,8}$/.test(e));
    const lower = name.toLowerCase();
    return list.some((e) => lower.endsWith(e)) ? [''] : list;
}
/** Absolute path of `name` on `PATH`, or null. Absolute paths are checked as given. */
export function which(name, env = process.env, platform = process.platform) {
    if (!/^[A-Za-z0-9._/\\:-]{1,512}$/.test(name))
        return null;
    const exts = windowsExtensions(name, env, platform);
    const candidates = isAbsolute(name) ? [name] : (env['PATH'] ?? '').split(delimiter).filter((d) => d.length > 0).map((d) => join(d, name));
    for (const base of candidates) {
        for (const ext of exts) {
            const p = `${base}${ext}`;
            try {
                if (!statSync(p).isFile())
                    continue;
                accessSync(p, constants.X_OK);
                return p;
            }
            catch {
                /* not here */
            }
        }
    }
    return null;
}
