/**
 * Start the bridge: resolve the CLIs, bind 127.0.0.1 (8790, or any free port
 * when taken / `--port 0`), wire pairing, probes and backends.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { probeClaude, probeCodex, cached } from './backends/status';
import type { BridgeConfig } from './config';
import { createHeadlessBackends, resolveCommands } from './headless';
import { Pairing } from './pairing';
import { createBridgeHandler, type BridgeLogger } from './server';

/** A listening bridge. */
export interface RunningBridge {
  server: Server;
  port: number;
  url: string;
  pairing: Pairing;
  close(): Promise<void>;
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (e: NodeJS.ErrnoException): void => {
      server.off('listening', onListening);
      reject(e);
    };
    const onListening = (): void => {
      server.off('error', onError);
      resolve((server.address() as AddressInfo).port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

/** Start listening; `onCode` receives every pairing code (rotations included). */
export async function startBridge(config: BridgeConfig, opts: { logger?: BridgeLogger; onCode?: (code: string) => void } = {}): Promise<RunningBridge> {
  const commands = resolveCommands({ codexPath: config.codexPath, claudePath: config.claudePath });
  const backends = createHeadlessBackends({ codexPath: config.codexPath, claudePath: config.claudePath, timeoutMs: config.timeoutMs }, commands);
  const probeDeps = { codexCommand: commands.codex, claudeCommand: commands.claude };
  const status = cached(async () => Promise.all([probeCodex(probeDeps), probeClaude(probeDeps)]), 30_000);
  const pairing = new Pairing(opts.onCode);
  let boundPort = config.port;
  const server = createServer(createBridgeHandler({ config, port: () => boundPort, pairing, backends, status, ...(opts.logger ? { logger: opts.logger } : {}) }));
  server.requestTimeout = config.timeoutMs + 60_000;
  server.headersTimeout = 30_000;
  server.keepAliveTimeout = 5_000;
  try {
    boundPort = await listen(server, config.port);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE' || config.port === 0) throw e;
    boundPort = await listen(server, 0);
  }
  return {
    server,
    port: boundPort,
    url: `http://127.0.0.1:${boundPort}`,
    pairing,
    close: () => new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };
}
