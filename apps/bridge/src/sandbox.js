/**
 * Isolation for headless CLI runs: an allowlisted environment (no API keys,
 * tokens or other secrets are ever passed through) and a fresh, empty,
 * private working directory that is deleted afterwards.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
/**
 * Variables a CLI needs to find its binary, its own login and a locale.
 * Everything else (API keys, cloud credentials, tokens, proxies…) is dropped.
 */
export const ENV_ALLOWLIST = [
    'HOME', 'USER', 'LOGNAME', 'PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'TMPDIR', 'TEMP', 'TMP',
    'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME', 'XDG_RUNTIME_DIR',
    // CLI homes (where the subscription login lives)
    'CODEX_HOME', 'CLAUDE_CONFIG_DIR',
    // Windows essentials
    'SystemRoot', 'SYSTEMROOT', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOMEDRIVE', 'HOMEPATH', 'PATHEXT', 'ComSpec',
];
/** Names that must never be forwarded, even if allowlisted by mistake. */
const SECRET_NAME = /KEY|TOKEN|SECRET|PASSW|CREDENTIAL|AUTH|COOKIE|SESSION/i;
/** Build the restricted environment for a CLI child process. */
export function restrictedEnv(source = process.env, extra = {}) {
    const env = {};
    for (const name of ENV_ALLOWLIST) {
        const v = source[name];
        if (typeof v === 'string' && v.length > 0 && v.length < 8192 && !SECRET_NAME.test(name))
            env[name] = v;
    }
    for (const [k, v] of Object.entries(extra))
        if (!SECRET_NAME.test(k))
            env[k] = v;
    return env;
}
/** Run `fn` inside a fresh private temp directory, always removed afterwards. */
export async function withTempDir(fn, root = tmpdir()) {
    const dir = await mkdtemp(join(root, 'aether-bridge-'));
    try {
        return await fn(dir);
    }
    finally {
        await rm(dir, { recursive: true, force: true, maxRetries: 2 }).catch(() => undefined);
    }
}
