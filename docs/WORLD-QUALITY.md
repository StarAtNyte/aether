# World quality: the harness's default checks

Every world the AI builds or edits, and every world at publish, goes through the world-quality pass. Every fix made by
hand on one world becomes a check and, where one exists, an automatic fix for all worlds. The AI judges the visual
checks from renders. Code measures what can be measured and gives its numbers to the AI as evidence. Measurements are
never the verdict on matters of taste. A camera inside a wall is a fact, though, and stands even when the judge misses
it.

- Code: `packages/agent/src/presentation/quality.ts` (data detectors and fixes, `runQualityPass`).
- Visual review: `presentation/review.ts` (frames, `SHOT_CHECKLIST`, fixes) and `presentation/director.ts` (render,
  judge, fix, look again).
- Studio: `apps/studio/src/engine/presentation.ts` (runs it), `editor/publish/PresentSection.tsx` (shows it).

## When it runs

| When | What |
|---|---|
| After every AI turn that changed the world (the studio, `Studio.send`) | The data checks and their fixes |
| After a turn that built a new world | The data checks, then the visual review judged by the AI |
| When the publish dialog opens on a world version not yet checked | The full pass. Results and what is left show in the Presentation section |
| On demand | The **Quality pass** button in the publish dialog |

Without a model (offline), the visual review falls back to measurements (dark, blown out or flat frames, and the
depth probe). The dialog says so.

## The checklist

Each item has a detector (data, host measurement or AI from renders) and a fix through existing fields and tools.
"Route" means the fix needs a pipeline or the user. The pass says which.

1. **Opening and hero view**
   - Detectors:
     - A building's opening must be at standing eye height: at most 2.2 m above the floor.
     - The view must face the sunlit side: the camera is on the sun's side of what it looks at.
     - Nothing within 3 m of the lens. This is probed at the 70° walk lens the visitor tours with, not at the 55° load lens.
     - Hand-set openings are checked by the same rules.
   - AI: framing, and trunks, branches or foliage at the frame edges.
   - Fixes:
     - Lower the opening to 1.65 m.
     - Re-pick it from the renderer's ranked views (`view/arch-hero.ts` rules). The AI picks among rendered candidates.
2. **Aerial and title views**
   - Detector: a view is never top-down (pitch below −60°), and the horizon must be in frame for views high above the floor.
   - AI:
     - The terrain's edge must never show. The far-hills skirt covers it.
     - No frame dominated by a near prop or flat ground.
   - Fix: tilt the view up so the horizon sits in frame.
3. **Playability**
   - Detectors:
     - The spawn stands on the ground. The level tools measure the surface under it.
     - Static meshes have colliders.
     - The engine's playability check runs when the host provides it (`QualityHost.playability`, packages/physics playability).
   - Fixes:
     - Set the spawn on the surface.
     - Give the static meshes `trimesh` colliders.
   - Nothing under the spawn: routed to the user.
4. **Bake and texture density**
   - Detector: baked parts under one lightmap texel per metre (`QualityHost.bakeDensity`, when the renderer reports it).
   - Fix (route): rebake. The atlas packs as boxes, and sub-texel parts take per-vertex shading.
5. **Missing geometry**
   - AI: a close "detail" frame of the landmark is judged for holes, untextured parts and pieces of a kit that vanished
     (under cluster LOD).
6. **Scale sanity**
   - Detectors:
     - Doors are 1.9 to 3.1 m.
     - Stair risers are 15 to 19 cm.
     - Handrails are 0.8 to 1.1 m.
     - People are 1.5 to 1.9 m.
   - Fix: reset people to human scale. The others are flagged.
7. **Interpenetration**
   - Detectors:
     - Things floating or sunk (the level tools' grounding).
     - A building, pagoda, gazebo or torii sunk into the terrain on its high side or hanging over a drop on its low side, measured over its whole footprint (`sunk.ts`; library structures are sized from their catalogue footprint).
   - Fix (data, automatic): `settle.ts` raises the piece to the highest ground of its footprint and adds a stone plinth down to the lowest ground, so the floor is never buried and nothing hangs. The same rule (`settle-core.ts`) is the builder's default: `Builder.gen` settles every building it places on a landscape (`ground: 'terrain'`, or `terrain: heightFn` on a hand-placed world; `ground: 'flat'` opts out).
   - AI: props through walls, and clothes through bodies.
   - Fix: the agent sets them down with `place_level_items` in its review.
8. **Lighting per shot**
   - Detector: film shots looking into a low sun (a backlit subject).
   - AI: flat or washed-out shots, weak key and fill contrast, and exposure.
   - Fixes:
     - Move the shot's hour.
     - Set the world's time of day.
     - Re-pick the opening.
9. **Sky and clouds**
   - AI:
     - Clouds that read wrong, such as fish-scale lobes, tiling or seams.
     - The cloud style matching the look (painted heads for anime, soft volumes for realistic).
10. **Story and tours**
    - Detectors:
      - Repeated framings in tour stops or film shots, and filler shots.
      - Every shot moving the same way.
      - A person named in a caption who is not on screen in that shot, or who is not in the world at all.
    - Fixes:
      - Drop the repeat.
      - Track the named person.
      - Route the rest to a rewrite.
    - A story world opens on a "Watch (with sound)" card, so its score plays after a user gesture.
11. **Characters**
    - Detector: people drawn as primitives (an NPC or a person-named entity without a human body).
    - Fixes:
      - Give them a rigged, animated human from the cast.
      - Route a bespoke character to the Blender character pipeline (`/api/local/blender/*`, local app only). A hosted
        studio keeps the cast body.
12. **Performance**
    - Detector: drawn triangles against the tier's budget. The budgets are 1.5 M (low), 4 M (medium), 8 M (high) and
      16 M (ultra).
    - The programs linked are reported. The cooked program set means no program links during a tour or the film.
    - Fix (route): thin the scatter or bake to meshes.

## Fix loop

The visual review renders these frames:

- the opening, at the walk lens for a building;
- three film frames, or three tour stops;
- a close detail of the landmark;
- the play spawn.

A degenerate frame is rendered again on its own first. A frame is degenerate when it is:

- near-black;
- one flat tone;
- an outdoor daytime view whose top band (where the sky is) came out black.

If it stays degenerate, it is reported as a failed render and is never judged or fixed. A black frame once led the
judge to move a world's hour to noon.

Captures draw the way the viewport draws, with the post chain and the quantized streams' folded matrices, and the
first-draw pacer is off for them. The bare scene render used before left the quantized ground, land and trees out of
landscape captures. The pacer, which adds one new pipeline per frame, also left the sky and most of the land out of
large worlds.

The judge gives every finding a severity (high, medium or low) and a confidence. Only measured facts and sure findings
(high severity, confidence 0.7 or more) are fixed automatically. Everything else is ranked and shown as a suggestion. The
publish dialog lists at most six problems and folds the rest away under "suggestions".

The AI judges the frames in batches of at most four images. The rounds then run as follows:

1. One fix is applied per frame, and the frame is rendered and judged again. This runs for up to four rounds.
2. A fix that did not cure a frame is not repeated. The next one in line is tried: pull back, then raise, then drop
   the shot or stop.
3. Fixes from the last round that were never re-rendered are reported as such.
