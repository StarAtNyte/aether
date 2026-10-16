/**
 * Bridge configuration from command-line flags and environment variables.
 *
 *   --port <n>          listen port (default 8790; 0 = any free port)
 *   --origin <url>      extra allowed studio origin (repeatable; or AETHER_BRIDGE_ORIGINS=a,b)
 *   --studio <url>      studio URL used in the printed deep link (default http://localhost:5173)
 *   --timeout <s>       per-request timeout of a headless run (default 240)
 *   --codex <path>      codex binary (default: "codex" on PATH, else the SDK's bundled CLI)
 *   --claude <path>     claude binary (default: "claude" on PATH)
 */
import { BRIDGE_DEFAULT_PORT } from '@aether/agent';
/** Local studio origins allowed by default (dev server, preview, production server). */
export const DEFAULT_ORIGINS = [
    'http://localhost:5173', 'http://127.0.0.1:5173',
    'http://localhost:4173', 'http://127.0.0.1:4173',
    'http://localhost:8787', 'http://127.0.0.1:8787',
];
function isLoopbackHost(host) {
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}
/**
 * Normalize an allowed origin. Non-loopback origins must be HTTPS. Wildcards,
 * paths, credentials and non-HTTP schemes are rejected (null).
 */
export function normalizeOrigin(raw) {
    let u;
    try {
        u = new URL(raw.trim());
    }
    catch {
        return null;
    }
    if (u.username || u.password || raw.includes('*'))
        return null;
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && isLoopbackHost(u.hostname)))
        return null;
    return u.origin;
}
/** Parse flags + env. Throws an Error with a usage message on invalid input. */
export function parseBridgeConfig(argv, env = process.env) {
    const origins = new Set(DEFAULT_ORIGINS);
    let port = BRIDGE_DEFAULT_PORT;
    let studioUrl = 'http://localhost:5173';
    let timeoutMs = 240_000;
    let codexPath;
    let claudePath;
    const extra = (env['AETHER_BRIDGE_ORIGINS'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        const value = argv[i + 1];
        const need = () => {
            if (value === undefined || value.startsWith('--'))
                throw new Error(`${flag} needs a value`);
            i++;
            return value;
        };
        switch (flag) {
            case '--port': {
                const n = Number(need());
                if (!Number.isInteger(n) || n < 0 || n > 65535)
                    throw new Error('--port must be 0–65535');
                port = n;
                break;
            }
            case '--origin':
                extra.push(need());
                break;
            case '--studio':
                studioUrl = need();
                break;
            case '--timeout': {
                const s = Number(need());
                if (!Number.isFinite(s) || s < 10 || s > 1800)
                    throw new Error('--timeout must be 10–1800 seconds');
                timeoutMs = Math.round(s * 1000);
                break;
            }
            case '--codex':
                codexPath = need();
                break;
            case '--claude':
                claudePath = need();
                break;
            case '--help':
            case '-h':
                throw new Error('usage');
            default:
                throw new Error(`unknown flag ${String(flag)}`);
        }
    }
    for (const o of extra) {
        const n = normalizeOrigin(o);
        if (!n)
            throw new Error(`invalid origin "${o}" (use https://host, or http://localhost:<port>)`);
        origins.add(n);
    }
    const studio = normalizeOrigin(studioUrl);
    if (!studio)
        throw new Error(`invalid --studio URL "${studioUrl}"`);
    origins.add(studio);
    return { port, origins: [...origins], studioUrl: studioUrl.replace(/\/+$/, ''), timeoutMs, maxBodyBytes: 16 * 1024 * 1024, maxWaiting: 4, codexPath, claudePath };
}
/** Usage text. */
export const USAGE = `Aether Bridge — use your Codex or Claude Code subscription from the Aether studio.

Usage: npm run bridge -- [--port 8790] [--origin https://your-studio.example] [--studio URL] [--timeout 240]

The bridge listens on 127.0.0.1 only, prints a one-time pairing code, and runs
the headless CLIs with every tool disabled in a throwaway directory.`;
