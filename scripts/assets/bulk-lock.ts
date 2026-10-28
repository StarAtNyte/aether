/** The lock that keeps two publishers off the shared staging folder and the dataset (`<bulk dir>/publish.lock`, holds the owner's pid). */
import { closeSync, existsSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs';
import { join } from 'node:path';

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export const lockFile = (dir: string): string => join(dir, 'publish.lock');

/** Take the lock, waiting while a live process holds it (a lock whose process is gone is taken over). */
export async function acquireLock(dir: string, waitMs = 6 * 3600_000): Promise<() => void> {
  const f = lockFile(dir);
  const t0 = Date.now();
  for (;;) {
    try {
      const fd = openSync(f, 'wx');
      writeSync(fd, String(process.pid));
      closeSync(fd);
      return () => {
        try {
          if (readFileSync(f, 'utf8').trim() === String(process.pid)) rmSync(f, { force: true });
        } catch {
          /* already gone */
        }
      };
    } catch {
      const pid = Number(existsSync(f) ? readFileSync(f, 'utf8').trim() : 0);
      if (pid && pid !== process.pid && !alive(pid)) rmSync(f, { force: true });
      else if (pid === process.pid) return () => undefined;
      else if (Date.now() - t0 > waitMs) throw new Error(`${f} is still held by pid ${pid}`);
      else await new Promise((r) => setTimeout(r, 5000));
    }
  }
}
