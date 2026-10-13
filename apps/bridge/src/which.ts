/**
 * Resolve an executable on PATH without spawning a shell.
 */
import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';

/** Absolute path of `name` on `PATH`, or null. Absolute paths are checked as given. */
export function which(name: string, env: NodeJS.ProcessEnv = process.env): string | null {
  if (!/^[A-Za-z0-9._/\\:-]{1,512}$/.test(name)) return null;
  const exts = process.platform === 'win32' ? ['', ...(env['PATHEXT'] ?? '.EXE;.CMD;.BAT').split(';').map((e) => e.toLowerCase())] : [''];
  const candidates = isAbsolute(name) ? [name] : (env['PATH'] ?? '').split(delimiter).filter((d) => d.length > 0).map((d) => join(d, name));
  for (const base of candidates) {
    for (const ext of exts) {
      const p = `${base}${ext}`;
      try {
        if (!statSync(p).isFile()) continue;
        accessSync(p, constants.X_OK);
        return p;
      } catch {
        /* not here */
      }
    }
  }
  return null;
}
