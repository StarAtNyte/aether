/**
 * E2E environment: locate a Chromium binary and run the Aether server in
 * offline mock mode serving the built studio. Everything started here is
 * owned by the caller and must be stopped in a `finally`.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox } from 'playwright';

/** Repository root (tests/e2e/support → ../../..). */
export const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
/** Built studio directory served by the server. */
export const STUDIO_DIST = join(REPO_ROOT, 'apps/studio/dist');

const HEALTH_TIMEOUT_MS = 30_000;

/**
 * Chromium flags for GPU coverage on GPU-less machines. The first three
 * enable WebGPU and software GL; the last two route WebGPU to SwiftShader's
 * Vulkan, without which headless Chromium returns a null adapter and the
 * studio (correctly) falls back to WebGL2.
 */
export const CHROME_ARGS: readonly string[] = ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader'];

/**
 * Resolve the Chromium executable: `AETHER_E2E_CHROME`, then Playwright's
 * pinned build, then any cached Playwright Chromium, then system Chrome.
 */
export function findChrome(): string {
  const fromEnv = process.env['AETHER_E2E_CHROME'];
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const pinned = chromium.executablePath();
  if (existsSync(pinned)) return pinned;
  const cache = join(homedir(), '.cache/ms-playwright');
  if (existsSync(cache)) {
    const builds = readdirSync(cache)
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)));
    for (const d of builds) {
      for (const rel of ['chrome-linux64/chrome', 'chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-win/chrome.exe']) {
        const p = join(cache, d, rel);
        if (existsSync(p)) return p;
      }
    }
  }
  for (const p of ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']) if (existsSync(p)) return p;
  throw new Error('No Chromium found. Run `npx playwright install chromium` or set AETHER_E2E_CHROME.');
}

/**
 * Firefox preferences for headless runs on GPU-less machines: force WebGL on
 * (software rasterizer) so the studio renders through its WebGL2 backend.
 */
export const FIREFOX_PREFS: Readonly<Record<string, boolean | number | string>> = Object.freeze({
  'webgl.force-enabled': true,
  'webgl.disabled': false,
  'webgl.enable-webgl2': true,
});

/**
 * Resolve the Firefox executable: `AETHER_E2E_FIREFOX`, then Playwright's
 * pinned build, then any cached Playwright Firefox, then a system Firefox.
 */
export function findFirefox(): string {
  const fromEnv = process.env['AETHER_E2E_FIREFOX'];
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const pinned = firefox.executablePath();
  if (existsSync(pinned)) return pinned;
  const cache = join(homedir(), '.cache/ms-playwright');
  if (existsSync(cache)) {
    const builds = readdirSync(cache)
      .filter((d) => /^firefox-\d+$/.test(d))
      .sort((a, b) => Number(b.slice(8)) - Number(a.slice(8)));
    for (const d of builds) {
      const p = join(cache, d, 'firefox/firefox');
      if (existsSync(p)) return p;
    }
  }
  for (const p of ['/usr/bin/firefox', '/usr/lib/firefox/firefox']) if (existsSync(p)) return p;
  throw new Error('No Firefox found. Run `npx playwright install firefox` or set AETHER_E2E_FIREFOX.');
}

/** Ask the OS for a free TCP port on localhost. */
async function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const srv = createServer();
    srv.once('error', fail);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      srv.close(() => (port > 0 ? ok(port) : fail(new Error('no free port'))));
    });
  });
}

/** A running server owned by the test. */
export interface TestServer {
  url: string;
  stop(): Promise<void>;
}

/**
 * Start the Aether server (mock LLM, static studio) on a free port, or reuse
 * `AETHER_E2E_URL` when set (then `stop()` is a no-op).
 */
export async function startServer(log: (line: string) => void): Promise<TestServer> {
  const external = process.env['AETHER_E2E_URL'];
  if (external) return { url: external.replace(/\/+$/, ''), stop: async () => undefined };
  if (!existsSync(join(STUDIO_DIST, 'index.html'))) throw new Error('apps/studio/dist is missing — run `npm run build` first.');

  const port = await freePort();
  const url = `http://localhost:${port}`;
  const dataDir = mkdtempSync(join(tmpdir(), 'aether-e2e-'));
  const child: ChildProcess = spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/main.ts'], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      NODE_ENV: 'production',
      SERVE_STATIC: 'true',
      AETHER_PROVIDER: 'mock',
      ANTHROPIC_API_KEY: '',
      OPENAI_API_KEY: '',
      ALLOWED_ORIGINS: url,
      DATA_DIR: dataDir,
      LOG_LEVEL: 'warn',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (d: Buffer) => log(`[server] ${d.toString().trim()}`));
  child.stderr?.on('data', (d: Buffer) => log(`[server] ${d.toString().trim()}`));

  const stop = async (): Promise<void> => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise<void>((ok) => child.once('exit', () => ok()));
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 5_000);
      await exited;
      clearTimeout(timer);
    }
    rmSync(dataDir, { recursive: true, force: true });
  };

  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return { url, stop };
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  await stop();
  throw new Error('Aether server did not become healthy');
}
