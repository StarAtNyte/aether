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
| Entries | 404: 368 models (animated: people and animals with idle / walk / run, 2 chests that open), 5 HDR skies, 23 photographed surfaces, 8 forge originals; among the models, 13 code-authored vehicles (kart, race car, road cars) and 22 skinned, animated animals (7 Quaternius Farm Animals CC0, fox and wolf from the Khronos Fox, 13 code-authored) |
| Categories | furniture 49, kitchen 21, bathroom 10, decor 25, lighting 13, plants 19, nature 28, rocks 8, buildings 26, street 32, vehicles 29, people 19, animals 37, food 24, tools 5, props 31, skies 5, surfaces 23 |
| Sources | 14 Kenney kits (CC0), 16 Poly Haven models + 5 Poly Haven HDRIs (CC0), 23 ambientCG PBR materials (CC0), Quaternius Farm Animals (CC0, 7 models), Khronos Fox (CC-BY-4.0), 8 first-party forge originals, 13 code-authored creatures and 13 vehicles (MIT) |
| Disk | 58 MB under `assets/lib/` (meshopt-compressed GLB, 1k JPEG textures, 512 px surface maps, 192 px WebP thumbnails, 1k HDR) |
| Catalog | `assets/catalog.json`, 244 KB (43 KB gzip), loaded lazily after the editor starts |
| Provenance | `assets/manifest.json`: source archive + SHA-256 (Kenney) or per-file MD5 (Poly Haven API), file inside the archive, licence, authors and SHA-256 of every shipped file |

Every asset is real-world sized in metres, its base on y = 0 and centred in
x / z. Props face +Z (like the parametric furniture); characters, animals and
vehicles face −Z, the engine's forward axis, so behaviours walk and drive
them head first. Search understands synonyms ("couch" → sofa, "cop car" →
police car), plurals and small typos.

### Rebuilding it

```sh
npm run assets:fetch    # download + verify the sources into ~/.cache/aether-asset-src (outside the repo)
npm run assets:build    # normalise, merge, LOD, compress, colliders, catalog + manifest
npm run assets:thumbs   # render thumbnails in one headless Chromium
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
