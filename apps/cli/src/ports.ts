/**
 * Port selection: the preferred port when it is free, else the next free one
 * of a small range, else any free port the OS assigns. An explicitly chosen
 * port is never silently replaced.
 */
import { createServer } from 'node:net';

/** True when `port` can be bound on `host` right now. */
export function portFree(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.unref();
    srv.once('error', () => resolve(false));
    srv.listen({ port, host, exclusive: true }, () => srv.close(() => resolve(true)));
  });
}

/** A port the OS considers free on `host`. */
export function ephemeralPort(host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.once('error', reject);
    srv.listen({ port: 0, host }, () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      srv.close(() => (port > 0 ? resolve(port) : reject(new Error('no free port'))));
    });
  });
}

/** Options of {@link pickPort}. */
export interface PickPortOptions {
  preferred: number;
  /** The user asked for this exact port: fail instead of moving on. */
  explicit: boolean;
  host: string;
  /** How many following ports to try (default 20). */
  range?: number;
  isFree?: (port: number, host: string) => Promise<boolean>;
  ephemeral?: (host: string) => Promise<number>;
}

/** Choose the listen port. Resolves `{ port }` or `{ error }`. */
export async function pickPort(opts: PickPortOptions): Promise<{ port: number } | { error: string }> {
  const isFree = opts.isFree ?? portFree;
  if (opts.explicit) return (await isFree(opts.preferred, opts.host)) ? { port: opts.preferred } : { error: `port ${opts.preferred} is already in use (choose another with --port, or leave it out to pick a free one)` };
  const range = opts.range ?? 20;
  for (let p = opts.preferred; p < Math.min(65536, opts.preferred + range); p++) if (await isFree(p, opts.host)) return { port: p };
  try {
    return { port: await (opts.ephemeral ?? ephemeralPort)(opts.host) };
  } catch {
    return { error: 'no free port found' };
  }
}
