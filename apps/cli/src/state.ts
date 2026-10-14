/**
 * The local app's state folder and files:
 *
 *   <state>/server.json   pid, port, link, instance id of the running server (0600)
 *   <state>/secret        per-install session secret (0600, created once)
 *   <state>/access-token  LAN access token (0600, only with --allow-lan)
 *   <state>/server.log    rotating server log; server.out: crash output of the last start
 *   <state>/data/         projects' server data, local AI jobs and extra Codex account homes
 *
 * Default folder: `$XDG_STATE_HOME/aether` or `~/.local/state/aether`
 * (Linux, macOS), `%LOCALAPPDATA%\Aether` (Windows); `AETHER_STATE_DIR` or
 * `--state-dir` override it. Everything read back is validated.
 */
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';

/** Resolve the state folder for this user and platform. */
export function resolveStateDir(env: Readonly<Record<string, string | undefined>>, platform: NodeJS.Platform, home: string, override: string | null = null): string {
  const explicit = override ?? env['AETHER_STATE_DIR'] ?? '';
  if (explicit !== '') return resolve(explicit);
  if (platform === 'win32') {
    const local = env['LOCALAPPDATA'];
    return local && isAbsolute(local) ? join(local, 'Aether') : join(home, 'AppData', 'Local', 'Aether');
  }
  const xdg = env['XDG_STATE_HOME'];
  // The XDG spec says relative values are invalid and must be ignored.
  return xdg && isAbsolute(xdg) ? join(xdg, 'aether') : join(home, '.local', 'state', 'aether');
}

/** Paths inside the state folder. */
export interface StatePaths {
  dir: string;
  server: string;
  secret: string;
  accessToken: string;
  log: string;
  out: string;
  data: string;
}

/** File layout of a state folder. */
export function statePaths(dir: string): StatePaths {
  return {
    dir,
    server: join(dir, 'server.json'),
    secret: join(dir, 'secret'),
    accessToken: join(dir, 'access-token'),
    log: join(dir, 'server.log'),
    out: join(dir, 'server.out'),
    data: join(dir, 'data'),
  };
}

/** Create the folder (0700). */
export function ensureStateDir(paths: StatePaths): void {
  mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
  try {
    if (process.platform !== 'win32') chmodSync(paths.dir, 0o700);
  } catch {
    /* not our folder to chmod (e.g. an existing shared dir): files are still 0600 */
  }
}

/** Record of the running server. */
export const ServerRecordSchema = z
  .object({
    version: z.literal(1),
    pid: z.number().int().min(1).max(4_194_304),
    port: z.number().int().min(1).max(65535),
    host: z.string().min(1).max(255),
    /** Link printed to the user (never holds the LAN access token, which is only printed). */
    url: z.string().regex(/^http:\/\/[^\s]{1,300}$/),
    instance: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
    startedAt: z.number().int().min(0),
    lan: z.boolean(),
    bridge: z.object({ port: z.number().int().min(0).max(65535), origins: z.array(z.string().max(300)).max(8) }).nullable(),
  })
  .strict();
/** Record of the running server. */
export type ServerRecord = z.infer<typeof ServerRecordSchema>;

/** Write a file atomically with mode 0600. */
export function writePrivate(file: string, text: string): void {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text, { mode: 0o600 });
  renameSync(tmp, file);
  try {
    if (process.platform !== 'win32') chmodSync(file, 0o600);
  } catch {
    /* best effort */
  }
}

/** Read the server record (null when absent, unreadable, oversized or invalid). */
export function readServerRecord(paths: StatePaths): ServerRecord | null {
  try {
    if (statSync(paths.server).size > 16 * 1024) return null;
    const parsed = ServerRecordSchema.safeParse(JSON.parse(readFileSync(paths.server, 'utf8')) as unknown);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Save the server record. */
export function writeServerRecord(paths: StatePaths, rec: ServerRecord): void {
  writePrivate(paths.server, `${JSON.stringify(ServerRecordSchema.parse(rec), null, 2)}\n`);
}

/** Remove the server record. */
export function clearServerRecord(paths: StatePaths): void {
  rmSync(paths.server, { force: true });
}

/** A fresh random secret (32 bytes, base64url: 43 characters). */
export function newSecret(): string {
  return randomBytes(32).toString('base64url');
}

const SECRET_RE = /^[A-Za-z0-9_-]{32,128}$/;

/** The per-install secret: read it, or create it (0600) on first use; a damaged file is replaced. */
export function loadOrCreateSecret(file: string): string {
  try {
    const text = readFileSync(file, 'utf8').trim();
    if (SECRET_RE.test(text)) return text;
  } catch {
    /* create below */
  }
  const s = newSecret();
  writePrivate(file, `${s}\n`);
  return s;
}

/** Read an existing secret file (null when absent or invalid). */
export function readSecret(file: string): string | null {
  try {
    const text = readFileSync(file, 'utf8').trim();
    return SECRET_RE.test(text) ? text : null;
  } catch {
    return null;
  }
}

/** True when a process with this pid exists (EPERM: exists but owned by someone else). */
export function pidAlive(pid: number, kill: (pid: number, sig: 0) => void = (p, s) => process.kill(p, s)): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Liveness of a recorded server. */
export type ServerLiveness =
  /** Health answers with our instance id. */
  | 'running'
  /** The process exists but health does not answer (starting, hung, or the pid was reused). */
  | 'unresponsive'
  /** The process is gone: the record is stale. */
  | 'stale';

/**
 * Classify a record: health with the matching instance id wins (the pid may
 * belong to a wrapper on some platforms); otherwise the pid decides.
 */
export function classify(rec: ServerRecord, health: { instance?: string } | null, alive: boolean): ServerLiveness {
  if (health && health.instance === rec.instance) return 'running';
  return alive ? 'unresponsive' : 'stale';
}

/** True when a file exists. */
export function exists(file: string): boolean {
  return existsSync(file);
}
