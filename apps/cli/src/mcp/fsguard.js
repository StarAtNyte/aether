/**
 * The project folder: the only place the MCP server reads or writes. Callers
 * never pass paths; they pass a *name* that is reduced to a safe file name and
 * resolved inside a fixed sub-folder. The resolved path is checked again
 * against the real (symlink-free) project root, so a link planted inside the
 * folder cannot redirect a write elsewhere.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { ToolError } from './errors';
/** A file name made of `[a-z0-9._-]`, at most 64 characters, never starting with a dot. */
export function safeFileName(name, fallback) {
    const base = basename(String(name).replace(/\\/g, '/'))
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^[-.]+/, '')
        .replace(/-{2,}/g, '-')
        .slice(0, 64)
        .replace(/[-.]+$/, '');
    return base === '' ? fallback : base;
}
/** The project folder with confined read/write helpers. */
export class ProjectDir {
    /** Real path of the project folder. */
    root;
    constructor(dir) {
        const abs = resolve(dir);
        mkdirSync(abs, { recursive: true, mode: 0o700 });
        this.root = realpathSync(abs);
    }
    /** True when `target` (already absolute) lies inside the root, symlinks resolved as far as they exist. */
    inside(target) {
        let probe = target;
        while (!existsSync(probe)) {
            const up = dirname(probe);
            if (up === probe)
                return false;
            probe = up;
        }
        const real = realpathSync(probe);
        return real === this.root || real.startsWith(this.root + sep);
    }
    /** Absolute path of `<folder>/<file>` inside the project; throws `path_denied` otherwise. */
    resolve(folder, file) {
        const dir = join(this.root, folder);
        const target = resolve(dir, file);
        if (!(target === dir || target.startsWith(dir + sep)) || !this.inside(target))
            throw new ToolError('path_denied', 'That location is outside the project folder.');
        // Never write through a symlink, even one that points back inside.
        let link = false;
        try {
            link = lstatSync(target).isSymbolicLink();
        }
        catch {
            /* does not exist yet */
        }
        if (link)
            throw new ToolError('path_denied', 'Refusing to use a symbolic link.');
        return target;
    }
    /** Write `data` atomically to `<folder>/<file>` (parents created, mode 0600). Returns the project-relative path. */
    write(folder, file, data, maxBytes) {
        const bytes = typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength;
        if (bytes > maxBytes)
            throw new ToolError('too_large', `The file would be ${Math.round(bytes / 1024 / 1024)} MB; the limit is ${Math.round(maxBytes / 1024 / 1024)} MB.`);
        const target = this.resolve(folder, file);
        mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
        if (!this.inside(dirname(target)))
            throw new ToolError('path_denied', 'That location is outside the project folder.');
        const tmp = `${target}.${randomBytes(4).toString('hex')}.tmp`;
        try {
            writeFileSync(tmp, data, { mode: 0o600 });
            renameSync(tmp, target);
        }
        catch (e) {
            rmSync(tmp, { force: true });
            throw e;
        }
        return `${folder}/${file}`.replace(/\\/g, '/');
    }
    /** Read `<folder>/<file>` as text (null when absent); larger than `maxBytes` throws `too_large`. */
    readText(folder, file, maxBytes) {
        const target = this.resolve(folder, file);
        let st;
        try {
            st = statSync(target);
        }
        catch {
            return null;
        }
        if (!st.isFile())
            return null;
        if (st.size > maxBytes)
            throw new ToolError('too_large', 'The saved file is too large to load.');
        return readFileSync(target, 'utf8');
    }
}
