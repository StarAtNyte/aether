/**
 * MCP client of the Blender MCP server (`mcp-for-blender`, MIT, pinned),
 * started over stdio with uvx. It talks to the add-on's socket in the user's
 * Blender on 127.0.0.1 only, with telemetry off. Only the allow-listed tools
 * (`BLENDER_MCP_TOOLS`) can be called: asset search, downloads, generation
 * and telemetry tools are never reachable.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { BLENDER_MCP_TOOLS } from '@aether/agent/blender';
import { BridgeError } from '../errors';

/** The pinned MCP server package. */
export const MCP_PACKAGE = 'mcp-for-blender==2.2.7';
/** Where Blender's add-on listens (never anything but loopback). */
export const BLENDER_HOST = '127.0.0.1';
/** The add-on's default port. */
export const BLENDER_PORT = 9876;

/** One tool result, flattened. */
export interface McpToolResult {
  text: string;
  images: Array<{ data: string; mimeType: string }>;
  isError: boolean;
}

/** A connected MCP session. */
export interface BlenderMcpSession {
  listTools(): Promise<string[]>;
  callTool(name: string, args: Record<string, unknown>, opts?: { signal?: AbortSignal; timeoutMs?: number }): Promise<McpToolResult>;
  close(): Promise<void>;
}

/** The server's environment: the SDK's minimal default plus the connection and telemetry switches. */
export function mcpEnv(port: number = BLENDER_PORT, base: Record<string, string> = getDefaultEnvironment()): Record<string, string> {
  const env: Record<string, string> = { ...base };
  for (const k of ['UV_CACHE_DIR', 'UV_TOOL_DIR', 'UV_PYTHON_INSTALL_DIR', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'APPDATA', 'LOCALAPPDATA']) {
    const v = process.env[k];
    if (v !== undefined && env[k] === undefined) env[k] = v;
  }
  return { ...env, BLENDER_HOST, BLENDER_PORT: String(port), DISABLE_TELEMETRY: 'true', BLENDER_MCP_DISABLE_TELEMETRY: 'true' };
}

/** Is `name` one of the tools Aether may call? */
export function allowedMcpTool(name: string): boolean {
  return (BLENDER_MCP_TOOLS as readonly string[]).includes(name);
}

/** Start the MCP server with uvx and connect. */
export async function connectBlenderMcp(opts: { uvx: string; port?: number; timeoutMs?: number }): Promise<BlenderMcpSession> {
  const transport = new StdioClientTransport({ command: opts.uvx, args: [MCP_PACKAGE], env: mcpEnv(opts.port), stderr: 'ignore' });
  const client = new Client({ name: 'aether', version: '1' });
  await client.connect(transport, { timeout: opts.timeoutMs ?? 120_000 });
  return {
    async listTools() {
      const r = await client.listTools(undefined, { timeout: 30_000 });
      return r.tools.map((t) => t.name);
    },
    async callTool(name, args, o = {}) {
      if (!allowedMcpTool(name)) throw new BridgeError('tool_violation', `The Blender tool "${name.slice(0, 40)}" is not allowed.`);
      const r = await client.callTool({ name, arguments: args }, undefined, { timeout: o.timeoutMs ?? 120_000, resetTimeoutOnProgress: true, ...(o.signal ? { signal: o.signal } : {}) });
      const content = Array.isArray(r.content) ? (r.content as Array<Record<string, unknown>>) : [];
      const text = content
        .filter((c) => c['type'] === 'text' && typeof c['text'] === 'string')
        .map((c) => c['text'] as string)
        .join('\n');
      const images = content.filter((c) => c['type'] === 'image' && typeof c['data'] === 'string').map((c) => ({ data: c['data'] as string, mimeType: typeof c['mimeType'] === 'string' ? c['mimeType'] : 'image/png' }));
      return { text, images, isError: r.isError === true };
    },
    async close() {
      await client.close().catch(() => undefined);
    },
  };
}
