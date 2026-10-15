/**
 * `aether`: one command to run the Aether studio on this computer with the
 * user's own AI login. See {@link USAGE} and docs/CONTRACTS.md ("Local app").
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, networkInterfaces } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PORT, USAGE, isLoopbackHost, parseArgs, type CliOptions } from './args';
import { cliStatus, findCli, loginEnv, runInteractive, signInArgs, signOutArgs } from './accounts';
import { buildReason } from './build';
import { runDoctor } from './doctor';
import { follow, formatLogLine, lastLines, readTail } from './logs';
import { pickPort } from './ports';
import { crashTail, inspect, newInstanceId, serverEnv, serverUrl, spawnServer, stopServer, waitHealthy } from './server';
import { clearServerRecord, ensureStateDir, loadOrCreateSecret, newSecret, readSecret, resolveStateDir, statePaths, writePrivate, writeServerRecord, type StatePaths } from './state';
import { adminPost, openBrowser } from './system';

/** Repository root (apps/cli/src → ../../..). */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const out = (s = ''): void => {
  process.stdout.write(`${s}\n`);
};
const err = (s: string): void => {
  process.stderr.write(`${s}\n`);
};

function version(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** Non-internal IPv4 addresses (the LAN link), or the explicit host. */
function lanAddresses(host: string): string[] {
  if (isLoopbackHost(host)) return [];
  if (host !== '0.0.0.0' && host !== '::') return [host];
  const list: string[] = [];
  for (const addrs of Object.values(networkInterfaces())) for (const a of addrs ?? []) if (a.family === 'IPv4' && !a.internal) list.push(a.address);
  return list.slice(0, 8);
}

/** Build the studio with Vite (no shell: node runs Vite's own bin). */
function buildStudio(): Promise<boolean> {
  const studio = join(REPO_ROOT, 'apps/studio');
  let viteBin: string;
  try {
    const require = createRequire(join(studio, 'package.json'));
    const pkgFile = require.resolve('vite/package.json');
    const pkg = JSON.parse(readFileSync(pkgFile, 'utf8')) as { bin?: Record<string, string> | string };
    const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.['vite'];
    if (!bin) return Promise.resolve(false);
    viteBin = join(dirname(pkgFile), bin);
  } catch {
    err('Vite is not installed. Run "npm ci" in the Aether folder first.');
    return Promise.resolve(false);
  }
  return new Promise((done) => {
    const child = spawn(process.execPath, [viteBin, 'build', '--logLevel', 'warn'], { cwd: studio, stdio: 'inherit', shell: false, windowsHide: true });
    child.once('error', () => done(false));
    child.once('exit', (code) => done(code === 0));
  });
}

async function printPairing(paths: StatePaths, port: number): Promise<void> {
  const secret = readSecret(paths.secret);
  if (!secret) return;
  const r = await adminPost(port, '/api/local/bridge/pair', secret);
  const body = r?.status === 200 && typeof r.body === 'object' && r.body !== null ? (r.body as { code?: unknown; links?: unknown; url?: unknown }) : null;
  if (!body || typeof body.code !== 'string' || !Array.isArray(body.links)) {
    err('  Could not get a pairing code from the bridge (see: aether logs).');
    return;
  }
  out(`  Bridge for hosted studios: ${typeof body.url === 'string' ? body.url : ''}`);
  out(`  Pairing code: ${body.code}  (Settings → AI connection → Local bridge)`);
  for (const l of body.links) if (typeof l === 'string') out(`  Or open: ${l}`);
}

async function signInHint(): Promise<void> {
  const codex = await cliStatus('codex');
  if (codex.loggedIn) out(`  AI: Codex signed in${codex.account ? ` (${codex.account})` : ''}.`);
  else if (codex.installed) out('  AI: Codex is not signed in. Sign in from the studio, or run: aether login');
  else out('  AI: Codex CLI not found. Install it (npm i -g @openai/codex) and sign in, or use the studio offline.');
}

async function cmdStart(o: CliOptions, paths: StatePaths, warnings: readonly string[]): Promise<number> {
  ensureStateDir(paths);
  const existing = await inspect(paths);
  if (existing?.state === 'running') {
    out(`Aether is already running: ${existing.rec.url}`);
    if (o.open) openBrowser(existing.rec.url);
    if (existing.rec.bridge) await printPairing(paths, existing.rec.port);
    return 0;
  }
  if (existing?.state === 'unresponsive') {
    err(`Aether (pid ${existing.rec.pid}) is not answering. Run "aether stop" (or "aether stop --force"), then start again.`);
    return 1;
  }
  if (existing?.state === 'stale') clearServerRecord(paths);

  const reason = buildReason(REPO_ROOT, join(REPO_ROOT, 'apps/studio/dist/index.html'));
  if (o.build === 'always' || (o.build === 'auto' && reason !== null)) {
    out(reason === 'missing' ? 'Building the studio (first run, about a minute)…' : 'Building the studio (sources changed)…');
    if (!(await buildStudio())) {
      err('The studio build failed. See the output above; "aether doctor" checks the basics.');
      return 1;
    }
  } else if (reason === 'missing') {
    err('The studio is not built and --no-build was given. Run "aether start" without --no-build.');
    return 1;
  }

  const lan = lanAddresses(o.host);
  const picked = await pickPort({ preferred: o.port ?? DEFAULT_PORT, explicit: o.port !== null, host: o.host === '::' ? '::' : o.host === 'localhost' ? '127.0.0.1' : o.host });
  if ('error' in picked) {
    err(`Cannot start: ${picked.error}.`);
    return 1;
  }
  const port = picked.port;
  loadOrCreateSecret(paths.secret);
  let accessToken: string | null = null;
  if (o.allowLan) {
    accessToken = newSecret();
    writePrivate(paths.accessToken, `${accessToken}\n`);
  }
  const instance = newInstanceId();
  const env = serverEnv(process.env, { root: REPO_ROOT, paths, port, host: o.host, instance, lanAddresses: lan, accessTokenFile: accessToken ? paths.accessToken : null, origins: o.origins, bridgePort: o.bridgePort });
  const url = serverUrl(o.host, port, lan);
  for (const w of warnings) err(`Warning: ${w}`);

  let spawned;
  try {
    spawned = spawnServer(REPO_ROOT, paths, env, o.foreground);
  } catch (e) {
    err(`Cannot start the server: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
  writeServerRecord(paths, { version: 1, pid: spawned.pid, port, host: o.host, url, instance, startedAt: Date.now(), lan: o.allowLan, bridge: o.origins.length > 0 ? { port: o.bridgePort, origins: [...o.origins] } : null });
  const ready = await waitHealthy(port, instance, spawned.child);
  if (ready !== 'ok') {
    clearServerRecord(paths);
    if (ready === 'timeout') {
      const { killServer } = await import('./system');
      killServer(spawned.pid, 'SIGTERM');
    }
    err(ready === 'exited' ? 'The server stopped during startup:' : 'The server did not become ready in time:');
    for (const l of crashTail(paths)) err(`  ${formatLogLine(l)}`);
    for (const l of lastLines(readTail(paths.log, 64 * 1024), 10)) err(`  ${formatLogLine(l)}`);
    return 1;
  }

  const link = accessToken ? `${url}/?access=${accessToken}` : url;
  out('');
  out(`  Aether is running: ${link}`);
  if (accessToken) out('  Anyone on your network with this link can open the studio. Stop it with: aether stop');
  await signInHint();
  if (o.origins.length > 0) await printPairing(paths, port);
  out(o.foreground ? '  Press Ctrl+C to stop.' : '  Stop with: aether stop · Logs: aether logs -f');
  out('');
  if (o.open) openBrowser(link);
  if (o.foreground) {
    const stop = (): void => {
      spawned.child.kill('SIGTERM');
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    const code = await new Promise<number>((r) => spawned.child.once('exit', (c) => r(c ?? 0)));
    clearServerRecord(paths);
    return code;
  }
  return 0;
}

async function cmdStatus(o: CliOptions, paths: StatePaths): Promise<number> {
  const found = await inspect(paths);
  if (o.json) {
    out(JSON.stringify(found ? { state: found.state, url: found.rec.url, pid: found.rec.pid, port: found.rec.port, startedAt: found.rec.startedAt, bridge: found.rec.bridge, stateDir: paths.dir } : { state: 'stopped', stateDir: paths.dir }));
    return found?.state === 'running' ? 0 : 3;
  }
  if (!found || found.state === 'stale') {
    if (found) clearServerRecord(paths);
    out('Aether is not running. Start it with: aether start');
    return 3;
  }
  if (found.state === 'unresponsive') {
    out(`Aether (pid ${found.rec.pid}) is not answering. Try: aether stop`);
    return 1;
  }
  const mins = Math.max(0, Math.round((Date.now() - found.rec.startedAt) / 60_000));
  out(`Aether is running: ${found.rec.url}`);
  out(`  pid ${found.rec.pid} · up ${mins} min · logs ${paths.log}`);
  if (found.rec.bridge) out(`  bridge for ${found.rec.bridge.origins.join(', ')} (aether pair)`);
  return 0;
}

async function cmdStop(o: CliOptions, paths: StatePaths): Promise<number> {
  const r = await stopServer(paths, readSecret(paths.secret), o.force, out);
  switch (r) {
    case 'stopped':
      out('Aether stopped.');
      return 0;
    case 'not-running':
      out('Aether is not running.');
      return 0;
    case 'stale-cleaned':
      out('Aether was not running (cleaned up a stale record).');
      return 0;
    case 'refused':
      return 1;
    case 'failed':
      err('Aether could not be stopped. Check the process list.');
      return 1;
  }
}

async function cmdLogs(o: CliOptions, paths: StatePaths): Promise<number> {
  const text = readTail(paths.log);
  if (text === '' && !o.follow) {
    out(`No log yet (${paths.log}).`);
    return 0;
  }
  for (const l of lastLines(text, o.lines)) out(formatLogLine(l));
  if (!o.follow) return 0;
  const ctrl = new AbortController();
  process.once('SIGINT', () => ctrl.abort());
  await follow(paths.log, (l) => out(formatLogLine(l)), ctrl.signal);
  return 0;
}

async function cmdLogin(o: CliOptions): Promise<number> {
  const name = o.backend === 'codex' ? 'Codex' : 'Claude Code';
  const command = findCli(o.backend);
  if (!command) {
    err(o.backend === 'codex' ? 'The Codex CLI is not installed. Install it with: npm i -g @openai/codex' : 'The Claude Code CLI is not installed (https://docs.claude.com/claude-code).');
    return 1;
  }
  const st = await cliStatus(o.backend);
  if (st.loggedIn) {
    out(`${name} is already signed in${st.account ? ` (${st.account})` : ''}: ${st.detail}`);
    out(`To use another account: aether logout${o.backend === 'claude' ? ' --claude' : ''}, then aether login${o.backend === 'claude' ? ' --claude' : ''}.`);
    return 0;
  }
  out(`Signing in to ${name} with your own account${o.backend === 'codex' && o.deviceAuth ? ' (device code)' : ''}…`);
  const code = await runInteractive(command, signInArgs(o.backend, o.deviceAuth), loginEnv());
  if (code !== 0) {
    err(code === 127 ? `${name} could not be started.` : `${name} sign-in did not complete.${o.backend === 'codex' && !o.deviceAuth ? ' On a machine without a browser, try: aether login --device-auth' : ''}`);
    return 1;
  }
  const after = await cliStatus(o.backend);
  out(after.loggedIn ? `Signed in${after.account ? ` (${after.account})` : ''}. Reload the studio to use it.` : 'The sign-in finished, but the CLI does not report a login yet.');
  return after.loggedIn ? 0 : 1;
}

async function cmdLogout(o: CliOptions): Promise<number> {
  const command = findCli(o.backend);
  if (!command) {
    out('Nothing to sign out of: the CLI is not installed.');
    return 0;
  }
  const code = await runInteractive(command, signOutArgs(o.backend), loginEnv());
  out(code === 0 ? 'Signed out.' : 'Sign-out did not complete.');
  return code === 0 ? 0 : 1;
}

async function cmdPair(paths: StatePaths): Promise<number> {
  const found = await inspect(paths);
  if (found?.state !== 'running') {
    err('Aether is not running. Start it with: aether start --origin https://<hosted studio>');
    return 1;
  }
  if (!found.rec.bridge) {
    err('The bridge is off. Restart with: aether stop && aether start --origin https://<hosted studio>');
    return 1;
  }
  await printPairing(paths, found.rec.port);
  return 0;
}

async function cmdDoctor(o: CliOptions, paths: StatePaths): Promise<number> {
  const checks = await runDoctor(REPO_ROOT, paths);
  if (o.json) out(JSON.stringify(checks));
  else {
    for (const c of checks) {
      out(`${c.status === 'ok' ? ' ok ' : c.status === 'warn' ? 'warn' : 'FAIL'}  ${c.name.padEnd(16)} ${c.detail}`);
      if (c.fix && c.status !== 'ok') out(`      ${''.padEnd(16)} → ${c.fix}`);
    }
  }
  return checks.some((c) => c.status === 'fail') ? 1 : 0;
}

/** `aether mcp`: serve the MCP protocol on stdio (stdout belongs to the protocol; nothing else may print there). */
async function cmdMcp(o: CliOptions, paths: StatePaths): Promise<number> {
  const { runStdioServer } = await import('./mcp/server');
  const playerDir = o.playerDir ?? join(REPO_ROOT, 'apps/studio/dist');
  err(`aether mcp: project folder ${resolve(o.projectDir ?? 'aether-project')} (the only place this server reads or writes)`);
  return runStdioServer(
    { projectDir: o.projectDir ?? 'aether-project', provider: o.provider, stateDir: paths.dir, playerDir, log: (l) => err(`aether mcp: ${l}`) },
    version(),
  );
}

/** Run the CLI; resolves to the exit code. */
export async function main(argv: readonly string[]): Promise<number> {
  const parsed = parseArgs(argv, process.env);
  if (!parsed.ok) {
    err(`aether: ${parsed.error}`);
    return 2;
  }
  const o = parsed.options;
  if (o.command === 'help') {
    out(USAGE);
    return 0;
  }
  if (o.command === 'version') {
    out(version());
    return 0;
  }
  const paths = statePaths(resolveStateDir(process.env, process.platform, homedir(), o.stateDir));
  switch (o.command) {
    case 'start':
      return cmdStart(o, paths, parsed.warnings);
    case 'stop':
      return cmdStop(o, paths);
    case 'status':
      return cmdStatus(o, paths);
    case 'logs':
      return cmdLogs(o, paths);
    case 'login':
      return cmdLogin(o);
    case 'logout':
      return cmdLogout(o);
    case 'pair':
      return cmdPair(paths);
    case 'doctor':
      return cmdDoctor(o, paths);
    case 'mcp':
      return cmdMcp(o, paths);
  }
}
