# Agent tools reference

This page lists every tool the model can call while it builds or edits a world. It also covers the loop that drives
those tools, the offline planner, the model providers, the safety rules, and the tools the `aether mcp` server
exposes. Everything here was read from the code, and each section names its source files. Package contracts are in
[CONTRACTS.md](CONTRACTS.md). How to set up and use the MCP server is in [MCP.md](MCP.md).

The model makes the decisions. The tools measure, validate, and either apply an edit or refuse it with a reason
and a fix. A tool result is plain text written for the model. A refusal never stops the rest of the batch.

## Contents

- [Where the tools are defined](#where-the-tools-are-defined)
- [Common rules](#common-rules)
- [World editing](#world-editing)
- [Architecture](#architecture)
- [Level and terrain](#level-and-terrain)
- [Assets and code](#assets-and-code)
- [Eyes: inspection, measuring, renders](#eyes-inspection-measuring-renders)
- [Verification and playtest](#verification-and-playtest)
- [Photo to room](#photo-to-room)
- [Generation brief and richness review](#generation-brief-and-richness-review)
- [Conversation control](#conversation-control)
- [How the loop works](#how-the-loop-works)
- [Offline planner](#offline-planner)
- [Providers](#providers)
- [Safety](#safety)
- [MCP server tools](#mcp-server-tools)

## Where the tools are defined

| Tool set | Names | Source |
| --- | --- | --- |
| Planner tools (`AGENT_TOOLS`), 19 | `apply_patches`, `build_architecture`, `design_plan`, `place_items`, `edit_items`, `query_scene`, `write_generator`, `write_script`, `request_asset`, `search_assets`, `find_model`, `simready_search`, `import_asset`, `inspect`, `run_verification`, `shape_land`, `tune_feel`, `tune_look`, `finish` | `packages/agent/src/tools.ts` |
| Level tools (`LEVEL_TOOLS`), 2. Added after `AGENT_TOOLS` only when the host passes `AgentOptions.levelTools` | `query_level`, `place_level_items` | `packages/agent/src/tools.ts`, run by `packages/playtest/src/level/index.ts` |
| Compact profile (`COMPACT_TOOLS`), 2. Used by small on-device models | `apply_patches`, `finish` (short schemas, same validators) | `packages/agent/src/tools.ts` |
| Tools given to sub-calls, 6. The planner never sees these | `submit_generator` (coder), `describe_room`, `sample_photo`, `report_verdicts`, `report_judgement`, `reconcile_room` (photo flow) | `packages/agent/src/coder.ts`, `packages/agent/src/photo/prompt.ts` (`describe_room`, `sample_photo`, `report_verdicts`), `packages/agent/src/photo/judge.ts`, `packages/agent/src/photo/reconcile.ts` |
| MCP server tools, 13 | `create_world`, `edit`, `apply_patch`, `list_entities`, `get_entity`, `get_world_summary`, `verify`, `playtest`, `replay`, `render_still`, `export`, `undo`, `redo` | `apps/cli/src/mcp/tools.ts` |

The table names 24 model-facing tool names inside the agent (16 + 2 + 6) and 13 MCP tools. `COMPACT_TOOLS` reuses
two of the planner names.

The executor is `packages/agent/src/executor.ts`, and the loop is `packages/agent/src/agent.ts`. The system prompt
(`packages/agent/src/prompt.ts`) explains how to use the tools and gives the patch payload format. The patch format
is kept out of the tool schemas because the full World IR schema would be too large for every request
(`tools.ts`, header comment).

## Common rules

These rules come from `executor.ts`, `tools.ts` and `@aether/arch` `scene/dispatch.ts`.

- **Validation.** Every argument is treated as untrusted. A string instead of an object is refused ("not valid
  JSON"). Input larger than `TOOL_LIMITS.MAX_INPUT_CHARS` (600,000 serialized characters) is refused. Each tool
  then checks its own zod schema, and the first 8 issues are reported.
- **Unknown tool names** get back a list of the available tools.
- **Undo.** Every editing tool commits one undo step, through `AgentHost.applyPatches`. The host checks the
  patches again.
- **Result size.** The executor cuts results at 20,000 characters (`MAX_RESULT_CHARS`). Entity JSON from
  `inspect` is cut at 3,000 characters per entity. Design-tool text is cut at 14,000 (`DESIGN_LIMITS.MAX_TEXT`)
  and level-tool text at 6,000 (`LEVEL_LIMITS.MAX_TEXT`). At most 25 refused patches or ops are listed by index.
- **People.** After `apply_patches`, `build_architecture`, the design tools and the level tools, any added or
  changed entity that stands for a person but has no `character` gets a rigged character. This is one extra undo
  step, and the result carries a note saying so (`attachPeople`, using core `characterPatches`).
- **Text limits.** Commit messages are cut to 200 characters. `TOOL_LIMITS.MAX_MESSAGE` is 2,000 characters.
- **Claims and refusals.** The shared wording is in `packages/agent/src/claims.ts`. A report claims only what the
  evidence shows (what was measured or seen, at which view, against which limit) and ends with a `Not checked:`
  list (`NARROW_CLAIM`, used by the building and level review turns, the stall ask, the critic and `finish`). A
  refusal from `place_items` or `edit_items` is a constraint of the room (a door the piece would block, a room too
  small for it), to be solved with another size, wall or room, never resent unchanged or worked round with
  `apply_patches` (`REFUSAL_IS_A_CONSTRAINT`).
- **Empty-world guard.** An edit that would leave a world that had entities with none is refused, whole, with
  the count and the two ways forward (`emptyWorldRefusal`). `apply_patches` applies the batch to a copy first; a
  `startOver: true` flag (set only when the user asked to start over) skips the check. A `clear` followed by new
  content in the same batch ends non-empty and passes. `edit_items` `remove` carries the same check.

## World editing

### `apply_patches`

- **What it does.** Edits the World IR with a list of patch operations. The ops are `add`, `update`, `remove`,
  `rename`, `addRule`, `updateRule`, `removeRule`, `setEnvironment`, `setPlayer`, `setState`, `setHud`,
  `defineGenerator`, `defineScript`, `addTest`, `removeTest`, `setMeta`, `clear`, `removeGenerator` and
  `removeScript` (`PATCH_OPS`). The voxel ops `setVoxel` and `voxelEdit` are described in the system prompt.
- **Input.** `{patches: object[1..400], message: string, startOver?: boolean}`. 400 is `TOOL_LIMITS.MAX_PATCHES_PER_CALL`. `startOver` is set only when the user asked to start over; without it a batch that leaves the world with no entities is refused (see the common rules).
- **Returns.** `Applied N/M patches. The world now has K entities.`, then each rejected patch as
  `[index] op: reason`. Valid patches still apply. The call counts as an error only when nothing applied.
- **Extra handling.** These are in `applyPatchesTool`, in this order:
  0. **Empty-world guard.** The batch is applied to a copy; if the world had entities and would have none, the
     whole call is refused unless `startOver` is true.
  1. **Realistic swap.** When the request wants a realistic look, the low-poly nature generators are swapped for
     the realistic set, and the result says so (`makeRealistic`).
  2. **Dependents move with their owner.** When a patch moves an entity, the entities that belong to it (a light,
     a goal zone, a plinth) move too, unless the batch places them itself (`carryDependents`, core
     `carryPatches`).
  3. **Minimal-edit guard.** If the request was classified as a small edit, the whole batch goes through
     `auditPatches` (`packages/agent/src/refine/guard.ts`). The batch is refused, with nothing applied, when it
     changes existing entities outside the request's scope. With no identified target, up to 8 unrelated existing
     entities may change (`UNTARGETED_LIMIT`). With a target, none may. New entities are always allowed, and so are entities the assistant itself added earlier in the same turn (a failed first attempt may be replaced or removed). What a target owns counts as the target: dependents, and pieces whose id starts with the target's id and a name (`shrine` owns `shrine-torii`, but `wolf-2` is a sibling, not a piece of `wolf`). The
     refusal tells the model to resend property-level `update` patches. The guard applies only to
     `apply_patches`.
  4. **Library generators.** Library generators that the patches reference are defined first, as their own undo
     step (`libraryDefinitions`).
  5. **Notes.** The result adds a note when water was added as a flat primitive, or a hill was made from a
     primitive. Both notes point to `shape_land`.
- **When to use it.** For any world content that has no more specific tool: entities, rules, environment, player,
  tests and HUD. Small requests should be property-level `update` patches (system prompt, "Refining").

## Architecture

The four design tools come from `packages/arch/src/scene/dispatch.ts` (`DESIGN_TOOL_NAMES`, `DesignToolInputs`,
`DESIGN_LIMITS = {MAX_ITEMS: 40, MAX_EDITS: 40, MAX_QUERIES: 12, MAX_TEXT: 14000, MAX_REF: 100}`). The executor runs
them in `designTool`. They measure against the document, return the accepted steps as patches, and return
refusals as text with a fix.

### `design_plan`

- **What it does.** Builds the building's shell from a written plan, before anything is placed. The shell is
  walls, floors, doors, windows and stairs. It is built at the exact positions in the plan and read back with the
  built opening ids. Nothing is furnished.
- **Input.** `{plan}` (validated inside `@aether/arch`). The plan holds:
  - `id`, `name`, `style`, `brief`, `programme[]` and `circulation`.
  - `levels[]`, each with `height` (floor to floor), rooms as rects `[x0,z0,x1,z1]` (x east, z south, neighbours
    share edges), `openings[]` (`kind`, `room`, `wall`, `along`, `width`, `height`, `sill`, `to`, `main`) and
    `stairs[]` (`{room}` to fit one, or exact `{at, heading, shape, width}`).
  - `furniture[]` with `relations` (`against_wall`, `centred_on_wall`, `in_corner`, `flanks`, `beside`,
    `above_centred`, `centred_on_opening`, `on_top`, `faces`).
  - `roof`, `site`, `exteriorWall {finish}` (a light brick, plaster or cladding) and `facade` (see below).
  - **Facade.** A building made from a design plan gets its front by default (`packages/arch/src/facade.ts`): an entrance
    with a door surround (two pilasters and a lintel) and a canopy on two columns, a cornice band round the roofline, a
    paved forecourt in front of the entrance, a lamp post at each corner of it (with a real light), trough and urn
    planters, two benches facing the street, and a warm light under the canopy. `facade {sign: "NAME"}` adds a sign with
    block lettering in an emissive material on a dark panel (`arch-sign`, 5 x 7 pixel face, standing on the canopy; its own
    real light); `canopy`, `doorSurround`, `cornice`, `forecourt`, `lamps`, `planters`, `bench`, `light` each switch a part
    off, `surround` (box, board, stone, none) sets the window surrounds, `signColor` and `signPanel` the colours;
    `facade: false` keeps a bare front. `build_architecture` `set_facade {building, facade}` changes it later (merged into
    the stored plan, re-compiled). Without a `facade` on a plan (photo rooms, hand-written plans) nothing changes: the
    style's own articulation stays.
- **Returns.** The built shell, or a refusal that says what to change.
- **When to use it.** First, for any building, apartment, room or interior (system prompt, "Buildings").
  Sending it again revises the shell, and pieces already placed stay.

### `place_items`

- **What it does.** Places pieces from the parts library into rooms. Each item is measured. It is refused, with a
  reason and a fix, when it would overlap, cross a wall, cover a door or window, block a doorway or a door swing,
  or wall a room in.
- **Input.** `{items[1..40], building?, message?}`. Each item (`PlaceItemInput`, strict) has:
  - `kind` or `asset`, `room`, `level?`, `id?`, `name?`, `params?` and `opening?` (the window, for curtains and
    blinds).
  - A real model: `kind: "model:<id>"` (or `model: "<id>"`) places a library model found with `find_model`; the model
    stands in for the catalogue kind that mounts the way it does (sofa, lamp, picture...), so anchoring, collisions,
    clearances and seating work as for a part. `model: "auto"` with a `kind` lets the finder choose by the building's
    style, `params.color` and `fit`; when nothing fits, the parametric part is placed and the answer says so.
    `fit: [w,h,d]` (metres, 0 for a side that does not matter) scales the model within 0.5x to 2x. `params.color`
    (`#rrggbb`) recolours upholstery models (their main material is named `paint`). Models do not open: wardrobes,
    cabinets and kitchens stay parts.
  - A target: `wall` with `t` or `align`, or `at [x,z]`, or `on` (a host piece) with `offset`. Optional `edge`,
    `gap`, `y`, `yaw` and `faces`.
- **Curtains and blinds.** A `curtain` item with `opening` hangs one panel on each side of that window (two
  entities), whatever `params` say: `params.panels` is forced to 1 and any `gap` is dropped (`placeCurtain`,
  `packages/arch/src/scene/edit.ts`). `params.width` is the gathered width of one panel. A drawn curtain
  (`params.closed` above 0) gets a reach of 0.2 m. When `params.pelmet` is `box`, `valance` or `swag`, one pelmet is
  made across both panels and the panels carry none. A `blind` hangs centred over the window. A description or a
  call that asks for `panels: 2` with a `gap` therefore no longer makes pairs that cover the glass and are refused.
- **Crafted procedural kinds.** These parts carry real shape (swept poles, lofted ceramic, woven strands) and read as
  the object in a render. Aliases such as "rattan chair", "wicker chair", "pedestal sink", "washbasin", "refrigerator",
  "cooker" and "range hood" resolve to them.
  - `cane-chair`: rattan frame with woven-cane seat and back. `variant` `dining` | `bar` | `stool`, `height` (seat
    height m; bar 0.65-0.75), `frame` finish, `tint` (frame colour), `cane` (weave colour).
  - `sink`: standalone basin. `style` `pedestal` | `wall-hung` | `vessel` | `utility`; `width` (0 = style default),
    `color` (ceramic), `tap` finish, `top` and `body` (vessel console / utility fronts), `bowls` 1-2 and `drainer`
    (utility). A bathroom cabinet with a basin is still `vanity`.
  - `fridge`: `layout` `bottom-freezer` | `single` | `side-by-side` | `french`, `width`, `height` (0.85 for an
    under-counter fridge), `finish`, `interactive`.
  - `oven`: freestanding cooker with hob, grates, knobs and a glazed door. `width` (0.9+ gives six burners),
    `finish`, `color`, `trim`. `extractor`: wall cooker hood; `width`, `height` (flue), `finish`.
  - `rug` also takes `pattern` `diamonds`, `kilim` and `shag` (high pile, 3 cm) besides `plain`, `zigzag`, `stripes`.
  - **Venue and public-space parts** (`packages/arch/src/furniture/venue.ts`, `civic.ts`, `world.ts`; each one mesh per material, under 5k triangles, so copies instance): `cinema-seat` (flip-up padded seat, head roll, armrests, cup holder, `seatUp`), `tier-steps` (stepped floor, `rows`, `riser`, `growth`), `cinema-screen` (frame, velvet masking, curved glowing picture), `stage` (deck, fascia, steps, pleated `curtains` open/closed, valance, backdrop), `speaker` (cabinet, surround, column, monitor), `acoustic-panel` (fabric, slat, diffuser), `booth-port` (projection booth window), `step-light`, `lectern` (lectern, podium, pulpit), `pew`, `altar`, `library-stack`, `vitrine` (case, plinth, table; exhibit vase, bowl, bust, urn), `reception-desk` (reception, concession, bar with back bar), `school-desk`, `blackboard`, `treadmill`, `weight-bench` (flat, incline, rack with barbell), `dumbbell-rack`, `hospital-bed`, `bus-stop`, `market-stall`; and the small pieces that make a venue read as the real place (`packages/arch/src/furniture/display.ts`): `statue` (robed figure, bust or abstract on a plinth; marble, bronze, stone or patina), `rope-stanchion` (post, ball top and velvet rope sagging to the next post; `shape_land along` sets the span from the spacing), `plaque` (wall label: card, brass or slate), `place-setting` (plate, napkin, fork, knife, spoon, wine and water glass), `candle` (votive, taper or pillar with an emissive flame), `column` (round, fluted, square or wall pilaster), `ceiling-baffle` (fin, raft or coffer hung from the ceiling) and `planter` (trough, urn or round, with shrubs, flowers or grass); `art` takes `frame: "gilt"` and `subject: "landscape" | "portrait"`. `furnitureByKind` and `place_items` resolve aliases ("theatre seat", "display case", "church pew", "concession counter", "painting", "table setting", "velvet rope", "wall label", "tea light", "pillar", "acoustic baffle", "potted plant").
  - **Discovery: `find_model`** lists the crafted parts that match the words first (`findCrafted`, aliases per part), each with its parameters and how to place it (free world: shape `{kind:"procedural", generator:"furn-..."}`; many: `shape_land`; in a room: `place_items {kind}`), then library models.
- **Returns.** Accepted and refused items, with measurements.
- **When to use it.** After `design_plan`, for every planned piece.

### `edit_items`

- **What it does.** Applies measured edits to pieces already placed.
- **Input.** `{edits[1..40], building?, message?}`. Each edit is one of (`EditItemInput`):
  - `move {ref, wall|edge, t|align, at, on, offset, y, yaw, faces, gap}`
  - `rotate {ref, yaw|delta|faces}`
  - `resize {ref, params}`
  - `remove {ref}`
  - `snap_to_wall {ref, wall?, edge?, t?, align?, gap?}`
  - `anchor_to_opening {ref, opening, mode?: centre|left|right, gap?, y?}`
  - `center_over {ref, target, gap?}`
- **Returns.** Accepted and refused edits.
- **When to use it.** To fix what the review reports. The tool description says: "never rebuild a room to move
  one piece". The photo flow also uses it to fit pieces to their boxes in the photo (`layoutStep` in
  `photo/pipeline.ts`).

### `query_scene`

See [Eyes](#query_scene-1).

### `build_architecture`

- **What it does.** Applies declarative operations to building plans (`applyArchOps`, `packages/arch/src/ops.ts`).
  The plan compiles to walls, floors, ceilings, doors, windows, stairs, roof, furniture and lights. After that,
  every touched building is checked for usability: rooms reachable on foot, doors swing free, furniture grounded.
- **Input.** `{ops[1..40], message}`. 40 is `MAX_ARCH_OPS`. The ops (`ArchOp`) are:

  | Op | Key fields |
  | --- | --- |
  | `create_building` | `plan`, `walkthrough` (default true) |
  | `remove_building` | `building` |
  | `add_level` | `building`, `level` |
  | `add_room` | `building`, `level` 0..5, `room`, `doors[≤8]` |
  | `remove_room` | `building`, `room` |
  | `add_door` | `building`, `level`, `door` |
  | `add_window` | `building`, `level`, `window {room, count?, width?, side?}`. Without `side`, the room's widest clear exterior wall is used |
  | `add_stairs` | `building`, `level` (the lower level), `stair {room}` or `{at, heading, shape?: straight\|l\|u, width?}` |
  | `set_roof` | `building`, `roof` |
  | `set_style` | `building`, `style` |
  | `furnish_room` | `building`, `room`, `furnish`, `items[≤60]?`, `omit[≤20]?` |
  | `place_item` | `building`, `room`, `item` |
  | `remove_item` | `building`, `room`, `kind` |
  | `set_wall` | `building`, `room`, `wall` (compass or `all`), `material?`, `dado?`, `clear` |
  | `set_material` | `building`, `target: exterior\|roof\|floor\|walls`, `room?`, `material` |
  | `set_residents` | `building`, `count` 0..8 |
  | `dress_room` | `building`, `room` (id or `all`), `dress` |
  | `set_site` | `building`, `site {garden?, surroundings?: none\|estate, planting?, terrace?, pool?}` |
  | `set_facade` | `building`, `facade {sign?, canopy?, doorSurround?, cornice?, forecourt?, lamps?, planters?, bench?, light?, surround?}` or `false` |

- **Returns.** One line per applied op. Each refused op comes back as `[index] op code: message Fix: hint`. If a
  usability report fails, the result says what to fix. The call counts as an error only when every op was
  refused and nothing was patched.
- **Stairs.** `add_stairs` uses `fitStair` and `checkStair` (`packages/arch/src/stair-fit.ts`). A stair on level
  `li` climbs that level's storey height. A stair is refused, with the measurements and a stair that does fit,
  when it:
  - crosses a wall,
  - blocks a doorway (it must keep `STAIR_DOOR_CLEARANCE` 0.5 m beyond half the door width), or
  - arrives on no floor upstairs.

  A good stair has `STAIR_LANDING` (0.9 m) of clear floor at each end. The minimum is `STAIR_MIN_LANDING`
  (0.6 m). `fitStair` searches the rooms along their walls, every heading, trying straight, then L, then U.
- **When to use it.** For structural edits after `design_plan`: add a level, room, door, window or stairs, or set
  the roof, style, wall, material or residents. After the main pieces, `dress_room {room:"all"}` adds rugs,
  lamps, plants and curtains. Do not use `dress_room` for a room copied from a photo. A house on its own plot gets
  `set_site {garden:true, surroundings:"estate"}` (system prompt, "Buildings"). The checker's `room_sparse` and
  `no_grounds` findings name these two ops as the fix (`packages/arch/src/scene/checks.ts`).

## Level and terrain

### `shape_land`

- **What it does.** Builds real ground for outdoor worlds, as one undo step (`packages/agent/src/land.ts`,
  `LandInput`). Everything it adds is tagged `land`. Heights come from the same heightfield physics uses, so
  `query_level` and `place_level_items` agree with it.
- **Input.** One of these ops (land, mound, path, grid, tier, wall, along, around, perimeter, row):
  - `{op:"land", kind: meadow|forest|snow|canyon, size 120..800 (420), relief 0..120 (48), color?, plot?
    {x, z, radius 4..200 (20)}, stream? {z, half 1..12, bend 0..30, depth 0.4..4}, lake? {x, z, radius 3..120,
    depth 0.5..10}, woods? {conifers ≤400, broadleaf ≤400, birch ≤200, scrub ≤600, boulders ≤200}, cover? {grass?,
    flowers[≤4]?, radius 5..150, density 0..2}}`. It replaces the land it built before.
  - `{op:"mound", x, z, size 4..300 (24), height 0.5..60 (5), top 0..0.6 (0.25), roughness 0..1, ridge, color?,
    name?}` raises a natural hill with a level summit.
  - `{op:"path", points[2..64], width 0.6..14 (1.8), surface: soil|gravel|cobble|sand|decking|asphalt|dry-earth,
    color?, name?}` lays a path over the terrain.
  - `{op:"tier", at:[x,z], rows 1..40, seatsPerRow, of ("furn-cinema-seat"), facing, aisles (1), aisleWidth (1.1), rowDepth (1.05), riser ("auto" | m), screenDistance (6), screenBottom (1), eye (1.1), clearance (0.12), stepLights (true), finish, color}` builds a raked auditorium (`packages/agent/src/layout.ts`): one `furn-tier-steps` floor, one instanced seat block with each seat at its row's tread height, optional aisle step lights; `at` is the centre of the front row, `facing` (north is -Z, south +Z, east +X, west -X, or yaw degrees) is where the seats look. `riser:"auto"` solves a rise and growth per row so each row sees the bottom of the screen `clearance` over the eye in front (`solveTier`); the answer reports front and back row positions, the back tread height and the tightest clearance, and says when the rise had to be capped. At most 2000 seats.
  - `{op:"wall", from:[x,z], to:[x,z], of ("furn-frame"), params, variants:[params...], count | spacing, y (1), facing, inset (0.4), gaps:[[t0,t1]...], offset (0.02), light:{every, type, color, intensity, range, rise, out}}` hangs N pieces along one wall in one call (`layout.ts`, `alongPatches`): evenly spaced from the wall's two ends (its inner face), all looking away from the wall (default to the left of `from` to `to`), one instanced entity per variant (variants are taken in turn, so a gallery has different subjects and frames), stretches in `gaps` left empty for doors and windows, and optional real lights beside every `every`-th piece (an instanced piece lights nothing; at most 24 lights). `{op:"along", from, to, of, count | spacing, y, facing, variants, light}` is the same on a free-standing line: display cases down a hall, columns, lamps, stools along a counter.
  - `{op:"perimeter", at:[[x,z],...], table:{of:"furn-table", params, yaw}, of ("furn-chair"), shape ("rect" | "round"), long (2), ends (0), count (4, round), size, gap (0.18), facing ("in" | "out"), settings:{of:"furn-place-setting", y (0.75), inset (0.24)}, centre:{of:"furn-candle", y}}` puts the table and its seats at every listed position in one call, with a cover (plate, glasses, cutlery, facing the seat) at every seat and a piece in the middle of every table when `settings` and `centre` are given (14 tables of 4 are 56 covers and 14 candles in the same call) (14 tables of 4 is 56 seats and 14 tables in four or five instanced entities, each seat looking at its table); the answer gives the table spacing that keeps walkways clear.
  - `{op:"around", rect:[x0,z0,x1,z1], of, mode ("along" stands the pieces in a line inside each wall | "wall" hangs them), spacing | count (per side), y, inset (0.6), offset (0.3 off the wall), sides (all four), gaps:{north:[[t0,t1]],...}, variants, params, light}` places the same piece on every wall of a rectangular room in one call, all facing in (`layout.ts`, `aroundPatches`: four `along` runs): columns or pilasters round a hall (`furn-column`, variant "pilaster" flush, y 0), planters, sconces, panels, stanchions.
  - `wall` and `along` also take `labels:{of ("furn-plaque"), y (1.25), side ("right" | "left", as seen from the room), gap (0.12), params}`: a small piece beside every piece in the same call (30 paintings get 30 wall labels). A piece with a `span` param (`furn-rope-stanchion`) gets the pitch as its span unless the call sets one, so a line of posts is one continuous rope. Ceiling baffles or coffers are a `grid` with `y` at the ceiling height; statues are an `along` run.
  - `tier` puts step lights on every riser along each aisle and along both outer edges of the block when the margin is 0.3 m or more (rows minus one, times aisles plus two).
  - `of` takes a generator id or the plain name of a crafted part ("chair", "painting", "display case"). They work inside a building by world coordinates.
  - `{op:"grid", at:[x,z], cols, rows, of, params?, spacingX?, spacingZ?, facing?, aisles?, aisleWidth?, y?}` one instanced entity of rows by columns (a nave of pews, a classroom, a restaurant floor, library stacks), aisles splitting each row into blocks; at most 3000 pieces.
  - `{op:"row", points[2..64], of: generator id (built-in, library or defined), spacing 0.25..60 (4), jitter 0..1
    (0.25), scale [lo, hi] (0.85..1.15), params?, sides: centre|both + offset 0..40 (m off the line), name?}` strings
    trees, a hedge, fence posts or props along a polyline (an avenue, a bank, a boundary). One instanced scatter entity
    with explicit points, each point on the ground height at its x,z. Refused (nothing applied) for an unknown
    generator or more than 2000 instances.
  - Coordinates are within ±2000 m.
- **Returns.** A summary of what was built (`landPatches`), or the patches that failed.
- **When to use it.** First, for any outdoor world. Then place things, then lay paths (system prompt, "Levels").
  Rivers and lakes come from `land`, never from a flat box of water. A canyon is `kind:"canyon"` with an asphalt
  path along its floor.

### `tune_look`

- **What it does.** Look development: the assistant sets how light and colour are presented, after it has looked at
  renders (`packages/agent/src/look-edit.ts`, `TuneLookInput`, `lookPatches`). The values are stored in the World IR
  (`environment`, `environment.grade`, `environment.look`) by one `setEnvironment` patch, so it is one undo step with a
  diff, survives saving and sharing, and every render (studio, stills, the review images) respects it. The renderer's
  constants (`INTERIOR_WARMTH` 0.45, the grade presets, vignette 0.22 and so on) are only the defaults. Nothing in it
  judges: the assistant decides, from the pictures, what to change and when it is good enough.
- **Input.** All optional; omitted fields stay as they are. Exposure: `exposure` 0.1..4 (1), `exposureEv` -3..3,
  `bloom` 0..3, `ambientIntensity` 0..8 (0.4), `sunIntensity` 0..16 (2.5), `hdriIntensity` 0..8. Colour: `temperature` and `tint` -1..1,
  `saturation` 0.4..1.8, `contrast` 0.6..1.6, `sunTint`, `ambientTint`, `foliageTint` (`#rrggbb` multipliers; white
  keeps the colour). Fog: `fogColor`, `fogDensity` 0..1 (required when the world has no fog), `fogVisibility` 30..20000 (metres).
  Lighting intent: `intent {key: dim | moderate | bright, text}`; the renderer derives the exposure from the picture at eye height against it, `exposure` / `exposureEv` only bias it (so state the intent, do not crank the exposure). Review turns also carry advisory histograms of the images (mean, washed and crushed shares). Interiors: `interiorWarmth` -1..1.5 (0.45), `interiorBalance` 0..1.5 (1), `lampStrength` 0..3 (1). `vignette`
  0..1 (0.22). Exterior context beyond the plot (`environment.surroundings`, see `docs/CONTRACTS.md`): `surroundings` (preset
  `none | meadow | countryside | woodland | suburb`), `hills` 0..200 (ridge height, m), `hillDistance` 150..1500 (m), `treeDensity` 0..1,
  `treeSpecies` `broadleaf | conifer | mixed`, `farFields` (boolean), `clearRadius` 10..400 (m kept free of trees); every field after the
  preset overrides it. `reset: ['surroundings']` removes the whole block. `reset` lists names to put back to the default (`fog` removes the fog). `message` (≤200) is the history
  line.
- **Exterior context.** A room built from a photo or a plan stands on a lawn; a photo room carries `surroundings: { preset: 'countryside' }`
  from the photo flow (`derive.ts`), so a window shows hills, a tree line and fields under a sky, not an empty plane to a white horizon.
  The assistant changes it with `tune_look` (cheap: instanced trees, two hill layers and one field ring, no physics, no effect on the baked
  light) and adds specific props near the house (a fence, a hedge, three named trees) with `find_model` and `place_items`.
- **Returns.** `Look changed: exposure 1 -> 1.4; grade.temperature default -> 0.2.` or "Nothing changed: those values
  are already set", plus refused parts.
- **When to use it.** In a review round or a photo compare round when the pictures show the whole image reading
  cold, dark, flat or washed out; instead of repainting surfaces to compensate. The system prompt does not describe
  it; the detail is in the tool description. The photo flow hands the assistant the measured brightness, white point,
  saturation and tonal spread of photo and render as data (`lookEvidenceText`) and does not change the look itself.

### `make_texture`

- **What it does.** Gives a surface or a piece a real texture and says which source it came from
  (`packages/agent/src/textures.ts`, `makeTextureTool`). Offered when the host can store pictures
  (`AgentOptions.textures`; the studio always offers it, with an image generator when one is connected). Sources, in order:
  an image model (a `prompt` and a connected Codex image tool or OpenAI Images key; `from_photo_region` sends a crop of the
  photo as a reference), the user's photograph (floors and walls rectified through the solved camera, pieces cropped from
  their boxes), the procedural library (nearest finish; removes an older texture). The picture is de-lit, made seamless,
  turned into albedo / occlusion-roughness / normal maps in three tiers and kept in the project's asset store; floors
  and walls carry it as `MaterialSpec.texture` in the stored plan (`set_material` / `set_wall`, so it survives a re-compile),
  pieces as `arch.skins` on the piece. The colour of the surface becomes the source's mean colour; the maps hold ratios around it.
- **Input.** `target` ("floor", "wall:north", "walls", a piece id or kind), `prompt?` (<=300), `from_photo_region?` (true, or
  `[x0,y0,x1,y1]` in 0..1 of the photo), `tileable?` (default true), `tile?` (metres of one tile, 0.1..8), `finish?`
  (material class word), `source?` (`auto` | `photo` | `ai` | `procedural`), `room?`, `message?`.
- **Returns.** One line per target: the source used and its caution (clean square, coverage, pattern contrast, tile size) and,
  after `| not used:`, why the other sources were not (no image model connected, the photo does not show it, the model failed).
  Then `Provenance: <target>: photographed | AI-generated | procedural`. The assistant is told to look at the next render beside the
  photo and keep the result only if it reads like the real surface; the numbers are advisory.
- **Photo flow.** Before the first comparison the host samples every floor, wall and soft piece the photo shows clearly
  (`photo/texture-pass.ts`, phase `textures` in the chat) and the compare turn lists `make_texture`; the user message names
  what was photographed and what kept its procedural finish, with the reason.
- **Without an image model.** Nothing changes except the first source is skipped and the result says so. The tool, the photo pass
  and the library path need no network and no key. Details: `docs/IMAGE_GENERATION.md`.

### `query_level`

See [Eyes](#query_level-1).

### `place_level_items`

- **What it does.** Places gameplay items by x,z. Each item is snapped to the ground (`y = ground + above + half
  its height`). It is refused, with the distance, the height gap and the nearest standable spot, when:
  - nothing is under it,
  - it is buried in something solid,
  - a standing item would sit on a cliff (`LEVEL_LIMITS.SLOPE_LIMIT_DEG` is 55), or
  - the player cannot reach it. Reach is checked by default for `pickup`, `goal`, `checkpoint` and `enemy`.

  The role fills in behaviours and a sensor body.
- **Input.** `{items[1..40], message?}` (`PlaceLevelInput`, `packages/playtest/src/level/index.ts`). Each item
  has:
  - `id`, `role: pickup|goal|checkpoint|hazard|enemy|prop|decor|life` (default `prop`), `x`, `z`, `above?`,
    `below?`, `yaw`, `entity?`, `key?` and `reach?`.
  - Without `entity`, the call moves an existing item.
  - For `role:"life"`: `species`, `count` 1..24 (`MAX_LIFE_COUNT`), `radius` 1..150 (8) and `perch?`. One call
    adds at most 60 animals (`LIFE_LIMIT`).
  - Species: deer, doe, cat, sheep, cow, horse, pig, dog and fox stand on ground. Bird, crow, seagull, hawk and
    parrot fly or perch. Butterfly flies at flower height. Fish and koi swim in water at least 0.3 m deep. Duck
    floats on water (`packages/core/src/life.ts`).
  - Coordinates are within ±5000 m.
- **Returns.** Placed and refused items with measurements. All placed items are one undo step.
- **When to use it.** For everything the player must reach. Do not guess y. Fix only the refused items. In the
  review loop, use it to move items (system prompt, "Levels"). The loop also calls it for a local "move X onto
  the hill" edit, to set the object on the measured surface (`settleOnGround` in `agent.ts`). From that call the
  loop keeps only transform `update` patches of the moved objects and the entities that belong to them.

## Assets and code

### `search_assets`

- **What it does.** Searches the asset library (`@aether/assets` `searchAssets`): real-size furniture, plants,
  trees, rocks, buildings, street props, vehicles, animated characters and animals, food, tools and HDR skies.
  Material entries are filtered out.
- **Input.** `{query ≤120, category?, limit 1..20 (8)}`. `category` is one of `ASSET_CATEGORIES` (17 values).
- **Returns.** One line per hit: `id — name [category]`, with the size in metres, where it goes when it is not on
  the floor, and whether it is animated. HDRIs come with a `setEnvironment {"hdri": id}` hint, and generators
  with their procedural shape. Places with `shape {"kind":"asset","id"}`. If the library is not loaded, the
  result says so.
- **When to use it.** For everyday objects, ahead of primitives (system prompt, "Guidelines").

### `simready_search`

- **What it does.** Looks for a candidate model outside the library in NVIDIA SimReady Central (`searchSimready` in
  `@aether/assets`; see [ASSETS.md](ASSETS.md#simready-central)). Read-only: it downloads and imports nothing.
- **Input.** `{query ≤120, max_size? (metres, longest side), limit 1..10 (5)}`.
- **Returns.** Only hits whose package and dataset card both carry an accepted licence (CC0, CC BY 4.0, MIT, Apache-2.0, BSD): package,
  licence, author, dataset and USD size, whether the model is already in the library (then its id), else the
  `npm run assets:simready -- fetch <repo>@<revision>/<package>` command a developer runs. Then how many hits were rejected and why
  (non-commercial, no-derivatives, share-alike, custom or missing licence). If the service cannot be reached (offline, or from a
  browser page, whose content-security policy does not allow the origin), the result says so and is not an error.
- **When to use it.** After `find_model` and `search_assets` found nothing that reads as the object. A candidate cannot be placed until it is imported (`import_asset` does that on the local server; without one):
  the agent names the one it would import, uses the nearest library model or a crafted part meanwhile, and the user decides.
  The service is mostly small robotics props, so check the size.

### `import_asset`

- **What it does.** Brings one model that the library lacks into the project, on the local Aether server: SimReady search,
  licence gate (CC0, CC BY 4.0, MIT), pinned download, USD to glTF conversion, reduction to at most 20,000 triangles
  ([ASSETS.md](ASSETS.md#importing-while-you-work)). The host (`AgentOptions.importAsset`, the studio's `AssetController.importModelFromServer`)
  stores the GLB with the project as a user asset carrying the CC BY credit line, so exported and published games embed it and list it.
- **Input.** `{query ≤120, max_size? (metres)}`.
- **Returns.** The asset id (`user-<hash>`), name, size, triangles, licence and the credit, with the placement lines
  (`shape {"kind":"asset","id"}`, or `place_items {"kind":"model:<id>"}` in a room). Progress (searching, licence, downloading,
  converting, optimising) goes to the step feed, the status line and a toast while it runs, up to about a minute.
- **Without a local server** (the hosted page, a server with imports off, the Python tools not installed) it answers that importing
  needs the local server, or `conversion tools not installed: run npm run assets:simready-setup`, and is not an error: the agent
  carries on with the nearest library model or a crafted part.
- **When to use it.** After `find_model` and `search_assets` found nothing (and `simready_search` showed a candidate exists).
  It counts as read-only for the review loop (it changes the project's assets, not the world).

### `find_model`

- **What it does.** Ranks the real-size, photographed models of the library (`@aether/assets` `findModels`) by what the
  piece is, the design style or biome, the colour and the size wanted. Interiors: sofas, armchairs, chairs, tables, beds,
  shelves, lamps, plants, vases, books, mirrors, pictures, clocks, small appliances. Outdoors and beyond (Poly Haven,
  CC0): rocks, boulders, cliffs, dead trunks, quiver trees, ferns, succulents, branches; street furniture (street
  lamps, hydrants, barriers, bins, utility boxes, manholes, picnic tables, wet-floor signs, chain-link fence, iron
  gates, covered cars); harbour and coast (ships, buoys, barrels, crates, cannons, chests); industrial and sci-fi
  (pipes, cranes, generators, racks, carts, spacecraft instruments, moon rock); farm and garden (planters, tools,
  bags, sprinkler, gnome); medieval and fantasy (castle door, shields, swords, statues, candlesticks).
- **Input.** `{what, style?, category?, look?, color?, size? [w,h,d], limit 1..8 (4)}`. `what` is free text ("green
  velvet armchair", "sandstone boulder"); its type word picks the models, the other words rank them. `style` is a
  design style (modern, scandinavian, industrial, classic, rustic, vintage...) or a biome word (forest, desert,
  coastal, harbour, urban, industrial, farm, scifi, fantasy, medieval, ...). `category` limits to one catalog category
  (nature, rocks, plants, street, building, vehicles, props, tools, decor, lighting, furniture...). `look` is the art
  style: `realistic` (default, photographed models only), `stylised` or `low-poly` (the Kenney-style kits, including
  the sci-fi base, castle and harbour kits, for cartoon or blocky worlds) or `any`. Stylised kits are never offered to a
  realistic request.
- **Returns.** One line per model: `id — name: size; category, look; styles; colours; where it goes; why it ranked`.
  The model judges the candidates (and later the render) and places one with `place_items` in a room, or with an
  `apply_patches` entity `shape {"kind":"asset","id":"<id>"}` in an open world. Colours are measured from the model's
  own base-colour texture, not written by hand.
- **No exact match.** Crafted venue parts come first (`findCrafted`: statue, rope barrier, wall label, table setting, candle, column, acoustic baffle, planter ...). When the library has no model named like the request (the head noun, `headNoun` and `lacksNoun` in `@aether/assets`) and no crafted part answers, the result says so and tells the model to name the substitute in its notes, pick the nearest piece only if it still reads as the thing, or craft one from primitives; a bench is not a pew and a tree is not a statue. `pew` is no longer a synonym of `bench`.
- **When to use it.** Before placing seating, tables, beds, lamps, plants and decor, before dressing a landscape,
  street, harbour, factory or fantasy set with props, and in the photo compare loop when a piece differs in shape,
  style or colour.
- **Architecture pieces.** Four crafted pieces name structural elements: `furn-spiral-stair` (spiral staircase,
  winding stair, loft stair), `furn-dormer` (dormer window, gable, shed or hip dormer), `furn-turret-roof` (conical
  roof, witch hat roof, tower roof, dome roof) and the `classical` and `ionic` variants of `furn-column` (the
  tapering fluted shaft with base and capital). The same geometry is the structural generators `arch-spiral-stair`,
  `arch-dormer`, `arch-turret-roof` and `arch-column` with `style`
  (`fluted`, `classical`, `pilaster`); a world uses either. A spiral stair needs a stairwell in the floor above:
  `spiralFootprint` gives the outline (a disc without the landing sector); a dormer stands on the roof surface, with
  `dormerPlacement` giving the position and yaw on a roof's side; the wall of a turret stands below its roof's origin.


### `write_generator`

- **What it does.** Defines a custom procedural geometry generator. `source` is the body of
  `function generate(params, api)` and must `return api.build()`.
- **Input.** `{id (slug ^[a-z][a-z0-9-]{1,63}$), description ≤2000, params? (ParamSpec map), source}`.
- **Checks.** The id must not be a built-in id or start with `arch-` or `furn-` (reserved for buildings). The
  definition is parsed with core `GeneratorDef`, then the host's `validateGenerator` checks it in a sandbox.
- **Returns.** The generator id and its params, or the validation error (cut to 2,000 characters) so the model
  can fix it and call again.
- **When to use it.** Only when no built-in or library generator fits. For anything non-trivial, use
  `request_asset` instead.

### `request_asset`

- **What it does.** Hands a generator to a specialist coder, in two stages (`requestAssetTool`):
  1. **Deep build.** This runs only when the host supplies `buildAsset`. The studio does that when the connection
     is local AI with the worker and the deep option is on (`apps/studio/src/engine/Studio.ts`, `deepBuilder`).
     A coding agent works in a throwaway workspace. Its result is checked again with `GeneratorDef` and
     `validateGenerator`.
  2. **Single-shot coder.** If there is no deep build, or it fails, a `role:"coder"` call is offered one tool,
     `submit_generator` (`packages/agent/src/coder.ts`). It gets 2 attempts by default: one try and one repair
     with the error.
- **Input.** `{id (slug), description 1..2000, params_hint? ≤500}`.
- **Returns.** The defined generator's id and params, or why it could not be built. On failure the model is told
  to use built-ins or primitives.
- **Deep-build budget (studio).** `deepTurns` is 1..6 (default 3, `apps/studio/src/ai/prefs.ts`). The time
  limit is `min(20, 3 + turns × 2)` minutes. The worker protocol accepts `maxTurns` 1..8
  (`apps/bridge/src/worker/protocol.ts`).

### `write_script`

- **What it does.** Defines a per-entity behaviour script. `source` is the body of `function update(ctx)`, called
  every fixed tick, and returns intents.
- **Input.** `{id (slug), description ≤2000, source}`.
- **Checks.** Core `ScriptDef` parse, then the host's `validateScript`.
- **Returns.** How to attach the script: `behaviors: [{"type":"script","params":{"script":id}}]`.
- **When to use it.** Only when built-in behaviours and rules cannot express the behaviour.

### `submit_generator` (coder sub-call only)

`{id, description, params, source}`, all required. The planner never sees this tool. The single-shot coder uses
it, and so does the asset forge (`packages/agent/src/forge.ts`).

The asset forge is a studio feature, not a planner tool. It loops through these steps:

1. Build a generator with `submit_generator`.
2. Sandbox-check it.
3. Render four views on one contact sheet.
4. A `role:"critic"` call scores the sheet: silhouette 0.35, proportions 0.25, parts 0.25, colours 0.15
   (`FORGE_CRITERIA`).
5. The coder patches the generator from the critique.

The loop stops when the score reaches `FORGE_GATE` (0.8) or the budget runs out. The budget is 6 iterations and
16 calls at most (`FORGE_LIMITS`), with defaults of 4 and 10. The best iteration wins.

## Eyes: inspection, measuring, renders

### `inspect`

- **What it does.** Reads the world.
- **Input.** `{ids?[≤24], groups?}`, each id up to 64 characters.
- **Returns.** With no ids: the compact world summary, up to 400 entities. With ids: the full JSON of each entity,
  cut at 3,000 characters, plus a list of ids that were not found. With `groups:true`: a read of every group of
  repeated things at once (`packages/agent/src/groups.ts`): each scatter layer and each run of three or more alike
  separate entities, with count, bounds, closest and typical neighbour distance, pairs closer than the spacing
  (overlapping) and instances more than 0.35 m off the ground height (floating or buried); `ids` narrow it to layers.
  Measurement only, for the model to act on.

### `query_scene`

- **What it does.** Answers factual questions about a building, so the model can look things up instead of
  asking the user. It does not edit.
- **Input.** `{queries[1..12], building?}`. Each query is one of (`QueryInput`, strict):
  - `wall {room, wall, kind?, y0?, y1?}`: openings, pieces and the free stretches of a wall.
  - `measure {a, b}`: distance, gap, heights and wall offsets between pieces, openings, `room/north` faces or
    `{point}`.
  - `list {room?, wall?, kind?, level?}`
  - `parts`: the parts library with sizes and parameters.
  - `shell`: rooms, walls and openings with exact positions.
  - `vocabulary {topic?}`: the room-shell vocabulary that `design_plan` accepts: ceiling styles (coved, vaulted,
    barrel, coffered, beamed, tray), cornice, picture rail, skirting, panelled dados, niches, window styles with
    glazing bars (sash, arched, bay, casement), door styles (panelled, glazed, double, french, arched), curtains,
    blinds and pelmets, fireplaces and built-ins.
  - `finishes {near: "#rrggbb", surface?: wall|floor|ceiling|any, hint? ≤60, limit? 1..10}`: the nearest PBR
    finishes of the material library for a sampled colour, each with the tint to give it.
  - `review {fast?}`: every check (overlaps, blocked doors and swings, floating or intersecting pieces, scale,
    clearance, reachability, lighting, emptiness), plus whether the building still matches the plan.
  - `stairs {level? 0..5, room?, shape?, heading?, width? 0.7..2.5}`: a ready `add_stairs` op from `fitStair`, or
    why none fits, with the sizes from `stairSizes`.
- **When to use it.** Before and after placing pieces, and during review. Measure first, then make the smallest
  change that works (`reviewTurnText` in `packages/agent/src/review.ts`).

### `tune_feel`

- **What it does.** Sets how the game answers what happens in it, as one undo step (`packages/agent/src/feel-edit.ts`,
  `TuneFeelInput`, `feelPatches`): the tier of the whole game, per-event cues, and continuous particle emitters on
  entities. Presentation only: it never changes physics, rules, the playtest bot or replay proofs.
- **Input.** All optional: `preset` (`subtle`, `normal`, `punchy`, `off`); `events` per event (`pickup`, `hit`, `damage`,
  `death`, `win`, `checkpoint`, `jump`, `land`, `explosion`, `launch`) a cue `{tier?, shake? 0..1, hitStop? 0..0.25,
  fovKick? -20..20, flash? 0..1, flashColor?, vignette?, rumble?, squash?, text?, duck?, vfx?, vfxColor?, vfxScale?}`
  merged into the current one, or `null` to drop it; `footsteps` (dust under walking people); `emitters`
  `[{target: id or #tag, vfx: preset or "none", rate?, color?, scale?, offset?}]` (24 per call, 64 targets each, `*`
  refused); `autoEmitters` (fire on torches, campfires and braziers, smoke on chimneys, embers on forges and lava, magic
  on portals); `reset`; `message`.
- **Returns.** `Feel: <tier and cues>; fire on torch-1, torch-2.` plus any refused targets, or "Nothing to change".
- **When to use it.** For every game (its description asks for a tier by genre and emitters on what burns), and for
  requests such as "make hits feel punchy", "sparks when coins are collected", "dust when landing", "less shake".
  The same requests are also answered by the local edit engine without a model (`refine/ops-feel.ts`).

### `query_level`

- **What it does.** Measures a game or outdoor level using the host's physics (`runLevelTool`,
  `packages/playtest/src/level/index.ts`). It does not edit.
- **Input.** `{op, …}`. The ops (`QueryLevelInput`) are:
  - `summary`: the player, extent, win condition, objectives, and which objectives are reachable.
  - `ground {points[1..24] {x, z, below?}}`: top surface height, what the surface is, and its slope.
  - `clearance {x, z, radius 0.1..3 (0.4), height 0.3..6 (1.8), below?}`: free radius, headroom, and whether a
    body fits.
  - `sightline {from, to}`: what blocks the line.
  - `reach {points[1..12] {x, z, y?}}`: whether the player can walk, jump or ride a lift there from the spawn, and
    if not, the size of the gap.
  - `objectives`
  - `review`: the level checked as a designer would, with a fix for each finding. It also returns structured
    `data` (findings and up to 8 camera poses) that the review loop uses.
  - `grounding {ids?[≤24]}`: objects that should rest on something but hover.
- **Limits.** `LEVEL_LIMITS` is 24 points, 40 items, ±5000 m coordinates and 4,000 rays per call.
- **When to use it.** Before and after placing items. Run `objectives` before `finish`. Use `sightline` so the
  goal is visible from the spawn, and `clearance` for narrow gaps. The player is 0.7 m wide and 1.7 m tall
  (system prompt, "Levels").

### Review renders

There is no render tool for the planner. The review loop and the photo loop ask the host for images and attach
them to the next user turn:

- The host renders the views through `AgentHost.captureReview(views)`.
- The poses come from `reviewPoses` and the numbered marks from `projectMarks`. A legend maps each number to a
  piece (`legendText`, `@aether/arch`).
- A building's review also gets two exterior views when there is room for them (`exteriorPoses`, `@aether/arch`): `exterior-street` at eye height facing the entrance from where a passer-by would stand, and `exterior-aerial` from three quarters above. No marks are drawn on them. The turn text asks the model to judge the entrance, sign, window rhythm, roofline and forecourt, and to fix a bare front with `set_facade`.
- Review images have an aspect of 1.5 (`REVIEW_ASPECT`). At most 8 images go in one round (`MAX_REVIEW_VIEWS`).
  The studio asks for 6 (`maxViews: 6` in `Studio.ts`).
- The studio renders with its viewport (`AgentBridge.captureReview`). The headless software renderer
  (`apps/cli/src/mcp/review.ts`, `captureReviewHeadless`) is used by `scripts/eval-design.ts`,
  `scripts/eval-photo.ts` and `scripts/photo-judge-noise.ts`. The MCP session does not supply `captureReview`, so
  its review uses the checker only.

## Verification and playtest

### `run_verification`

- **What it does.** Runs the world's tests and physics diagnostics now, without a display (`AgentHost.verify`).
- **Input.** `{}`.
- **Returns.** `PASSED` or `FAILED`, then the summary. The loop records the result, so a passing run clears the
  pending-edits flag.

### Verification after `finish`

When the model finishes with unverified edits, the loop runs `host.verify` itself (see
[How the loop works](#how-the-loop-works)).

### Playtest bot

The planner has no playtest tool. In the studio, after a run that changed the world, the playtest bot runs on its
own (`this.playtest.run({auto: true})` in `Studio.ts`). It plays a game, or walks through a building.

When the bot finds a defect, it proposes a patch, applies it as an ordinary history entry, and plays again
(`selfRepair`, `packages/playtest/src/repair.ts`). `maxRounds` defaults to 4, with a maximum of 8. The studio uses
`MAX_REPAIR_ROUNDS = 3` (`apps/studio/src/engine/playtest/controller.ts`).

The MCP server exposes the bot as the `playtest` tool.

## Photo to room

`packages/agent/src/photo/pipeline.ts` (`reconstructRoom`) handles a request that comes with a picture of a room.
This happens when the agent has `photo` options and `isRoomPhotoRequest` matches, or when the composer's
"Recreate this image" is used (`RunOptions.photo: 'recreate'`). Without a model that can see images, nothing is
built: the user gets the palette and brightness of the picture and a plain explanation. The flow uses its own
sub-call tools, and the design tools the planner already has.

| Tool | Who calls it | Input | Purpose |
| --- | --- | --- | --- |
| `describe_room` | the reader (planner role, `ANALYSIS_SYSTEM`) | `{description}` (validated by `parseRoomDescription`) | A structured description of the room. A refused description is sent back to the model, up to 3 attempts (`ANALYSIS_ATTEMPTS`) |
| `reconcile_room` | one call after the reads | `{add[≤80]{key, reason 12..300}, remove[≤80]{key, reason}, summary?}` | Settles entries that the reads disagree on, by checking the photo. Runs only when two or more valid reads disagree and `reconcile` is not false |
| `report_judgement` | each independent judge (`role:"critic"`, `JUDGE_SYSTEM`) | `{verdicts[1..140]{id, a 0..4, b? 0..4, evidence, ok?, okB?}, closer?: A\|B\|same, why?}` | Scores each checklist item on a rubric and says whether it would accept the item (`ok`). An item passes by the majority of those calls; without them, at a median of 3 (`PASS_SCORE`). From the second look, the judge compares the accepted render with the new one blind, as A and B, and its `closer` decides whether the new state is kept |
| `sample_photo` | the model doing the fixes, in each compare round. Offered only when the photo raster could be read | `{regions[1..8] {surface?, box?, kind?: wall\|floor\|ceiling\|any, hint?}}` | Reads colour from the photo's pixels instead of guessing: the well-lit colour, the mean and shadow colour of each region, and the nearest library finishes with the tint to give each. `surface` is `wall-north`, `wall-east`, `wall-south`, `wall-west`, `floor`, `ceiling` or a piece or opening id; `box` is `[x0,y0,x1,y1]` in 0..1, origin top-left. It is ranked with verdicts, before edits |
| `measure_room` | the model doing the fixes, from the first compare round; the same estimate (no anchor) is also put into the analysis input before the first shell | `{anchor?:{name, size_m, axis:"height"|"width", box [x0,y0,x1,y1] in 0..1}}` | Advisory room size from a monocular depth network (`photo/measure.ts`, `photo/depth-model.ts`, method in `packages/arch/src/photo/depth.ts`). Runs Depth Anything V2 Small (Apache-2.0, 27 MB, CPU, onnxruntime-web, about 1.5 s) on the photo and returns width, depth and height in metres with a low-high range, what fixed the scale (the anchor, or a ceiling of 2.4 to 2.7 m) and a depth picture (warm near, cool far). The first compare round shows the same numbers next to the model's own footprint, with a door of the description as the anchor when one is whole in the frame. Not offered without the host's `decodeImage`; when the weights cannot be fetched (offline, checksum mismatch), the runtime cannot start or `AETHER_DEPTH=off`, the reply says it is not available and nothing else changes. Never edits the room or decides a verdict |
| `perceive_photo` | the model doing the fixes, in the compare rounds, when `PhotoOptions.perception` is not false (default on) and the host can decode images; the first pass (room nouns plus the open detection pass) also runs before the photo is read and its report text and annotated picture are added to the first message of every reading | `{find?: string[] object nouns, generic?: boolean}` | Measures the photo with specialised models and returns evidence, not a verdict (`photo/perception/`): open-vocabulary detection (Florence-2 base, MIT: boxes, a confidence from its box tokens), a mask for each box (SAM 2.1 tiny, Apache-2.0), metric depth (Depth Anything V2 metric indoor small, Apache-2.0), a RANSAC floor plane, wall lines and a room box (width, depth, height, each with a range and a confidence; the width is a lower bound when a side wall is out of frame), the camera height and field of view, each object back-projected to room coordinates (floor or wall, visible size, height, which wall it is against, its neighbours), per-object colour from the mask pixels (CIELAB median with glare removed, k=3 palette, plain-words name and hex, luminance, stripe/check/plain, matte/glossy) and the floor, wall and ceiling colours from the fitted planes with furniture removed. A second opinion from the relative-depth network with a door or ceiling anchor is printed next to the room box. An annotated picture (numbered boxes, masks, colour chips) follows the reply. Objects found stay; a repeated call only adds the nouns not asked before. The room box is now the median of independent reads (vanishing-point camera from image lines, metric and relative depth, door or ceiling scale; one vote per family, spread = confidence, width a lower bound when a side wall is out of frame), every box gets a CLIP second-pass label with a probability and its alternatives (duplicates across prompts merged), and the colours are read from eroded masks without glare or shadow, with a white-reference "lit like white" colour when the ceiling or a wall is whitish. The same report (`PerceptionReport`, version 2, masks as run-length codes) is kept in the final resume state, and the object inventory is seeded from it: a perceived object no seat listed is added flagged `seen: measured` and a matched one gains a `measured:` line. First use fetches about 430 MB with pinned SHA-256 (see THIRD_PARTY.md); about 15 s per photo on 32 cores; offline, `AETHER_PERCEPTION=off` or a failed model, the reply names the unavailable part and nothing else changes. Never edits the room or decides a verdict. In the repair loop the same report feeds the measured comparison of the object table (see `apply_measured_colour` and `find_model like_crop`) |
| `apply_measured_colour` | the fixing model, in the repair rounds of a photo rebuild with objects and perception on (a materials repair: it needs `declare_repair` like any edit) | `{object, ref?, source?: "seen"\|"lit-like-white", param?}` | Sets a built piece's colour from the colour measured on the photo in one step: `object` is the inventory or perceived id, `ref` the built entity (default: its first linked piece), `param` the colour parameter (default `color`, else the first of linen, upholstery, shade, headboard, seat, body, top that holds a hex), `source` "seen" (default) or "lit-like-white" (cast and exposure removed with the ceiling or a whitish wall as the white reference). Goes through `edit_items` resize, so it is validated and one undo step; a piece whose colour is a named finish is refused with the reason. The measured table says "apply_measured_colour {object:...}" in its fix hint when the render colour is off |
| `review_build_plan` | the assistant that settles the build plan, once after the inventory of a photo rebuild with perception on (and once more for pieces the room checks refused); not offered in any other flow | `{decisions: [{n, verdict: "accept"\|"edit"\|"drop", reason?, kind?, model?, x?, z?, wall?, t?, gap?, y?, w?, h?, d?, yaw?, color?}], summary?}` | The build plan made from the perception report (one row per perceived object: kind, model candidates, position, size, facing, colour) is shown as a table with the photo and the annotated picture. Rows left out are built as planned; `edit` changes fields; `drop` needs a reason of 8 characters or more (a false detection, a duplicate, a wrong label). Then all rows are placed in one `place_items` batch and recorded in the object ledger against their perceived ids. See "Build from the measurements" in `PHOTO_TO_ROOM_HARNESS.md` |
| `find_model` `like_crop` | the model, in a photo rebuild with perception on | `{like_crop: object id, what?: name}` | Appearance retrieval: ranks the library by CLIP image similarity between the crop of the photo (a perceived id such as p3, or an inventory id) and the library thumbnails (`assets/clip-index.json`, 0.5 MB), returning the top three with the usual facts, then the name search for `what` if given. The object table also lists the top three look-alikes for every object whose type or presence the judges fault. Outside a photo rebuild it is refused and says so |
| `look_closer` | the model doing the fixes, in each compare round | `{regions[≤4]{box [x0,y0,x1,y1] in 0..1, note?}, side_by_side?, plan?}` | The magnifier (`photo/closer.ts`). The render is always taken from the photo's own solved camera, so one box is the same place in both pictures. `regions`: each box as the photo crop next to the same render crop; `side_by_side`: the whole photo and render in one image; `plan`: the room from above, ceiling removed, numbered pieces (legend: id, position, size) and the room's width, depth and height. Needs the host's `composeImages` (crops) and `captureReview` (plan); says what is unavailable otherwise. Ranked with verdicts, before edits |
| `report_differences` | the model doing the fixes, in each compare round, when `PhotoOptions.differences` is on (the studio sets it); also the independent cross-check seat | `{differences[≤30]{id, kind?: proportion\|position\|colour\|material\|lighting\|missing\|extra\|scale\|other, where?, what, size 0..5, status?: fixed\|smaller\|same\|worse}, summary?}` | The ranked list of what still differs between the photo and the render, from the side-by-side image, the region crops and the colour readout. Edits are refused until it is called in the round. From the second round on the model re-sends every earlier id with its status on the NEW render. See "Differences ledger" below |
| `stage_gate` | the model doing the fixes, when `PhotoOptions.harness` is on (the studio sets it) | `{gates[≤8]{stage: evidence\|camera\|shell\|furniture\|materials\|lighting, verdict: pass\|fail\|blocked, evidence, blocker?}}` | The model's verdict on a stage, from what it sees. A pass without evidence, a block without a named blocker, and a stage the run has not reached are refused. A blocked stage stops the run and the closing message names it. See `docs/PHOTO_TO_ROOM_HARNESS.md` |
| `declare_repair` | same | `{difference, cause: camera\|geometry\|materials\|lighting, why?}` | Said before each edit. The difference must be open in the ledger with that cause; while a difference of size 3 or more is open in an earlier class (camera, geometry, materials, lighting) a later class is refused; the edit tools used afterwards must fit the declared cause |
| `report_inventory` | the two inventory seats (stateless, role critic), once, before the first compare round, when `PhotoOptions.objects` is on | `{items[≤80]{id?, kind, category: structure\|furniture\|fixture\|decor\|small\|plant\|textile\|view, label, box [x0,y0,x1,y1] in 0..1, relations[≤6], size?, look?, confidence?, occluded?, entity?}, summary?}` | The list of every distinct element the photo shows (`photo/objects.ts`). One seat is told the built pieces and links each object to one (`entity`, or `none`); the other is blind. The two lists are reconciled; an object only one seat saw is flagged, never dropped |
| `report_object_judgement` | each judge of the per-object panel (stateless) | `{verdicts[≤8]{id, present, type, position, size, material: match\|close\|off\|unclear, evidence, fix?}}` | One request judges up to six objects from the photo, the render with numbered inventory boxes and a paired crop each. Good enough is the standard (tolerance in words in the prompt). Median per aspect over the judges; match and close pass, unclear is not chased, off is open and becomes an `obj-<id>-<aspect>` difference. No combined score |
| `report_relations` | the layout panel (stateless) | `{relations[≤40]{id, ok, note?}}` | Whether the render shows the same relations (centred, level, in a row, above, a distance from a corner) as the photo |
| `state_object_reason` | the model doing the fixes, when objects are inventoried | `{reasons[≤30]{id, aspect?: present\|type\|position\|size\|material\|all, reason}}` | Says why an object that is still off cannot be fixed (hidden in the photo, no matching model, a limit of the tools, a wrong inventory box). The aspect stops counting as open; the reason is shown. `finish` with failing objects and no reason is answered twice with the list, then accepted. See PHOTO_TO_ROOM_HARNESS.md, "Object by object"
| `set_photo_camera` | same | `{fov?, height?, heading?, pitch?, x?, z?}` | Moves the camera the compare render is taken from (cause class camera). Rolled back with the room when the judges find the round worse |
| `report_verdicts` | the model doing the fixes, in each compare round | `{verdicts[1..140] {id, pass, note?}, summary?, closer?: new\|best\|same}` | Its own pass/fail per item. When there is no judge panel, these verdicts judge the round (edits sent before verdicts are refused), and `closer` is its side-by-side call between the new render and the best one, shown next to each other: `best` rolls the room back |
| `design_plan`, `place_items` | the builder (`runBuild` in `@aether/arch/photo`) | as above | Shell first, then pieces at measured positions |
| `edit_items`, `place_items`, `query_scene`, `design_plan`, `tune_look`, `finish` | the model in each compare round | as above | Fix what still differs from the photo; `tune_look` sets the world's light and colour when the whole picture reads differently |

How a run proceeds:

1. **Reads.** The photo is read `reads` times: default 3 (`READS_DEFAULT`), maximum 5 (`READS_MAX`). The reads run
   in parallel, with temperature 0 and a seed of `READ_SEED` (4421) + k. Two or more valid reads are merged into
   one description.
2. **Compare rounds.** Each round renders the room from the photo's calibrated camera, plus straight-on views of
   walls with failing items. `maxViews` defaults to 3, with a maximum of 4. Then it:
   - gives the model `look_closer` (crops of photo and render at the same camera, both side by side, the plan from above), and an opening step that ranks the differences (proportion, position, colour, material, lighting, missing or extra items) and fixes the largest first (one instruction per round: the written ranking without a differences ledger, the same step as the first `report_differences` call, or its judge-and-add form on later rounds, with a ledger; `rankDifferencesText` in `photo/prompt.ts`),
   - measures fidelity, and
   - asks `judges` independent judges: default 3 (`JUDGES_DEFAULT`), maximum 7 (`JUDGES_MAX`), seed
     `JUDGE_SEED` (7331) + seat.

   Before the shell is built, openings that crowd one wall are separated (`separateOpenings`,
   `packages/arch/src/photo/derive.ts`): pushed apart along the wall inside 0.3 m corner margins with 0.12 m of wall
   between them, windows narrowed (not below 0.5 m) when the wall is too short, and the last window left out when
   even that does not fit. Doors keep their width. Each change is added to the build notes, and the shell is no longer
   refused for it. The photo prompt also tells the reader to describe one curtain per window and not to set `panels`
   or `gap` (the builder hangs one panel each side).

   Who decides: the judges (or, judging alone, the fixing model comparing the best render with the new one). A round
   they do not prefer is rolled back (`decideRound`, `restorePatches`). The measured fidelity is advisory data in the
   message to the model and the judges; it never accepts or rejects a round. Each round allows up to 8 model turns
   (`TURNS_PER_ROUND`).
3. **End.** The loop ends when:
   - every item passes,
   - the model stops because it judges the room good enough or has nothing left to change,
   - progress stalls (`ProgressTracker`, `stallRounds` default 3), or
   - `maxRounds` is reached. With no cap, a safety ceiling `PHOTO_ROUNDS_CEILING` (200) still applies.
   A tie is accepted, so a run of ties can leave the room below the best state seen. When the state the loop ends
   on is not the best one (and there is a judge panel), the judges look at the last render and the best render side
   by side (`pickBest`). If they find the best closer, the room goes back to it (`Back to the best state, round N`).
   If they find the last closer or cannot tell, the last state stays. Either way the result carries a sentence
   saying what they decided. No score is compared here.
4. **Verification.** The room is verified at the end.

The studio sets these values for paid keys: `maxRounds: 10`, `judges: 1`, `reads: 1` (`PHOTO_ROUNDS_METERED`,
`PHOTO_JUDGES_METERED`, `PHOTO_READS_METERED` in `Studio.ts`). Subscription backends get no round cap and the
defaults above.

### Compare kit, differences ledger and cross-check

What the model sees each compare round, besides the numbered render views (all of it advisory data for the model's eyes; nothing
here accepts or rejects a round):

- **Side by side.** The photo and the clean render from the same solved camera in one image (`AgentHost.composeImages`).
- **Region crops.** For up to `PhotoOptions.crops` regions (default 4, at most 8) the same box cut from the photo and the render,
  side by side. Regions are the walls, floor and ceiling the description boxes, then the largest pieces and openings; the ones
  that failed last round come first (`cropRegions`, `photo/kit.ts`). `look_closer` still lets the model ask for any other region.
- **Colour readout.** For the same regions, the lit and shadow colour of the photo against the render's lit colour, ΔE and
  lighter/darker (`regionReadout`). Small differences are the preview's flat light; the model is told to look at hue and
  relative lightness.

With `PhotoOptions.differences: true` the round is also a ledger (`photo/differences.ts`, `DifferenceLedger`):

1. The model lists every difference it sees (`report_differences`), with kind, where, the amount and a size 1..5, before any edit.
   Edits sent first are refused ("List the differences first"); the list and the edits can share one reply (the list runs first).
2. It fixes the largest first, one change per difference.
3. In the next round it receives its list and must send every id again with a status judged on the new render only. The ledger
   points out the largest difference when it is still "same" after an edit, flags "worse", and keeps an id that was left out
   counted as open. A round that the judges rolled back does not blame the undone edit.
4. At the end the closing message names what is still open, largest first, from both seats.

With `PhotoOptions.crossCheck: true`, after the compare rounds one independent seat (role `critic`, temperature 0, seed
`CROSSCHECK_SEED`) gets a fresh conversation with the photo, the final render, the kit and the readout, and lists the differences it
sees. It never edits; its findings join the ledger as `check-…` entries and are reported with the others. The same two options
exist for the review loop of a prompt-built world (`ReviewOptions.differences`, `crossCheck`): the renders are compared with the
request (and any reference pictures the user attached, shown side by side with a render), the gaps are ranked and fixed largest
first and confirmed on the next renders, an approval that leaves a gap of size 4 or 5 open is asked about once, and an
independent seat checks the final renders against the request. Both options are off in `WorldAgent` unless set and on in the studio.

## Generation brief and richness review

Full text: [GENERATION_BRIEF.md](GENERATION_BRIEF.md). Source: `packages/agent/src/brief.ts`, `brief-stage.ts`; hooks in `agent.ts`. On only when `AgentOptions.brief` is set, the provider is not the offline planner, no picture is attached, and the run starts a new world (`intent: 'new'`, or an empty world).

| Tool | Offered to | What it does |
| --- | --- | --- |
| `submit_brief` | the brief call only (never the planner) | `{elaboration: elaborate|moderate|minimal, elaboration_reason, kind, summary, scale, zones, elements:[{name, count, size?, note?, find?}], materials, lighting, richness:{kinds, pieces, note?, basis?}, reference:{generate, reason, prompt?}}`. Validated by zod; a refusal names the fields once. |
| `look_closer` (reference form) | the planner and review turns, only while a generated reference picture exists | `{regions:[{box:[x0,y0,x1,y1] in 0..1}]}` returns crops of the picture; `{whole:true}` the whole picture. Read-only. This is a different schema from the photo flow's `look_closer`, which compares a photo with a render and is offered only inside that flow. |

The model states how elaborate the request is (default `elaborate`; `minimal` only when the user states a small scale or simplicity), and the richness target follows. The reference image is optional: the model decides, a connected image generator makes it (`make_texture`'s path), and the decision and reason are recorded whether or not a picture was made. The review loop then shows the brief, the renders and advisory piece counts per element (`richnessEvidence`) and the model fixes what is missing or sparse. The offline planner skips all of this.

Events: `brief` (`BriefView`: the brief, `editable`, the reference record, the user's notes). `RunOptions.reviewBrief` lets the host pause for the user's edit; absent, the run carries on.

## Conversation control

### `finish`

- **What it does.** Declares the request complete. The `message` is shown to the user.
- **Input.** `{message ≤2000}`.
- **Returns.** `Finishing; verification runs next.`
- **Rules.** These are in `agent.ts`:
  - If `finish` comes in the same reply as a refused call, it is ignored, and the model is told to read the
    reasons first.
  - The closing message goes through `guardVerificationClaim` (`packages/agent/src/honesty.ts`). If the message
    claims tests passed but no verification ran and none is pending, a note is appended.
  - In a review round, `finish` means the model approves the result.

## How the loop works

`WorldAgent.run` (`packages/agent/src/agent.ts`) is an async generator of events. It never throws, and it always
ends with one `done` event that carries token usage.

1. **Input checks.** The prompt must be non-empty and at most 8,000 characters (`CONTEXT_LIMITS.MAX_PROMPT_CHARS`).
   At most 4 images are allowed, each a base64 PNG, JPEG, WebP or GIF data URL under 5 MiB
   (`packages/agent/src/context.ts`). The asset catalog loads before planning starts.
2. **Photo path.** A room photo request goes to the photo flow above, and that run ends there.
3. **Local edit path.** If the world has content and the request is not for a new world, the deterministic edit
   engine (`refine/runtime`) tries the edit first, with no model call:
   - A clear small edit is applied directly as one undo step. It is re-verified unless it is cosmetic.
   - Undo and redo are handled the same way.
   - An ambiguous reference becomes a question for the user offline. With a model, the reference is passed to the
     model to decide.
   - Otherwise the request is classified (`classifyScope`). A small edit turns on the `apply_patches` guard, and
     a world with more than 80 entities (`SLICE_THRESHOLD`) sends a focused summary.
4. **Planner turns.** Each turn sends the system prompt, the conversation and the tools, then runs every tool call
   in order. Limits:
   - **Turns.** `maxTurns` defaults to 8 (clamped to 1..50).
   - **Tool calls.** `maxToolCalls` defaults to 48 (clamped to 1..500). Past the budget, each call gets
     "Tool-call budget exhausted … Call finish now."
   - **Tokens.** `maxTokens` defaults to 16,000 (clamped to 256..64,000).
   - **Cut-off reply.** A reply cut off at the output limit gets "continue with smaller calls".
   - **Nudges.** A reply that gives up after a refusal, or claims the tools are missing, gets up to 3 nudges.
5. **Finish, verify, repair.** When a turn ends (with `finish`, or a reply with no tool call) and there are
   unverified edits, the loop runs `host.verify`:
   - If verification fails, a repair turn sends the report back, up to `maxRepairs` (default 2, clamped to
     0..10).
   - If it passes, or nothing needs verifying, the review loop starts. A small targeted edit is reviewed only if
     it touched `design_plan` or `build_architecture`.
6. **Review rounds.** These run only when `AgentOptions.review` is set and the run changed the world. The offline
   planner skips review.
   - **What the model sees.** Each round shows the checker's findings. For a building, that is `reviewFindings`,
     plus a warning for any person without a character. For a level, it is `query_level review`. When the model
     can see images, the round also includes numbered renders.
   - **Within a round.** The model has up to 8 turns (`REVIEW_TURNS_PER_ROUND`), with the same `maxToolCalls`
     budget per round.
   - **Ending on approval.** The loop ends when the model approves (calls `finish`, or answers without a tool
     call, with no edits) and the checker reports no errors. Warnings are shown again once per distinct set
     before approval stands.
   - **Ending on a stall.** `StallTracker` (`packages/agent/src/review.ts`, `stallRounds` default 3, clamped to
     2..20) ends the loop when:
     - the same findings return `stallRounds` rounds in a row,
     - there is no better score for `stallRounds + 1` rounds, or
     - the checks are clean and edits stay cosmetic for `2 × stallRounds` rounds.

     A round with no edits and no approval also stops the loop.
   - **After review.** If the review changed the world, it is verified again.
7. **Round caps.**

   | Connection | Review rounds | Turns and tool calls | Source |
   | --- | --- | --- | --- |
   | Subscription in the studio (`resolved.kind` is `bridge` or `local`) | No `maxRounds`. Ends on approval or a stall, with a runaway ceiling of 200 (`REVIEW_ROUND_CEILING`) | 40 turns, 300 tool calls (`REVIEW_MAX_TURNS`, `REVIEW_MAX_TOOL_CALLS`) | `Studio.ts` |
   | Paid key in the studio (`byok`, `server`) | `REVIEW_ROUNDS_METERED = 10` | 40 turns, 300 tool calls | `Studio.ts` |
   | BYO key, whole browser session | Separately, a cap of 150 model calls (`BYOK_SESSION_CALL_CAP`) | | `apps/studio/src/ai/byokCatalog.ts` |
   | MCP server | `review: {maxRounds: 6}`, checker only (no renders) | `maxTurns: 40`, `maxToolCalls: 300`, `maxRepairs: 2` | `apps/cli/src/mcp/session.ts` |
   | On-device (compact profile) | No review, no level tools, no photo vision | Output cap of 1,200 tokens (`COMPACT_LIMITS`) | `Studio.ts`, `agent.ts` |

8. **Playtest.** In the studio, the playtest bot runs after the turn (see
   [Verification and playtest](#verification-and-playtest)).

**Loop discipline** (`packages/agent/src/harness.ts`, shared by the main loop and the review rounds):

- **Refused calls.** `CallLedger` remembers refused calls. The second identical refusal appends a reflection to the result; the third
  says it will not be run again, and the fourth identical call is not run at all ("Not run: …"). Three refusals of one tool in a
  row with different arguments earn a "step back" note. Before the model finishes, refused calls that the same tool never
  succeeded at afterwards are listed once, so its closing message accounts for them (`ledger.unresolved()`).
- **Budgets.** Two turns before `maxTurns` (and on the last turn) and when 15% of the tool-call budget is left, the model is told
  to wrap up (`budgetNote`).
- **Compaction.** When a conversation passes 240,000 characters, tool results older than the newest 12 messages shrink to their
  first lines plus a count of what was dropped (`compactConversation`, one sweep, so the cache prefix changes once). A continued
  conversation over its 300,000-character budget is compacted the same way before it is abandoned.
- **Queued messages.** `RunOptions.steer` is polled between model turns and before the run would end; what it returns reaches the
  model as `<queued_message>` blocks, a `steer` event reports it, and the run does not end while a message waits. The studio's
  composer queues messages while a turn runs; messages not picked up run next as one message, and a stopped turn drops them.
- **Cancel and continue.** A cancelled run with a session key keeps its conversation up to the last answered turn (with a note that
  the user cancelled) and the world as the model last saw it, so "no, instead …" continues instead of starting over.
- **Steps.** Every tool call yields a `step` event with a plain label ("Placing 4 items"); a look at images yields one with the
  pictures (`looked`), which the studio shrinks to thumbnails and never stores. The studio shows "Step N", "Still working…" after
  ten quiet seconds, and the steps folded behind "Show all N steps".

**Continued conversations.** A run with a session key continues the planner conversation of its last successful
run. It sends only the scene changes since then (`sceneChangesText`), not the full summary
(`packages/agent/src/conversation.ts`). A failed run forgets the conversation.

## Offline planner

The offline planner is `createMockProvider` (`packages/agent/src/providers/mock/index.ts`), with provider name
`mock`. It is deterministic and calls no model.

- **Planner role.** It answers with one `apply_patches` call per chunk of its plan (`chunkPatches`), an optional
  `build_architecture` call with its building ops, and `finish`. It uses no other planner tool.
- **Coder role.** It answers `submit_generator` with a fixed placeholder monument.
- **Results.** It replies "All set." to tool results. In a repair turn it says it "cannot repair further".
- **Behaviour.** These are in `agent.ts`:
  - **Ambiguous references.** When the local edit engine finds an ambiguous reference, the question goes to the
    user.
  - **Missing things.** An edit that names something the world lacks is answered in plain words instead of
    adding a scene.
  - **False claims.** A "Done" message is replaced when nothing visible changed.
  - **No review.** Review rounds are skipped.
  - **No photo flow.** The photo flow refuses to build.
  - **Level tools.** The level tools still serve its local "onto" moves (comment in `Studio.ts`).
- **Fallback.** It is the last link of the studio's provider chain. The chain is the chosen assistant, then the
  user's other signed-in assistants, then the offline planner (`createProviderChain` in `Studio.ts`;
  `packages/agent/src/providers/fallback.ts`). It also handles the MCP server's `offline` mode
  (`apps/cli/src/mcp/provider.ts`).

## Providers

The studio's connection kinds are `'offline' | 'local' | 'server' | 'bridge' | 'webllm' | 'byok'`
(`apps/studio/src/ai/connection.ts`).

| Kind | What it is | Provider code |
| --- | --- | --- |
| `local` | The Aether server on this computer (`aether start`) with the user's own Codex or Claude Code sign-in. It can run the deep-build worker (`worker: true`) | `createLocalProvider` (`@aether/agent`). Headless backends in `apps/bridge/src/backends/codex.ts` and `claude.ts` |
| `bridge` | A hosted studio paired with the local bridge, using the same CLIs | `apps/bridge` |
| `byok` | The user's own key, used from the browser. Providers are `anthropic`, `openai`, `openrouter` and `gemini` (`BYOK_PROVIDERS`) | Anthropic: `createAnthropicProvider` (`browser: true`). OpenAI: `createOpenAIProvider`. OpenRouter (`https://openrouter.ai/api/v1`) and Gemini (`https://generativelanguage.googleapis.com/v1beta/openai`): `createChatCompletionsProvider`, the OpenAI-compatible Chat Completions API (`apps/studio/src/ai/byok.ts`) |
| `server` | A model configured on an Aether server: an Anthropic or OpenAI-style API key, or a headless CLI | `apps/server/src/llm/providers.ts` |
| `webllm` | A model that runs on the device in the browser. Uses the compact profile | `createWebLlmProvider` (`packages/agent/src/providers/webllm.ts`) |
| `offline` | The offline planner | `createMockProvider` |

Text-only backends (headless Codex and Claude Code, WebLLM) have no native tool calls. They are wrapped by
`createEmulatedProvider` (`packages/agent/src/emulation/provider.ts`):

- The backend must reply with JSON that matches a JSON Schema.
- An invalid reply gets one automatic re-ask that quotes the problem.
- A valid reply is checked with zod and turned into `tool_use` blocks.

## Safety

- **Untrusted model output.** These checks apply to everything a model returns:
  - Tool arguments are checked for type and size and validated with zod (`executor.ts`). Patches are validated
    again by `applyPatches` on the host.
  - Generators and scripts are checked in the host sandbox before they are defined.
  - The planner's tool list does not change per request, and unknown tool names are refused.
  - The level review data (`LevelReviewData`, `packages/agent/src/level-review.ts`) and photo descriptions
    (`parseRoomDescription`) are validated.
  - Settling an object on the ground keeps only transform updates of the moved objects
    (`settleOnGround`, `agent.ts`).
  - Deep-build results are parsed and validated again by the agent.
  - The system prompt tells the model to treat text in the world summary, entity names and user content as data,
    not instructions (`prompt.ts`, "Workflow").
- **Headless CLIs have no tools.**
  - **Claude Code** (`apps/bridge/src/backends/claude.ts`) runs with:
    - `--tools ""`,
    - `--disallowedTools` set to a list of built-in tools (`CLAUDE_DENIED_TOOLS`),
    - `--strict-mcp-config` with an empty MCP config,
    - `--safe-mode`, `--setting-sources ""`, `--disable-slash-commands` and `--permission-mode dontAsk`,
    - a schema for its JSON output (`--json-schema`), and
    - a fresh empty directory and a restricted environment.

    If any tool other than `StructuredOutput` or any MCP server appears, the run is killed.
  - **Codex** (`apps/bridge/src/backends/codex.ts`) runs with:
    - a read-only sandbox, approval "never", no network and web search off,
    - shell, exec, patch, image, browser and plugin features disabled,
    - every MCP server from the user's config disabled by name,
    - a fresh empty directory and an allowlisted environment, and
    - a strict `outputSchema`.

    The first command, file change, MCP call or web search aborts the run.
- **The sandboxed deep-build worker** (`apps/bridge/src/worker/agentic.ts`) is the only place a CLI gets tools:
  - **Codex** runs in a `workspace-write` sandbox with network and web search off and approval "never". Every MCP
    server and every feature except the shell and image viewing is disabled.
  - **Claude Code** runs `--restricted` with only Read, Write, Edit and Bash, and Bash may only run
    `node check.mjs`.
  - Any MCP or web call, any other command, or a file outside the workspace ends the run.
  - The parent process reads only the artifact file and validates it itself.
- **Honesty.** A claim that tests passed is marked when no verification backs it (`honesty.ts`). The offline
  planner's "Done" is replaced when nothing changed.

## MCP server tools

`aether mcp` (`apps/cli/src/mcp/tools.ts`, `session.ts`, `limits.ts`) is a stdio MCP server. All inputs are strict
zod schemas. Failures come back as `isError` with `code: message`. See [MCP.md](MCP.md) for client setup,
resources and the safety model.

| MCP tool | Input (limits) | What it does | Maps to |
| --- | --- | --- | --- |
| `create_world` | `{prompt 1..4000}` | Builds a new world with the full agent loop: plan, tools, verify, repair, review | `WorldAgent.run` with all 16 planner tools and the 2 level tools. Checker-only review, `maxRounds: 6` |
| `edit` | `{prompt 1..4000}` | Changes the current world; one `undo` reverts the whole request | Same agent loop, including the local edit engine and the minimal-edit guard |
| `apply_patch` | `{patches[1..200], message? ≤200, atomic? (default true)}`, at most 512 KB of JSON | Exact World IR edits with no model; all or nothing by default | The same patch validation as `apply_patches`, without the model-side extras (guard, carry, notes) |
| `list_entities` | `{selector?, tag?, behavior?, text?, parent?, offset, limit 1..200 (50)}` | Compact rows of entities, paged | A paged version of `inspect` without ids |
| `get_entity` | `{id}` | One entity in full, plus `wall` and `placementProblems` for wall pieces | `inspect {ids:[id]}` plus the wall facts behind `query_scene wall` |
| `get_world_summary` | `{}` | The planner's text summary, counts and the active provider | `inspect {}` |
| `verify` | `{}` | Runs the tests and diagnostics without a display | `run_verification` |
| `playtest` | `{seconds 1..120 (60), goal? ≤200}` | The bot plays the world and reports win, lose or incomplete, with the objectives, state and path | The playtest bot (not a planner tool) |
| `replay` | `{}` | Fast-forwards the physics and summarises each moving body; writes `replays/replay.json` | No planner equivalent |
| `render_still` | `{width, height 64..1920 (960×540), yawDeg? -360..360, pitchDeg? -10..89, fovDeg? 15..110, from?, lookAt?, at? 0..60, name?}` | A PNG from the software renderer, returned inline up to 1.5 MB | Same renderer family as `captureReviewHeadless` |
| `export` | `{format: gltf\|build\|plan\|project\|ifc, name?}` | Writes the world under `exports/` | No planner equivalent |
| `undo`, `redo` | `{}` | One tool action per step, up to 200 undo steps | The history |

Wall-clock caps (`MCP_LIMITS`): agent runs 5 minutes, and `verify`, `playtest`, renders and exports 60 seconds
each. The provider mode is `auto`, `offline` or `local` (`apps/cli/src/mcp/provider.ts`). `local` runs the agent
through the local server's Codex or Claude Code backend. `offline` uses the offline planner.
