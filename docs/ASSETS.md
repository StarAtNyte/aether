# Assets: library, imports, forge and packages

Aether builds most things procedurally, but everyday objects look best as
real models. The asset pipeline adds a curated library of real-world-sized
models and HDR skies, user imports, an AI "forge" that turns an image or a
sentence into an editable generator, and self-contained world packages —
with a fallback chain so a world never shows a hole.

```
CC0 / CC-BY asset → built-in generator → AI-written generator → primitive stand-in
```

## The curated library

| | |
| --- | --- |
| Entries | 666: 625 models (animated: people and animals with idle / walk / run, 2 chests that open), 10 HDR skies, 23 photographed surfaces, 8 forge originals; 250 models are realistic (photographed), 348 low-poly and 68 stylised (the kits of Kenney and the code-authored creatures and vehicles) |
| Categories | furniture 115, building 53, vehicles 50, decor 50, street 47, nature 38, animals 37, rocks 28, plants 25, kitchen 25, lighting 24, food 24, props 77, characters 19, bathroom 10, tools 11, skies 10, surfaces 23 |
| Sources | 17 Kenney kits (CC0; the later sci-fi base, castle and watercraft kits are built by `build.ts --extra`), about 190 Poly Haven models (98 interiors, 76 outdoor, street, industrial, harbour, farm and fantasy models, 16 earlier ones) + 10 Poly Haven HDRIs (CC0), 23 ambientCG PBR materials (CC0), Quaternius Farm Animals (CC0, 7 models), Khronos Fox (CC-BY-4.0), 29 NVIDIA SimReady Central models (an LG range cooker and 28 common props: office chairs, desk, tables, shelf, cabinets, sofas, lamps, monitor, keyboard, bins, mug, plate, bucket, boxes, tools; CC-BY-4.0), 8 first-party forge originals, 13 code-authored creatures and 13 vehicles (MIT) |
| Disk | 170 MB under `assets/lib/` (meshopt-compressed GLB, JPEG textures at 256 / 512 / 1k, 512 px surface maps, 192 px WebP thumbnails, 1k HDR), plus 68 MB of KTX2 twins under `assets/lib/k/` ([GPU-compressed textures](#gpu-compressed-textures-ktx2)); the library is fetched on demand, never bundled with the app code |
| Catalog | `assets/catalog.json`, 464 KB (83 KB gzip), loaded lazily after the editor starts |
| Provenance | `assets/manifest.json`: source archive + SHA-256 (Kenney) or per-file MD5 (Poly Haven API), file inside the archive, licence, authors and SHA-256 of every shipped file |

Every asset is real-world sized in metres, its base on y = 0 and centred in
x / z. Props face +Z (like the parametric furniture); characters, animals and
vehicles face −Z, the engine's forward axis, so behaviours walk and drive
them head first. Search understands synonyms ("couch" → sofa, "cop car" →
police car), plurals and small typos.

### Which models serve which world

Every model carries a **category** (nature, rocks, plants, street, building, vehicles, props, tools, decor, lighting,
furniture, ...) and a **look** (`style`: `realistic` for photographed Poly Haven models, `low-poly` or `stylised` for the
Kenney-style kits and code-authored pieces). Realistic models also carry an `interior` fact: the object type ("tree",
"rock", "hydrant", "sofa"), words for the design style or the biome it belongs to (forest, desert, coastal, harbour,
urban, industrial, farm, scifi, fantasy, medieval), measured colours and the size. `find_model` ranks by those, so a
prompt for a desert gets sandstone and quiver trees, a harbour gets ships, buoys and barrels, a city block gets
street lamps, hydrants, barriers and bins. It takes `category` and `look` filters: a realistic request never returns a
stylised kit, a `look: "low-poly"` request searches the kits (sci-fi base, castle, watercraft, pirate, fantasy
town, nature, city, survival...) instead.

| World | Realistic (Poly Haven) | Stylised / low-poly (Kenney) |
| --- | --- | --- |
| Forest, woodland | dead trunks, ferns, mossy rocks, branches (the dense scanned trees are too heavy; procedural trees fill in) | nature kit, castle trees and logs |
| Desert, canyon | quiver trees, succulents, sandstone boulders, rubble and a cliff, sand rocks | castle rocks |
| Coast, harbour | coastal ships, barrels, crates, chests, cannon, buoys, life ring, buckets | watercraft kit (ships, boats, containers, cargo, ramps), pirate kit |
| City block, street | street lamp, hydrant, barriers, bins, utility boxes, manholes, picnic table, signs, fence, gates, covered car, fire escape | city kits (roads, commercial, suburban), car kit |
| Industrial, sci-fi | pipes, crane, generator, racks, carts, barrel stove, floodlights, spacecraft instrument, moon rocks | space kit (corridors, hangars, platforms, craft, turrets, crystals, rovers) |
| Farm, garden | planters, watering can, spade, ladder, seed tray, bags, sprinkler, crates, buckets | survival kit |
| Medieval, fantasy | castle door, shields, swords, statue, candlestick | castle kit (walls, towers, gates, siege engines, bridges), fantasy town kit |
| Interiors | the 98 furniture and decor models; sinks, cane chairs, rugs, fridges and ovens are procedural parts (`sink`, `cane-chair`, `fridge`, `oven`) | furniture kit |

Venue, civic, gym, clinic and street pieces that no photographed model covers are crafted procedural parts (see [AGENT_TOOLS.md](AGENT_TOOLS.md#place_items): cinema seat, tier floor, cinema screen, stage, pew, altar, library stack, vitrine, counters, school desk, blackboard, treadmill, hospital bed, bus shelter, market stall and more), found by `find_model` through their aliases before library models; photographed models remain the choice for chairs, tables, lamps, benches, street lamps and props.

Gaps that remain: dense photographed trees and grass (procedural foliage covers them), bathtub and toilet (procedural
parts), curtains and rugs (procedural parts), window views (sky HDRIs).

### Rebuilding it

```sh
npm run assets:fetch    # download + verify the sources into ~/.cache/aether-asset-src (outside the repo)
npm run assets:build    # normalise, merge, LOD, compress, colliders, catalog + manifest
npm run assets:thumbs   # render thumbnails in one headless Chromium
npx tsx scripts/assets/build.ts --interior [--ids=a,b]   # the Poly Haven rows of selection-interior.ts and selection-outdoor.ts (--ids upserts only those)
npx tsx scripts/assets/build.ts --extra                  # the later Kenney kits and skies of selection-extra.ts
npx tsx scripts/assets/sheet.ts 0 120 sheet.png   # contact sheet for review
```

- `assets/sources.json` lists every download (URL, version, licence, SHA-256).
  The fetch script refuses hosts outside kenney.nl / polyhaven / ambientCG, anything not
  CC0-1.0 / CC-BY-4.0, checksum mismatches, archives with absolute or `..`
  paths, and Kenney archives whose `License.txt` does not state CC0.
- `scripts/assets/selection.ts` is the curation: which files ship, their ids,
  names, categories, keywords, placement (floor / wall / ceiling / surface),
  collider kind and the per-kit scale to metres.
- `scripts/assets/build.ts` (glTF-Transform + meshoptimizer, dev-only):
  1. static models: every node transform and the normalisation are baked
     into the vertices and primitives sharing a material are merged (a few
     draw calls per model); animated / skinned models keep their hierarchy
     under a normalising root;
  2. older untextured kits store sRGB colours in linear factors — fixed;
  3. models over 3,000 triangles get geometry-only LOD files (≈ 50 % and
     ≈ 15 %) that reuse LOD 0's materials at run time;
  4. colliders: box, upright capsule (characters) or 26-direction support
     points of a convex hull (cm);
  5. `EXT_meshopt_compression` (decoded by three's `MeshoptDecoder`),
     content-hashed file names (served with immutable caching).
- Realistic textures are re-encoded to JPEG q0.8 ≤ 1024 px (a third of the
  bytes) with the browser's encoder.
- `scripts/assets/materials.ts` turns ambientCG PBR sets (CC0) into photo
  finishes for `material.finish` (oak, walnut, brick, tile, marble,
  concrete, stone, fabric, plaster, terrazzo, ground and wall finishes such
  as asphalt, cobble, gravel, grass, sand and snow; 23 in all): 512 px albedo divided by its
  mean (so the finish colour and `material.color` tints still apply), an
  ORM map whose roughness is rescaled to the finish's calibrated value, and
  the OpenGL normal map. Catalog entries have kind `material`, id
  `finish-<finish>`, category `materials` ("Surfaces" in the library).
  When the catalog is loaded, the renderer swaps its procedural finish
  textures for the photos; without it the procedural ones stay.

### Licences

Only CC0-1.0 and CC-BY-4.0 third-party assets are accepted (attribution is
generated automatically for CC-BY: credits panel, end-of-game screen,
`CREDITS.txt` in packages, and [THIRD_PARTY.md](THIRD_PARTY.md)). NC, ND,
editorial-only, personal-use-only and unclear licences are never shipped.
Quaternius packs from quaternius.com were evaluated and **not** included: the pack pages say
CC0 but the site's licence page forbids redistributing the assets as
assets, which a public repository would do. (The Farm Animals pack ships
from its OpenGameArt release, whose own `License.txt` states CC0.)

## GPU-compressed textures (KTX2)

A JPEG or WebP texture is decoded to RGBA8 before it reaches the GPU: a 1k
map takes 5.6 MB with its mip chain, whatever its file size. Every textured
library model therefore has a twin under `assets/lib/k/` whose images are
KTX2 / Basis Universal (`KHR_texture_basisu`), which the browser transcodes
to a block format the GPU samples directly (BC7 on desktop, ETC or ASTC on
mobile): a quarter of the memory.

```sh
npm run assets:ktx2              # after assets:build / characters:build / the block-texture script
npm run assets:ktx2 -- --check   # verify assets/ktx2.json against the files
npm run e2e:ktx2                 # memory, load time, download and stills, with and without (needs a build)
```

- **Encoder**: KTX-Software's `ktx` CLI 4.4.2 (Apache-2.0), pinned:
  `AETHER_KTX`, else `ktx` on `PATH` (version checked), else the official
  Linux x86_64 release, downloaded once into `~/.cache/aether-tools` and
  checked against its SHA-256. Images are decoded to exact bytes in one
  headless Chromium (WebGL2 read-back, unpremultiplied); encodings are cached
  by input hash and settings, so a rerun only encodes what changed.
- **Codecs**: colour (base colour, emissive) is sRGB, everything else linear.
  Albedo is ETC1S (Basis LZ, `--clevel 4 --qlevel 255`) when the luma-weighted
  SSIM of its first level is at least 0.95, UASTC otherwise (fine detail,
  hard palette edges). Normal maps and ORM / metal-rough / occlusion maps
  are UASTC with rate-distortion optimisation and Zstandard (normals
  λ 0.5, data λ 1.25), kept as RGB (no two-channel normal mode: three
  samples `.xyz`). Cut-out colour (`MASK` / `BLEND`: the cast's hair cards,
  lantern glass) is UASTC without RDO, its colour bled outwards under
  transparent texels so mip levels have no dark fringe. Full mip chains
  (lanczos4; wrapping for repeating samplers).
- **Index**: `assets/ktx2.json` maps each original library path to its twin
  with both SHA-256s, sizes, each texture's codec and SSIM and the estimated
  GPU bytes before and after. A test fails when a library file changes and
  its twin was not remade. The block sheets have KTX2 array twins too
  (`public/blocks/block-*.ktx2`, `block-ktx2.json`).
- **Run time**: the renderer sets up one `KTX2Loader` per renderer once the
  catalog is in and self-tests it (transcoder fetched, a tiny embedded KTX2
  transcoded). Library model URLs with a twin then load the twin. Anything
  that cannot work, such as no workers or WebAssembly, no compressed format
  on the GPU (transcoding to RGBA8 would save nothing), missing transcoder
  files or a failed self-test or twin, loads the original file instead.
  `?textures=rgba` forces the originals (comparisons).
- **Transcoder**: three's `basis_transcoder.{js,wasm}` (Apache-2.0) are served
  from `apps/studio/public/basis/` with `ktx2-worker.js`, KTX2Loader's own
  worker body as a static file, because the transcoder glue needs
  `new Function` and a `blob:` worker would inherit the page's strict CSP. The
  worker gets its own sealed policy (see [SECURITY.md](SECURITY.md)).
  `scripts/assets/basis-worker.ts` regenerates the three files after a three
  upgrade; a test compares them.
- **The cast**: outfit and hair tints are baked on the CPU. For a body loaded
  from its twin the tint is baked from the original file's embedded images,
  read without decoding the mesh (one extra download of the original body
  per tinted body). The tinted copies stay RGBA8.
- **Exports and path traces**: the glTF export decompresses compressed
  textures through three's WebGL2 texture utilities, and the path tracer
  samples them on its own WebGL2 context, when that context supports the
  format (otherwise they are left out, as before).
- **Not compressed**: the photographed surface finishes (`x/`, 512 px maps
  filled into shared texture arrays at run time), the leaf cards (composed
  from the Poly Haven leaf sprites on a canvas at run time), the outfit masks
  (read on the CPU only) and the thumbnails (UI images, never on the GPU).

The trade-off is download size: UASTC normal and ORM maps are 3 to 5 times
larger than the 1k JPEGs they replace (they are close to lossless), so the
twins add 67 MB to the deployment (24.6 MB of sources) and a world downloads
1.2 to 2.8 times the library bytes on a first visit (library files are cached
immutably afterwards). In return a world's image textures take 2.7 to 6 times
less GPU memory, which is what decides whether integrated GPUs and memory-tight
browsers keep up. Measured results are in [REVIEW_LOG.md](REVIEW_LOG.md).

## Using assets

- **Library tab** (Assets panel): category sections, chips, search,
  favourites (per browser). Click places at the centre of the view (several
  clicks line objects up); drag drops under the cursor with a translucent
  preview, snapped to the surface below, against walls (back to the wall)
  or under ceilings; wall items hang on walls. Skies set `environment.hdri`;
  surfaces dropped on an object set its `material.finish`.
- **Inspector**: source and licence, real size, look (variants), fit size
  and animation (auto / none / a clip).
- **Agent**: `search_assets` tool and a compact library summary in the
  prompt; shape `{"kind":"asset","id":"sofa"}`. The offline planner uses
  library models for everyday nouns and keeps nature and gameplay pieces
  procedural; furnished buildings get photographed furniture where it
  suits the style.
- **Animated people and animals** play idle / walk / run from their actual
  movement (patrol, wander, follow, npc, playerController…).

## Imports

Drop files on the viewport or use **Imports → Import files**:

- `.glb` / self-contained `.gltf` models (≤ 32 MB, ≤ 500 k triangles, no
  external references, supported extensions only; pivot normalised;
  content-addressed ids so re-imports dedupe);
- PNG / JPEG / WebP images become framed posters (≤ 12 MB, ≤ 8192 px);
- `.hdr` environments become the sky (≤ 24 MB, ≤ 4096 px);
- `.aether.zip` world packages open as a world.

Imports are stored in this browser's IndexedDB (`aether-assets`, ≤ 200
files, ≤ 400 MB; session-only when storage is blocked) and are not part of
share links (a stand-in shows; use a package to share them).

## The asset forge

**Create from an image or text** (Library tab, or refine a creation in
Imports): a connected model (Codex, Claude Code or an API key) rebuilds the
object as an editable procedural generator:

1. **Observe** — object class, macro → meso → micro parts, proportions as
   ratios, PBR materials, identity-defining features.
2. **Spec** — component list with real dimensions (kept in the
   generator's description).
3. **Build** in passes (silhouette → structure → form → materials →
   details) and **parametrise** (size, colours, counts, variants).
4. The sandbox checks it, a private WebGL2 renderer draws front, side, top
   and three-quarter views, and a critic scores silhouette, proportions,
   parts and colours against the reference with concrete fixes.
5. The coder patches the code; repeat until the gate (80/100) passes or the
   budget (4 passes, 10 model calls) is spent. Every pass is shown live
   with its score and what still differs; the best version wins.

Accepted results are saved as **Your creations** (IndexedDB) and placed;
"Refine" applies a change ("taller, walnut") to the same generator. Offline
the forge says it needs a connected model; a model without vision builds and
validates without the visual comparison (said in the dialog).

The eight **forge originals** in the library (ornate fountain, classical
statue, Victorian lantern, sailing galleon, vintage roadster, stylised
explorer, cherry blossom tree, garden gazebo) were made with this pipeline
(`scripts/assets/forge-heroes.ts`, Claude Code, 33 model calls in total) and
ship as ordinary library generators — AI-written code, disclosed in
[THIRD_PARTY.md](THIRD_PARTY.md#ai-disclosure).

## Packages

**Menu → Export package** writes `<world>.aether.zip`: the world, every
library file it uses, its imports and `CREDITS.txt`. Opening a package
re-validates every file (entry count and size caps enforced while inflating, CRC, safe names,
content ids must match).

### The interior model library

About a hundred photographed interior models (sofas, armchairs, chairs, tables,
beds, shelves, lamps, plants, vases, books, mirrors, pictures, clocks, small
appliances) from Poly Haven (CC0) ship next to the Kenney kits, in `assets/lib/i/`.
They are built by their own step so a full `assets:build` never has to run for them:

```sh
npm run assets:fetch -- --only=polyhaven   # sequential, MD5-checked downloads into the cache
npx tsx scripts/assets/build.ts --interior # rows of scripts/assets/selection-interior.ts → assets/lib/i, assets/interior.json, catalog, manifest
npx tsx scripts/assets/thumbs.ts           # thumbnails of the new entries
npx tsx scripts/assets/thumbs.ts --only a,b --front=out --yaw=0   # straight-on views, to check which way a model faces
```

- Real metres and a floor-centre pivot (the front faces +Z; `rot` in the selection
  turns a model that does not), meshopt packing, a triangle budget of 20,000 for the
  main file (the vertex buffers shrink with it) and one distance level.
- Texture tiers: the photographed maps are resized by `scripts/assets/tex_tiers.py`
  (Pillow) to 512 px, or 1024 px for large pieces, and to 256 px for the **light copy**
  (`lite` in the catalog) that the renderer loads on the low quality tiers (software
  or weak GPUs, low memory). Nothing loads until a piece is placed: each model is its
  own file, fetched on first use and cached with the rest of the library.
- Catalog facts (`interior`): the type ("sofa", "coffee-table"), design styles,
  colour names and the dominant colour measured from the model's own base-colour
  texture, and whether its upholstery can be recoloured. `@aether/assets` `findModels`
  ranks on them (type, then style, colour and size); `pickModel` is what layouts use.
- Variants: the other models of the same type (up to twelve) are listed as
  `variants`, 2 to 9 per type.
- Gaps, stated plainly: Poly Haven has no sink, toilet, bath, fridge, rug, curtain
  or modern bed. Those stay parametric parts (or the Kenney pieces).
- Size on disk: about 50 MB for the main files and distance levels, 17 MB more for
  the light copies. A scene fetches only the models it places.

## Amazon Berkeley Objects (streamed real products)

7,813 real furnishings (sofas, chairs, tables, beds, lamps, rugs, wall art, mirrors, planters, decor) from the
[Amazon Berkeley Objects GLB pack](https://huggingface.co/datasets/codepawl/abo-glb), CC BY 4.0, streamed from Hugging Face at
the pinned revision. Only the index ships: `assets/abo.json.gz` (386 KB; 1.5 MB as JSON), rebuilt with `npm run assets:abo`
(`scripts/assets/abo-index.ts`; `--metadata=<file>` reads a local `metadata.jsonl`, `--json=<file>` also writes the plain text).

- **Ids.** A product is the asset `abo-<lowercase ABO id>` (`abo-b0714qgc72`). `catalogEntry` and `assetInfo` answer for it as for
  a library model once `loadCatalog` resolved (it loads the index alongside the catalog), so placement, size, physics (a box
  collider), credits and the planner need nothing else. Type, category and mounting (floor, wall, ceiling, surface) come from the
  listing name first, then its product type; the size is the measured one in metres; the loader shifts each product onto a
  floor-centre pivot (wall art hangs centred on its back, pendants hang from y = 0 in the pack).
- **Search.** `find_model` lists "Real products" above the library for interior pieces (`findAboModels`: the finder's type, style,
  colour and size ranking, then the request's other words such as "velvet", "chesterfield" or "floor" first);
  `search_assets` adds up to four. `place_items {"kind":"model:abo-…"}` places one at real size with the mount the product has.
- **Levels.** LOD 0 near is `objects_ktx2/` (KTX2 up to 2048 px), the far levels `lods/…_lod2` (512 px) and `_lod3` (256 px); the
  light copy of the low tiers is `_lod2`. KTX2 textures cannot be shrunk on upload, so under the texture cap (512 px on
  integrated GPUs and in low-memory mode, see PERFORMANCE.md) the loader takes the first level within it. Without a KTX2
  transcoder the WebP copy (`objects/`) loads instead. Geometry is meshopt-compressed (the loader's `MeshoptDecoder`).
- **Network and caching.** The resolve URLs answer with a `no-store` redirect to `us.aws.cdn.hf.co` (or straight from
  `huggingface.co`), CORS open; the CSP lists both hosts. The model loader keeps every product file in Cache Storage
  (`aether-abo-v1`): the URLs are pinned, so a product downloads once per browser. Published games carry the files they use
  under `assets/lib/` and never contact Hugging Face.
- **Weight.** Each distinct product is about 1.4 MB with its far levels (median); the weight check (`streamed_products`) warns past
  60 MB or 3 M full-detail triangles and fails a world past 150 MB. The agent is told to use about 8 to 15 products per room.
- **Credit.** "3D models by Amazon.com, Amazon Berkeley Objects (CC BY 4.0); web-optimised GLB by CodePawl" (see THIRD_PARTY.md).

## SimReady Central

[NVIDIA SimReady Central](https://huggingface.co/spaces/nvidia/simready-central) is a semantic search over about 3,600
OpenUSD packages that vendors and labs publish as Hugging Face datasets (97 percent CC BY 4.0, Apache-2.0 code for the
service). Aether uses it as a **searchable, licence-filtered source of candidates**; it is not part of the shipped library
and the studio never needs it for what ships. 29 packages are imported ahead of time: an LG range cooker and 28 common props (triangles 560 to 11,800, 45 to 400 KB each, 9.1 MB for all files and tiers; the hosted build ships only their thumbnails, the models come from the CDN when a world uses one). Anything else can be imported while you work, see below.

```sh
npm run assets:simready -- search "range cooker" [--limit=8] [--max-size=2] [--min-size=0.2] [--json]
npm run assets:simready -- fetch LGElectronics/simready-assets@70ea043e1a85455227e516766443d1fa235a5ea0/cooking_ldgl6924s
npx tsx scripts/assets/build.ts --simready [--ids=simready-range-cooker-lg]   # convert + build only these ids, upsert catalog, manifest, assets/simready.json
npm run assets:thumbs -- --only simready-range-cooker-lg ; npm run assets:ktx2
```

- **API** (`packages/assets/src/simready.ts`, pure, `fetch` injected): `POST https://nvidia-simready-central.hf.space/search`
  with `{"description": text, "limit": N, "return_metadata": true}` answers `[{url, score, metadata: {modified, size}}]`, where `url` is
  `https://huggingface.co/datasets/<owner>/<dataset>/blob/<revision>/<package>/simready_usd/<file>.usd`. Size filters
  are the service's own `min_bbox_x|y|z` / `max_bbox_x|y|z` (metres, Z up; the tool bounds all three with `--max-size` /
  `--min-size`). The service has property filters for the licence too, but it matches the licence by substring (CC BY has
  three spellings in the index) and cannot be trusted as the check, so the tool asks for three times the hits wanted and filters
  itself. `/search_hybrid` is a variant of the same call; it is not used.
- **Licence check, per hit.** Two sources are read: the package's own `com.nvidia.simready.packaging.json` (`license`) at
  the pinned revision, and the dataset card (`https://huggingface.co/api/datasets/<owner>/<dataset>`, `cardData.license`). A hit is
  shown only when every source that answers is on the allow-list: **CC0-1.0, CC-BY-4.0 (as `CC-BY 4.0`, `cc-by-4.0`,
  `CC-BY-4.0`), MIT, Apache-2.0, BSD-3-Clause, BSD-2-Clause**; a compound licence (`A AND B`) needs every term allowed. Everything
  else is listed under "Rejected" with the reason: non-commercial, no-derivatives, share-alike or copyleft, a custom
  `LicenseRef-*`, no licence stated, any other licence. A package whose file and card disagree is rejected. Apache-2.0 and
  BSD hits are findable but marked "not importable yet": the catalog schema (`AssetLicence`) takes CC0, CC-BY and MIT only.
- **Fetch.** `fetch <owner>/<dataset>@<40-hex revision>/<package>` re-checks the licence, lists the package through the Hub tree
  API, downloads each file by its revision-pinned `resolve` URL (https, `huggingface.co` / `*.hf.co` hosts only, size caps) into
  `~/.cache/aether-asset-src/simready/<owner>/<dataset>/<revision>/<package>` (outside the repository, package folder name
  unchanged, a new directory per revision), and verifies every file: Git LFS SHA-256, the Git blob id of the small files, then the
  package's bill of materials (SHA-256 of every file) against the hash `packaging.json` pins. A branch name is refused. The files
  are untrusted data: nothing in them is run and the converter reads them with `python -I`.
- **Convert.** `scripts/assets/usd2glb.py` (dev-time, Python with `usd-core`, `numpy`, `pillow` in a venv outside the repository:
  `python -m venv ~/.local/share/aether/simready/venv && ~/.local/share/aether/simready/venv/bin/pip install usd-core numpy pillow`,
  or `AETHER_SIMREADY_PY`) bakes world transforms, triangulates, welds, converts Z-up to Y-up in metres, builds one primitive per
  material (GeomSubsets), and reads the PBR from the UsdPreviewSurface when it has textures, else from the OmniPBR (MDL)
  inputs next to it: diffuse, normal, emissive and opacity textures (opacity folded into the base-colour alpha), metallic and
  roughness constants or maps. MDL-only effects are listed and skipped. Python is never a runtime or CI dependency of the repository.
- **Build** (`selection-simready.ts`, `build.ts --simready`): the USD's SHA-256 must match `assets/sources.json`
  (`simready.packages`, validated: CC0-1.0 or CC-BY-4.0 only). The GLB then goes through the interior pipeline (real metres,
  floor-centre pivot, `rot` to face +Z, triangle budget 20,000 with meshopt, 512 px textures and a 256 px light copy, a distance
  level, a box collider, colours and styles for `find_model`). Files live in `assets/lib/s/` (the `--interior` rebuild clears `i/`),
  with an own `assets/simready.json` that a full `assets:build` merges back. Heavy CAD sources use an *aggressive* decimation
  (`simplifyDocument(..., true)` in `process.ts`): one metric error for the whole model found by bisection, then a topology-free
  pass, then normals recomputed from the new surface, because the default per-primitive pass stalls at about half the triangles on
  meshes split at every UV and normal seam.
- **Credits.** The pack carries the dataset, author and licence; a world that uses the model gets the CC-BY line in the credits
  panel, the end-of-game screen and `CREDITS.txt`, like the Fox. [THIRD_PARTY.md](THIRD_PARTY.md) records the credit text, the
  changes made and every hash.
- **The agent.** `simready_search` ([AGENT_TOOLS.md](AGENT_TOOLS.md#simready_search)) lists accepted candidates and prints the fetch
  command. It never downloads or imports.
- **Importing another asset.** Search, fetch, add a `simready.packages` entry to `assets/sources.json` (licence evidence: the
  `license` line of `packaging.json` and the dataset card; USD URL, size, SHA-256, package hash), add a row to
  `selection-simready.ts` (use `rot` for the front, `convert: ['--resmooth=50']` for CAD tessellation), then run the build, thumbnails
  and `assets:ktx2`, and add the THIRD_PARTY.md row with the changes made.

### Importing while you work

When nothing in the library fits, the agent (tool [`import_asset`](AGENT_TOOLS.md#import_asset)) or a script can have the **local
Aether server** import one model on demand. The conversion needs the Python USD tools, which cannot run in a browser, so it only
works with `npm run aether -- start` (or `npm run dev:server`); the hosted static site answers "importing needs the local server" and
never errors.

```sh
npm run assets:simready-setup     # once: ~/.local/share/aether/simready/venv with usd-core, numpy, pillow, huggingface_hub
npm run assets:simready-e2e -- "office chair"   # opt-in smoke of the whole path against the real services (not in CI)
```

- **Endpoints** (`apps/server/src/routes/assets-import.ts`; loopback and the session cookie required, off on a production or hosted
  server unless `AETHER_ALLOW_IMPORT=1`, off everywhere with `AETHER_ASSET_IMPORT=off`; `/api/health` reports `assetImport`):
  `POST /api/assets/import {query | ref, maxSize?}` returns `{job}` (202); `GET /api/assets/import/<job>` returns the stage
  (`queued`, `searching`, `licence`, `downloading`, `converting`, `optimising`, `ready`, `failed`), a message, progress 0..1 and, when
  ready, the record; `GET /api/assets/imported` lists the imports of this computer; the files are served under
  `/api/assets/imported/files/<id>/s/<name>.<hash>.glb`.
- **Pipeline** (`apps/server/src/assets-import/service.ts`): SimReady search (or a pinned ref) -> licence gate (only CC0-1.0, CC-BY-4.0, MIT;
  nothing else is ever downloaded) -> download of the pinned revision into `~/.cache/aether-asset-src/simready` with the hash checks of
  the CLI (shared module `packages/assets/src/simready-fetch.ts`, 150 MB cap) -> `usd2glb.py` through the venv (`AETHER_USD_PYTHON`
  overrides it; missing: `conversion tools not installed: run npm run assets:simready-setup`) -> the library's interior pipeline
  (`build.ts --import-one`, 20,000 triangles at most, 512 px textures, a distance level, a light copy; meshopt is left out; the studio's
  validator now also accepts a meshopt file's empty fallback buffer, as the hub's models use) -> `~/.local/share/aether/imported/<id>/` (`AETHER_IMPORT_DIR`) with `imported.json`: the library-shaped
  catalog entry, the credit line, author, licence, dataset, revision and the SHA-256 of the USD, the package and every file.
  One job at a time, a short queue, ten starts per ten minutes, twelve minutes per job.
- **In the studio.** The step feed, the status line and a toast show the stage. The finished GLB is checked against its recorded hash,
  validated like any dropped file and **stored with the project as a user asset** (`user-<hash>`) carrying its CC BY credit line, so a
  world never depends on the server after the import. Exported packages (`assets/user-<hash>.glb`) and published or shared games
  embed exactly the imports the world uses, and the credits panel, the end-of-game screen and `CREDITS.txt` list one line per
  imported model with its licence. A copied share link carries only the world, so a viewer sees stand-ins for
  imported models (the toast says so, as for any import); a published game (`game.json` `imports`) and an exported package carry the bytes.
- **Placing.** In an open world `shape {"kind":"asset","id":"user-..."}`; in a room `place_items {"kind":"model:user-..."}` (placed as a
  generic floor piece, no catalogue kind).
- **Not done.** The imported model has no `find_model` entry (the agent gets its id from the tool result), and Apache-2.0 / BSD packages
  are findable but not imported (the credit schema takes CC0, CC BY and MIT only).

**Honest limits.** The index is mostly small robotics props (median 0.19 x 0.17 x 0.11 m): furniture, buildings and nature are
rare, and appliances come from a few vendors. Packages are CAD-derived: 100,000 to 500,000 triangles that cannot be reduced
well, so the shipped model keeps the silhouette, the front, the hobs and the textures but has a ragged back and fewer details
(the range cooker keeps 19,000 of 514,000 triangles). Doors and joints are not kept: the model is one static mesh at rest.
OmniPBR clear coat and other MDL effects become plain PBR. The USD conversion needs the dev venv. The service and its
dataset hosts are third parties and can change or vanish: nothing at run time depends on them, the search says so and the
agent tool carries on, and a studio page cannot reach the service under its content-security policy (`connect-src` is not
widened for it); the CLI and scripts can. The licence check reads the package at its pinned revision; a vendor can still mislabel a
package, so the evidence is recorded with each import and a person approves each one.

## Hub dataset (Hugging Face)

The library's browser-sized models are also published as Aether's own dataset, `StarAtNyte1/aether-assets` on Hugging Face, so any
world can search for a model and load it lazily without the local server. The pinned commit is in `assets/hub.json`
(`{dataset, revision, visibility, indexSha256}`); a build uses that commit, so it is reproducible.

- **Layout** (like the SimReady datasets): `models/<id>/<id>.glb` (the library's meshopt GLB, 512 px textures, at most 1.2 MB),
  `<id>.lod1.glb`, `<id>.lite.glb`, `thumb.webp` (192 px), `provenance.json` (SimReady-derived models: the pinned source dataset,
  commit, package, the USD's SHA-256 and the package hash; it states that the file is a derivative and not NVIDIA-validated);
  `index.json` (one row per asset: id, name, aliases, tags, category, style realistic or stylized, size in metres, triangles, bytes,
  SPDX licence, author, credit line, source name / URL / dataset / commit / path, the conversion note, the CC BY "modified" notice,
  collider, SHA-256 and size of every file); `index.min.json` (the compact index the client loads, about 130 KB, 40 KB gzipped);
  `embeddings.bin` + `embeddings.json` (int8 CLIP ViT-B/32 image embeddings of the thumbnails, the same tower as the photo
  perception layer, 0.3 MB); `README.md` (the dataset card: dataset licence `other`, per-asset licence column, CC BY attribution table).
- **What goes in.** Only CC0-1.0 and CC-BY-4.0 models of the catalog (`hubLicenceAllowed`): never non-commercial, no-derivatives,
  share-alike or unlabelled, and not the first-party MIT creatures and vehicles. Dropped: main file over 1.2 MB, people (rigged
  characters are not props), no thumbnail, no triangles. Every row has a credit and a source; SimReady-derived rows pin the source
  commit.
- **Tool.** `npm run assets:hf -- build` stages `~/.local/share/aether/hf-assets-stage/` from the catalog; `verify [--remote]` re-hashes
  every file, audits licences, credits and source pins, validates both indexes and the embeddings, checks that every main file passes
  the studio's GLB validator, and with `--remote` compares against the hub's file list; `upload [--public] [--pin]` creates the repo
  **private** (unless `--public`), uploads the models in batches of 120 and the index last (a half upload never points at missing
  files), and `--pin` writes the commit and the index hash into `assets/hub.json`. `huggingface_hub` reads the token itself
  (`~/.cache/huggingface/token` or `HF_TOKEN`); the script never reads, prints or logs it. The token needs write access to the
  namespace.
- **Search** (`@aether/assets/hub`, `@aether/assets/hub-client`, both loaded lazily; the first-load budget is unchanged).
  `HubClient.search(query, {limit, style, maxBytes})` loads `index.min.json` from
  `https://huggingface.co/datasets/<dataset>/resolve/<revision>/` on the first query, keeps it in the Cache API (a pinned commit is
  immutable, so it is never revalidated; an unpinned `main` is revalidated with its ETag), and ranks with the library's own search
  (every word must match by name, alias, tag, synonym, prefix or one typo). It returns hits with thumbnail URLs and never throws:
  offline, blocked, private or a bad answer is the state `unavailable` with a reason, and the bundled library keeps working.
  `similar(id)` ranks by the image embeddings. Text-to-embedding search is not shipped to the browser: CLIP's text tower is 64 MB.
- **Loading a hub model.** `AssetController.importHubModel(id)`: fetch the GLB lazily from the pinned commit, compare its SHA-256 with
  the index (a mismatch is discarded), validate it like any dropped file, store it with the project as a user asset carrying the
  credit line and `origin: hub:<dataset>@<commit>/<id>`. The world references the asset by its content hash (`user-<hash>`), so exports
  and published games **embed** it: a published page never talks to Hugging Face (the player's CSP stays closed) and shared `/play`
  links work whether the dataset is public or not. The credit appears in the credits dialog, the end screen and `CREDITS.txt`.
- **In the studio.** The Assets panel search shows an "Asset hub" section under the library results as you type (220 ms debounce,
  two letters minimum, thumbnails lazy, models the library already has are not repeated); a click adds the model. The agent's
  `find_model` lists hub models after the library's, marked "hub", and `import_asset {query, hub_id}` loads one.
- **Private dataset.** While `visibility` is `private` a built studio does not contact the hub at all. `vite dev` reads it through
  `/__hub/…` (`scripts/vite/hub-proxy.ts`): GET only, only this dataset's index, embeddings and `models/<id>/` files, the token
  (`AETHER_HUB_TOKEN` or `HF_TOKEN`) added on the server side and never sent to the browser or to a redirect host;
  `AETHER_HUB_DIR=<staging folder>` serves a local build instead of the network.
- **CSP.** The studio page may GET from `huggingface.co` and its CDN redirect hosts (`cdn-lfs*.huggingface.co`, `cdn-lfs*.hf.co`,
  `cas-bridge.xethub.hf.co`): `connect-src` for the index and models, `img-src` for thumbnails, nothing else (no scripts, workers or
  frames). The player and exported games get no such hosts.

### Lookup order (hub-first for props)

Read from the code before the change: `find_model` listed crafted parts and bundled-library models first and appended hub models
after them (the model chose); `import_asset` (SimReady Central, or `hub_id` for the hub) ran only when the model called it; the
generators (`write_generator`, crafted `furn-*` parts) came when nothing matched; the offline planner never touches the hub (the
studio passes `hubSearch` only to the live agent); the generation brief only names parts and models.

Now, for a real-world prop (furniture, appliance, tool, vehicle, kitchenware, equipment, decor):

1. **Asset hub**, if a match passes the thresholds in `packages/assets/src/hub-policy.ts` (`HUB_FIRST`, one place): confidence
   at least 0.7 (1 = every query word is a name word, 0.73 a tag, 0.33 a prefix match) AND the longest side is plausible (a
   typical-size table for common props, else 0.4 to 2.5 times the bundled catalog's size for the same words; never under 3 cm or over
   30 m, so a 0.1 m "desk" is rejected). The match is the library ranker's (name, alias, tag, synonym), normalised: the CLIP image
   embeddings have no text tower in the browser (64 MB), so they serve `similar()` only.
2. **Bundled library**, then **crafted parts**, then the **generator**.

Structural parts (walls, doors, windows, stairs, roofs, floors, ceilings, foundations, facades, beams...) never come from the hub:
the hub is not even asked. The hub gets 3 s (`HUB_FIRST.timeoutMs`); unreachable, private, slow or throwing, it is skipped silently
and the offline planner is unaffected. Every `find_model` answer ends with `Source: ...` (hub, or library and crafted parts with
the reason the hub was skipped) so the judge and the chat can say which was used. A hub model keeps the hash check, credit line and
embedding in exports as before.

## Bulk import (SimReady to the hub dataset)

`npm run assets:simready -- bulk` converts a curated slice of SimReady Central and publishes it to the hub dataset
(`StarAtNyte1/aether-assets`, private until a person makes it public). It is deterministic (no model calls), unattended and
resumable (the conversion itself makes no model calls; the front of each model is decided afterwards by the dev-time front fix below). **The models never enter git**: the repository only gets the code, `scripts/assets/simready-queries.json` and the
small `assets/hub.json` pin; the files live in the dataset and are found through the hub search (`HubClient.search`,
`find_model`, the Assets panel) and loaded lazily like every hub model.

```sh
npm run assets:simready-setup                        # once: the USD venv (and huggingface_hub)
nice -n 19 npm run assets:simready -- bulk --concurrency=2 --max=600 --time-budget=8 >> ~/.local/share/aether/simready-bulk/run.log 2>&1 &
npm run assets:simready -- bulk --discover-only      # only discovery and filters, prints the counts
```

Flags: `--max=N` (attempted conversions), `--concurrency=2`, `--time-budget=HOURS`, `--chunk=12` (assets per thumbnail pass),
`--publish-every=50`, `--queries=a,b` (only queries containing these words), `--rediscover`, `--retry=<reason substring>`
(re-queue rejected assets, e.g. after a converter fix), `--no-publish`, `--no-push` (do not push the pin), `--max-pkg-mb=400`,
`--min-free-gb=6`, `--timeout-min=8`, `--max-usd-mb=60`, `--deny=word,word`.

- **Discovery.** `simready-queries.json` lists about 220 terms (furniture, office, kitchen, bathroom, household, tools, warehouse,
  lab and medical, retail, outdoor, toys, small vehicles); each is searched with 60 hits and a 4 m size limit. Hits are merged by
  repository, commit and package, and **labelled from the package name** when a term names it (`cart_mobile_a01` is a cart even when
  the "sofa" search found it); otherwise from the term. Packages named by a code only (`D00825`) are kept only when they are a top-8
  match of the term, because nothing else says what they are. At most two variants per name stem (`_a01`, `_b02`) are kept.
- **Filters before converting.** Licence (the package's `com.nvidia.simready.packaging.json` and the dataset card must agree and be CC0-1.0
  or CC-BY-4.0: MIT, Apache and BSD are findable but the hub dataset takes CC0 and CC BY only, so they are skipped with that reason),
  a name denylist (`denylist` in the queries file: gripper, robot arm, sensor, bracket, bolt, screw, nut, gear, connector, PCB, chip,
  motor, ... whole words only, so a screwdriver stays), USD file over 60 MB, a package over 400 MB (they carry 4K texture sets), source
  over 3 million triangles, and the already-have check (library ids, the 29 imported packages, the hub index). The size range of 5 cm to 4 m
  is checked on the converted model (the search has no size in its answer); the 4 m limit is also sent to the service.
- **Conversion.** Pinned, hash-verified fetch into `~/.cache/aether-asset-src/simready/` (deleted after each asset), `usd2glb.py`, then the
  library's interior pipeline (`build.ts --import-one` with `bulk`): triangle budget by size (3,000 under 25 cm, 6,000 under 60 cm, 10,000
  under 1.2 m, 14,000 above), **UV-aware simplification** (the UVs join the error metric; the old attribute-blind pass smeared colour
  atlases, a white kettle came out blotched), meshopt, 512 px textures, a distance level and a light copy, a floor-centre pivot, metres.
  A thumbnail (192 px WebP) is rendered by the library's thumbnail renderer in one headless browser per chunk.
- **Front.** The index is authored with the front along +X: a piece whose long side runs along the glTF Z axis (sofa, desk, shelf) is turned
  270 degrees (the way the 28 reviewed props were set); symmetric terms (mug, bottle, ball) need none; anything else is logged
  `front unsure` and left as authored (the model still loads, a person may turn it). The decision is in the ledger and in each asset's `provenance.json`.
- **Quality gates** (`simready-gate.ts`): triangles within the budget, main file at most 600 KB, UVs on every primitive of a textured model, a
  base-colour texture or a colour other than the default white, normals not inverted (signed volume of the triangles), size plausible, base-colour
  texture not black or white, thumbnail not blank, near-uniform, black or white. A failure goes to `rejected.json` with the reason and nothing
  of it reaches the dataset. Hung converters are killed with their process group after 8 minutes.
- **State.** `~/.local/share/aether/simready-bulk/`: `state.json` (the ledger: every package with status `discovered`, `fetched`,
  `converted`, `published`, `rejected` or `skipped`, the reason, hashes, triangles, bytes, seconds, front decision; written atomically after every
  asset), `out/<id>/` (the accepted model, its thumbnail and `record.json`), `rejected.json`, `emb-cache.json`, `run.log`. A re-run continues where the last one stopped.
- **Publishing.** Every 50 accepted models: `hf-dataset build` (the library and the bulk output merged; ids `simready-<package>`, credit line
  `"<name>" by <author> (SimReady Central: <repo>), CC BY 4.0, modified (converted and reduced by Aether)`, source dataset, commit, path and the USD
  and package SHA-256 in `source`), `verify`, `upload --pin --only=<new ids>` (one commit per batch) and the pin in `assets/hub.json` pushed to main.
  The write token is read by `hf-dataset.ts` from `~/.config/aether/hf-write.token` (else `HF_TOKEN`) straight into `huggingface_hub`: never
  printed, logged or committed. The repository stays private.
- **Index size.** `index.min.json` is about 240 bytes a row; the client loads it lazily and keeps it in the Cache API. `verify` measures the
  gzip size and fails above 400 KB (611 models: 145 KB raw, 53 KB gzipped; at 1,500 models about 130 KB gzipped, so no sharding is needed yet).
  Embeddings of **every** staged thumbnail (CLIP ViT-B/32, int8, cached by thumbnail hash in `emb-cache.json`) are rebuilt on each `build`.
  `README.md` keeps the CC BY table only up to 150 rows; above that it links `credits.csv`, which lists every asset with its credit line and pinned source.
- **Numbers** (first batches, two workers at `nice 19`): 15 to 110 s per asset, 40 s on average; 60 to 280 KB main files; 2,600 to 10,000
  triangles. About a third of the packages that pass the filters are rejected or skipped before conversion by size or licence.
- **How the hub search finds them.** Names, tags (the term and the package words), aliases from the synonym table and the type feed the same
  ranking as the library (`HubClient.search("kettle")`); `similar(id)` ranks by image embedding.

### Front fix (a vision model decides each front and mounting)

The shape rules guess a model's front (`front unsure` in the log) and are wrong for some pieces (an office chair turned away from its desk,
a forklift driving backwards). `npm run assets:simready -- front-fix` asks a vision model instead. It is a dev-time script around **one model
call per asset**; the geometry rules are advice in the prompt, the answer is the decision.

```sh
npm run assets:simready -- front-fix --budget-usd=15 [--ids=a,b] [--source=all|bulk|lib] [--scope=all|unsure] [--refresh] [--render-only]
npm run assets:simready -- bulk --reprocess=front     # convert again only the models whose rotation or mounting changed, then publish them
```

- **What it sees.** The converted GLB (front on +Z, metres, floor-centre pivot) turned by 0, 90, 180 and 270 degrees about Y, in a per-id
  shuffled order, as one 2x2 contact image (768 px, tiles labelled A to D, a red floor arrow marking +Z toward the viewer), rendered in the
  headless browser with the thumbnail renderer's lights; plus the name, type, category and size. It answers JSON
  `{front: A|B|C|D|none, mounting: floor|wall|ceiling|table, confidence, reason}` (Anthropic API key from `~/.config/aether/anthropic.key`,
  `claude-sonnet-5-5`, low effort; never printed or logged).
- **What it writes.** `scripts/assets/simready-fronts.json` (checked in, small): per id the absolute build rotation `rot` (a multiple of 90),
  `mounting`, `confidence`, `reason`, `model`. A front is written only at confidence 0.7 or more; below that the model is left as it is and
  `front unsure (model)` is logged (a wall, ceiling or table mounting is still recorded). Symmetric terms (mug, bottle, bin, drum, box, ...)
  are skipped and logged. Answers are cached in `~/.local/share/aether/frontfix/` by model and source hash (a second run costs nothing),
  concurrency is capped at 2, and the run stops at `--budget-usd` (token counts are summed from the replies; the price per million tokens is
  an estimate, `--price-in`/`--price-out`). About $0.009 per model.
- **Applying it.** `build.ts` takes the file's `rot` and `mounting` (as the catalog's placement: wall, ceiling, surface, floor) in place of
  the shape rules for the bulk converter and for the 28 library props. `bulk --reprocess=front` converts again only the ids whose file differs
  from what they were built with, regenerates thumbnails, hashes and embeddings, and publishes the changed models to the dataset in batches
  and re-pins `assets/hub.json`. Model files of hub assets never go to git; the 28 library props live in `assets/lib/` and are rebuilt
  with `build.ts --simready` when the check turns one.
- **Mount pivot.** A model the check marks `wall` has its pivot at its back-centre mount point (the front is +Z, so the back is the minimum Z)
  instead of the floor-centre, and the entry (and the hub record) carries `mountY`, the height above the floor that point is mounted at, from the
  table `mountSpec` in `front-overrides.ts` by id and type: basin rim 0.85 m (pivot at 85 % of the model's height), urinal 0.55, wall toilet 0.1,
  signs, frames and mirrors 1.5 (centre), lamps 1.8, screens and hand dryers 1.2, sockets 0.3, shelves, cabinets, racks and holders 1.4,
  others 1.4; a piece over 1.6 m tall keeps its base at the floor (`mountY` 0). A `ceiling` model's pivot is its top-centre and `mountY` is 0.
  A consumer that snaps a wall model to a wall places the pivot at `mountY`. `bulk --reprocess=front` converts again every wall or ceiling
  model whose entry has no `mountY`. `CatalogEntry.mountY` and `HubRow.mountY` carry it (0..4 m, optional). The min index adds it as a 16th column (`columns` then ends in
  `mountY`) only when a row has one; the pinned public index still has 15 columns and reads unchanged (`HubItem.mountY` is then absent).
  Consumers: the studio drop (`placeAsset`) puts the pivot at floor + `mountY` (a `mountHeight` overrides it) with the back on the wall, and a
  ceiling model at the ceiling it hits; the agent's `place_items` with a wall model puts the entity at `mountY` (a given `y` is then the height of
  the mount point, not the bottom) and a ceiling model at the ceiling. An entry without `mountY` keeps the old rule (`y` is the bottom).
  A hub model imported into a project is normalised to a base-on-floor pivot, so it is placed as a floor piece.
- **One publisher at a time.** Publishing and reprocessing take `<bulk dir>/publish.lock` (the owner's pid; a lock whose process is gone is
  taken over), so two runs never write the shared staging folder or the dataset together.

## Optional image → mesh

See [IMAGE_TO_3D.md](IMAGE_TO_3D.md) for the off-by-default TRELLIS.2
provider (your own machine or cloud account).

## Vehicles and animals

- **Vehicles** (`scripts/assets/vehicles.ts`, `vehicle-geo.ts`; `npm run` is not needed: `npx tsx scripts/assets/vehicles.ts`)
  are modelled in code (MIT): lofted superellipse bodies with a painted roof, glass, pillars, door seams, arches, lamps,
  plates, lathe-turned tyres and spoked rims, brake discs, tube frames, and for the kart and the race car a helmeted driver
  in a racing suit with arms on a steering wheel. Real size (a sedan is 4.7 m, a kart 2.6 m), base on y = 0, facing -Z.
  Named nodes drive the visual rig (see `docs/CONTRACTS.md`, vehicle rig). `VEHICLE_DUMP=<dir>` writes plain GLBs and
  `npx tsx scripts/assets/model-sheet.ts out.png a.glb b.glb` renders a contact sheet for art review.
- **Animals** (`scripts/assets/creatures.ts`): skinned animals with idle / walk / run clips. `build.ts` re-merges
  `assets/creatures.json` and `assets/vehicles.json` after every library rebuild.
- **People** are never library models: use `entity.character` (Rocketbox cast). The block mini-figures stay in the library
  for block worlds only and `findStandIns` flags them elsewhere.
