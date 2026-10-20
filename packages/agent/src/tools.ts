/**
 * Tools the planner model can call, as JSON Schemas (sent to providers) and
 * matching zod schemas (used to validate the model's untrusted arguments).
 *
 * The patch payload is described in the system prompt instead of the tool
 * schema: a full JSON Schema of the World IR would cost thousands of tokens on
 * every request and providers handle deeply nested unions poorly. Patches are
 * fully validated by `applyPatches` anyway.
 */
import { z } from 'zod';
import { DESIGN_LIMITS, DesignToolInputs } from '@aether/arch';
import type { ToolDef } from './types';

/** Upper bounds on tool arguments. */
export const TOOL_LIMITS = Object.freeze({
  MAX_PATCHES_PER_CALL: 400,
  MAX_INSPECT_IDS: 24,
  MAX_MESSAGE: 2_000,
  /** Serialized size cap of any tool input. */
  MAX_INPUT_CHARS: 600_000,
});

/** Patch operations accepted by apply_patches (mirrors the core `Patch` union). */
export const PATCH_OPS = [
  'add', 'update', 'remove', 'rename', 'addRule', 'updateRule', 'removeRule', 'setEnvironment', 'setPlayer', 'setState',
  'setHud', 'defineGenerator', 'defineScript', 'addTest', 'removeTest', 'setMeta', 'clear', 'removeGenerator', 'removeScript',
] as const;

const slugPattern = '^[a-z][a-z0-9-]{1,63}$';

const paramSpecSchema = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['number', 'int', 'boolean', 'color', 'enum'] },
    default: {},
    min: { type: 'number' },
    max: { type: 'number' },
    options: { type: 'array', items: { type: 'string' } },
    description: { type: 'string' },
  },
  required: ['type', 'default'],
} as const;

/** Tool names. */
export type AgentToolName = 'apply_patches' | 'build_architecture' | 'design_plan' | 'place_items' | 'edit_items' | 'query_scene' | 'write_generator' | 'write_script' | 'request_asset' | 'search_assets' | 'inspect' | 'run_verification' | 'finish';

/** Asset categories accepted by search_assets (mirrors @aether/assets `AssetCategory`). */
export const ASSET_CATEGORIES = [
  'furniture', 'kitchen', 'bathroom', 'decor', 'lighting', 'plants', 'nature', 'rocks', 'building', 'street',
  'vehicles', 'characters', 'animals', 'food', 'tools', 'props', 'sky',
] as const;

/** Operations of build_architecture (mirrors @aether/arch `ArchOp`). */
export const ARCH_OPS = [
  'create_building', 'remove_building', 'add_level', 'add_room', 'remove_room', 'add_door', 'add_window', 'add_stairs', 'set_roof', 'set_style',
  'furnish_room', 'place_item', 'remove_item', 'set_wall', 'set_material', 'set_residents', 'dress_room', 'set_site',
] as const;

/** Upper bound of architecture ops per call (mirrors @aether/arch `MAX_ARCH_OPS`). */
export const MAX_ARCH_OPS_PER_CALL = 40;

/** All tools available to the planner (stable order: part of the prompt-cache prefix). */
export const AGENT_TOOLS: ToolDef[] = [
  {
    name: 'apply_patches',
    description:
      'Edit the world with a batch of patch operations (see "Patch operations" in the system prompt). Valid patches are applied in order and committed as one undo step; invalid ones are skipped and reported back with their index and reason, so fix and resend only those. Batch related edits (up to 400 patches per call).',
    inputSchema: {
      type: 'object',
      properties: {
        patches: {
          type: 'array',
          minItems: 1,
          maxItems: TOOL_LIMITS.MAX_PATCHES_PER_CALL,
          items: { type: 'object', properties: { op: { type: 'string', enum: [...PATCH_OPS] } }, required: ['op'] },
          description: 'Patch objects, e.g. {"op":"add","entity":{...}} or {"op":"setEnvironment","set":{"sky":"sunset"}}.',
        },
        message: { type: 'string', description: 'Short commit message for the history timeline, e.g. "Add pine forest".' },
      },
      required: ['patches', 'message'],
      additionalProperties: false,
    },
  },
  {
    name: 'build_architecture',
    description:
      'Create and edit real-world buildings and interiors (houses, apartments, offices, cafés, villas) from a declarative plan (see "Architecture" in the system prompt). The plan compiles into walls with mitred corners, floors, ceilings, doors that open with E, windows, stairs, a roof, furniture and real lights, then is checked: every room reachable on foot, doors swing free, furniture grounded without overlaps. Ops apply in order; refused ops come back with a code and a fix hint while the others still apply. Wall coverings: {"op":"set_wall","building":"b","room":"bed","wall":"north"|"south"|"east"|"west"|"all" (seen from inside),"material":{"finish":"wallpaper"|"wallpaper-stripe"|"wallpaper-floral"|"wallpaper-damask"|"wallpaper-geometric"|"panelling"|"wood-slats"|"brick"|"tile","color"?},"dado"?:{"height":1,"material":{...}}} changes one wall or a lower wainscot without touching the others. More windows: {"op":"add_window","building":"b","window":{"room":"kitchen","count"?:1,"width"?:1.2,"side"?:"north"}}: without "side" the room\'s widest clear exterior wall is used (its storey is found from the room); the room keeps the windows it has, and a refusal lists the clear wall per side. Stairs (on the LOWER level, climbing its storey height): {"op":"add_stairs","building":"b","level":0,"stair":{"room":"hall"}} fits one there, or {"stair":{"at":[x,z] first riser,"heading":"north|south|east|west" direction of travel,"shape"?:"straight|l|u","width"?:1}}; a stair that crosses a wall, blocks a doorway or arrives on no floor upstairs is refused with the measurements and a stair that fits.',
    inputSchema: {
      type: 'object',
      properties: {
        ops: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_ARCH_OPS_PER_CALL,
          items: { type: 'object', properties: { op: { type: 'string', enum: [...ARCH_OPS] } }, required: ['op'] },
          description: 'e.g. {"op":"create_building","plan":{...}} or {"op":"furnish_room","building":"house","room":"living"}.',
        },
        message: { type: 'string', description: 'Short commit message, e.g. "Two-bedroom apartment".' },
      },
      required: ['ops', 'message'],
      additionalProperties: false,
    },
  },
  {
    name: 'design_plan',
    description:
      'FIRST step for any building, house, apartment, room or interior: write the design plan BEFORE anything is placed. Programme (what each room is for), rooms as rects [x0,z0,x1,z1] in metres (x east, z SOUTH; neighbours share edges), circulation, the storey height (levels[].height, floor to floor: about 0.22 m above the ceiling the shell reports), EVERY opening with room, wall (north|south|east|west), along (centre, metres from the wall\'s left end seen from inside) and width, stairs per lower level as {"room":"hall"} (fitted to the storey height against a free wall) or exact {at, heading, shape, width}, and every piece of furniture with its relations (against_wall, centred_on_wall, in_corner, flanks, beside, above_centred, centred_on_opening, on_top, faces) plus your intent in words. The shell (walls, floors, doors, windows) is built at exactly those positions and read back to you; nothing is furnished until you place it. A refused plan says what to change. Send it again to revise the shell (pieces you placed stay).',
    inputSchema: {
      type: 'object',
      properties: {
        plan: {
          type: 'object',
          description:
            '{"id":"house","name":"…","style":"modern|scandinavian|industrial|japandi|classic|mediterranean","brief":"one or two sentences","programme":[{"room":"bedroom","purpose":"sleep","targetArea":14}],"circulation":{"entrance":"hall","notes":"…"},"levels":[{"height":2.9,"rooms":[{"id":"bedroom","type":"bedroom","rect":[0,0,4,3.6],"walls":{"north":{"finish":"wallpaper-floral","color":"#dfe5d2"}}}],"openings":[{"kind":"window|door|sliding|opening","room":"bedroom","wall":"north","along":2,"width":1.4,"height":1.3,"sill":0.9,"to":"hall|outside","main":true}],"stairs":[]}],"furniture":[{"id":"bed","kind":"bed","room":"bedroom","intent":"bed centred on the north wall","relations":[{"type":"against_wall","wall":"north"},{"type":"centred_on_wall","wall":"north"}]}],"roof":{"shape":"flat|gable|hip|shed"}}',
        },
      },
      required: ['plan'],
      additionalProperties: false,
    },
  },
  {
    name: 'place_items',
    description:
      'Place pieces from the parts library (see query_scene parts) into rooms of the building: furniture, appliances, rugs, plants, curtains, art, mirrors, lights. Each item: {kind, room, id (your handle from the plan), and WHERE: wall + t (metres along that wall, left to right as seen from inside) or wall + align centre|start|end, or at [x,z], or on (a host piece) + offset, y (bottom height of wall pieces), yaw, faces, params (size, colour, materials), opening (curtains: the window)}. Items apply in order against the evolving room; each one is measured and REFUSED with the exact reason and a fix when it would overlap, cross a wall, cover a door or window, block a doorway or its swing, or wall a room in. Refusals do not stop the others. Up to 40 per call, one undo step.',
    inputSchema: {
      type: 'object',
      properties: {
        items: { type: 'array', minItems: 1, maxItems: DESIGN_LIMITS.MAX_ITEMS, items: { type: 'object', properties: { kind: { type: 'string' }, room: { type: 'string' } }, required: ['room'] } },
        building: { type: 'string', description: 'Building id (only when there are several).' },
        message: { type: 'string', description: 'Short commit message.' },
      },
      required: ['items'],
      additionalProperties: false,
    },
  },
  {
    name: 'edit_items',
    description:
      'Change placed pieces with measured, validated edits. Each edit: {op:"move", ref, wall|edge, t|align, at, on, offset, y, yaw, faces} | {op:"rotate", ref, yaw|delta|faces} | {op:"resize", ref, params} | {op:"remove", ref} | {op:"snap_to_wall", ref, wall, align|t, gap} | {op:"anchor_to_opening", ref, opening, mode:"centre|left|right"} | {op:"center_over", ref, target, gap}. `ref` is an entity id from query_scene or the summary (or your handle). Refused with the reason when the result would be wrong; the others still apply. Use it to fix what the review reports: never rebuild a room to move one piece.',
    inputSchema: {
      type: 'object',
      properties: {
        edits: { type: 'array', minItems: 1, maxItems: DESIGN_LIMITS.MAX_EDITS, items: { type: 'object', properties: { op: { type: 'string', enum: ['move', 'rotate', 'resize', 'remove', 'snap_to_wall', 'anchor_to_opening', 'center_over'] }, ref: { type: 'string' } }, required: ['op', 'ref'] } },
        building: { type: 'string' },
        message: { type: 'string' },
      },
      required: ['edits'],
      additionalProperties: false,
    },
  },
  {
    name: 'query_scene',
    description:
      'Look things up instead of guessing or asking the user. Queries (up to 12 per call): {q:"wall", room, wall, kind?, y0?, y1?} openings, pieces and the free stretches of a wall | {q:"measure", a, b} distance, gap, heights and wall offsets between two pieces, openings, "room/north" wall faces or {point:[x,z]} | {q:"list", room?, wall?, kind?, level?} | {q:"parts"} the parts library with sizes and parameters | {q:"shell"} rooms, walls and openings with exact positions | {q:"review"} every check (overlaps, blocked doors and swings, floating or intersecting pieces, scale, clearance, reachability, lighting, emptiness) plus whether the building still matches your plan | {q:"stairs", level?, room?, shape?, heading?, width?} where a stair to the next storey fits (risers for the storey height, against a free wall, clear of doorways, arriving on open floor upstairs) as a ready add_stairs op, or why none fits with the sizes each shape needs.',
    inputSchema: {
      type: 'object',
      properties: {
        queries: { type: 'array', minItems: 1, maxItems: DESIGN_LIMITS.MAX_QUERIES, items: { type: 'object', properties: { q: { type: 'string', enum: ['wall', 'measure', 'list', 'parts', 'shell', 'review', 'stairs'] } }, required: ['q'] } },
        building: { type: 'string' },
      },
      required: ['queries'],
      additionalProperties: false,
    },
  },
  {
    name: 'write_generator',
    description:
      'Define a custom procedural geometry generator (only when no built-in generator fits). `source` is the BODY of `function generate(params, api)` using the GeneratorApi and must `return api.build()`. Base at y=0, centered in x/z, meters. The code is statically checked and test-run in a sandbox; errors come back so you can fix it. Then use it with shape {"kind":"procedural","generator":"<id>","params":{...}}.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', pattern: slugPattern, description: 'Lowercase slug, must not clash with a built-in id.' },
        description: { type: 'string' },
        params: { type: 'object', additionalProperties: paramSpecSchema, description: 'Parameter specs with defaults.' },
        source: { type: 'string', description: 'Function body (JavaScript, no imports, no globals).' },
      },
      required: ['id', 'description', 'source'],
      additionalProperties: false,
    },
  },
  {
    name: 'write_script',
    description:
      'Define a custom per-entity behavior script (only when built-in behaviors and rules cannot express it). `source` is the BODY of `function update(ctx)` called every fixed tick; it returns intents (see Script API). Attach with behaviors: [{"type":"script","params":{"script":"<id>"}}].',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', pattern: slugPattern },
        description: { type: 'string' },
        source: { type: 'string', description: 'Function body (JavaScript, sandboxed, no globals).' },
      },
      required: ['id', 'description', 'source'],
      additionalProperties: false,
    },
  },
  {
    name: 'request_asset',
    description:
      'Ask the specialist coding model to write, test and define a custom procedural generator for a distinctive object (e.g. "a gothic cathedral with flying buttresses"). Prefer this over write_generator for anything non-trivial. Returns the generator id and its params once it validates.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', pattern: slugPattern },
        description: { type: 'string', description: 'What the object looks like: parts, proportions, colors, style.' },
        params_hint: { type: 'string', description: 'Optional: parameters it should expose, e.g. "height, color, floors".' },
      },
      required: ['id', 'description'],
      additionalProperties: false,
    },
  },
  {
    name: 'search_assets',
    description:
      'Search the library of ready-made, real-world-sized 3D assets (furniture, plants, trees, rocks, buildings, street props, vehicles, animated characters and animals, food, tools, HDR skies). Synonyms work ("couch" finds sofas). Returns ids with size in metres; place one with shape {"kind":"asset","id":"<id>"} — no scale needed. Prefer assets over primitives for everyday objects.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What you need, e.g. "sofa", "oak tree", "police car", "woman".' },
        category: { type: 'string', enum: [...ASSET_CATEGORIES] },
        limit: { type: 'integer', minimum: 1, maximum: 20 },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'inspect',
    description: 'Read the current world. Without ids: the compact world summary. With ids: the full JSON of those entities (up to 24).',
    inputSchema: {
      type: 'object',
      properties: { ids: { type: 'array', items: { type: 'string' }, maxItems: TOOL_LIMITS.MAX_INSPECT_IDS } },
      additionalProperties: false,
    },
  },
  {
    name: 'run_verification',
    description: 'Run the world\'s tests and physics diagnostics headlessly now and get a pass/fail summary with concrete problems.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'finish',
    description: 'Call when the world fulfils the request. `message` is shown to the user: one or two sentences on what was built and how to play it. Verification runs automatically afterwards.',
    inputSchema: {
      type: 'object',
      properties: { message: { type: 'string' } },
      required: ['message'],
      additionalProperties: false,
    },
  },
];

/** Names of the level tools (offered only when the host supplies `AgentOptions.levelTools`). */
export const LEVEL_TOOL_NAMES = ['query_level', 'place_level_items'] as const;

/** True when `name` is a level tool. */
export function isLevelToolName(name: string): name is (typeof LEVEL_TOOL_NAMES)[number] {
  return (LEVEL_TOOL_NAMES as readonly string[]).includes(name);
}

/** Tools for games and outdoor worlds: look things up and place with measured feedback. Appended after {@link AGENT_TOOLS}. */
export const LEVEL_TOOLS: ToolDef[] = [
  {
    name: 'query_level',
    description:
      'Measure the level instead of guessing (games, terrain, outdoor worlds). {op:"summary"} the player, extent, win, objectives and which are reachable | {op:"ground", points:[{x,z,below?}]} top surface height, what it is and the slope at each point (up to 24) | {op:"clearance", x, z, radius?, height?} free radius, headroom and whether a body fits | {op:"sightline", from:[x,y,z], to:[x,y,z]} what blocks it | {op:"reach", points:[{x,z,y?}]} whether the player can walk, jump or ride a lift there from the spawn, and if not how far and how high the gap is | {op:"objectives"} every pickup, goal and zone with its reach | {op:"review"} the level checked as a designer would (no win condition, spawn, unreachable objectives, pacing, objects hovering above the terrain they should stand on) with the fix for each | {op:"grounding", ids?} every object that should rest on something (props, landmarks, shrines, rocks) measured against the real surface under it: how far it hovers and what is below (things tagged "floating", pickups, goals and moving bodies are left out). Use it before and after placing; after moving something onto terrain, check it rests.',
    inputSchema: {
      type: 'object',
      properties: { op: { type: 'string', enum: ['summary', 'ground', 'clearance', 'sightline', 'reach', 'objectives', 'review', 'grounding'] } },
      required: ['op'],
    },
  },
  {
    name: 'place_level_items',
    description:
      'Place pickups, goals, checkpoints, hazards, enemies, props and decor by x,z: each is snapped to the ground there (y = ground + above + half its height), refused when nothing is under it, when it is buried in something solid, when a standing item sits on a cliff, or (pickup, goal, checkpoint, enemy) when the player cannot reach it, with the distance and height gap and the nearest standable spot. Item: {id, role: pickup|goal|checkpoint|hazard|enemy|prop|decor|life, x, z, above?, below?, yaw?, key? (state key a pickup raises), reach?, entity: {shape, name?, material?, behaviors?, physics?, tags?, npc?}}. Roles fill in the behaviours (collectible, goal, checkpoint, hazard) and a sensor body. Send {id,x,z} without entity to move an existing item: it is set down with its bottom on the surface there (its own old position does not count). Role life places a living group the tools measure for you: {id, role:"life", species, count (1-24), radius (m, the area they share), x, z, perch?}; species deer, doe, cat, sheep, cow, horse, pig, dog, fox (stand on ground that is not steep or under water), bird, crow, seagull, hawk, parrot (fly in clear air above the terrain, or perch on the solid surface at x,z), butterfly (flower height), fish, koi (swim in water at least 0.3 m deep, away from the bank), duck (floats on water): each animal is placed where it fits, the others are reported with the measured reason; no entity needed. Up to 40 per call, one undo step; refused items do not stop the others.',
    inputSchema: {
      type: 'object',
      properties: {
        items: { type: 'array', minItems: 1, maxItems: 40, items: { type: 'object', properties: { id: { type: 'string' }, role: { type: 'string', enum: ['pickup', 'goal', 'checkpoint', 'hazard', 'enemy', 'prop', 'decor', 'life'] }, x: { type: 'number' }, z: { type: 'number' }, species: { type: 'string' }, count: { type: 'number' }, radius: { type: 'number' }, perch: { type: 'boolean' } }, required: ['id', 'x', 'z'] } },
        message: { type: 'string' },
      },
      required: ['items'],
      additionalProperties: false,
    },
  },
];

/**
 * Tools of the compact prompt profile (small on-device models): only
 * apply_patches and finish, with short descriptions and minimal schemas so
 * the whole request fits a ~4k-token context. Same names and validators as
 * {@link AGENT_TOOLS}.
 */
export const COMPACT_TOOLS: ToolDef[] = [
  {
    name: 'apply_patches',
    description: 'Edit the world with patch operations. Errors come back by index: fix and resend only those.',
    inputSchema: {
      type: 'object',
      properties: { patches: { type: 'array', minItems: 1, items: { type: 'object' } }, message: { type: 'string' } },
      required: ['patches', 'message'],
    },
  },
  {
    name: 'finish',
    description: 'Call when done. message: one sentence for the user.',
    inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
  },
];

/** zod validators for each tool's arguments. */
export const ToolInputs = {
  apply_patches: z.object({
    patches: z.array(z.unknown()).min(1).max(TOOL_LIMITS.MAX_PATCHES_PER_CALL),
    message: z.string().max(TOOL_LIMITS.MAX_MESSAGE).default('Agent edit'),
  }),
  build_architecture: z.object({
    ops: z.array(z.unknown()).min(1).max(MAX_ARCH_OPS_PER_CALL),
    message: z.string().max(TOOL_LIMITS.MAX_MESSAGE).default('Architecture edit'),
  }),
  design_plan: DesignToolInputs.design_plan,
  place_items: DesignToolInputs.place_items,
  edit_items: DesignToolInputs.edit_items,
  query_scene: DesignToolInputs.query_scene,
  write_generator: z.object({
    id: z.string(),
    description: z.string().max(TOOL_LIMITS.MAX_MESSAGE),
    params: z.record(z.string(), z.unknown()).default({}),
    source: z.string(),
  }),
  write_script: z.object({ id: z.string(), description: z.string().max(TOOL_LIMITS.MAX_MESSAGE), source: z.string() }),
  request_asset: z.object({
    id: z.string().regex(new RegExp(slugPattern)),
    description: z.string().min(1).max(TOOL_LIMITS.MAX_MESSAGE),
    params_hint: z.string().max(500).optional(),
  }),
  search_assets: z.object({
    query: z.string().max(120),
    category: z.enum(ASSET_CATEGORIES).optional(),
    limit: z.number().int().min(1).max(20).default(8),
  }),
  inspect: z.object({ ids: z.array(z.string().max(64)).max(TOOL_LIMITS.MAX_INSPECT_IDS).optional() }),
  run_verification: z.object({}),
  finish: z.object({ message: z.string().max(TOOL_LIMITS.MAX_MESSAGE).default('') }),
} as const;

/** True when `name` is one of {@link AGENT_TOOLS}. */
export function isAgentTool(name: string): name is AgentToolName {
  return Object.prototype.hasOwnProperty.call(ToolInputs, name);
}
