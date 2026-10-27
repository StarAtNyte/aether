/**
 * The tools of the Aether MCP server. Every input is a strict zod schema
 * (unknown keys are rejected, sizes capped); every failure becomes a short,
 * safe message (see ./errors). Tools never take file paths: output goes to
 * the project folder under a sanitized name.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { ToolError, safeMessage } from './errors';
import { MCP_LIMITS } from './limits';
import type { AetherSession } from './session';

const Vec3In = z.tuple([z.number().finite().min(-1e6).max(1e6), z.number().finite().min(-1e6).max(1e6), z.number().finite().min(-1e6).max(1e6)]);
const PromptIn = z.string().trim().min(1).max(MCP_LIMITS.MAX_PROMPT_CHARS);

function text(obj: unknown): string {
  const s = JSON.stringify(obj, null, 1);
  return s.length > MCP_LIMITS.MAX_TEXT_CHARS ? `${s.slice(0, MCP_LIMITS.MAX_TEXT_CHARS)}\n... (truncated)` : s;
}

function ok(obj: Record<string, unknown>, extra: CallToolResult['content'] = []): CallToolResult {
  return { content: [{ type: 'text', text: text(obj) }, ...extra], structuredContent: obj };
}

/** Wrap a handler: failures become `isError` results with a safe message. */
function guarded<A>(session: AetherSession, name: string, fn: (args: A, signal: AbortSignal | undefined) => Promise<CallToolResult>) {
  return async (args: A, extra: { signal?: AbortSignal }): Promise<CallToolResult> => {
    try {
      return await fn(args, extra.signal);
    } catch (e) {
      const m = safeMessage(e, [session.project.root]);
      if (m.code === 'internal') session.opts.log?.(`${name}: ${e instanceof Error ? `${e.name}: ${e.message.slice(0, 300)}` : 'error'}`);
      return { isError: true, content: [{ type: 'text', text: `${m.code}: ${m.message}` }], structuredContent: { error: m } };
    }
  };
}

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
const WRITE_FILES = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

/** Register every tool on `server`. */
export function registerTools(server: McpServer, session: AetherSession): void {
  server.registerTool(
    'create_world',
    {
      title: 'Create a world',
      description:
        'Start a new world from a plain-language description (a game, a scene, a building, a physics toy). Aether plans it, builds it with patches, then PROVES it works by fast-forwarding the physics headless (tests such as "the ball reaches the goal") and repairs what fails. The previous world stays one `undo` away. Returns what was built and the verification result. Use `edit` for changes to an existing world.',
      inputSchema: { prompt: PromptIn.describe('What to build, e.g. "a small coin-collecting game on floating islands with a win screen".') },
      annotations: WRITE,
    },
    guarded(session, 'create_world', async ({ prompt }, signal) => {
      const run = await session.createWorld(prompt, signal);
      return ok({ ...run, world: session.describe() });
    }),
  );

  server.registerTool(
    'edit',
    {
      title: 'Edit the world',
      description: 'Change the current world from a plain-language request ("make the tower twice as tall", "add a red door that opens when the player is near"). Aether patches only what is needed, re-verifies and repairs. One `undo` reverts the whole request.',
      inputSchema: { prompt: PromptIn.describe('The change to make.') },
      annotations: WRITE,
    },
    guarded(session, 'edit', async ({ prompt }, signal) => {
      const run = await session.edit(prompt, signal);
      return ok({ ...run, world: session.describe() });
    }),
  );

  server.registerTool(
    'apply_patch',
    {
      title: 'Apply World IR patches',
      description:
        'Apply exact edits to the World IR without a model. Each patch is an object with an "op" ("add", "update", "remove", "rename", "addRule", "setEnvironment", "setPlayer", "setState", "addTest", "setMeta", ...). Read the `aether://schema/patch` resource for every op and field. All patches succeed or none is applied (unless atomic is false). Example: {"op":"add","entity":{"id":"crate","shape":{"kind":"primitive","primitive":"box","size":[1,1,1]},"transform":{"position":[0,3,0]},"physics":{"body":"dynamic"}}}.',
      inputSchema: {
        patches: z.array(z.record(z.string(), z.unknown())).min(1).max(MCP_LIMITS.MAX_PATCHES).describe('Patches in order.'),
        message: z.string().max(200).optional().describe('Short label for the undo history.'),
        atomic: z.boolean().optional().describe('Default true: apply all or nothing. False applies the valid ones and reports the rest.'),
      },
      annotations: WRITE,
    },
    guarded(session, 'apply_patch', async ({ patches, message, atomic }) => {
      const r = await session.applyPatch(patches, message ?? '', atomic ?? true);
      return ok({ ...r, world: session.describe() });
    }),
  );

  server.registerTool(
    'list_entities',
    {
      title: 'List entities',
      description: 'List the entities of the world (id, name, shape, position, behaviors, physics body), filtered and paged. Filters combine: `selector` (an entity id, "#tag", "player" or "*"), `tag`, `behavior`, `text` (matches id, name or tag), `parent`.',
      inputSchema: {
        selector: z.string().max(200).optional(),
        tag: z.string().max(64).optional(),
        behavior: z.string().max(64).optional(),
        text: z.string().max(100).optional(),
        parent: z.string().max(64).optional(),
        offset: z.number().int().min(0).max(100_000).default(0),
        limit: z.number().int().min(1).max(MCP_LIMITS.MAX_LIST).default(50),
      },
      annotations: READ,
    },
    guarded(session, 'list_entities', async (a) => {
      const r = session.listEntities({
        offset: a.offset,
        limit: a.limit,
        ...(a.selector ? { selector: a.selector } : {}),
        ...(a.tag ? { tag: a.tag } : {}),
        ...(a.behavior ? { behavior: a.behavior } : {}),
        ...(a.text ? { text: a.text } : {}),
        ...(a.parent !== undefined ? { parent: a.parent } : {}),
      });
      return ok(r as unknown as Record<string, unknown>);
    }),
  );

  server.registerTool(
    'get_entity',
    {
      title: 'Get an entity',
      description: 'The full definition of one entity (transform, shape, material, physics, behaviors, state, tags), exactly as `apply_patch` would write it. Wall pieces (pictures, curtains, mirrors, TVs) also carry `wall` (the wall face, room and offset along it) and `placementProblems` (what they overlap, with a fix).',
      inputSchema: { id: z.string().min(1).max(64) },
      annotations: READ,
    },
    guarded(session, 'get_entity', async ({ id }) => {
      const entity = session.getEntity(id) as unknown as Record<string, unknown>;
      const wall = session.wallPlacement(id);
      return ok({ entity, ...(wall ? { wall: wall.mount, placementProblems: wall.problems } : {}) });
    }),
  );

  server.registerTool(
    'get_world_summary',
    {
      title: 'Summarize the world',
      description: 'A compact text summary of the world as the planner sees it (entities, rules, tests, state), plus counts. Cheaper than reading the whole World IR resource.',
      inputSchema: {},
      annotations: READ,
    },
    guarded(session, 'get_world_summary', async () => ok({ ...session.describe(), provider: await session.providerLabel(), summary: session.summary() })),
  );

  server.registerTool(
    'verify',
    {
      title: 'Verify the world',
      description: 'Run the world\'s tests by forking the physics world headless and fast-forwarding it (physics as unit tests): stability, "reaches", "eventually", navigable buildings, plus static diagnostics (floating or overlapping objects, unreachable goals). Returns pass/fail per test with the reason.',
      inputSchema: {},
      annotations: READ,
    },
    guarded(session, 'verify', async (_a, signal) => ok({ ...(await session.verify(signal)) })),
  );

  server.registerTool(
    'playtest',
    {
      title: 'Playtest the game',
      description: 'A bot plays the world like a person (walks, jumps, rides lifts, drives) toward pickups, rule zones, goals and checkpoints, with real physics and game logic. Reports win/lose/incomplete, which objectives were reached, the game state (score ...), messages shown and the path walked. Use it after `verify` to prove the game can be finished.',
      inputSchema: {
        seconds: z.number().min(1).max(MCP_LIMITS.MAX_PLAYTEST_SECONDS).default(60).describe('Game seconds to play at most.'),
        goal: z.string().max(200).optional().describe('Selector of what to reach instead of the automatic objectives.'),
      },
      annotations: READ,
    },
    guarded(session, 'playtest', async ({ seconds, goal }, signal) => ok({ ...(await session.playtest({ seconds, ...(goal ? { goal } : {}) }, signal)) })),
  );

  server.registerTool(
    'replay',
    {
      title: 'Replay the proof',
      description: 'Fast-forward the physics and report how the bodies that move behaved: start, end, path length, peak height and eight keyframes each. The full motion is saved to replays/replay.json in the project folder. Afterwards `render_still` can draw any moment of it with `at`.',
      inputSchema: {},
      annotations: WRITE_FILES,
    },
    guarded(session, 'replay', async (_a, signal) => ok({ ...(await session.replay(signal)) })),
  );

  server.registerTool(
    'render_still',
    {
      title: 'Render a still',
      description:
        'Render the world to a PNG with the built-in software renderer (no GPU or browser needed): sun, shadows, sky, fog, glass. The image is returned inline and saved under renders/ in the project folder. Default camera frames the whole world from the front-right; pass yawDeg/pitchDeg/fovDeg, or from + lookAt (metres), to compose a shot. `at` (seconds) shows a moment of the last `replay`. Library models and sculpted meshes are not drawn (listed under skipped).',
      inputSchema: {
        width: z.number().int().min(MCP_LIMITS.MIN_IMAGE).max(MCP_LIMITS.MAX_IMAGE).default(960),
        height: z.number().int().min(MCP_LIMITS.MIN_IMAGE).max(MCP_LIMITS.MAX_IMAGE).default(540),
        yawDeg: z.number().min(-360).max(360).optional(),
        pitchDeg: z.number().min(-10).max(89).optional(),
        fovDeg: z.number().min(15).max(110).optional(),
        from: Vec3In.optional(),
        lookAt: Vec3In.optional(),
        at: z.number().min(0).max(60).optional().describe('Seconds into the last replay.'),
        name: z.string().max(64).optional().describe('File name (letters, digits, - and _ only).'),
      },
      annotations: WRITE_FILES,
    },
    guarded(session, 'render_still', async (a, signal) => {
      if ((a.from === undefined) !== (a.lookAt === undefined)) throw new ToolError('invalid_input', 'Give both from and lookAt, or neither.');
      const r = await session.renderStill(
        {
          width: a.width,
          height: a.height,
          ...(a.yawDeg !== undefined ? { yawDeg: a.yawDeg } : {}),
          ...(a.pitchDeg !== undefined ? { pitchDeg: a.pitchDeg } : {}),
          ...(a.fovDeg !== undefined ? { fovDeg: a.fovDeg } : {}),
          ...(a.from ? { from: a.from } : {}),
          ...(a.lookAt ? { lookAt: a.lookAt } : {}),
          ...(a.at !== undefined ? { at: a.at } : {}),
          ...(a.name ? { name: a.name } : {}),
        },
        signal,
      );
      const meta = { file: r.file, width: r.width, height: r.height, triangles: r.triangles, camera: r.camera, skipped: r.skipped };
      const image: CallToolResult['content'] = r.png.byteLength <= MCP_LIMITS.MAX_INLINE_IMAGE_BYTES ? [{ type: 'image', data: r.png.toString('base64'), mimeType: 'image/png' }] : [];
      return ok({ ...meta, inline: image.length > 0 }, image);
    }),
  );

  server.registerTool(
    'export',
    {
      title: 'Export',
      description:
        'Write the world to the project folder under exports/. "gltf": a binary glTF (.glb) of what the world looks like (one node per entity). "build": a standalone static web game (.zip: the player, the world, icons; needs the studio build that `aether start` makes). "plan": SVG floor plans of every storey of every building. "ifc": an IFC4 model (.ifc) of every building (storeys, walls with door and window openings, slabs, rooms, roofs, stairs) for BIM tools. "project": the Aether project file (.aether.json) that the studio opens. Returns the project-relative paths.',
      inputSchema: {
        format: z.enum(['gltf', 'build', 'plan', 'project', 'ifc']),
        name: z.string().max(64).optional().describe('Base file name (sanitized).'),
      },
      annotations: WRITE_FILES,
    },
    guarded(session, 'export', async ({ format, name }, signal) => ok({ ...(await session.export(format, name, signal)) })),
  );

  server.registerTool(
    'undo',
    {
      title: 'Undo',
      description: 'Revert the last change: one `create_world`, `edit` or `apply_patch` call (however many patches it made) per step.',
      inputSchema: {},
      annotations: WRITE,
    },
    guarded(session, 'undo', async () => ok({ ...(await session.undo()) })),
  );

  server.registerTool(
    'redo',
    {
      title: 'Redo',
      description: 'Re-apply what the last `undo` reverted (until the next change).',
      inputSchema: {},
      annotations: WRITE,
    },
    guarded(session, 'redo', async () => ok({ ...(await session.redo()) })),
  );
}
