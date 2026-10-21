# Aether: worlds that are checked before you play them

## The problem

Text-to-3D tools have become good at making scenes that look right in a
screenshot. A world, though, also has to work. The door has to open, the key
has to be reachable before the locked gate, the dominoes have to fall in
order, and the win screen has to trigger when the twelfth lantern is
collected. A model that writes a game in one pass gets some of this wrong, and
nobody finds out until a person plays it.

There is a second problem once the first version exists. People want to
change one thing ("make the sofa dark green", "make the wolves slower"). Most
generators can only regenerate. That costs thousands of tokens, and it quietly
changes everything else in the scene.

Aether is a browser studio built around both problems. It turns a prompt into
an interactive 3D world, a game, a physics scene or a building, and before
handing it over it checks that the world does what was asked.

## How it works

**A world is a document, and the AI edits it with patches.** Every world is
one JSON document validated by a schema, the World IR. It holds entities,
physics bodies and joints, materials, lights, rules, behaviours, NPCs with
dialogue, building plans, tests, and generator code. The model never touches
the renderer. It emits typed patches, and each patch is checked for schema,
references, size and prototype pollution, then committed as one undoable
history step. Rendering (three.js, WebGPU with a first-class WebGL2 path),
physics and logic all read the same document, and the core packages also run
headless in Node, which is how the benchmark, the MCP server and
`aether-verify` work.

**The model is the decision-maker, and code gives it tools.** With Codex or
Claude Code connected (the user's own login, run locally), the model plans
first, then builds through tools that measure and refuse: `design_plan`,
`place_items` (refuses a bed through a wall or a painting over a window),
`add_stairs` (fits a stair to the room or explains why it cannot),
`shape_land` (carves terrain with streams, lakes, mounds and draped paths),
`dress_room`, `set_site`, `query_scene` and `query_level`. After building, it
looks at rendered views of its own result plus a structured scene summary, and
fixes what it sees. On a subscription login this review loop has no round
cap: it ends when the model approves or progress stalls. Without a model, a
deterministic offline planner builds from the same parts.

**Physics as unit tests.** A world carries tests: `topples`, `reaches`,
`eventually`, `stable`, `noOverlap`, `moves`, `staysAbove`, `navigable`,
`npcs`. `verify` forks the Rapier physics world headless with the game rules
attached, fast-forwards it in a worker, and decides each test. A failure goes
back to the model as a short report it can act on.

**A bot plays it.** Tests catch broken physics. They do not catch a coin
hovering out of reach or a win rule that asks for more coins than exist. So
after each build and edit, a playtest bot plays the game through the real
character controller. It plans routes and jumps over a navigation graph
sampled from the physics world, fetches keys, talks to shopkeepers, and plans
round enemies. In a building it walks to every room. When it finds a defect,
it applies the smallest fix it can verify (steps up to a ledge, a wider
doorway, slower enemies) as one undoable step and plays again.

**A sealed replay.** The physics verdict and the bot's winning run are sealed
into one content-hashed proof file, which can be signed with Ed25519. Share
links and published games carry it, and `aether-verify` re-simulates it in
Node or in the visitor's browser. This is a deterministic replay check, not a
formal proof. It shows that the author's checks pass on this exact world and
engine version. It does not show that the game is good.

**Small edits stay small.** A local resolver handles many edits in about a
millisecond with no model call. It finds the target by name, type, room,
ordinal, spatial relation, selection or conversation, and edits a
copy-on-write draft, so the patch is exactly the property-level difference.
When a model writes the patch, a guard refuses changes to objects the request
did not name. Things attached to an object (its light, goal zone, altar) move
with it.

## The evidence

All figures come from scripts in the repository and the measurements recorded
in [REVIEW_LOG.md](REVIEW_LOG.md) and [BENCHMARK.md](BENCHMARK.md).

**Verification speed.** Over the benchmark's worlds, the headless proof runs
at a median 561 times real time (the slowest was 136 times). Forking a running
simulation costs 0.79 ms and replays with zero drift. On the shipped
flagships, the playtest bot needs about 1 to 3.5 seconds of compute per game, and about
10 s for the low-gravity Orbital Lab.

**Edits against regeneration** (`npm run bench`, 130 edits on 16 worlds).
Aether made 127 of 130 requested edits. The median patch was 230 output tokens,
against 7,716 tokens to re-emit the world (39 times more). Aether changed
something unrequested in 8 edits, while a fresh regeneration did so in all
130. Where Aether loses is listed too: 3 edits not completed, and 6 that broke
a passing verification.

**Edits by chat** (`npm run eval:edits`, 199 prompts over the default
projects). The unassisted offline planner passed 53 of 199 and changed
unrelated things in 24%. The local fast path passes 199 of 199 at 0.5 ms
median. A deliberately careless recorded model passed 0 of 102 with the guard
off and 99 of 102 with it on. One caveat: 48 holdout prompts scored 38 of 48
on their first run, and they were then fixed, so they are no longer an
independent estimate.

**Self-repair** (deliberately broken worlds, oracle repairer). Physics tests
alone noticed 9 of 9 physics faults but 0 of 24 winnability faults. With the
bot in the loop, all 33 were noticed and repaired. The repairer always knows
the fix once told where to look, so this measures whether the loop finds and
explains the fault. It is not a score for any particular model.

**Token turn layout.** Codex reports running totals per thread, and an
accounting bug had made builds look like 6 to 10 million input tokens. The
real cost was about 40 to 55k tokens per call, 85 to 95% of it cached. The
real waste was in starting a new thread for every edit and rewriting earlier
messages. After the change to an append-only, resumable conversation that
sends only `<scene_changes>` on follow-up turns, uncached input fell 64% on a
forest game with two edits and 52% on a house. One edit's first call went from
101,745 characters to 718. In the studio with Codex, a forest game took 14
calls and 222 s and was verified playable. Its three edits took 2 to 4 calls
and 16 to 43 s each, with under 5k uncached tokens per edit.

**Photo fidelity.** A room rebuilt from a photo is scored by deterministic
measures (openings, inventory, placement, sizes, CIEDE2000 colour) and by a
panel of three stateless critic calls that compare renders blind as A/B. A
change is kept only if it does not lower the measures and the panel prefers
it. In a seeded simulation of noisy judges, this cut the share of rounds where
a good change was rolled back from 29% to 7.5%. Reading the photo three times
and merging the readings made the description stable across runs: the
checklist size spread went from 0.47 to 0, and the measured fidelity spread
from 0.048 to 0.008. The final pass rates of three live runs were 83, 83 and
100%. The honest part: on this small sample the final pass rate did not become
steadier, and judge noise near the pass boundary remains.

**Acceptance.** First-time-user passes through the real studio UI (offline,
Claude Code and Codex; a game, a house, a photo room, block worlds, a phone
viewport, non-English prompts) found 46 defects. All but one were fixed,
each with a test. The one left open is missing shell detail in photo rooms. The bot itself was then
reworked after it ran out of time on generated forests. On the Codex forest it
went from "ran too long" at the 240 s simulated cap to a pass in 26.5
simulated seconds and 3.6 s of wall time. The suite now has about 4,170 unit
and integration tests, a 34-prompt smoke run, and Playwright suites in
Chromium (WebGPU and WebGL2) and Firefox.

## Honest limits

- The look is real-time PBR with HDR skies, baked interior light and
  grading. It is not a Blender Cycles still. Distant terrain shows facets, and
  some library models are stylised.
- The offline planner reads English only and has a fixed vocabulary. It got
  only 3 of 19 benchmark prompts outside that vocabulary right.
- Model-driven builds take minutes, and every call re-reads a cached preamble
  of about 33k tokens.
- A won bot run is a constructive proof that a game can be won. A lost run
  proves nothing about the game, and the bot still struggles with enemies
  faster than the player.
- Photo-to-room cannot build vaulted ceilings, cornices or sash windows yet,
  and it needs a vision model.

## What is next

- Load catalogs and API references on demand, to shrink the per-call
  preamble.
- Use a coarser jump-link search for low-gravity worlds.
- Extend the room vocabulary (ceiling shapes, mouldings, window styles) so
  photo rooms can match more of what the critics see.
- Push interior lighting further toward offline-render quality.
- Have the bot evade during jumps and lift rides.
- Record the house runs of the AI-first evaluation, which were cut short by
  a usage limit.
