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
import { registerResources } from './resources';
import { registerTools } from './tools';
import { AetherSession } from './session';
/** Name reported to clients. */
export const MCP_SERVER_NAME = 'aether';
const INSTRUCTIONS = 'Aether builds 3D worlds, games and buildings from plain language and proves they work. Typical loop: create_world, then verify (physics unit tests) and playtest (a bot plays it), fix with edit or apply_patch, look with render_still, ship with export. Read the aether://guide resource first; aether://schema/patch lists every patch op. Everything is undoable with undo.';
/** Build the MCP server over an open session. */
export function createAetherMcpServer(session, version = '0.1.0') {
    const server = new McpServer({ name: MCP_SERVER_NAME, version }, { instructions: INSTRUCTIONS, capabilities: { logging: {} } });
    registerTools(server, session);
    registerResources(server, session);
    return server;
}
/** Open a session and connect it to `transport` (tests pass an in-memory one). */
export async function startMcpServer(opts, transport, version) {
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
/** Run over stdio until the client disconnects. Resolves to the exit code. */
export async function runStdioServer(opts, version) {
    // The protocol owns stdout: anything a library prints there would corrupt it.
    console.log = (...a) => console.error(...a);
    console.info = console.log;
    console.debug = console.log;
    const transport = new StdioServerTransport();
    const running = await startMcpServer(opts, transport, version);
    return new Promise((resolve) => {
        const done = () => {
            void running.close().then(() => resolve(0), () => resolve(0));
        };
        transport.onclose = done;
        process.once('SIGINT', done);
        process.once('SIGTERM', done);
        process.stdin.once('end', done);
    });
}
