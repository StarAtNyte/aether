/**
 * Start the bridge: resolve the CLIs, bind 127.0.0.1 (8790, or any free port
 * when taken / `--port 0`), wire pairing, probes and backends.
 */
import { createServer } from 'node:http';
import { probeClaude, probeCodex, cached } from './backends/status';
import { createHeadlessBackends, resolveCommands } from './headless';
import { LoginManager } from './auth';
import { Pairing } from './pairing';
import { createWorkerSessionStore } from './worker/text-backend';
import { createBridgeHandler } from './server';
function listen(server, port) {
    return new Promise((resolve, reject) => {
        const onError = (e) => {
            server.off('listening', onListening);
            reject(e);
        };
        const onListening = () => {
            server.off('error', onError);
            resolve(server.address().port);
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, '127.0.0.1');
    });
}
/** Start listening; `onCode` receives every pairing code (rotations included). */
export async function startBridge(config, opts = {}) {
    const commands = resolveCommands({ codexPath: config.codexPath, claudePath: config.claudePath });
    const sessions = createWorkerSessionStore();
    const backends = createHeadlessBackends({ codexPath: config.codexPath, claudePath: config.claudePath, timeoutMs: config.timeoutMs, sessions }, commands);
    const probeDeps = { codexCommand: commands.codex, claudeCommand: commands.claude };
    let status = cached(async () => Promise.all([probeCodex(probeDeps), probeClaude(probeDeps)]), 30_000);
    const login = new LoginManager({ codexCommand: commands.codex, claudeCommand: commands.claude });
    let lastAuth = 0;
    const onAuthChange = () => {
        const s = login.status();
        const stamp = s?.finished ? s.startedAt : Date.now();
        if (stamp === lastAuth)
            return;
        lastAuth = stamp;
        status = cached(async () => Promise.all([probeCodex(probeDeps), probeClaude(probeDeps)]), 30_000);
    };
    const pairing = new Pairing(opts.onCode);
    let boundPort = config.port;
    const server = createServer(createBridgeHandler({ config, port: () => boundPort, pairing, backends, status: () => status(), login, sessions, onAuthChange, ...(opts.logger ? { logger: opts.logger } : {}), ...(opts.publish ? { publish: opts.publish } : {}) }));
    server.requestTimeout = config.timeoutMs + 60_000;
    server.headersTimeout = 30_000;
    server.keepAliveTimeout = 5_000;
    try {
        boundPort = await listen(server, config.port);
    }
    catch (e) {
        if (e.code !== 'EADDRINUSE' || config.port === 0)
            throw e;
        boundPort = await listen(server, 0);
    }
    return {
        server,
        port: boundPort,
        url: `http://127.0.0.1:${boundPort}`,
        pairing,
        close: () => new Promise((resolve) => {
            login.dispose();
            sessions.clear();
            server.closeAllConnections();
            server.close(() => resolve());
        }),
    };
}
