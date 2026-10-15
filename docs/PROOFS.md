# Replay proofs: format, verifier and threat model

Aether verifies a world by forking its physics headless and fast-forwarding
it ("physics as unit tests", `@aether/physics` `verify`). A **replay proof**
makes that result portable: anyone can re-run the same simulation on their own
device or in Node and see whether it reproduces the outcome the author sealed.

**What it is.** A *deterministic replay check*. The proof says: "this exact
world (content hash), simulated by this engine for this long, decided its
tests this way." A verifier re-simulates and compares.

**What it is not.** It is not a formal proof, and it does not say the game is
fun, fair, bug-free or that the world's own tests are meaningful: the tests
belong to the world's author, and a world with no tests passes trivially. It
says the author's checks pass and that nobody edited the claim or the world
afterwards. Every surface that shows a proof says "deterministic replay
check, not a formal proof".

## Format (`aether-proof`, v1)

Implemented in `packages/verifier/src/proof.ts` (zod, `.strict()`, hard caps;
the proof is untrusted input). Canonical JSON = keys sorted, no whitespace,
`-0` is `0`, non-finite numbers are rejected. Hashes are `sha256:<hex>`.

```jsonc
{
  "format": "aether-proof", "v": 1,
  "engine": { "replay": "aether-replay/1", "physics": "rapier3d-compat@0.21.0" },
  "sealedAt": 1760000000000,                 // informational; not a trusted clock
  "world":  { "hash": "sha256:…", "name": "…", "entities": 74, "tests": 4 },
  "replay": { "maxSeconds": 12, "fixedDt": 0.016666…, "traceHz": 12 },
  "colliders": { "mode": "none" | "embedded" | "external", "hash": "…", "entries": [ … ] },
  "claim": {
    "passed": true, "simulatedSeconds": 7.283,
    "tests": [ { "id": "…", "kind": "…", "passed": true, "message": "…", "atTime": 1.2 } ],
    "diagnostics": [ { "severity": "warning", "code": "floating", "entities": ["…"] } ],
    "hash": "sha256:…"                        // of { passed, simulatedSeconds, tests, diagnostics }
  },
  "playtest": {                              // optional: the playtest bot's winning run (see below)
    "v": 1, "bot": 1, "kind": "game", "status": "passed", "worldHash": "<16 hex, gameplay content>",
    "seconds": 27.7, "steps": 1662, "summary": "…", "objectives": { "done": 8, "total": 8 }, "falls": 0,
    "trace": { "dt": 0.0833, "frames": 333, "box": [ … ], "data": "<base64 uint16 x,y,z,yaw>", "events": [ … ] }
  },
  "trace": { "hash": "sha256:…", "frames": 88, "bodies": 16, "dt": 0.083333 },
  "hash": "sha256:…",                         // of the canonical body (everything but hash and signature)
  "signature": { "alg": "Ed25519", "publicKey": "<b64url raw 32 B>", "sig": "<b64url 64 B over the UTF-8 of hash>" }
}
```

- **`world.hash`** is the hash of the canonical JSON of the world after
  `validateWorld` (the normalised form), so the same world hashes the same
  after `game.json` or a share link round trip (a test covers all bundled
  games).
- **`engine`** identifies the replay semantics. `REPLAY_ENGINE` is bumped
  whenever a physics, rules or trace change could change a replay's outcome;
  `PHYSICS_ENGINE` must equal the Rapier version `@aether/physics` depends on
  (a test enforces it). A different value is reported as **engine mismatch**,
  not as tampering or failure.
- **`trace.hash`** fingerprints the moved bodies' recorded poses quantised to
  1 mm (little-endian int32), independent of host endianness.
- **`colliders`**: shapes that only the renderer can derive (custom
  generators, imported models) are embedded (hashed, capped); if they do not
  fit, the mode is `external` and a verifier reports **cannot re-check**
  instead of guessing.
- **`signature`** is optional. The signed message is the UTF-8 text of
  `hash`, so it covers the whole body.

### Where proofs live

| Place | How |
| --- | --- |
| `proof.json` | a proof, optionally with the full world under `worldDoc` (so it is self-contained) |
| published game build | `game.json` `proof` member, a standalone `proof.json`, `<meta name="aether:proof">` in `index.html`, a "Replay-sealed" caption on `cover.png` / `screenshot.png`, a README section |
| share link | `#w=…` payload member `proof` (omitted above 16 KB; the publish hub says so; the bot's run is part of the seal) |

## The bot's run inside the seal

The playtest bot (`@aether/playtest`) is the other half of "playable": the
physics replay shows the world's own checks hold, and the bot shows a player
can actually reach the end (collect what is needed, talk to the character who
sells the key, open the gate). Both claims travel as **one** proof: when the
studio (or `aether-verify seal`) has a passed bot run for exactly this world it
is embedded as the `playtest` member, covered by the content hash and the
signature. Nothing about the bot is a second badge or a second file:

- The seal horizon is the longest of the default (12 s) and what the world's
  own tests need (`replaySettingsFor`), so a world whose NPC test runs 16 s is
  decided rather than left "not decided".
- The evidence carries a thinned winning run (at most 400 trace frames, 20
  events; a sealed Hollow Gate proof is about 6 KB) so it fits in a share link.
- `checkProof` verifies the evidence is about this gameplay (`worldHash`
  against `@aether/playtest` `hashWorld`) and, when the caller supplies a
  re-player (`CheckOptions.playtest`; the CLI and the player do), has the bot
  play the game again: a bot that no longer wins is `replay-diverged`. Without a
  re-player the step is reported as skipped, never as passed.
- A failed, stale or `unsupported` bot run is not sealed in; sealing a world
  whose own checks fail is still refused. The bot adds a stronger claim, it
  never lowers the bar of the replay.

## The verifier (`@aether/verifier`)

`packages/verifier`, no new dependencies (it reuses `@aether/core`,
`@aether/physics`, `@aether/logic` and the headless logic host that the
studio's verification workers also use; the hashing is a dependency-free
SHA-256, signing is Web Crypto Ed25519 in Node 22+ and current browsers).

```
aether-verify <proof.json | game.json | build-dir> [--world file] [--trust <publicKey>]… [--no-replay] [--no-bot] [--json]
aether-verify seal <game.json | world.json> [--out proof.json] [--key key.json] [--seconds <n>] [--no-bot]
aether-verify keygen <key.json>
```

Exit status: 0 verified, 1 not verified, 2 usage or unreadable input. In code:
`checkProof(proof, world, options)` returns a status and the steps it took.

`checkProof` runs these steps in order and stops at the first failure:

1. **format**: zod schema and caps (`invalid`).
2. **content hash**: body, claim and embedded colliders hash to what the proof
   says (`tampered`).
3. **signature** (if present): Ed25519 over the hash (`bad-signature`). The
   key is reported by short id; it is **not** tied to an identity (see below).
4. **engine**: replay and physics versions equal this verifier's
   (`engine-mismatch`).
5. **world**: the presented world's hash equals `world.hash` (`world-mismatch`).
6. **replay**: re-simulate with the recorded settings and compare outcome,
   simulated time, per-test results, diagnostics and the motion fingerprint
   (`replay-diverged` with the differences listed; `inconclusive` if the
   wall-clock budget ran out; `unverifiable` for `external` colliders).

`verified` means step 6 reproduced the claim. **Verified playable** is shown
only when the reproduced claim is also "all checks passed". A sealed failure
verifies as a faithful failure report and is never labelled playable.
Publishing refuses to seal a world with failing checks.

### Determinism

The replay uses fixed steps, no wall-clock input and no `Math.random` (seeded
rng only); the wall-clock budget exists only to stop runaway work, and a
replay it cut short is never sealed or judged. Rapier runs as WebAssembly
(IEEE-754, no threads), so it is reproducible across engines. The
`packages/verifier/test/golden.json` pins hold the hashes of fixed worlds
(including a kinematic, trigonometry-driven one): if a change moves them, bump
`REPLAY_ENGINE` and regenerate with `UPDATE_GOLDEN=1`.
`npm run e2e:proof` seals those worlds inside Chromium and Firefox (the
verifier bundled for browsers) and requires the proofs to be **byte-identical**
to Node's, then has each engine verify Node's proofs; it also verifies, in
Node, proofs sealed by the browser.

## Threat model

| Attacker does | Result |
| --- | --- |
| edits any field of a proof (claim, hash, engine, world summary) | `tampered`: the content hash no longer matches |
| edits the claim and recomputes the hashes (unsigned proof) | `replay-diverged`: the re-simulation disagrees |
| edits a signed proof and recomputes the hash | `bad-signature` |
| grafts a signature or key from another proof | `bad-signature` |
| edits the world after sealing | `world-mismatch` (even a one-character rename) |
| presents a proof from another engine version | `engine-mismatch`, with an explanation; never reported as success |
| signs a forged proof with their own key | verifies as signed by *that* key; trust is the viewer's decision (`--trust`) |
| feeds a hostile proof / world file | zod caps, size limits, prototype-pollution-safe parsing, `validateWorld`; scripts only run in the QuickJS sandbox; replay bounded by 60 simulated seconds and a 30 s wall-clock budget |

Limits, stated plainly:

- A signature proves "signed by the holder of this key", never who that is.
  The studio keeps a non-extractable Ed25519 key in the browser's IndexedDB
  ("same browser as last time"). Clearing site data makes a new key.
- An unsigned proof only shows the world and claim are consistent with each
  other and with a fresh replay; anyone can produce one for any world.
- The proof covers the world's own tests, not whether they are the right
  tests. `sealedAt` is the sealer's clock.
- A replay is only as deterministic as the engine: a different Rapier or logic
  version can change outcomes, which is why the engine is part of the claim.
- Worlds that need renderer-derived shapes may be `unverifiable` where those
  shapes do not travel (share links drop proofs above 16 KB).
- Share links created by the older `#/view/<token>` viewer and the server's
  `/api/worlds` store carry no proof.
- The local viewer re-check runs on the viewer's CPU; a very large world can
  take several seconds. The player loads the verifier only when asked.

## UI wording

`packages/verifier/src/format.ts` holds every badge string so all surfaces
agree: *Sealed playable* (the author's claim, before any check), *Checking…*,
*Verified playable*, *Verification failed*, *Seal out of date*, *Cannot
re-check*, *Not sealed*. The player's title screen shows the badge with a
"Check it yourself" button; the result lists what was checked. When the seal
carries the bot's run, the same badge adds one sentence ("A bot played it to the
win in 28 s of play (8 of 8 goals reached)"), a "Watch the bot's run" ghost
replay and, after a check, "Re-played on this device: it won again." In the
studio, a live bot run on the world on screen reads *Verified playable* too (it
is a check you can see happen); what is published is the sealed claim, which
becomes *Verified playable* for a viewer once they check it.
