# Generation brief

A general prompt ("make a cinema hall") used to come out minimal: the model built the shortest thing that answers the words. The brief makes it plan first, build to that plan, and check the result against it. It applies to a 3D world started from a text prompt (not a photo, not an edit of an existing world): interiors (cinema hall, library, restaurant, church, gym, clinic, school, museum, airport lounge) and outdoor or game worlds (village, harbour, forest camp, sci-fi corridor).

The model looks and judges; code only keeps the books. Counts are advisory evidence. Nothing passes or fails on a number, and no word list in code decides how elaborate a request is.

Source: `packages/agent/src/brief.ts` (schema, instruction text, checklist, evidence), `brief-stage.ts` (the stage), hooks in `agent.ts`. Enabled with `AgentOptions.brief` (the studio sets it for the full prompt profile; the MCP server and the offline planner do not).

## Stages

1. **Brief.** One model call (`submit_brief`), written from the model's own knowledge. It first states `elaboration` with a one-line reason taken from the wording of the request:
   - `elaborate` is the default for a general prompt: a full-scale, detailed result;
   - `minimal` only when the user states a small scale or asks for simplicity ("a tiny cabin", "simple", "just a box");
   - `moderate` in between.
   The model judges this from the meaning of the request; the instruction text carries the rule, code carries no keywords. The richness target follows the statement.
   Then: kind, summary, scale in metres, zones, elements (name, realistic count, size, note, and `find` words for counting), materials, lighting, and a richness target (approximate distinct kinds and pieces, scaled to the world size). A brief that fails validation is sent back once with the reasons; if it still fails the build goes on without a brief, and a step says so.
2. **Reference image (optional, the model's decision).** The brief says whether to look at a generated reference (`reference.generate`) and why: yes for an elaborate request of a specific, visually distinctive space it is unsure about (cathedral, airport, museum, cinema hall); no for simple or minimal requests and for things it knows well. The decision and the reason are recorded either way. When an image generator is connected (the Codex image tool or an OpenAI key, as for `make_texture`; see IMAGE_GENERATION.md) one picture is made. It goes to the model with the checklist, and `look_closer {regions:[{box}]}` (or `{whole:true}`) returns crops of it so the model can pull details. With no generator, or when generation fails, the record says `unavailable` or `failed` and the build uses the brief alone.
   Provenance: `generated reference`, with the prompt, generator and model. The picture is held for the run only; it is never put in the world, the project or the repository. Web search, where a provider offers it, is for ideas in text only: no web image is copied or kept.
3. **Plan shown.** A `brief` event carries the plan. The studio shows it as a collapsible card in the chat. With the setting "Review the plan before building" (Settings, AI connection) the run waits: the user can change counts, drop elements, add a note, and press "Build with this plan". Default: off, the run carries on at once.
4. **Build.** The checklist is part of the first build turn: ask `find_model` for each element (crafted venue parts such as the cinema seat, stage, screen, pew, vitrine and library stack come first, then photographed models), place repeated things in one call each with `shape_land` `tier` (raked seating, sightline solved), `grid` or `row` so a 120-seat block is one instanced entity, light the space so it reads at eye height, and give every zone its own character. For a `minimal` brief it says to stay sparse.
5. **Richness review.** In the existing review loop, each round also shows the brief, the renders (eye height and overview), and an advisory block with piece counts per brief element (matched by the model's `find` words in names, ids, tags and generator ids), the entity count and distinct kinds. The model compares the result with its brief (`inspect {groups:true}` reads repeated groups), lists what is missing or sparse and fixes it with small patches. The judges decide; the loop ends when the model approves with nothing large open, on a stall, or at the round budget the host set for the quality loop (no separate ceiling).

## Run record

The `brief` event is kept in the chat record: the validated brief, the elaboration statement and reason, the reference decision (`generated | skipped | unavailable | failed`) with reason, prompt and provenance, and the user's edits. The studio view is bounded and revalidated when a chat is loaded.

## Offline planner

Unchanged. Offline there is no brief, no reference image and no review; the run is labelled as the offline planner as before.

## Limits

The brief is only as good as the model's knowledge of the kind of place. Counts are estimates for a size, not a quota; a hand-placed piece named unlike its element will read as missing in the evidence, which is why the model, not the count, judges.
