# Photo to room: the staged harness

How Aether turns one photograph of a room into a room you can walk through, and how the run is kept honest. This is the design the code in `packages/agent/src/photo` follows (`stages.ts` holds the stage machine, the repair-order guard, the assumptions ledger and the provenance record; `pipeline.ts` drives them).

The rule behind all of it: **the model looks and judges; code only keeps the books.** Deterministic measures (colour deltas, silhouette overlap, clearance) are advisory text handed to the model. No gate passes or fails on a number.

## Stages

A run walks ten stages in order. A stage is `pending`, `active`, `passed`, `failed` (retried), `blocked` (cannot go on without something from outside) or `skipped` (with a reason). Every status change is an event, so the studio chat shows a checklist with ticks.

| # | id | What happens | Gate (judged by the model, with evidence) |
| --- | --- | --- | --- |
| 1 | `capability` | Check what this run can do: a model that can see images, the design tools, a renderer that draws the photo's camera, crops/compose support. | Facts of the host, not an opinion. Missing vision or missing tools is a blocker reported with its exact name; nothing is invented. |
| 2 | `evidence` | Read the actual pixels (several independent reads, merged). Write down composition, camera, shell, openings, furniture, materials, light. Open the assumptions ledger. Hash the photo. | The model confirms each part of the room that matters is either seen or listed as an assumption with a confidence. |
| 3 | `camera` | Solve the camera and framing before detail: field of view, horizon, eye height, which walls are visible. | After the first render from the photo's camera: do the horizon, the wall edges and the largest silhouettes land where the photo has them? |
| 4 | `shell` | Floor, walls, ceiling, openings (doors, windows) at the estimated metre scale. | Does the shell match in proportion and opening placement, at the same camera? |
| 5 | `furniture` | Furniture and anchored decor, each tied to a wall or another piece. | Inventory: nothing large missing, nothing invented, positions and sizes believable. |
| 6 | `materials` | Finishes for every surface the photo shows, sampled or chosen, never an image card. | Hue, lightness, gloss and pattern scale of the main surfaces, judged in crops. |
| 7 | `lighting` | Sun direction and tint, window light, lamps, exposure and white balance. | Same light direction, same warmth, same brightness relation between lit and shaded areas. |
| 8 | `repair` | Compare and repair. The causes are fixed in a fixed order: camera, then geometry, then materials, then lighting (see below). | No open difference of size 3 or more in a class before the next class is worked on; the last round has no large open difference or the stall is named. |
| 9 | `crosscheck` | A fresh seat with no conversation compares the photo and the final render and lists what still differs. It records; it does not fix. | The seat's list is merged into the ledger as its own entries (source `independent`), so what it finds is counted as open in the closing message. |
| 10 | `delivery` | Walkthrough verification (a bot reaches every room, doors and drawers work), provenance record saved with the project, export offered. | Verification result and honest limits written into the closing message. |

`camera` to `lighting` are judged together on the first render (the first look) and again whenever the repair loop clears a class. Stage verdicts come from a `stage_gate` tool the model calls: `{gates:[{stage, verdict: pass|fail|blocked, evidence, blocker?}]}`. The machine rejects a `pass` with no evidence text, a `blocked` with no blocker, and a verdict for a stage that is not yet active. A model that never calls the tool leaves the stage `pending`, and the closing message says so; the run does not claim a tick it was not given.

## Repair order

The run repairs the cause of a difference, and causes have an order: a wrong camera makes every later judgement wrong, wrong geometry makes the materials look wrong, and so on.

1. `camera`: field of view, eye height, horizon, framing, which walls show.
2. `geometry`: shell size, openings, piece sizes and positions, missing or extra pieces.
3. `materials`: colour, finish, gloss, pattern scale, texture.
4. `lighting`: sun, lamps, exposure, white balance, shadows.

Every difference in the ledger carries its `cause` (one of the four). Before any edit the model calls `declare_repair {cause, difference, why}`. The guard then checks two things and refuses with the reason when either fails:

- The declared cause is not later than the earliest class that still has an open difference of size 3 or more. (Small differences, size 1 or 2, never block a later class.)
- The tool the model uses fits the declared cause: camera edits move the photo-camera solve and wall framing, geometry edits change items and the shell, materials edits change finishes and textures, lighting edits change the environment and lights. A material tool under a `geometry` declaration is refused.

A refusal teaches: the reply names the class to work on and the open difference to fix. The declaration is also an audit trail; it is shown beside the step in the chat.

## Verify after fix

A difference the model fixed is not closed until the next render shows it. The ledger requires an earlier id to be reported again with `fixed`, `smaller`, `same` or `worse`, judged on the new render; an id left out stays open; a difference that did not shrink after an edit is pointed out; a round the judges find worse is rolled back, including a camera change. The independent seat at the end lists what it sees without the conversation, so a difference the fixer called fixed can still show up there as its own entry.

## Measured room size (depth network, advisory)

The shell size used to be only the model's guess, and wide-lens photos read narrow. `measure_room` runs a small monocular depth network (Depth Anything V2 Small, Apache-2.0, 27 MB, CPU) on the photo and reports width, depth and height with a range. Method: relative inverse depth to depth with a swept shift, pinhole back-projection with a swept field of view (65, 75, 90 degrees), a floor plane fitted to the lower third gives "up", and the metric scale comes from one thing of known size: a named anchor (a door about 2.05 m, a bed width, a table height) or else a ceiling of 2.4 to 2.7 m. Width is the span of the wall points across the picture (a lower bound when the side walls are out of frame), depth the far wall plus a 0.4 m camera standoff. The reported range is the 10th to 90th percentile over the sweep. The first compare round shows the numbers, a depth picture and the model's own reading side by side; the model decides. Weights are fetched on first use with a pinned SHA-256 and cached; offline, the line is simply absent (see docs/THIRD_PARTY.md). CLI: `npx tsx scripts/measure-room.ts photo.jpg`.

## Assumptions and blockers

Anything the photo cannot show is an assumption: metric scale, depth behind occluders, hidden walls, the back of furniture, the room outside the frame, ceiling height, the colour of what is in shadow. Each entry has an id, a text, a confidence between 0 and 1, the stage that made it and a one-line prompt that changes it.

The run does not stop to ask about assumptions. It makes the most conservative one and records it. It asks the user only for a **material blocker**: a missing thing without which a different room would be built (no vision model; a photo that is not of a room; two photos that disagree). A blocker has a kind (`capability`, `evidence`, `contradiction`), a plain sentence and what would unblock it. Blockers are reported as the exact reason; the run does not simulate progress behind them.

## Provenance record

Built at the end of the run and carried on the final `photo` event (`provenance`). The studio keeps it in the chat record of the project, shows it in a panel on the photo room and downloads it as JSON. The world document itself has no field for it, so it is not inside the `.aether.json` project file; it travels as the downloaded record:

- source photo SHA-256 and pixel size (the photo itself is not stored);
- permission note: the user states the photo is theirs or they may use it for this; local processing is recorded separately from any publication right, which the record leaves as "not stated";
- estimated metre scale and what it rests on (door height, ceiling height, standard furniture) with its confidence;
- single-view assumptions, hidden surfaces and the assumptions ledger;
- stage verdicts with their evidence text, the models that judged, the number of rounds, what remained open;
- the exports that were made.

The studio shows this record in a panel on the photo room: the stage list, the assumptions with one-tap changes, the open differences, the hashes, and the export buttons.

## Delivery and export

The room is already a playable project (walkthrough, doors that swing, drawers, switches). Delivery offers (buttons on the photo room's panel): the playable project (`.aether.json`), a portable GLB of the static room, and the provenance record as JSON. The limits are written in plain words with the files: one view cannot show hidden surfaces, scale is estimated, and furniture is built from the photo, not scanned.

## What this adds over a fixed workflow

- Runs in the browser with any connected model (Claude, Codex, OpenAI-compatible). No local toolchain, no external renderer.
- Several independent reads of the photo before anything is built, and several independent judges per round with a median, plus a final seat that has not seen the conversation.
- Crops of the same region in the photo and the render, side by side, on request or by default.
- A verify-after-fix ledger: no difference is closed on the fixer's say-so.
- A playable check: the walkthrough bot must reach every room and the doors and drawers must work, not only a still that looks right.
- Live edit by chat afterwards: small patches, one undo step each.
- A resumable run: the final `photo` event carries a resume state (room description, built opening ids, stage states, assumptions, differences ledger, repair log). A later turn with the same photo (matched by hash) and the room still in the world skips reading and building and continues at the repair stage ("Continue repair" in the panel). The photo itself is held in memory by the studio only, so a reload loses the ability to continue.
- Offline fallback is labelled: with no model that sees images the run says so and builds nothing; it never passes off a template room as the photo.

## Honest limits

- A single photograph fixes only what is visible. Hidden surfaces are authored, not measured.
- Metric scale is an estimate from cues in the picture.
- The judges are language models looking at images: they vary between runs, which is why the run uses a median, a comparison against the accepted state, and a fresh seat at the end. None of it is a measurement of likeness.
- The stage gates are only as good as the model's evidence text; they make the run's claims auditable, not certain.
