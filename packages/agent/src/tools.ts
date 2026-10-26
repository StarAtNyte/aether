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
import { LandInput } from './land';
import { DESIGN_LIMITS, DesignToolInputs } from '@aether/arch';
import { FeelEvent, FeelTier, VfxPreset } from '@aether/core';
import { TuneFeelInput } from './feel-edit';
import { BAKE_QUALITIES, BakeLightInput } from './bake-edit';
import { LOOK_RESET_KEYS, TuneLookInput } from './look-edit';
import type { ToolDef } from './types';
import { MakeTextureInput } from './textures';

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
export type AgentToolName = 'apply_patches' | 'build_architecture' | 'design_plan' | 'place_items' | 'edit_items' | 'query_scene' | 'write_generator' | 'write_script' | 'request_asset' | 'search_assets' | 'find_model' | 'inspect' | 'run_verification' | 'shape_land' | 'tune_feel' | 'tune_look' | 'bake_light' | 'make_texture' | 'finish';

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
      'Create and edit real-world buildings and interiors (houses, apartments, offices, cafés, villas) from a declarative plan (see "Architecture" in the system prompt). The plan compiles into walls with mitred corners, floors, ceilings, doors that open with E, windows, stairs, a roof, furniture and real lights, then is checked: every room reachable on foot, doors swing free, furniture grounded without overlaps. Ops apply in order; refused ops come back with a code and a fix hint while the others still apply. Wall coverings: {"op":"set_wall","building":"b","room":"bed","wall":"north"|"south"|"east"|"west"|"all" (seen from inside),"material":{"finish":"wallpaper"|"wallpaper-stripe"|"wallpaper-floral"|"wallpaper-damask"|"wallpaper-geometric"|"panelling"|"wood-slats"|"brick"|"tile","color"?},"dado"?:{"height":1,"material":{...}}} changes one wall or a lower wainscot without touching the others. More windows: {"op":"add_window","building":"b","window":{"room":"kitchen","count"?:1,"width"?:1.2,"side"?:"north"}}: without "side" the room\'s widest clear exterior wall is used (its storey is found from the room); the room keeps the windows it has, and a refusal lists the clear wall per side. Stairs (on the LOWER level, climbing its storey height): {"op":"add_stairs","building":"b","level":0,"stair":{"room":"hall"}} fits one there, or {"stair":{"at":[x,z] first riser,"heading":"north|south|east|west" direction of travel,"shape"?:"straight|l|u","width"?:1}}; each needs a clear landing as wide as the stair and at least 0.9 m (and its width) deep at its foot (in front of or beside the first riser) and beyond its top step upstairs, clear of walls, railings and furniture; a stair that crosses a wall, blocks a doorway or lands short of that is refused with the measurements and a stair that fits (create_building moves such a stair to the nearest that works and says so); "replace":0 swaps the level\'s first stair for the new one.',
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
      'Place pieces from the parts library (see query_scene parts) into rooms of the building: furniture, appliances, rugs, plants, curtains, art, mirrors, lights. Each item: {kind, room, id (your handle from the plan), and WHERE: wall + t (metres along that wall, left to right as seen from inside) or wall + align centre|start|end, or at [x,z], or on (a host piece) + offset, y (bottom height of wall pieces), yaw, faces, params (size, colour, materials), opening (curtains and blinds: the window; a curtain makes both panels, plus one pelmet across them when params.pelmet is box|valance|swag; a blind hangs centred over it)}. Items apply in order against the evolving room; each one is measured and REFUSED with the exact reason and a fix when it would overlap, cross a wall, cover a door or window, block a doorway or its swing, or wall a room in. Refusals do not stop the others. Up to 40 per call, one undo step.',
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
      'Look things up instead of guessing or asking the user. Queries (up to 12 per call): {q:"wall", room, wall, kind?, y0?, y1?} openings, pieces and the free stretches of a wall | {q:"measure", a, b} distance, gap, heights and wall offsets between two pieces, openings, "room/north" wall faces or {point:[x,z]} | {q:"list", room?, wall?, kind?, level?} | {q:"parts"} the parts library with sizes and parameters | {q:"shell"} rooms, walls and openings with exact positions | {q:"vocabulary", topic?} the room-shell vocabulary you can set in design_plan: ceiling styles (coved, vaulted, barrel, coffered, beamed, tray), cornice, picture rail, skirting, panelled dados, niches, window styles with glazing bars (sash, arched, bay, casement), door styles (panelled, glazed, double, french, arched), curtains, blinds and pelmets, fireplaces and built-ins | {q:"finishes", near:"#rrggbb", surface?:"wall|floor|ceiling", hint?} the nearest PBR finishes for a sampled colour, each with the tint to give it | {q:"review"} every check (overlaps, blocked doors and swings, floating or intersecting pieces, scale, clearance, reachability, lighting, emptiness) plus whether the building still matches your plan | {q:"stairs", level?, room?, shape?, heading?, width?} where a stair to the next storey fits (risers for the storey height, against a free wall, clear of doorways, arriving on open floor upstairs) as a ready add_stairs op, or why none fits with the sizes each shape needs.',
    inputSchema: {
      type: 'object',
      properties: {
        queries: { type: 'array', minItems: 1, maxItems: DESIGN_LIMITS.MAX_QUERIES, items: { type: 'object', properties: { q: { type: 'string', enum: ['wall', 'measure', 'list', 'parts', 'vocabulary', 'finishes', 'shell', 'review', 'stairs'] } }, required: ['q'] } },
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
    name: 'find_model',
    description:
      'Find real, real-size models for one piece, ranked by style/biome, colour and size, with their facts so you can choose: furniture and decor, and also trees, rocks, cliffs, shrubs, grass, street furniture (lamps, hydrants, benches, bins, barriers), building facades, industrial and sci-fi parts, harbour and farm props, medieval and fantasy pieces. Each model is tagged with a category and a look (realistic photographed models by default; look "stylised" or "low-poly" asks the Kenney-style kits for cartoon or blocky worlds). Pick one and place it in a room with place_items {"kind":"model:<id>"} (optional "fit":[w,h,d] metres to scale it, "yaw"); kind "sofa" with "model":"auto" lets the finder choose. In an open world (no rooms) add an entity whose shape is {"kind":"asset","id":"<id>"} with apply_patches (scale it with transform.scale; models are real size in metres, base on y 0). Models do not open (no drawers or doors): keep the parametric part for wardrobes, cabinets and kitchens. Biome words work as the style: forest, desert, coastal, harbour, urban, industrial, farm, scifi, fantasy, medieval.',
    inputSchema: {
      type: 'object',
      properties: {
        what: { type: 'string', description: 'The piece, e.g. "sofa", "green armchair", "pine tree", "sandstone cliff", "street lamp", "fire hydrant", "wooden pier", "cannon".' },
        style: { type: 'string', description: 'Design style (modern, scandinavian, industrial, japandi, classic, rustic, vintage...) or biome (forest, desert, coastal, urban, farm, scifi, fantasy, medieval...).' },
        category: { type: 'string', enum: [...ASSET_CATEGORIES], description: 'Only this category (nature, rocks, plants, street, building, vehicles, props, tools, decor, lighting, furniture...).' },
        look: { type: 'string', enum: ['realistic', 'stylised', 'low-poly', 'any'], description: 'Art style of the model; default realistic. Stylised and low-poly are the cartoon kits.' },
        color: { type: 'string', description: 'Colour name or #rrggbb of the piece.' },
        size: { type: 'array', items: { type: 'number' }, minItems: 1, maxItems: 3, description: 'Wanted [width, height, depth] in metres (0 for a side that does not matter).' },
        limit: { type: 'integer', minimum: 1, maximum: 8 },
      },
      required: ['what'],
      additionalProperties: false,
    },
  },
  {
    name: 'inspect',
    description: 'Read the current world. Without ids: the compact world summary. With ids: the full JSON of those entities (up to 24). With groups:true: every group of repeated things (scatter layers of trees, rocks, grass, hedges, fence posts, and runs of alike separate entities) in one read: count, bounds, closest and typical neighbour distance, overlapping pairs, instances floating or buried (ids narrow it to those layers). Read the groups before and after you place or thin trees.',
    inputSchema: {
      type: 'object',
      properties: { ids: { type: 'array', items: { type: 'string' }, maxItems: TOOL_LIMITS.MAX_INSPECT_IDS }, groups: { type: 'boolean' } },
      additionalProperties: false,
    },
  },
  {
    name: 'run_verification',
    description: 'Run the world\'s tests and physics diagnostics headlessly now and get a pass/fail summary with concrete problems.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'shape_land',
    description:
      'Real ground for outdoor worlds instead of the flat plane. {op:"land", kind:"meadow"|"forest"|"snow"|"canyon", size?:420, relief?:48 (m), color?, plot?:{x,z,radius} (level ground at y=0 for buildings, camps, arenas), stream?:{z, half, bend?, depth?} (a stream carved across the land along X, with flowing water), woods?:{conifers, broadleaf, birch, scrub, boulders} (leaf-card trees on the slopes), cover?:{grass?, flowers?:[colors], radius?, density?}} builds the terrain, water, woods and ground cover in one step and replaces the land it built before | {op:"path", points:[[x,z],...], width?, surface?:"soil"|"gravel"|"cobble"|"sand"|"decking"|"asphalt"|"dry-earth", color?} drapes a trail, lane or road over the ground | {op:"row", points:[[x,z],...], of:generator id (tree-pine, tree-oak, bush, rock, a fence post…), spacing?:4 (m), jitter?:0.25, scale?:[0.85,1.15], params?, sides?:"centre"|"both" + offset? (m off the line) } strings trees, a hedge, fence posts or props along a lane, river bank or boundary, each on the ground at its own point (one instanced entity, up to 2000) | {op:"mound", x, z, size?, height?, top? (level summit share), roughness?, ridge?} raises a natural hill to stand a shrine, lookout or castle on (never a cylinder or box for a hill). land also takes lake?:{x,z,radius,depth?} (a basin with water). Rivers, lakes and ponds come from land, never a flat box of water. Call land first, then place things (place_level_items snaps them to this ground), then paths. A canyon, gorge or desert race: kind "canyon" (sandstone walls, the floor along Z at y=0, about 0.06 x size wide each side of x=0) and the road as a path with surface asphalt along the floor; never walls of boxes.',
    inputSchema: {
      type: 'object',
      properties: {
        op: { type: 'string', enum: ['land', 'path', 'mound', 'row'] },
        x: { type: 'number' },
        z: { type: 'number' },
        height: { type: 'number' },
        top: { type: 'number' },
        roughness: { type: 'number' },
        ridge: { type: 'boolean' },
        lake: { type: 'object' },
        kind: { type: 'string', enum: ['meadow', 'forest', 'snow', 'canyon'] },
        size: { type: 'number' },
        relief: { type: 'number' },
        color: { type: 'string' },
        plot: { type: 'object' },
        stream: { type: 'object' },
        woods: { type: 'object' },
        cover: { type: 'object' },
        points: { type: 'array', items: { type: 'array', items: { type: 'number' } } },
        width: { type: 'number' },
        of: { type: 'string' },
        params: { type: 'object' },
        spacing: { type: 'number' },
        jitter: { type: 'number' },
        scale: { type: 'array', items: { type: 'number' } },
        sides: { type: 'string', enum: ['centre', 'both'] },
        offset: { type: 'number' },
        surface: { type: 'string', enum: ['soil', 'gravel', 'cobble', 'sand', 'decking', 'asphalt', 'dry-earth'] },
        name: { type: 'string' },
      },
      required: ['op'],
      additionalProperties: false,
    },
  },
  {
    name: 'tune_feel',
    description:
      'Game feel and visual effects (presentation only: they never change the simulation, the playtest or a replay proof). preset: the tier of the whole game, "subtle" (calm exploration, walkthroughs), "normal" (the default), "punchy" (action, combat, arcade), "off". events: per-event cues merged into the current ones, for pickup | hit | damage | death | win | checkpoint | jump | land | explosion | launch, each {tier?, shake? 0..1 (trauma), hitStop? 0..0.25 s, fovKick? -20..20 deg, flash? 0..1, flashColor?, vignette? 0..1, rumble? 0..1, squash? 0..1, text? (floating +score/-damage), duck? 0..1 (background audio), vfx? (burst at the event), vfxColor?, vfxScale? 0.2..4}; null drops an event back to the tier. emitters: continuous effects on entities, [{target: id or #tag, vfx: preset or "none" to remove, rate? per s, color?, scale?, offset? [x,y,z] from the entity origin (put a torch flame at its top)}]. VFX presets: ' +
      VfxPreset.options.join(', ') +
      '. A good moment is several small answers within a tenth of a second (a burst, a body pop, a flash, a short hit-stop, a decaying shake, a floating "+1"); events fire by themselves (pickups, hazards, NPC blows, checkpoints, goals, losing, launchers, explosions, jumps, landings). Give every game a tier by genre ("punchy" action, combat, racing; "subtle" calm exploration, stories) and emitters on what burns or smokes (autoEmitters:true finds torches, campfires, chimneys, forges, portals). Pacing: teach a mechanic safely before testing it, a calm stretch before the last challenge, each reward louder than the last. Rules burst too: {"do":"effect","vfx":"explosion","at":"barrel-2","feel":"explosion"}. "Make hits feel punchy" = {events:{hit:{tier:"punchy"},damage:{tier:"punchy"}}}; "sparks when coins are collected" = {events:{pickup:{vfx:"sparks"}}}; "dust when landing" = {events:{land:{vfx:"dust"}}}; "the torches should burn" = {emitters:[{target:"#torch",vfx:"fire",offset:[0,0.9,0]}]}. One undo step.',
    inputSchema: {
      type: 'object',
      properties: {
        preset: { type: 'string', enum: [...FeelTier.options] },
        events: { type: 'object', properties: Object.fromEntries(FeelEvent.options.map((e) => [e, { type: ['object', 'null'] }])), additionalProperties: false },
        footsteps: { type: 'boolean' },
        emitters: { type: 'array', maxItems: 24, items: { type: 'object', properties: { target: { type: 'string' }, vfx: { type: 'string', enum: [...VfxPreset.options, 'none'] }, rate: { type: 'number' }, color: { type: 'string' }, scale: { type: 'number' }, offset: { type: 'array', items: { type: 'number' } } }, required: ['target', 'vfx'] } },
        reset: { type: 'boolean' },
        message: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'tune_look',
    description:
      'Look development, the way a photographer grades a shot: set how light and colour are PRESENTED after you have looked at renders (never to make a number match; you judge with your eyes). Stored in the world (environment, environment.grade, environment.look) as one undo step and respected by every render, review image and still; the renderer\'s constants are only the defaults. Omitted fields stay as they are; `reset` puts named ones back to the default. Exposure: exposure (multiplier, 1 neutral), exposureEv (stops, grade), bloom, ambientIntensity (default 0.4), sunIntensity (2.5), hdriIntensity. Colour: temperature (warm +, cool -), tint (green +, magenta -), saturation 0.4..1.8, contrast 0.6..1.6, sunTint / ambientTint / foliageTint (#rrggbb multipliers; #ffffff keeps the colour: a warm lamp-lit evening ambientTint #ffe2c2, autumn foliageTint #ffd9a0, cool overcast sunTint #dfe9ff). Fog: fogColor, fogDensity (needed when the world has no fog), fogVisibility (metres to 63% haze). Interiors: interiorWarmth (warm white-balance shift in a lit room, default 0.45), interiorBalance (how much of the lamps\' own cast is removed, 0..1.5, default 1), lampStrength (room lamps in the baked light, default 1, 0..3). vignette 0..1 (default 0.22). Exterior context beyond the plot (for photo-built rooms, interiors and any world that ends in an empty lawn under a pale sky): surroundings (preset none | meadow | countryside | woodland | suburb: distant hills melting into the horizon haze, a tree line with groves, a patchwork of fields), then hills (ridge height m), hillDistance (m), treeDensity 0..1, treeSpecies broadleaf | conifer | mixed, farFields (boolean), clearRadius (m kept free of trees); all instanced and cheap, presentation only (no physics, no effect on baked light). For specific props (a fence, a hedge, a few named trees near the house) use find_model and place_items on top. Judge the light from walking height (eye 1.6-1.7 m): too-dark corridors and entries, blown-out windows, lamps that do not visibly light nearby surfaces, flat ambient, brightness jumps between rooms; fix with this tool and with lights placed near the fixtures, then look again from the same eye-height view. Call it in a review round after viewing the numbered renders: say in `message` what you saw ("kitchen reads cold and flat, warming the white balance and lifting the exposure"), change a little, look again. Reply lists each value before and after.',
    inputSchema: {
      type: 'object',
      properties: {
        exposure: { type: 'number' }, exposureEv: { type: 'number' }, temperature: { type: 'number' }, tint: { type: 'number' }, saturation: { type: 'number' }, contrast: { type: 'number' }, bloom: { type: 'number' },
        ambientIntensity: { type: 'number' }, sunIntensity: { type: 'number' }, hdriIntensity: { type: 'number' },
        fogColor: { type: 'string' }, fogDensity: { type: 'number' }, fogVisibility: { type: 'number' },
        interiorWarmth: { type: 'number' }, interiorBalance: { type: 'number' }, lampStrength: { type: 'number' }, vignette: { type: 'number' },
        sunTint: { type: 'string' }, ambientTint: { type: 'string' }, foliageTint: { type: 'string' },
        surroundings: { type: 'string', enum: ['none', 'meadow', 'countryside', 'woodland', 'suburb'] }, hills: { type: 'number' }, hillDistance: { type: 'number' },
        treeDensity: { type: 'number' }, treeSpecies: { type: 'string', enum: ['broadleaf', 'conifer', 'mixed'] }, farFields: { type: 'boolean' }, clearRadius: { type: 'number' },
        reset: { type: 'array', items: { type: 'string', enum: [...LOOK_RESET_KEYS] } },
        message: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'bake_light',
    description:
      'Decide whether a building interior needs BAKED light, after you have looked at renders. A bake path-traces the sky occlusion and the light that bounces between surfaces (sun patches on the floor warming the ceiling, lamps on the walls, window light reaching the back of the room) into a lightmap per wall, floor, ceiling and furniture surface, so corners darken, the floor under a sofa grounds it and the room reads lit by its windows instead of by one flat value. Direct sun and lamps stay live (shadows, switches, opening doors). quality: low (256 px atlas, 24 rays per texel), medium (512 px, 48), high (1024 px, 96, slowest) or off (probe light only). samples overrides the rays. It runs in the background in the renderer (seconds to about a minute, with a visible cancellable status), is cached by content, falls back to the probe light if it cannot run, and is cheaper to draw than the probe light, so it also helps weak machines. Use it for interiors, photo-built rooms and showcase houses that look flat or too evenly lit; skip it for outdoor games. Stored in the world (environment.lightBake) as one undo step. After it applies, look again at the renders: if it does not help, set quality off or another quality; do not bake to make a number match.',
    inputSchema: {
      type: 'object',
      properties: {
        quality: { type: 'string', enum: [...BAKE_QUALITIES] },
        samples: { type: 'integer', minimum: 8, maximum: 512 },
        message: { type: 'string' },
      },
      required: ['quality'],
      additionalProperties: false,
    },
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
  find_model: z.object({
    what: z.string().min(1).max(120),
    style: z.string().max(40).optional(),
    category: z.enum(ASSET_CATEGORIES).optional(),
    look: z.enum(['realistic', 'stylised', 'low-poly', 'any']).optional(),
    color: z.string().max(40).optional(),
    size: z.array(z.number().finite().min(0).max(500)).min(1).max(3).optional(),
    limit: z.number().int().min(1).max(8).default(4),
  }),
  inspect: z.object({ ids: z.array(z.string().max(64)).max(TOOL_LIMITS.MAX_INSPECT_IDS).optional(), groups: z.boolean().optional() }),
  run_verification: z.object({}),
  shape_land: LandInput,
  tune_feel: TuneFeelInput,
  tune_look: TuneLookInput,
  bake_light: BakeLightInput,
  make_texture: MakeTextureInput,
  finish: z.object({ message: z.string().max(TOOL_LIMITS.MAX_MESSAGE).default('') }),
} as const;

/** True when `name` is one of {@link AGENT_TOOLS}. */
export function isAgentTool(name: string): name is AgentToolName {
  return Object.prototype.hasOwnProperty.call(ToolInputs, name);
}
