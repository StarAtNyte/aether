/**
 * `aether mcp`: the Aether loop as a Model Context Protocol server, so other
 * agents (Claude Code, Codex, editors) can drive it. Stdio transport; stdout
 * carries only protocol messages, diagnostics go to stderr.
 *
 * Safety model: the client is untrusted. It can read and write only the
 * project folder (never by path), cannot reach the network (the server's
 * only outgoing connection is to the Aether server on this computer's
 * loopback, when logged in), and every call is size-checked and time-capped.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { registerResources } from './resources';
import { registerTools } from './tools';
import { AetherSession, type SessionOptions } from './session';

/** Name reported to clients. */
export const MCP_SERVER_NAME = 'aether';

const INSTRUCTIONS =
  'Aether builds 3D worlds, games and buildings from plain language and proves they work. Typical loop: create_world, then verify (physics unit tests) and playtest (a bot plays it), fix with edit or apply_patch, look with render_still, ship with export. Read the aether://guide resource first; aether://schema/patch lists every patch op. Everything is undoable with undo.';

/** Build the MCP server over an open session. */
export function createAetherMcpServer(session: AetherSession, version = '0.1.0'): McpServer {
  const server = new McpServer({ name: MCP_SERVER_NAME, version }, { instructions: INSTRUCTIONS, capabilities: { logging: {} } });
  registerTools(server, session);
  registerResources(server, session);
  return server;
}

/** Open a session and connect it to `transport` (tests pass an in-memory one). */
export async function startMcpServer(opts: SessionOptions, transport: Transport, version?: string): Promise<{ server: McpServer; session: AetherSession; close(): Promise<void> }> {
  const session = await AetherSession.open(opts);
  const server = createAetherMcpServer(session, version);
  await server.connect(transport);
  return {
    server,
    session,
    async close() {
      await server.close();
      session.dispose();
    },
  };
}

/** What `serveUntilClosed` listens to besides the transport (the process, in production). */
export interface CloseSignals {
  /** The client's input stream; its end means the client went away. */
  input: NodeJS.ReadableStream;
  /** Where SIGINT/SIGTERM arrive; omitted in tests. */
  signals?: Pick<NodeJS.Process, 'once' | 'off'>;
}

/**
 * Serve over `transport` until the client disconnects, the input ends or a
 * signal arrives; resolves to the exit code. Shutdown runs exactly once:
 * closing the server closes the transport, which fires `onclose` again, and
 * a handler that re-closes on every `onclose` recurses until the stack
 * overflows.
 */
export async function serveUntilClosed(opts: SessionOptions, transport: Transport, on: CloseSignals, version?: string): Promise<number> {
  const running = await startMcpServer(opts, transport, version);
  return new Promise<number>((resolve) => {
    let closing = false;
    const done = (): void => {
      if (closing) return;
      closing = true;
      on.input.off('end', done);
      on.signals?.off('SIGINT', done);
      on.signals?.off('SIGTERM', done);
      void running.close().then(
        () => resolve(0),
        () => resolve(0),
      );
    };
    // Keep the protocol's own close handler (it fails pending requests) and add ours.
    let protocolOnClose = transport.onclose;
    transport.onclose = (): void => {
      const once = protocolOnClose;
      protocolOnClose = undefined;
      once?.();
      done();
    };
    on.signals?.once('SIGINT', done);
    on.signals?.once('SIGTERM', done);
    on.input.once('end', done);
  });
}

/** Run over stdio until the client disconnects. Resolves to the exit code. */
export async function runStdioServer(opts: SessionOptions, version?: string): Promise<number> {
  // The protocol owns stdout: anything a library prints there would corrupt it.
  console.log = (...a: unknown[]): void => console.error(...a);
  console.info = console.log;
  console.debug = console.log;
  return serveUntilClosed(opts, new StdioServerTransport(), { input: process.stdin, signals: process }, version);
}
