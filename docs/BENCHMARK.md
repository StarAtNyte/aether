# Benchmark

Aether makes four claims that can be checked with a script instead of a demo:

1. **Generated games work.** A game that passes verification can also be won.
2. **Small edits stay small.** Asking for a small change produces a small
   patch, not a rewritten world, and it does not break what already worked.
3. **The proof is fast.** The agent verifies a world by forking the physics
   engine and fast-forwarding it, far faster than real time.
4. **The offline planner is useful on its own.** Without any model, common
   requests come out as the right kind of world.

This benchmark measures each one, reports the cases where Aether loses next to
the cases where it wins, and commits its results so anyone can rerun it and
compare. It needs no network and no API key.

```
npm run bench                      # full run: 81 prompts, ~130 edits, repair and speed studies (about a minute)
npm run bench -- --write           # same, and rewrite docs/benchmark/results.json and the results section below
npm run bench:quick                # CI subset (about 10 s); exits non-zero if a documented claim stops holding
npx vitest run scripts/bench       # unit tests of the metric code and of the harness
```

Everything is in `scripts/bench/`. The committed results are in
`docs/benchmark/results.json` (one row per prompt, edit and fault, so any number
below can be traced to its rows).

## What runs

Every prompt goes through the same code the studio runs: the real `WorldAgent`
loop (plan, `apply_patches`, verify, repair turn), the real patch validation,
the real Rapier headless verification with the rules engine, and the offline
planner standing in for the model. Nothing in the benchmark touches a paid API.

### 1. Winnability

81 plain-language prompts: 24 games, 14 physics scenes, 8 voxel worlds, 11
houses and 24 scenes. Of these, 5 name a bundled flagship and 19 are
deliberately outside what the offline planner knows (`stretch`). What a person would expect
to see (`mustHave`) was written per prompt before any run.

**The bot.** `autoplay.ts` plays a generated game the way a person does, with
keyboard-like input through the real character controller, physics and rules at
the studio's 60 Hz step. It knows no theme. It reads the world document, finds
the objectives (entities with a `collectible` or `goal` behavior), builds a
graph of the walkable surfaces (static or moving boxes and cylinders that are
not hazards), plans routes within the character's jump envelope, waits for
moving platforms to come level, hops for pickups a walking player cannot reach,
sidesteps obstacles, and re-plans after a miss or a fall. It plays up to 150
simulated seconds.

*A bot that wins is a constructive proof that the game can be won. A bot that
loses is not a proof that it cannot:* it has no path-finding around buildings
and no notion of puzzles. Every "bot did not win" below is therefore an upper
bound on how unwinnable a game is, and the report prints the reason for each.

**Before and after self-repair.** Generated worlds that pass verification are
never repaired by the offline planner, so the natural before/after is
identical. To measure the repair loop itself, the benchmark breaks working
worlds on purpose (`repair-study.ts`):

| Fault | Breaks | What fails |
|---|---|---|
| a pickup floats 30 m up | winnability | no test |
| the goal sits 30 m above its platform | winnability | no test |
| the win rule asks for 3 more points than exist | winnability | no test |
| three dominoes are moved out of the line | physics | `chain-completes` |
| the object a test expects to move is bolted down | physics | `moves` / `topples` |

For each, a scripted model "writes" the broken world through the real agent
loop. If the loop's failing report names the problem, the model answers with
the fix; otherwise it abstains. Two configurations are compared: verification
as shipped (the world's own physics tests), and verification plus the bot
(a failing playtest is reported to the model as text).

*What this does and does not show.* The repairer is an oracle: it always knows
the fix once told where to look. The numbers measure whether the loop
**notices** a fault and **says what is wrong**, which is the part Aether
controls. They are a ceiling for any real model, not a score for one.

### 2. Edit versus regenerate

16 base worlds (scenes and games), 7 to 9 small edits each: recolor a named
kind of object, make it bigger or smaller, remove it, make it glow, add rocks,
make it night, make it rain. Edits that would change nothing (night in a world
that is already night) are not asked. Each edit is run three ways:

| Arm | What it is |
|---|---|
| **Aether patch** | The real loop on the existing world. The model answers with a minimal `apply_patches`. |
| **Regenerate, perfect copy** | A model that re-emits the whole edited document and copies every unchanged part flawlessly. Its world *is* Aether's; only its cost differs. This is the best case for regeneration: zero unrequested changes by construction. |
| **Regenerate, fresh sample** | The same offline planner asked again from scratch with the edit folded into the description (`"<original prompt>, and make all the trees red"`). It emits the whole scene again with a new random sample, which is what "just regenerate" does. Unrequested changes are measured, not assumed. |

The truth for a real model lies between the two regeneration arms: a strong
model copies much of the scene faithfully but not all of it, and a regenerated
scene is never bit-identical.

**Metrics.**

- *Asked change made.* The oracle (`edit-study.ts`) says which entities a
  request is about, as a person reading the outliner would: the noun starts a
  word in the entity's id, name, tags, generator (also inside a scatter) or
  primitive. "All the trees" must change every one of them (partial work is
  reported as a share of the request).
- *Collateral (unrequested) changes.* After the edit, every property
  ("leaf" of the entity JSON, `transform.position.0`, `material.color`, ...)
  that differs from the base and was not part of the request, plus every
  entity removed or added that should not have been, plus any change outside
  the allowed part of the environment.
- *Regressions.* Verification passed before and fails after; and, for games,
  the bot could win before and cannot after.
- *Tokens.* Estimated as `ceil(characters / 4)` of the canonical JSON the model
  emits (the same estimate the offline provider reports). Input tokens are the
  user turn only (world summary plus request for Aether; the whole document
  plus request for the perfect-copy model; the request alone for a fresh
  sample, which does not read the world). The system prompt is the same for
  all arms and left out.
- *Latency.* Local compute (planner, patch application, verification) is
  measured. A hosted model's generation time is **not** measured: the
  *projected* figure adds `output tokens / 60` seconds, an assumed speed that
  is stated in the results file. It is only a way to turn token counts into
  seconds.

**The oracle is not neutral.** It matches nouns with a regular expression
that is stricter than the planner's own matching in some places (`gatehouse` is
not a "house" to the oracle but is to the planner) and looser in others
(decorative pins on a neighbouring bowling lane are "pins"). Those
disagreements are reported as unrequested changes or incomplete edits rather
than hidden; read the listed examples, not only the counts.

### 3. Verification speed

Per sampled world: the full proof (diagnostics, every `world.tests` entry, the
rules engine) timed warm, the simulated seconds it covered, and the resulting
speed over real time; plain physics stepping with no rules; creating a physics
world from the document; forking a running world (snapshot and restore, the
primitive behind the headless proof); the snapshot size; and a replay check:
the fork and the original run 5 simulated seconds side by side and their
positions must agree exactly.

A proof stops as soon as every test is decided, so the simulated time per world
differs; worlds whose only test is static (no simulated time) are left out of
the speed-over-real-time figures and counted separately.

### 4. Offline planner coverage

From the same 81 prompts, with no model:

- *Right kind of world.* A game has a win condition; a physics scene has
  dynamic bodies and a behavioural test beyond "nothing overlaps"; a voxel
  prompt yields voxel terrain; a house has a built plan with a `navigable`
  test; a scene has enough content.
- *Every expected word present.* The world's ids, names, tags, generators and
  environment contain what the request asked for. The world's description is
  not used: the planner echoes the user's request into it, so it proves
  nothing.
- *Fell back to the default meadow.* The planner understood nothing and built
  its default scene.
- *Fully right and verified.* All of the above and the final verification
  passes.

The optional provider column runs the same checks on a signed-in model for a
spread of prompts, hard-capped at 30 model calls. It needs
`--provider=codex --allow-model` and is never part of `bench` or `bench:quick`.

## Fairness and limits

- **Same machinery.** Every arm uses the same agent loop, validation,
  verification and token estimate. The baseline is not a strawman prompt; it is
  the best honest "regenerate" the offline machinery can express, bracketed by a
  perfect-copy arm that is generous to regeneration.
- **The planner is deterministic and hand-written.** Its results say how well
  the *framework* supports edits, verification and repair; they do not predict a
  language model's quality. A model will make mistakes the planner does not,
  and will cover prompts the planner cannot. The coverage numbers describe the
  offline fallback only.
- **Flagships are template recall.** Prompts that name a bundled showcase
  ("build the lantern isles game") are answered by a prebuilt plan, so they are
  reported apart and never counted in the headline rates.
- **The suite is ours.** The prompts and expectations are public in
  `suite.ts`; a third of the prompts are out of vocabulary on purpose.
  Wilson 95 % intervals accompany every rate; with n around 20 they are wide.
- **The model column is anecdote, not a result.** Eight prompts and at most 14
  calls per run (two runs, 25 calls in all, were made while building the harness;
  an earlier sample scored lower on the same prompts). A model's answer varies
  from run to run, the structure checks were written around the planner's style,
  and eight samples cannot separate the two. It shows the harness works with a
  signed-in model and that none of the offline numbers should be read as a
  prediction for one.
- **Timing is machine dependent.** Rates and token counts are deterministic and
  reproduce exactly. Millisecond figures vary with the machine and load (the
  results file records Node version and core count); read them as orders of
  magnitude.
- **Verification is not winnability.** The first thing the benchmark shows is
  that a world can pass every physics test and still be unwinnable; see the
  repair table.

## CI

`npm run bench:quick` runs the subset marked `quick` (7 prompts, 12 edits, a few
repair cases and speed samples) and checks the claims the documentation makes.
For the quick prompts: the generated games are still won by the bot, every one
still has the right structure, all the words asked for and a passing
verification. Across the sampled edits: Aether still completes at least 80 %,
a minimal patch is still at least three times cheaper than re-emitting the
world, and it changes no more unrequested properties than a regeneration does.
A fork must still replay exactly, the proof must still run at least 5x real
time, and the repair loop must still repair the injected faults it should. A
failure means a real regression, or an intentional change that needs a fresh
`npm run bench -- --write`. The same run is a Vitest test
(`scripts/bench/bench.test.ts`), so `npm test` covers it. The full run applies
the same claims to the same quick prompts and only *reports* the rest of the
suite.

## Results

The section below is generated by `npm run bench -- --write`; do not edit it by
hand.

<!-- bench:results:start -->
### Results (full run, 81 prompts, 130 edits on 16 worlds, Node v24.14.0, 32 cores)

**Headline**

- Games: a bot wins 15/17 (88%) of the generated games the planner knows how to make, and 1/5 (20%) of those outside its vocabulary.
- Self-repair: on deliberately broken worlds the loop repaired 9/9 (100%) physics faults from the test report alone, but 0/24 (0%) winnability faults (no test fails); with a playtest in the loop 24/24 (100%).
- Edits: Aether made 127/130 (98%) of the requested edits with a median 230-token patch, against 7715.5 tokens to re-emit the whole world (39.1x); it changed something unrequested in 8/130 (6%) edits, a fresh regeneration in 130/130 (100%).
- Where it loses: 3 edits not completed, 6 that broke a passing verification, 3 that made a winnable game unwinnable.
- Speed: the physics proof runs at a median 561x real time (slowest 136x); a fork costs 0.79 ms and replays exactly (max drift 0 m).
- Planner: 53/57 (93%) in-vocabulary prompts come out fully right and verified; 3/19 (16%) of the prompts outside its vocabulary do.

#### 1. Can a bot win the generated games?

| Prompts | Games | Has a win condition | Bot wins, first version | Bot wins, after the loop |
| --- | ---: | ---: | ---: | ---: |
| In the planner's vocabulary | 17 | 17/17 (100%) | 15/17 (88%) | 15/17 (88%) |
| Outside it (stretch) | 5 | 1/5 (20%) | 1/5 (20%) | 1/5 (20%) |
| Named flagships (template recall) | 2 | 1/2 (50%) | 0/2 (0%) | 0/2 (0%) |

In-vocabulary games the bot wins: median 34 simulated seconds; 8 of them have pickups a walking player misses unless they jump.

Self-repair, on worlds that were deliberately broken (scripted model, oracle repairer: a ceiling, not a model score):

| Fault family | Faults that broke the world | Verify only: noticed | Verify only: repaired | Verify + playtest: noticed | Verify + playtest: repaired |
| --- | ---: | ---: | ---: | ---: | ---: |
| Physics (a test fails) | 9 | 9/9 (100%) | 9/9 (100%) | 9/9 (100%) | 9/9 (100%) |
| Winnability (no test fails) | 24 | 0/24 (0%) | 0/24 (0%) | 24/24 (100%) | 24/24 (100%) |
| All | 33 | 9/33 (27%) | 9/33 (27%) | 33/33 (100%) | 33/33 (100%) |

In-vocabulary games the bot did not win:

- g12 "collect coins in a city before the timer ends": the bot could not reach 'coin-8' at (-12.2, 1.1, 7.8) (stuck near (-1.7, -0.0, 37.1)), 'coin-3' at (-10.1, 1.1, 19.0) (stuck near (-1.6, -0.0, 35.4)) and 2 more; the game was lost (time ran out or a hazard)
- m07 "collect 6 coins in a space station": the bot could not reach 'coin-4' at (-2.1, 1.1, 8.8) (stuck near (-2.0, -0.6, 9.1)), 'coin-2' at (-12.1, 1.1, 12.6) (stuck near (-11.9, -6.3, 12.5)) and 4 more

#### 2. Edit versus regenerate

|  | Aether patch | Regenerate, perfect copy (best case) | Regenerate, fresh sample |
| --- | ---: | ---: | ---: |
| Asked change fully made | 127/130 (98%) | 127/130 (98%) | 44/130 (34%) |
| Mean share of the request done | 0.988 | 0.988 | 0.375 |
| Edits with unrequested changes | 8/130 (6%) | none by assumption | 130/130 (100%) |
| Unrequested properties changed, mean (median) | 0.7 (0) | 0 | 248.5 (238.5) |
| Verification regressions | 6/130 (5%) | 6/130 (5%) | 0/130 (0%) |
| Playability regressions (games) | 3/27 (11%) | 3/27 (11%) | 6/27 (22%) |
| Model output tokens, median (p90) | 230 (431) | 7715.5 (16014) | 4914.5 (8891) |
| Model input tokens, median | 2006 | 7728.5 | 78 |
| Patch operations, median | 6 | 62 | 78 |
| Entities rewritten, median | 6 | 62 | 66.5 |
| Local compute ms, median (p90) | 10.8 (45.7) | 6.2 (33.4) | 18.5 (50.5) |
| Projected latency ms at the assumed model speed, median | 3843 | 128595 | 81927 |

Over the edits Aether completed, re-emitting the whole document costs a median 39.1x the output tokens of the patch and the model must read 4.3x more input.

| Edit kind | Edits | Aether made the change | Fresh regeneration made it | Aether unrequested changes | Fresh regeneration unrequested changes |
| --- | ---: | ---: | ---: | ---: | ---: |
| recolor | 32 | 30 | 0 | 0 | 7973 |
| bigger | 16 | 15 | 0 | 68 | 4168 |
| remove | 16 | 16 | 0 | 8 | 3829 |
| night | 14 | 14 | 14 | 0 | 3566 |
| add | 16 | 16 | 15 | 0 | 3767 |
| rain | 16 | 16 | 15 | 0 | 3801 |
| smaller | 10 | 10 | 0 | 18 | 2606 |
| glow | 10 | 10 | 0 | 2 | 2591 |

Where Aether loses (3 edits it did not complete, 0 of which fresh regeneration did):

- domino: "make all the dominoes red" (82% of the request done)
- bowling: "make all the pins red" (32% of the request done)
- bowling: "make all the pins bigger" (32% of the request done; also changed pin-2:transform.position.0, pin-2:transform.position.2, pin-3:transform.position.0, pin-3:transform.position.2)

Edits that broke something that worked (6):

- street: "remove all the cars" broke verification
- coins: "remove all the coins" broke verification made the game unwinnable
- parkour: "remove all the platforms" broke verification made the game unwinnable
- bowling: "make all the pins bigger" broke verification
- tower: "remove all the blocks" broke verification
- coins2: "remove all the coins" broke verification made the game unwinnable

Edits with unrequested property changes (8):

- village: "make all the houses smaller": 3 (gatehouse-1:transform.scale.0, gatehouse-1:transform.scale.1, gatehouse-1:transform.scale.2)
- village: "make all the houses glow": 2 (gatehouse-1:material.emissive, gatehouse-1:material.emissiveIntensity)
- farm: "remove all the animals": 5 (removed sheep-1-head-1, removed sheep-2-head-1, removed sheep-3-head-1, removed sheep-4-head-1)
- street: "remove all the cars": 1 (player:controls)
- oasis: "make all the cacti smaller": 15 (cactus-1:transform.position.2, cactus-2:transform.position.0, cactus-2:transform.position.2, cactus-3:transform.position.0)
- domino: "make all the dominoes bigger": 56 (domino-2:transform.position.0, domino-2:transform.position.2, domino-3:transform.position.0, domino-4:transform.position.2)
- bowling: "make all the pins bigger": 12 (pin-2:transform.position.0, pin-2:transform.position.2, pin-3:transform.position.0, pin-3:transform.position.2)
- bowling: "remove all the lamps": 2 (removed lamp-post-1-light-1, removed lamp-post-2-light-1)

#### 3. Verification speed

| Measure (sampled worlds: 74) | Median | Worst / p90 |
| --- | ---: | ---: |
| Full proof (diagnostics, tests, rules), ms | 7 | p90 16.4 |
| Proof speed, simulated seconds per wall second (41 worlds with simulated time) | 561x | min 136x |
| Plain physics stepping, simulated seconds per wall second | 1670x | min 552x |
| Create a physics world from the document, ms | 1.21 |  |
| Fork a running world (snapshot + restore), ms | 0.79 | p90 1.42 |
| Forks per second | 1275 |  |
| Snapshot size, KiB | 136.5 |  |
| Fork replay drift after 5 s, metres |  | max 0 |

#### 4. Offline planner coverage

| Slice | Prompts | Right kind of world | Every expected word present | Mean word coverage | Fell back to the default meadow | Fully right and verified |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| All prompts | 81 | 71/81 (88%) | 61/81 (75%) | 0.81 | 9/81 (11%) | 60/81 (74%) |
| In vocabulary | 57 | 56/57 (98%) | 53/57 (93%) | 0.96 | 1/57 (2%) | 53/57 (93%) |
| Stretch (outside it) | 19 | 11/19 (58%) | 3/19 (16%) | 0.33 | 8/19 (42%) | 3/19 (16%) |
| Named flagships | 5 | 4/5 (80%) | 5/5 (100%) | 1.00 | 0/5 (0%) | 4/5 (80%) |

| Kind (flagships excluded) | Prompts | Right kind of world | Every expected word present | Mean word coverage | Fell back to the default meadow | Fully right and verified |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| game | 22 | 18/22 (82%) | 17/22 (77%) | 0.83 | 2/22 (9%) | 17/22 (77%) |
| physics | 13 | 10/13 (77%) | 7/13 (54%) | 0.62 | 3/13 (23%) | 7/13 (54%) |
| voxel | 8 | 7/8 (88%) | 7/8 (88%) | 0.88 | 0/8 (0%) | 7/8 (88%) |
| house | 10 | 9/10 (90%) | 9/10 (90%) | 0.90 | 1/10 (10%) | 9/10 (90%) |
| scene | 23 | 23/23 (100%) | 16/23 (70%) | 0.81 | 3/23 (13%) | 16/23 (70%) |

In-vocabulary prompts that came out incomplete (4):

- p04 "bowling with a heavy ball against a crate pyramid": missing crate (built "Bowling Night")
- v05 "a flat creative world to build in": no voxel terrain; missing voxel (built "Two-bedroom apartment")
- s06 "a desert oasis with palm trees and a tent": missing tent|water (built "Desert Canyon")
- m08 "a medieval castle with a moat and drawbridge": missing moat|water|bridge (built "Castle Keep")

Model run: codex, 14 of at most 14 calls, 8 prompts spread over the suite.

| Planner | Prompts | Right kind of world | Every expected word present | Mean word coverage | Fell back to the default meadow | Fully right and verified |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| codex | 8 | 6/8 (75%) | 7/8 (88%) | 0.88 | 0/8 (0%) | 5/8 (63%) |
| offline planner, same prompts | 8 | 8/8 (100%) | 6/8 (75%) | 0.81 | 1/8 (13%) | 6/8 (75%) |

- g01 "a coin collecting game: grab 8 coins before time runs out": no win condition (no win rule, no goal), words 0%, 1 calls, 2130 output tokens, 29 s
- g10 "a jumping challenge climbing to a golden portal at sunset": right kind, words 100%, 1 calls, 1651 output tokens, 24 s
- p04 "bowling with a heavy ball against a crate pyramid": right kind, words 100%, 5 calls, 2673 output tokens, 80 s
- v01 "a minecraft-like survival world": right kind, words 100%, 2 calls, 477 output tokens, 19 s
- h03 "a small cafe interior": right kind, words 100%, 1 calls, 447 output tokens, 14 s
- s02 "an asteroid field in space": right kind, words 100%, 1 calls, 2678 output tokens, 39 s
- s12 "a pagoda in a misty mountain valley": right kind, words 100%, 1 calls, 2876 output tokens, 40 s
- x09 "a medieval blacksmith workshop interior": only 12 objects, words 100%, 2 calls, 961 output tokens, 29 s
<!-- bench:results:end -->

## Reading the results

*Numbers move; these points are about the method and hold for any run.*

- **Verification and winnability are different questions.** The shipped tests
  prove physics (things rest, fall, topple, collide). None of them asks whether
  a player can finish the game, so a floating pickup or an unreachable goal
  passes. A playtest bot in the verification step catches those, and the repair
  loop then fixes them as readily as it fixes failing physics tests. Wiring the
  bot into the studio's verification (it needs only `initPhysics` and the
  logic runtime, both already there) is the obvious next step; the harness
  shows what it would buy.
- **A patch is cheaper and safer than a rewrite, but not free.** The remaining
  failures are listed in the tables with their causes. Those are the edits
  where a language model reading the report would do better than the offline
  planner; the harness is how to find out.
- **Out-of-vocabulary prompts fall back, quietly.** The offline planner builds
  its default meadow and verification passes, because nothing in it is
  broken. Coverage is therefore measured against what was asked, not against
  whether anything failed.

## Defects the benchmark found

Each is reproducible from the prompt or edit named, and none was visible to the
shipped verification.

- **Pickups placed where nobody can reach them.** `g12` ("collect coins in a
  city"): four of the eight coins sit inside building colliders (a ray dropped
  from above lands on the roof). `m07` ("collect 6 coins in a space station"):
  the deck is 16 m across and the coins are scattered up to 19 m out, over the
  void. The bot loses both; a player would too.
- **Pickups just out of a walking player's reach.** A coin is 1.1 m up and the
  player position is at the feet, so a pickup is only collected from the low
  point of its bob, or by hopping. The bot needed to hop in 8 of the 15 coin and
  parkour games it won (the "hop" count under table 1). Most people would hop
  too, but it is a rough edge.
- **A removal that orphans the player.** `street`: "remove all the cars" also
  removes the car the player drives, leaving `player.controls` pointing at
  nothing (verification then fails).
- **Scaling that moves neighbours.** "Make all the dominoes / pins / cacti
  bigger or smaller" shifts their positions as well as their size (dozens of
  unrequested property changes for the dominoes), and for the bowling pins the
  shifted triangle no longer verifies.
- **Vocabulary gaps.** "Dominoes" (plural with *es*) is not understood as
  "domino"; "pins" matches the decorative pins of the neighbouring lanes as well
  as the playable ten, so a recolor is only partly done.
- **Silent fallback.** Eight of the nineteen out-of-vocabulary prompts come out
  as the default meadow with a passing verification.

## Files

| File | Role |
|---|---|
| `scripts/bench/run.ts` | CLI, orchestration, the CI `check()` |
| `scripts/bench/suite.ts`, `bases.ts` | The 81 prompts and the 16 base worlds |
| `scripts/bench/metrics.ts` | Tokens, percentiles, Wilson intervals, leaf diffs, collateral accounting |
| `scripts/bench/autoplay.ts` | The generic playtest bot |
| `scripts/bench/prompt-study.ts`, `world-eval.ts` | Run a prompt through the real loop; structure and fidelity checks |
| `scripts/bench/edit-study.ts` | Edit cases, oracle intents, the three arms |
| `scripts/bench/repair-study.ts` | Fault catalogue, scripted model, repair arms |
| `scripts/bench/speed-study.ts` | Proof speed, fork cost, replay exactness |
| `scripts/bench/aggregate.ts`, `report.ts` | Summaries and Markdown |
| `docs/benchmark/results.json` | Committed full results |
