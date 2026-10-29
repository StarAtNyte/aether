# Changelog

Aether follows [Semantic Versioning](https://semver.org/) once it is published; until then every change lands on `main`
and `docs/REVIEW_LOG.md` carries the measured detail. Workspace packages share the version in the root `package.json`.

## Unreleased

- Added: photo-to-room keeps position on the books in metres. Every object round reports how far the linked pieces stand from the pose the measurements gave them (mean, median, worst, shares within 15 and 25 cm) and the object judges read that distance as evidence; the build plan shows each measured position with a stated uncertainty (about 0.08 m plus 7 percent of the range). A piece that drifted 30 cm or more from its measured pose without a gain in the measured mask overlap is put back at it (at most twice, reported, undoable; `AETHER_ANCHOR_RESTORE=off` disables it). Evidence for the model, no gate. `eval-photo` records run tokens.
- Changed: for real-world props (furniture, appliances, tools, vehicles, kitchenware, equipment, decor) `find_model` tries the asset hub first and prefers a match that passes a documented confidence and plausible-size threshold (`HUB_FIRST`), then falls back to the bundled library, crafted parts and generators. Walls, doors, windows, stairs, roofs and floors never come from the hub. The hub gets 3 s; unreachable it is skipped silently, and the answer says which source was used.
- Fixed: wall and ceiling models (wall sinks, signs, sockets, wall cabinets, ceiling lamps) had their pivot on the floor, so wall snapping put them at floor level. A wall model's pivot is now its back-centre mount point and its entry records `mountY`, the mount height above the floor (basin rim 0.85 m, signs 1.5 m, screens and hand dryers 1.2 m, shelves and cabinets 1.4 m, sockets 0.3 m); a ceiling model's pivot is its top-centre (`mountY` 0). `bulk --reprocess=front` converts again the models that lack it.
- Changed: a cold open of an editor URL (`#/new/<example>`, `#/p/<id>`) starts its downloads from the HTML: a small `editor-boot.js` links the whole editor chunk set as `modulepreload` in one round trip and starts the example's world JSON fetch at once (the project step reuses that response). The glTF exporter's WebGL texture helper moved to its own lazy chunk, so the editor no longer downloads the 366 kB `three-webgl` chunk it never uses; the card picture downloads beside the world instead of after it. Home budget unchanged (197 kB gzip).
- Added: `npm run assets:simready -- front-fix`, a vision check of the front and mounting of every converted SimReady model (four turned views in one image, one model call per asset, cached, with a spend cap). Its answers live in `scripts/assets/simready-fronts.json`; `bulk --reprocess=front` and the library build apply them, and `publish.lock` keeps two publishers apart.
- Added: `npm run assets:simready -- bulk`, a resumable, unattended pipeline that searches about 220 categories of NVIDIA SimReady Central, keeps only CC0 and CC BY 4.0 packages that pass name, size and duplicate filters, converts them (triangle budget by size, UV-aware simplification, meshopt, 512 px textures, thumbnail), rejects bad ones with logged reasons (inverted normals, black textures, blank thumbnails, oversize) and publishes the rest to the private hub dataset in batches of 50. The models stay out of git. The dataset card links `credits.csv` instead of a huge table, and every staged thumbnail now has an image embedding.
- Added: the local server imports 3D models on demand. When the library has nothing for an object, the agent calls `import_asset` and the server (`npx aether start`) searches NVIDIA SimReady Central, takes only CC0, CC BY 4.0 or MIT packages, downloads the pinned revision with hash checks, converts the USD, reduces it to a game-sized model (at most 20,000 triangles) and the studio stores it with the project with its CC BY credit line, so exports and published games carry it. Progress shows in the step feed and a toast; the hosted page says importing needs the local server. `npm run assets:simready-setup` creates the Python USD tools; `npm run assets:simready-e2e` is an opt-in smoke of the whole path.
- Added: 28 common props from SimReady Central in the library (office chairs, desk, tables, shelf, cabinets, sofas, lamps, monitor, keyboard, bins, mug, plate, bucket, boxes, hammer, wrench, toolboxes, tool cabinet), 560 to 11,800 triangles and 45 to 400 KB each; the hosted build ships their thumbnails only.
- Changed: credits list one line per imported model (a CC BY credit was lost when a world used several imports); `place_items` accepts a model imported into the project.
- Asset hub: the library's CC0 and CC BY models are exported as a Hugging Face dataset (`npm run assets:hf`: build, verify, upload; private until published) and the studio searches it as you type (Assets panel, `find_model`), then loads a model lazily with a hash check and its credit, no local server needed. `import_asset` takes a `hub_id`. The GLB validator accepts the empty meshopt fallback buffer.
- Fixed: stone, cobble and plaster (every anti-tiled finish) drew with the texture of whichever of them was drawn first; each finish now shows its own texture.
- The Templates page groups worlds by type (Games, Architecture, Scenes, Physics, Stories, Photo to 3D) with a filter row, instead of Featured / More worlds / Generated by the agent / Rooms rebuilt from a photo. Each card still says how it was made.

### Opening an example: the picture first

- `#/new/<example>` paints the editor skeleton with the example's card picture at once (the thumbnail is preloaded from `theme-boot.js`) instead of a text line: casa-patio cold on Slow 4G shows a real picture at 2.5 s instead of 11 s (LCP). The loading overlay shows three steps (Loading editor, Loading world, Preparing light) and a bar that follows the renderer's stages.
- The side panels (assistant, inspector, outliner, history, logic, verify) are their own chunks, no longer part of the editor's first download. The KTX2 transcoder is no longer fetched ahead of need before the first frame. Baked lightmaps are served immutable.
- `npm run e2e:load-slow` and the new `tests/e2e/open-timeline.e2e.ts` (request classes and milestones of an open) measure it.

### Lighter first load

- Home page JS 925 to 193 kB gzip (first visit on Slow 4G: LCP 6.2 to 2.7 s, 1,381 to 551 kB transferred); the player loads its engine after a loading screen (1,360 to 67 kB before first paint). The agent, arch compiler, procgen and asset catalog no longer load on the home page; the editor is fetched in the background once the home page is idle. `npm run e2e:load-slow` measures it; `scripts/size-budget.json` limits are tightened.

### NVIDIA SimReady Central as an asset source

- `npm run assets:simready -- search "<text>"` searches SimReady Central (about 3,600 OpenUSD packages on Hugging Face), reads each hit's licence (package file and dataset card) and shows only CC0, CC-BY-4.0, MIT, Apache-2.0 and BSD hits; non-commercial, no-derivatives, share-alike, custom and missing licences are listed as rejected with the reason. `fetch <repo>@<revision>/<package>` downloads one package at a pinned revision outside the repository and verifies LFS hashes, Git blob ids and the package bill of materials.
- `scripts/assets/usd2glb.py` (dev-time Python, outside the repository) converts a package to glTF; `build.ts --simready` builds the rows of `selection-simready.ts` into `assets/lib/s/` with the interior pipeline and an aggressive decimation for CAD sources.
- One asset imported: an LG range cooker (`simready-range-cooker-lg`, CC-BY-4.0, LG Electronics): 19,000 of 514,000 triangles, 0.59 MB main file, credited like the Fox. `find_model` answers "range cooker", "stove", "cooktop".
- `simready_search` agent tool (read-only, never imports; says so when the service is unreachable).

## 0.1.0 (pre-release, 2026-10-27)

First tagged state of the framework: natural language to verified, interactive 3D worlds in the studio, the CLI, the MCP server and the local bridge.

### Photo to room accuracy

- Benchmark-driven geometry pass (ground-truth self-test, no model): floor position error of floor pieces 0.66 to 0.31 m, room box 0.12 to 0.09 relative error, size error 14 to 9 percent, metric depth error 11 to 5 percent, median field of view error 1.75 to 1.0 degree. Floor height now the lowest strong peak, metric scale blended toward a 1.5 m eye, the room box led by the metric vanishing-point estimator, the vanishing-point search starting at 50 degrees, EXIF field of view when a JPEG carries it, and a stated confidence on a field of view the lines cannot fix. Dev loops `scripts/photo-selftest/geo-dev.ts` and `proj-dev.ts`.

- Room box by agreement of independent reads (vanishing-point camera from image lines, metric and relative depth, door or ceiling scale), spread reported as confidence; the twin reads within 11 percent of the known size, the hotel width is flagged a lower bound.
- Colour: the black twin floor was a depth-grid mismatch; masks are eroded, shadows and glare dropped, a white reference gives "lit like white" colours.
- Labels: CLIP second pass with probabilities and alternatives, duplicates merged.
- Build from the measurements: a plan of every perceived object (kind or look-alike model, position and size from the mask extents in room metres, facing, measured colour), settled by the model with reasons (`review_build_plan`) and placed in one batch with the surfaces coloured first, so every object has a linked piece from round 0 (the measured loop could only critique a build before: most objects were `unclear`). Coverage line, honest `unclear` split, falls back to the earlier flow offline.
- Repair loop: measured comparison (instance-id render of the build against the perception masks: IoU, offset, size, deltaE, fix hints), `apply_measured_colour`, `find_model like_crop` (appearance retrieval over a 0.5 MB CLIP index of the library thumbnails). Perception is on by default with a first-use download message and a skip.
- Ground-truth self-test (`npm run bench:photo-selftest`, no model): worlds with known truth drawn from chosen cameras, every measuring stage scored against it (camera, room box, depth, masks, back-projection, colour, projection and comparison oracles). Fixes it led to: the instance raster clips at the near plane and draws chairs, tables, beds, lamps and plants as parts instead of solid prisms (projection IoU 0.45 to 0.67), placements are no longer scaled to the fused room depth (floor position error 1.08 to 0.66 m), and the report's yaw wording is no longer inverted.

### Rendering and performance

- Motion profile: the default view keeps its resolution while the camera zooms or orbits (Sharp: the scale falls only under about 26 fps, never below 0.75, with an emergency step under 15 fps) instead of dropping to 0.5-0.7 and sharpening at rest; Smooth in Settings restores the 60 fps policy. Sharp measures as sharp as explicit Studio in motion (about 30 fps on the integrated GPU at 1280x720; the heaviest room, a penthouse, 19 fps).
- Studio render is the default view on integrated GPUs, with a silent fallback where the device cannot run it. A light chain draws while the view moves and the full chain once it rests; resolution steps by frame time and is kept during CPU-bound slowdowns.
- 60 fps work on the Intel integrated GPU: lean surface shading and a cheaper light volume while the view moves, culled and LOD'd foliage fields, static merging of unique procedural props, a sun shadow map reused while only the camera moves, shadow-pass cache keys no longer rebuilt per frame.
- Scene pass at an adaptive scale with a sharpening (Catmull-Rom) upsample and texture level bias; temporal upsample below half scale on WebGL2.
- Main-thread work moved to workers: character mask decode, the GLB export metal-rough composite, shared shader and noise preparation. A long-task harness and frame-cost scripts measure each flow.
- Baked light: lightmaps for the six bundled worlds and the four photo rooms (2.4 MB, content-keyed, applied on open with no bake). The key no longer depends on the graphics backend or quality tier. Light volume traces windows, walls as built and curtains.
- Room exposure is one number per room from the room's own light, plus a closed-loop trim from the finished picture at rest. The model can state a lighting intent (a key); dim keys are built dim and an over-lit picture is flagged.
- Heavy generated worlds open reliably on integrated GPUs: a world whose programs link for tens of seconds (a 49-lamp museum linked 640 KB shaders and never drew a first frame, then ran the heap past 1 GB) now shows its first image within seconds. A frame is shown after a bounded wait (2.5 s without an image, 6 s with one) while programs link and objects prepare, drawing what is ready and never an object whose program is still linking; the diagnostics say `presentation: progressive` with the counts. Local lights beyond a per-GPU forward budget (8 integrated, 6 software, 64 discrete) stay in the baked light volume only. `tests/e2e/heavy-open.e2e.ts` guards it with a synthetic world (150 art pieces, 400 instances, 30 lights).
- Exterior context from data (`environment.surroundings`: hills, tree line, field patchwork), facade depth, section poche, neon smear fix, day grade that counters AgX's lifted blacks.

- Editing: an identical repeat of an architecture edit on the same document is answered from its last results (the studio tried candidate ops and then committed the winner through the same call, doing the work twice): drawing a room 135 to 71 ms and 111 to 62 ms. A view-mode harness (`tests/e2e/arch-view-perf.e2e.ts`) counts wall rebuilds, geometry creations and GL objects over cutaway turns and level-mode toggles. A second pass over Pascal Editor's rendering and performance code is recorded in `docs/PASCAL_COMPARISON.md`.

### Photo to room

- `perceive_photo`: open-licence vision models measure the photo (Florence-2 detection, SAM 2.1 masks, metric depth, floor and wall planes, per-object colour in CIELAB) and the numbers go to the model as advisory evidence and seed the object inventory. Off by default, models fetched on first use with pinned checksums.

### Generation
- Generation brief: before building, the model plans what a space needs and how elaborate it should be, with counts worked out from area and spacing. The plan shows in chat as a collapsible card and can be edited before the build.
- Richness review: a world built from free pieces is compared against its brief with an overview and eye-height views; shortfalls go back to the model once per set, and a stall on repeated findings does not end a review whose brief is satisfied.
- `shape_land` layouts: tier and grid (rows, raked seating), wall, along, perimeter and around, and `street` (a village street with regional houses, fences with gates in line with doors, gardens and lamps). Land follows the plot; forests count trees per hectare.
- `find_model` offers crafted parts by alias and refuses a different kind of object as a stand-in.

### Templates
- Each generated-world card now says how it was made (`provenance` in the showcase manifest): "Built by the offline planner (no AI connected)", "Generated live by Claude Code" or "Generated live by Codex". The first five are offline-planner worlds. `scripts/brief-probe.ts` copies each run's world, stills and counts to `~/.local/share/aether/gen-worlds/<id>/`.
- Five worlds generated by the agent are bundled as templates under "Generated by the agent": Lantern Hunt (a verified-playable forest game), a medieval market village, a modern pool house, a two-bedroom apartment and a Scandinavian living room. Each is stored as generated (`origin: 'agent'` in the showcase manifest), re-validated and re-verified by `showcase:bake`, with its prompt on the card. Worlds, thumbnails and the section load lazily; the index bundle is unchanged.
- Three buildings from live runs join the agent templates, each with its provenance and prompt on the card: Starlight Cinema (Codex, 177 pieces with crafted seats, steps and acoustic panels), and Orion Cinema and Evening Bistro (Claude Code). Only worlds that passed review under the current renderer are bundled; the cards now show the prompt as a visible line.
- City Museum (Claude Code, 184 pieces: a gallery of framed paintings with labels, display cases, a sculpture hall, a cafe and a shop) joins the agent templates.

### Architecture elements and tool wording
- New structural elements, written from scratch and appended after the existing ones (a world that does not use them compiles to the same meshes and keys as before): `arch-spiral-stair` (radius, rise, turns, handedness, solid post or open core, steel, timber or glass balustrade, a guard round the stairwell above, a stairwell outline, a walking line and a wedge collider per tread, so the bot and the player climb it), `arch-dormer` (gable, shed and hip dormers with a window, cheeks and roof that meet the slope, flashing along the edges, `dormerPlacement` for a roof side) and `arch-turret-roof` (cone, bell, dome and ogee caps, round or polygonal, finial, optional turret wall with slits).
- Column styles: `arch-column` takes an optional `style` (fluted, classical with base, tapering shaft and tuscan, doric or ionic capital, pilaster); `furn-column` gained the `classical` and `ionic` variants.
- `find_model` names them: spiral staircase, dormer window, conical roof, witch hat roof (`furn-spiral-stair`, `furn-dormer`, `furn-turret-roof`).
- Tool wording: reports claim the narrowest thing the evidence supports and list what was not checked; a placement refusal is read as a constraint to solve; an edit that would empty a world is refused (`apply_patches` unless `startOver`, `edit_items` remove).

### Library and parts
- Asset library for any world: 76 Poly Haven outdoor and street models, Kenney space, castle and watercraft kits, five more HDRIs, KTX2 twins. The hosted build ships the subset the example worlds use and fetches the rest from a pinned CDN.
- Crafted procedural parts: furniture (sinks, cane chairs, fridges, ovens, rugs), venue and public space (cinema seat, tier floor, screen, stage, speakers, acoustic panels, lectern, stanchions, statue and bust, wall labels, place settings, candles, columns, planters), gym, clinic and street pieces (treadmill, rack, hospital bed, bus shelter, market stall), harbour (five kinds of boat, bollards, cleats, piles, lobster pots, gulls), and seven regional dwelling types with real roofs, shutters, reveals, plinths, fences, gardens and street lamps. Thatch and slate roof finishes.
- Facade pass for buildings made from a design: entrance surround, canopy, sign with emissive lettering, cornice, pilasters, forecourt, lamps.

### Photo to room
- `measure_room`: an advisory room size from a monocular depth network (Depth Anything V2 Small, Apache-2.0, CPU, weights fetched on first use). The estimate is added to the first analysis and a space refusal hands the model the room's numbers.
- The shell size answer is explicit and accountable; curtains hang at wide glazed doors; golden-hour skies keep to the side of noon their hour is on; real furniture models are placed where they fit.

### Studio
- Neutral, calm interface colours: no blue anywhere in the chrome. Warm-grey surfaces (OKLCH hue 85), the primary action is solid ink on light and paper on dark, secondary actions are outline or ghost, sliders have a 2 px ink track and an ink thumb, switches are ink, selection is shown with a neutral wash or weight, links are underlined, and focus is a 2 px solid ink or paper ring. Colour is kept for danger, warning and success, plus one small warm dot for the agent. Theme-colour meta (light and dark), favicon, manifest, loading and 404 pages, and the published player follow. The editor's selection outline, edit gizmos, path, ghost and replay overlays are white and warm grey. Tokens in `styles/tokens.css` are the one source; `npm run check:ui-colour` checks WCAG AA pairs and fails on any blue or purple hue in the stylesheets; `scripts/ui-audit.ts` and `scripts/ui-hue-scan.py` take and scan the screenshots. See `docs/DESIGN.md`.
- IFC4 export of buildings (`export` with `format: ifc` in the MCP server): storeys, mitred walls with door and window openings filled by doors and windows, floor slabs, room spaces, ceilings, roofs, stairs, railings, columns, furniture boxes. The STEP writer is adapted from Pascal Editor (MIT, credited in `docs/THIRD_PARTY.md`).
- Removed the Plan Reveal (the arch bar's Reveal button, the ink-on-paper plan overlay and the rising-walls animation). The Reveal video camera move in Publish stays.
- Project cards and rows show the actions button (…) at all times as a frosted 32 px button with a visible focus ring, plus a trash button. A Select mode deletes several projects with one confirmation and one Undo, with a message when some could not be deleted or restored. Delete or Backspace on a focused card opens the confirmation, Escape leaves Select, and the editor's Aether menu has Delete project….
- No text over the picture for mode switches, scene or texture preparation, lighting, checks or play tests. Stop puts the editor camera back where Play found it.

### Tooling
- Demo video pipeline (`npm run demo`): a scripted recorder for the real studio, an ffmpeg edit with burned-in captions, and checks.
- Scripts: `brief-probe`, `world-stills`, `exposure-audit`, `world-perf`, `dwelling-sheet`, `furn-sheet`.
- Community files: CONTRIBUTING, SECURITY, CODE_OF_CONDUCT, issue and pull request templates; `docs/BRANCHES.md`.
- `three` stays pinned to an exact version; `packages/render/test/three-internals.test.ts` fails with the member name when an upgrade changes a private shape.
- `npm run budget` checks the first-visit download against `scripts/size-budget.json`; `npm run licences` checks production licences against `docs/THIRD_PARTY.md`.
- `docs/README.md` indexes the documentation.

### Security
- The dev and preview servers answer to localhost only. A tunnel host is allowed by naming it in `AETHER_DEV_ALLOWED_HOSTS`.
- Lockfile: `body-parser` 2.4.0 and `fast-uri` 3.1.9 clear the high-severity audit finding. `npm audit` reports 0 findings.

### Reliability
- Uncaught errors and unhandled promise rejections are logged once each and shown as at most one calm notice per 15 seconds.
- Frames are presented only when complete: scene and effect passes are prepared before the screen pass opens.
- Rendering resolution is preserved during CPU-bound slowdowns; shared shaders and procedural noise prepare off the UI thread.
