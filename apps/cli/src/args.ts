/**
 * `aether` command-line parsing (pure: no I/O, so every rule is unit-tested).
 *
 *   aether [start]  [--port N] [--host H --allow-lan] [--open] [--no-build|--rebuild]
 *                   [--origin https://studio.example]... [--bridge-port N] [--foreground]
 *   aether stop     [--force]
 *   aether status   [--json]
 *   aether logs     [-f|--follow] [-n|--lines N]
 *   aether login    [--device-auth] [--claude]
 *   aether logout   [--claude]
 *   aether pair
 *   aether doctor   [--json]
 *   aether help | --help | version | --version
 *
 * Global: `--state-dir <dir>` (or AETHER_STATE_DIR) for the pid, port, log and
 * secret files.
 */

/** Sub-commands. */
export const COMMANDS = ['start', 'stop', 'status', 'logs', 'login', 'logout', 'pair', 'doctor', 'help', 'version'] as const;
/** A sub-command. */
export type Command = (typeof COMMANDS)[number];

/** Default port of the local app (falls forward to the next free one). */
export const DEFAULT_PORT = 4280;
/** Default port of the bridge for hosted studios. */
export const DEFAULT_BRIDGE_PORT = 8790;

/** Parsed options. */
export interface CliOptions {
  command: Command;
  /** Explicit port (an explicit port that is taken is an error; the default falls forward). */
  port: number | null;
  host: string;
  allowLan: boolean;
  open: boolean;
  build: 'auto' | 'never' | 'always';
  stateDir: string | null;
  follow: boolean;
  lines: number;
  deviceAuth: boolean;
  /** `login` / `logout` target. */
  backend: 'codex' | 'claude';
  /** Hosted studio origins served by the bridge (enables the bridge). */
  origins: string[];
  bridgePort: number;
  /** Run the server in this terminal instead of detaching (debugging, containers). */
  foreground: boolean;
  json: boolean;
  force: boolean;
}

/** Result of {@link parseArgs}. */
export type ParseResult = { ok: true; options: CliOptions; warnings: string[] } | { ok: false; error: string };

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const HOST_RE = /^([A-Za-z0-9.-]{1,253}|[0-9a-fA-F:]{2,45})$/;

/** True for a loopback host name or address. */
export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.toLowerCase()) || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

/**
 * Normalize a hosted studio origin for the bridge: https only (loopback http
 * allowed for local testing), no path, credentials or wildcards.
 */
export function normalizeStudioOrigin(raw: string): string | null {
  if (raw.includes('*') || raw.length > 300) return null;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.username || u.password) return null;
  if (u.protocol === 'https:') return u.origin;
  if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return u.origin;
  return null;
}

function portValue(flag: string, v: string, min: number): number | string {
  if (!/^\d{1,5}$/.test(v)) return `${flag} must be a number`;
  const n = Number(v);
  if (n < min || n > 65535) return `${flag} must be ${min}–65535`;
  return n;
}

/** Parse `argv` (without node and script). */
export function parseArgs(argv: readonly string[], env: Readonly<Record<string, string | undefined>> = {}): ParseResult {
  const o: CliOptions = {
    command: 'start',
    port: null,
    host: '127.0.0.1',
    allowLan: false,
    open: false,
    build: 'auto',
    stateDir: env['AETHER_STATE_DIR'] && env['AETHER_STATE_DIR'] !== '' ? env['AETHER_STATE_DIR'] : null,
    follow: false,
    lines: 80,
    deviceAuth: false,
    backend: 'codex',
    origins: [],
    bridgePort: DEFAULT_BRIDGE_PORT,
    foreground: false,
    json: false,
    force: false,
  };
  const warnings: string[] = [];
  let sawCommand = false;
  let hostGiven = false;
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i] ?? '';
    // --flag=value form
    const eq = raw.startsWith('--') ? raw.indexOf('=') : -1;
    const flag = eq > 0 ? raw.slice(0, eq) : raw;
    const inline = eq > 0 ? raw.slice(eq + 1) : undefined;
    const value = (): string | null => {
      if (inline !== undefined) return inline;
      const v = argv[i + 1];
      if (v === undefined || (v.startsWith('-') && v.length > 1)) return null;
      i++;
      return v;
    };
    if (!flag.startsWith('-')) {
      if (sawCommand) return { ok: false, error: `unexpected argument "${flag.slice(0, 40)}"` };
      if (!(COMMANDS as readonly string[]).includes(flag)) return { ok: false, error: `unknown command "${flag.slice(0, 40)}" (try: aether help)` };
      o.command = flag as Command;
      sawCommand = true;
      continue;
    }
    switch (flag) {
      case '--port':
      case '-p': {
        const v = value();
        if (v === null) return { ok: false, error: `${flag} needs a value` };
        const n = portValue('--port', v, 1);
        if (typeof n === 'string') return { ok: false, error: n };
        o.port = n;
        break;
      }
      case '--bridge-port': {
        const v = value();
        if (v === null) return { ok: false, error: '--bridge-port needs a value' };
        const n = portValue('--bridge-port', v, 0);
        if (typeof n === 'string') return { ok: false, error: n };
        o.bridgePort = n;
        break;
      }
      case '--host': {
        const v = value();
        if (v === null || !HOST_RE.test(v)) return { ok: false, error: '--host needs a host name or IP address' };
        o.host = v;
        hostGiven = true;
        break;
      }
      case '--allow-lan':
        o.allowLan = true;
        break;
      case '--open':
        o.open = true;
        break;
      case '--no-open':
        o.open = false;
        break;
      case '--no-build':
        o.build = 'never';
        break;
      case '--rebuild':
        o.build = 'always';
        break;
      case '--state-dir': {
        const v = value();
        if (v === null || v.length > 1024) return { ok: false, error: '--state-dir needs a folder' };
        o.stateDir = v;
        break;
      }
      case '--follow':
      case '-f':
        o.follow = true;
        break;
      case '--lines':
      case '-n': {
        const v = value();
        if (v === null || !/^\d{1,5}$/.test(v) || Number(v) < 1) return { ok: false, error: '--lines needs a positive number' };
        o.lines = Math.min(10_000, Number(v));
        break;
      }
      case '--device-auth':
        o.deviceAuth = true;
        break;
      case '--claude':
        o.backend = 'claude';
        break;
      case '--codex':
        o.backend = 'codex';
        break;
      case '--origin': {
        const v = value();
        if (v === null) return { ok: false, error: '--origin needs a URL' };
        const origin = normalizeStudioOrigin(v);
        if (!origin) return { ok: false, error: `--origin must be an https:// address (got "${v.slice(0, 80)}")` };
        if (!o.origins.includes(origin)) o.origins.push(origin);
        if (o.origins.length > 8) return { ok: false, error: 'at most 8 --origin values' };
        break;
      }
      case '--foreground':
        o.foreground = true;
        break;
      case '--json':
        o.json = true;
        break;
      case '--force':
        o.force = true;
        break;
      case '--help':
      case '-h':
        o.command = 'help';
        break;
      case '--version':
      case '-v':
        o.command = 'version';
        break;
      default:
        return { ok: false, error: `unknown option "${flag.slice(0, 40)}" (try: aether help)` };
    }
  }
  if (hostGiven && !isLoopbackHost(o.host)) {
    if (!o.allowLan) return { ok: false, error: `refusing to listen on ${o.host}: other devices could reach it. Add --allow-lan to confirm (an access token is then required).` };
    warnings.push(`Listening on ${o.host}: devices on your network can open Aether with the access link below. Local AI (Codex / Claude Code) still only answers on this computer.`);
  } else if (o.allowLan && !hostGiven) {
    return { ok: false, error: '--allow-lan needs --host <address> (for example --host 0.0.0.0)' };
  }
  return { ok: true, options: o, warnings };
}

/** Help text. */
export const USAGE = `Aether: speak a world into being. Runs on this computer and uses your own AI login.

Usage: aether [command] [options]

Commands:
  start            Build the studio if needed, start Aether in the background and print its link (default)
  stop             Stop the background server
  status           Show whether Aether is running, and its link
  logs [-f]        Show the server log (-f follows it, -n N lines)
  login            Sign in to Codex with your own ChatGPT account (--device-auth for a code; --claude for Claude Code)
  logout           Sign out of Codex (--claude for Claude Code)
  pair             Print a pairing code and link for a hosted copy of the studio (needs start --origin)
  doctor           Check Node, the Codex / Claude Code CLIs, the port and disk space
  help, version

Start options:
  --port N         Port (default ${DEFAULT_PORT}, or the next free one)
  --open           Open the link in your browser
  --no-build       Never build the studio (fail if it is missing); --rebuild always builds
  --origin URL     Also act as the bridge for a hosted studio at URL (https), so it can use this computer's Codex login
  --bridge-port N  Bridge port (default ${DEFAULT_BRIDGE_PORT})
  --host H --allow-lan
                   Listen on another address (e.g. 0.0.0.0); an access token is then required
  --foreground     Run in this terminal instead of the background
  --state-dir DIR  Where the pid, port, log and secret files live (default: your user state folder)
`;
