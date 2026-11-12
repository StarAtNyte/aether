<p align="center">
  <img src="apps/studio/public/favicon.svg" width="72" height="72" alt="Aether logo">
</p>

<h1 align="center">Aether</h1>

<p align="center">
  <b>Describe a world. Aether builds it, checks that it works, and lets you play it.</b>
</p>

<p align="center">
  <a href="https://aether-studio-lyart.vercel.app"><img alt="Live demo" src="https://img.shields.io/badge/live_demo-open_the_studio-4f46e5?style=flat-square"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-2ea44f?style=flat-square"></a>
  <a href=".nvmrc"><img alt="Node 24" src="https://img.shields.io/badge/node-24-339933?style=flat-square&logo=nodedotjs&logoColor=white"></a>
  <img alt="WebGPU and WebGL2" src="https://img.shields.io/badge/renderer-WebGPU_%7C_WebGL2-1b1a18?style=flat-square">
  <a href="https://github.com/StarAtNyte/aether/releases/tag/v0.1.0"><img alt="Version 0.1.0 pre-release" src="https://img.shields.io/badge/version-0.1.0_pre--release-orange?style=flat-square"></a>
</p>

<p align="center">
  <a href="https://github.com/StarAtNyte/aether/releases/tag/v0.1.0">
    <img src="docs/screenshots/tour-sanctuary-terraces.gif" width="100%" alt="A cinematic tour of Sanctuary Terraces, rendered in real time in the browser">
  </a>
  <br>
  <sub>Sanctuary Terraces, built by the agent (Claude Code): the studio's cinematic tour, recorded in real time on an
  Intel integrated GPU at ultra quality. Click for the two-minute demo video.</sub>
</p>

<p align="center">
  <a href="https://aether-studio-lyart.vercel.app"><b>Live studio</b></a> ·
  <a href="https://github.com/StarAtNyte/aether/releases/tag/v0.1.0"><b>Demo video</b></a> ·
  <a href="#quick-start"><b>Quick start</b></a> ·
  <a href="#documentation"><b>Docs</b></a>
</p>

Aether is an AI world studio that runs in the browser. Describe a world in plain
words and the AI builds it step by step: land, buildings, interiors. Or start
from a photo and it rebuilds the room in 3D. Then you shape it, prove it works
and share it with one link.

- **Shape it.** Select and drag pieces with gizmos, swap materials, or edit by
  chat ("make the sofa dark green"). Drag the sun to change the time of day;
  nothing is re-baked. Cut a building open, explode its floors, or open the
  floor plan with room areas.
- **Prove it.** A bot plays the game to show it can be won. The world's own
  tests run. Game rules read like sentences. If something is broken, the agent
  repairs it.
- **Share it.** One link carries the whole world and opens on a laptop or a
  phone. Publish it as a game, a video, a picture, a 3D model or a floor plan.
  Published worlds open in their own mode (third-person play, walkthrough, or a
  drone tour over a city) and can be remixed into the editor.
- **Range.** Architecture, interiors, cities, landscapes, games (shooter,
  exploration, boat) and animated story films with a play-as-the-character mode.

Underneath is a three.js WebGPU/WebGL2 renderer with real-time lighting, soft
shadows and an offline film and footage pipeline.

> [!TIP]
> **Run it on your computer with your Claude Code or Codex subscription.** It's free, and you don't need an API key.
>
> ```bash
> curl -fsSL https://raw.githubusercontent.com/StarAtNyte/aether/main/scripts/get-aether.sh | bash
> ```
>
> On Windows (PowerShell): `irm https://raw.githubusercontent.com/StarAtNyte/aether/main/scripts/get-aether.ps1 | iex`
>
> The installer downloads Aether into `~/aether`, installs it and opens the studio. The studio uses
> your signed-in `claude` or `codex` CLI. See the [Quick start](#quick-start) for the manual steps.

- **Hosted studio:** <https://aether-studio-lyart.vercel.app>. It includes a
  small shared trial of the hosted model, and it also works offline or with
  your own API key. You can also connect it to Claude Code or Codex on your
  computer: see [Connect an AI](#connect-an-ai).
- **On your computer:** one command (above), and your own Codex or Claude Code login.
- **Demo video (2 minutes):** attached to the [v0.1.0 release](https://github.com/StarAtNyte/aether/releases/tag/v0.1.0).

## What it does

<table>
  <tr>
    <td width="50%" valign="middle">
      <img src="docs/screenshots/showcase/sanctuary-falls.webp" width="100%" alt="Sanctuary Falls: a marble stair between three waterfalls to a Doric temple">
    </td>
    <td width="50%" valign="middle">
      <h3>Prompt to world</h3>
      Outdoor worlds, games, physics machines and buildings from a sentence, built by an agent that plans first, then
      places things through measuring tools and edits the world with small validated patches. A generation brief plans
      what a space needs and how elaborate it should be; after the build, a richness review compares the result with the
      plan and sends shortfalls back.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="middle">
      <h3>Playable games, verified by a bot</h3>
      Physics tests, a playtest bot that plays to the win and repairs defects, and sealed replay proofs that
      <code>aether-verify</code> re-runs. The badge says <b>Verified playable</b> or <b>Verified walkable</b> only after a
      passed run on exactly the world on screen.
    </td>
    <td width="50%" valign="middle">
      <img src="docs/screenshots/showcase/hollow-gate.webp" width="100%" alt="The Hollow Gate: buy the key, slip past the guard, outwit the wolves">
    </td>
  </tr>
  <tr>
    <td width="50%" valign="middle">
      <img src="docs/screenshots/showcase/linden-row.webp" width="100%" alt="Linden Row: ten family houses round a village green">
    </td>
    <td width="50%" valign="middle">
      <h3>Big worlds, smooth on a laptop</h3>
      A furnished street of 2,284 objects runs at 60 fps on an Intel integrated GPU at ultra quality and on an RTX 3050
      over WebGPU or WebGL2. The load screen stays up until the world is fully prepared, so the first step never stutters
      (<a href="#big-worlds-on-a-laptop">numbers</a>). Bundled lightmaps for interiors, a studio render that is the default
      view, adaptive resolution and a light chain while the view moves.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="middle">
      <h3>Photo to room</h3>
      Rebuilds a room from a photograph: shell, furniture and decor, with an advisory room-size estimate from a depth
      network (<code>measure_room</code>) and an AI judge loop that compares render and photo.
    </td>
    <td width="50%" valign="middle">
      <img src="docs/screenshots/photo-to-room-hotel.webp" width="100%" alt="Left: a CC0 photograph of a hotel bedroom. Right: the room Aether rebuilt from it">
      <br><sub>Photo (left, Markus Spiske, CC0 1.0) and the rebuilt room (right).</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="middle">
      <img src="docs/screenshots/shared-viewer.png" width="100%" alt="A shared world opened read-only from a link, with Play, Export and Remix">
    </td>
    <td width="50%" valign="middle">
      <h3>Publish and share</h3>
      Standalone web builds, share links that carry the whole world, videos, stills, GLB and floor plans. Agent-ready too:
      an MCP server (<code>aether mcp</code>) and the <code>aether</code> command line.
    </td>
  </tr>
</table>

Under it all is **a real model library**: CC0 models and textures (Kenney, Poly Haven, ambientCG) plus first-party
crafted parts: venues, streets, harbours, seven regional house types, gyms, clinics, furniture.

## Gallery

Fifteen featured projects ship with the studio and open from the home page.
Each was built from the prompt on its card. Each passes its physics checks,
and the bot plays the games to their win screens in the test suite. Blockfall
and Sakura River are the exceptions: they use their own game loops, which the
general bot does not drive. Five larger **big worlds** show the renderer at scale: hundreds to thousands of objects,
furnished interiors, waterfalls and whole towns, smooth on a laptop's integrated GPU.

<table>
  <tr>
    <td width="33%" valign="top"><img src="docs/screenshots/showcase/sanctuary-terraces.webp" width="100%" alt="Sanctuary Terraces"><br><b>Sanctuary Terraces</b><br><sub>A hill town on limestone terraces, waterfalls into a lagoon, a gilded temple</sub></td>
    <td width="33%" valign="top"><img src="docs/screenshots/showcase/sanctuary-falls.webp" width="100%" alt="Sanctuary Falls"><br><b>Sanctuary Falls</b><br><sub>A marble stair between three waterfalls to a Doric temple</sub></td>
    <td width="33%" valign="top"><img src="docs/screenshots/showcase/sanctuary-ascent.webp" width="100%" alt="Sanctuary Ascent"><br><b>Sanctuary Ascent</b><br><sub>A zigzag stair up a crag to a colossal Athena, built end to end in hardcore mode</sub></td>
  </tr>
  <tr>
    <td width="33%" valign="top"><img src="docs/screenshots/showcase/linden-row.webp" width="100%" alt="Linden Row"><br><b>Linden Row</b><br><sub>Ten real family houses round a village green, every room furnished, lit and walkable</sub></td>
    <td width="33%" valign="top"><img src="docs/screenshots/showcase/kestrel-outpost.webp" width="100%" alt="Kestrel Outpost"><br><b>Kestrel Outpost</b><br><sub>A third-person shooter: hold a cliff-ringed relay against five waves</sub></td>
    <td width="33%" valign="top"><img src="docs/screenshots/showcase/neon-rain-city.webp" width="100%" alt="Neon Rain City"><br><b>Neon Rain City</b><br><sub>A wet downtown at night, find five neon cats</sub></td>
  </tr>
  <tr>
    <td width="33%" valign="top"><img src="docs/screenshots/showcase/sakura-river.webp" width="100%" alt="Sakura River Journey"><br><b>Sakura River Journey</b><br><sub>Paddle a canoe through four seasons</sub></td>
    <td width="33%" valign="top"><img src="docs/screenshots/showcase/kyoto-temple.webp" width="100%" alt="Kyoto Temple Lanterns"><br><b>Kyoto Temple Lanterns</b><br><sub>A story in four chapters</sub></td>
    <td width="33%" valign="top"><img src="docs/screenshots/showcase/highland-trail.webp" width="100%" alt="Highland Trail"><br><b>Highland Trail</b><br><sub>Log six survey stakes, cross the footbridge, reach the summit</sub></td>
  </tr>
  <tr>
    <td width="33%" valign="top"><img src="docs/screenshots/showcase/chain-reaction.webp" width="100%" alt="Chain Reaction"><br><b>Chain Reaction</b><br><sub>Five Rube Goldberg machines, every bounce checked</sub></td>
    <td width="33%" valign="top"><img src="docs/screenshots/showcase/kart-canyon.webp" width="100%" alt="Kart Canyon"><br><b>Kart Canyon</b><br><sub>Three laps, checkpoints, boost pads, two rivals</sub></td>
    <td width="33%" valign="top"><img src="docs/screenshots/showcase/lantern-isles.webp" width="100%" alt="Lantern Isles"><br><b>Lantern Isles</b><br><sub>Find twelve lanterns across floating islands</sub></td>
  </tr>
  <tr>
    <td width="33%" valign="top"><img src="docs/screenshots/showcase/casa-patio.webp" width="100%" alt="Casa del Patio"><br><b>Casa del Patio</b><br><sub>A courtyard house above Sintra, every drawer opens</sub></td>
    <td width="33%" valign="top"><img src="docs/screenshots/showcase/skyline-penthouse.webp" width="100%" alt="Skyline Penthouse"><br><b>Skyline Penthouse</b><br><sub>Walk it, switch the lights, change the hour</sub></td>
    <td width="33%" valign="top"><img src="docs/screenshots/showcase/dusk-lake-house.webp" width="100%" alt="Dusk House by the Lake"><br><b>Dusk House by the Lake</b><br><sub>Explode it, cut it, walk to the jetty</sub></td>
  </tr>
</table>

<details>
<summary><b>Five more featured worlds, the photo rooms and the agent-generated worlds</b></summary>

<br>

<table>
  <tr>
    <td width="33%" valign="top"><img src="docs/screenshots/showcase/hollow-gate.webp" width="100%" alt="The Hollow Gate"><br><b>The Hollow Gate</b><br><sub>Buy the key, slip past the guard, outwit the wolves</sub></td>
    <td width="33%" valign="top"><img src="docs/screenshots/showcase/blockfall.webp" width="100%" alt="Blockfall"><br><b>Blockfall</b><br><sub>Mine, craft and survive the night in a block world</sub></td>
    <td width="33%" valign="top"><img src="docs/screenshots/showcase/orbital-lab.webp" width="100%" alt="Orbital Lab"><br><b>Orbital Lab</b><br><sub>Low gravity, five power cells, restart the reactor</sub></td>
  </tr>
  <tr>
    <td width="33%" valign="top"><img src="docs/screenshots/showcase/painterly-meadow.webp" width="100%" alt="Painterly Meadow"><br><b>Painterly Meadow</b><br><sub>A steam train in a wildflower valley</sub></td>
    <td width="33%" valign="top"><img src="docs/screenshots/showcase/four-seasons-garden.webp" width="100%" alt="Four-Seasons Garden"><br><b>Four-Seasons Garden</b><br><sub>Switch seasons with the 1 to 5 keys</sub></td>
    <td width="33%" valign="top"></td>
  </tr>
</table>

Four more example rooms, rebuilt from CC0 or public-domain photographs, are
listed on the Templates page under **Photo to 3D**: a hotel bedroom, a twin room, a four-poster
bedroom and a vaulted bedroom. The photo credit is on each card. They are saved runs of the photo flow
(`npm run showcase:photo-rooms`).

Nine worlds the agent generated from a prompt are listed under **Generated by
the agent**: a forest lantern hunt, a medieval market village, a modern pool
house, a two-bedroom apartment and a Scandinavian living room (built by the
offline planner), and four buildings from live runs: Starlight Cinema (Codex),
Orion Cinema, Evening Bistro and City Museum (Claude Code). Each card says how
the world was made and shows its prompt. They are saved exactly as generated,
open like any template and can be changed by chat.

The list and its order live in
[`apps/studio/src/showcase/manifest.ts`](apps/studio/src/showcase/manifest.ts).
`npm run showcase:bake -- --check` confirms that every saved world still
matches what its prompt builds (the photo rooms and the agent-generated
worlds are re-validated and re-verified instead).

</details>

## Quick start

You need **Node.js 24** (see `.nvmrc`), npm 10 or newer, and a WebGL2 browser.
Chrome or Edge use WebGPU; Firefox and Safari use the WebGL2 path.

The fastest way is the one-line installer:

```bash
curl -fsSL https://raw.githubusercontent.com/StarAtNyte/aether/main/scripts/get-aether.sh | bash   # macOS / Linux
irm https://raw.githubusercontent.com/StarAtNyte/aether/main/scripts/get-aether.ps1 | iex          # Windows PowerShell
```

It checks for Node 24 and git, clones the repository into `~/aether` (or
updates it; set `AETHER_DIR` to use another folder), runs `npm ci` and starts
the studio. Running it again updates Aether. To do the same steps by hand:

```bash
git clone https://github.com/StarAtNyte/aether && cd aether
npm ci
npm run aether -- start --open   # builds the studio once, starts it in the background, opens http://127.0.0.1:4280
```

On first open you choose **Sign in with ChatGPT (Codex)**, **Claude Code** (if
its CLI is signed in on this computer) or **Continue offline**. No API key is
needed: prompts run on your own subscription. From the `aether` folder,
`npm run aether -- stop` stops the server, and `npm run aether -- doctor`
checks Node, the build, the port and both CLIs.

> [!NOTE]
> Run Aether's CLI as `npm run aether -- …` (or `npx aether …` inside the
> cloned folder). Outside the repository, `npx aether` downloads an unrelated
> npm package that happens to have the same name.

Then type a prompt, for example *"a night forest adventure: collect 5 lanterns,
avoid the wolves, reach the shrine to win"* or *"a two-storey modern house with
a pool, open-plan living room, kitchen and two bedrooms"*. Keep chatting to
refine it, then press **Play**. [docs/USER_GUIDE.md](docs/USER_GUIDE.md)
covers prompting, chat edits, play mode, the badges, photo-to-room and
publishing.

To work on Aether itself with hot reload:

```bash
npm run dev:server   # API server on http://localhost:8787 (terminal 1)
npm run dev          # studio on http://localhost:5173, proxies /api (terminal 2)
```

<p align="center">
  <img src="docs/screenshots/proof-replay.png" width="100%" alt="The Aether editor: agent panel, viewport with a passed replay check, scene inspector">
  <br><sub>The studio: agent panel, viewport and scene inspector, with a passed replay check.</sub>
</p>

## The Aether framework

Aether is built on its own framework, not on a game engine. One set of TypeScript packages drives every kind of
world: a house, a city, a shooter, a boat ride and an animated film use the same world format, renderer, physics and
agent. The studio is one app on top of it.

| Package | What it does |
| --- | --- |
| [`core`](packages/core) | The World IR: one validated JSON document per world, typed patches, undo history |
| [`render`](packages/render) | three.js WebGPU/WebGL2 renderer: real-time sun and sky, soft shadows, characters, quality tiers |
| [`physics`](packages/physics) | Rapier physics, character controller, headless forks that run far faster than real time |
| [`logic`](packages/logic) | Game rules that read like sentences, behaviours, NPCs, weapons |
| [`playtest`](packages/playtest) | A bot that plays each game to the win |
| [`verifier`](packages/verifier) | Sealed replay proofs, re-simulated headless and checked |
| [`agent`](packages/agent) | The AI's tools, prompts, and the plan → build → check → repair loop |
| [`arch`](packages/arch) | Parametric buildings and interiors: walls, openings, roofs, stairs, furniture, floor plans |
| [`procgen`](packages/procgen) | Sandboxed generators: code the AI writes to build meshes, materials and foliage (a lantern, a cliff, a tree) |
| [`assets`](packages/assets) | Curated CC0 asset catalogue, glTF import and validation |
| [`voxel`](packages/voxel) | Block worlds |

Blender connects through a local bridge (see [docs/BLENDER-HARNESS.md](docs/BLENDER-HARNESS.md)): the AI models
pieces there, checks them, and bakes them into the same world format.

## How it works

```mermaid
flowchart LR
    P["Prompt<br/>(optional photo)"] --> PL["Plan<br/>generation brief"]
    PL --> BU["Build with tools<br/>validated patches"]
    BU --> CH["Headless checks<br/>+ bot play-test"]
    CH --> RV["Review renders<br/>look, measure, grade"]
    RV --> FX{"Good?"}
    FX -->|"no: fix"| BU
    FX -->|yes| OUT["Play or publish<br/>sealed replay proof"]
```

The world is one validated JSON document that the model edits with small patches. Code gives the model tools and
checks; the model decides. A headless physics fork and a bot that plays the game sit between the build and you.

<details>
<summary><b>What is different: six design choices, in detail</b></summary>

<br>

**1. The world is data, and the AI edits it with patches.** Every world is
one validated JSON document, the World IR
([`packages/core/src/schema.ts`](packages/core/src/schema.ts)). It holds
entities, shapes, materials, physics, joints, lights, behaviours, rules, NPCs,
buildings, tests and generator code. The model never touches the renderer. It
sends typed patches. Each patch is checked against the schema, cross-references,
size limits and prototype pollution, then stored as one undoable history step.
In the public benchmark, a small edit is a median 230-token patch, against
7,716 tokens to re-emit the whole world, and 8 of 130 edits changed anything
unrequested ([docs/BENCHMARK.md](docs/BENCHMARK.md)).

**2. The AI is the decision-maker. Code gives it tools and checks.** With
Codex or Claude Code connected, the model plans the layout first, then places
things through measuring tools. Some tools refuse nonsense: a bed through a
wall, a painting over a window, a stair that lands in a wall. The model then
looks at rendered views of its own result and fixes what it sees, round after
round. It also grades the look the way a photographer would (`tune_look`:
white balance, exposure, tints, fog, lamp strength), stored in the world as one
undo step. On a subscription login there is no fixed round cap: the loop ends when
the model approves its result or progress stalls. Paid API keys keep a finite
cap. Without a model, a deterministic offline planner builds from the same
parts, and the studio tells you it is offline. See
[docs/AGENT_TOOLS.md](docs/AGENT_TOOLS.md).

**3. Physics as unit tests.** `verify` builds a headless copy of the
[Rapier](https://rapier.rs) physics world with the game rules attached. It
fast-forwards the copy and checks the world's tests: `stable`, `noOverlap`,
`reaches`, `eventually`, `moves`, `topples`, `staysAbove`, `navigable` (every
room reachable on foot) and `npcs` (patrols reachable, nobody stuck). In the
benchmark it runs at a median 561 times real time (the slowest case was 136
times), and forking a running simulation costs 0.79 ms. Failures go back to
the model as a repair turn ("1/30 dominoes toppled; not: domino-1…").

**4. A bot plays it, and repairs what blocks it.** After every build and
edit, a playtest bot plays the game in a worker. It drives the real character
controller: it plans routes and jumps over a navigation graph sampled from the
physics world, fetches keys, talks to shopkeepers and steers round enemies. In
a building it walks to every room. When it finds a defect (an unreachable
pickup, a win target higher than the number of coins, a doorway narrower than
the player, enemies the player cannot survive), it applies the smallest fix as
one undoable step and plays again. The badge says **Verified playable** or
**Verified walkable** only after a passed run on exactly the world on screen.

**5. Sealed replay checks anyone can re-run.** The physics verdict and the
bot's winning run are sealed into one content-hashed proof file, signed with
Ed25519 if you choose to sign it. Share links and published games carry the
proof, and `aether-verify` re-simulates it in Node or in the browser. This is a
**deterministic replay check, not a formal proof**. It shows that the
author's checks pass on this exact world and engine version. It does not show
that the game is fun or bug-free ([docs/PROOFS.md](docs/PROOFS.md)).

```bash
npx aether-verify seal apps/studio/public/templates/worlds/chain-reaction.json --out proof.json
npx aether-verify proof.json --world apps/studio/public/templates/worlds/chain-reaction.json
#  ok   replay  10/10 checks passed over 15.167s of simulation, 16 moving bodies matched to 1 mm
#  ok   bot     a bot played it to the win again on this device (15 s of play)
```

**6. Small edits by chat.** After the first build, every message refines the
current world. "Make the sofa dark green velvet", "floral wallpaper on the
bedroom's back wall", "move the lamp a bit left", "make the wolves slower" and
"collect 15 coins to win" are resolved by name, type, room, position,
selection or conversation. Each becomes the smallest patch, shown as a
one-line diff with Undo. Common edits run locally in about a millisecond with
no model call (199 of 199 cases in `npm run eval:edits`). When a model writes
a patch, a guard refuses any change to objects the request did not name, and
the model tries again. Lights, zones and decor attached to an object move with
it (`attachedTo`).

</details>

<details>
<summary><b>Architecture diagrams: the agent loop and the packages</b></summary>

<br>

```mermaid
flowchart LR
    P["Prompt, optional photo"] --> M{"Model connected?"}
    M -->|"Codex / Claude Code / API key"| AI["Agent: plan first,<br/>then tools"]
    M -->|no| OFF["Offline planner"]
    AI -->|"apply_patches, design_plan,<br/>place_items, shape_land, tune_look…"| IR["World IR<br/>validated patches, undo history"]
    OFF --> IR
    IR --> R["Renderer<br/>three.js WebGPU / WebGL2"]
    IR --> V["verify<br/>headless Rapier fork,<br/>world tests"]
    IR --> B["Playtest bot<br/>plays to the win / walks every room"]
    R -->|"rendered views"| REV["Review round:<br/>model looks, measures, fixes"]
    V -->|failure report| AI
    B -->|"defect → smallest fix"| IR
    REV --> AI
    V & B --> S["Sealed replay proof<br/>badge · share link · aether-verify"]
```

```mermaid
flowchart TB
    subgraph Browser["apps/studio (React 19, Vite)"]
        UI["Editor, play mode, publish"]
        W["Workers: verification, playtest,<br/>voxel meshing, generator sandbox"]
    end
    subgraph Local["Your computer (optional)"]
        CLI["apps/cli: aether start / mcp"]
        SRV["apps/server (Hono): local AI routes,<br/>publishing, static hosting"]
        BR["apps/bridge: pairing for the hosted studio"]
        CX["codex / claude CLIs<br/>(your login)"]
    end
    subgraph Packages["packages/* (TypeScript, ESM; physics, logic, agent and arch run headless)"]
        CORE["core: World IR, patches, history"]
        AG["agent: loop, tools, providers, offline planner"]
        AR["arch: buildings, interiors, photo-to-room"]
        PH["physics: Rapier verify / fork / settle"]
        LO["logic: rules, behaviours, NPCs, QuickJS scripts"]
        PT["playtest: bot, level review, repairs"]
        VF["verifier: proofs, aether-verify"]
        RE["render: WebGPU / WebGL2, photoreal tiers"]
        PG["procgen: generators, sandbox"]
        AS["assets: CC0 catalog, characters"]
        VX["voxel: block worlds"]
    end
    UI --> AG & RE & PH & LO
    W --> PH & PT & PG & VX
    AG --> CORE & AR & PT
    CLI --> SRV --> CX
    BR --> CX
    UI -.->|"local AI / bridge"| SRV & BR
```

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) covers the design: patch
semantics, the verification algorithm, sandboxes, the agent's turn layout and
prompt caching, photo-to-room, the bot, and rendering.
[docs/CONTRACTS.md](docs/CONTRACTS.md) pins the public API of each package.

</details>

## Big worlds on a laptop

Heavy worlds (a furnished street of ten houses, a hillside town of 31,000 instances, cliff sanctuaries with waterfalls)
run on an ordinary laptop. Measured on an Intel UHD integrated GPU (Linux, 14 GB RAM) at ultra quality, after loading,
over a 25 s orbit; frame time is the median of 5 s windows at a 60 Hz display, so 16.7 ms is 60 fps:

| World | Objects | Frame time | Load | Peak memory |
| --- | ---: | --- | ---: | ---: |
| Kestrel Outpost | 118 | 16.7 ms | under 25 s | 2.5 GB |
| Linden Row | 2,284 | 16.7 ms | 61 s | 4.0 GB |
| Sanctuary Terraces | 224 | 16.7 ms | 68 s | 3.5 GB |
| Cliff Sanctuary | 647 | 16.7 ms | 64 s | 4.1 GB |
| Lisbon Hills | 483 | 16.7 ms (33 ms in the first seconds) | 52 s | 4.7 GB |

<details>
<summary><b>More GPUs and tiers, and what makes it work</b></summary>

<br>

Measured on an Intel UHD integrated GPU and an RTX 3050 Laptop GPU (Linux, 14 GB RAM), after loading, over a 25 s
orbit; frame time is the median of 5 s windows at a 60 Hz display:

| World | Objects | Intel UHD, ultra | Intel UHD, medium | RTX 3050, ultra | Load (Intel ultra) | Peak memory (Intel ultra) |
| --- | ---: | --- | --- | --- | ---: | ---: |
| Kestrel Outpost | 118 | 16.7 ms | | 16.7 ms | under 25 s | 2.5 GB |
| Linden Row | 2,284 | 16.7 ms | 16.7 ms | 16.7 ms (WebGPU and WebGL2) | 61 s | 4.0 GB |
| Sanctuary Terraces | 224 | 16.7 ms | | | 68 s | 3.5 GB |
| Cliff Sanctuary | 647 | 16.7 ms | | | 64 s | 4.1 GB |
| Lisbon Hills | 483 | 16.7 ms (33 ms in the first seconds) | | 16.7 ms | 52 s | 4.7 GB |

What makes it work, all in the renderer, so every world benefits, including new ones:

- **Nothing to explore until it is ready.** The load screen stays up, opaque, until scene, materials, shader programs,
  merged batches and the light bake are done and frames arrive at the running rate. Behind it the camera turns through
  four headings and prepares what each one sees, for both the moving and the resting picture, so turning the camera for
  the first time links nothing (it used to freeze a cliff town for 13 s).
- **Each mesh prepared once.** three.js keys every mesh's render state by the call depth and target format of the pass
  that draws it; the scene passes now render first at a fixed depth, so the moving and resting picture share it (a
  minute of a hillside town's load and up to 2 GB of page heap were spent building every mesh twice).
- **Memory released, not kept.** Linked shaders are freed (about 10 MB each in Mesa's Intel driver), programs of
  pipelines that are no longer used are deleted (a change of quality tier no longer keeps the old tier's programs beside
  the new ones), image textures are capped at 512 px on integrated GPUs, and capture targets live within a 32 MiB budget.
- **Less work per frame.** A cached sun shadow map redrawn only when casters change, a light motion chain with adaptive
  resolution on integrated GPUs, far room contents culled as a whole, and matrices recomputed only for objects that moved.
- **New worlds stay light.** The agent's guidelines and a weight check in every review round flag what only a world can
  avoid: identical pieces placed one by one (one instanced scatter instead), too many distinct finishes (each is a shader),
  more than two shadow-casting lamps.

</details>

[docs/PERFORMANCE.md](docs/PERFORMANCE.md) has the measurements before and after, every change and where it lives, what
was tried and rejected, and how to measure safely on your own machine.

## Reference

<details>
<summary><b>What you can make</b></summary>

<br>

- **Outdoor worlds and games.** Carved terrain with streams, lakes and
  footbridges, woods and ground cover, draped trails, physical sky and water.
  Collect-and-reach games, races with laps and checkpoints, story chapters,
  physics machines, a HUD, title, win and lose screens.
- **Characters from a sentence.** "A guard who patrols the gate and chases me
  when he sees me", "a shopkeeper who sells a key". NPCs have behaviour graphs,
  sight and hearing, factions and dialogue trees. The player and NPCs are
  rigged, animated human models (Microsoft Rocketbox, MIT) on one shared
  skeleton.
- **Architecture.** A building plan with storeys, rooms, doors, windows,
  fitted stairs, a roof and a site compiles into mitred walls with real
  openings, furnished rooms and gardens. A building check confirms every room
  is reachable on foot and every door swing is clear. Views: cutaway, exploded
  storeys, section cut, x-ray, and a floor plan with areas. In walk mode doors, drawers, taps and light switches work, and a mug
  can be picked up and thrown.
- **A room from a photo.** With a vision model connected, Aether reads the
  photo several times and merges the readings into one description. It builds
  the shell, the furniture and the decor, renders the result from the photo's
  camera, and a panel of AI judges compares render and photo item by item. The
  judges decide whether a round helped; the measured fidelity (openings,
  inventory, placement, colour) is shown as advice and never decides. The best
  state the judges preferred is kept, and a round they find worse is rolled
  back. The model also sets the room's light and colour from what it sees.
  Offline it says plainly that it cannot do this.
- **Graphics quality.** Settings → Graphics has Auto, Low, Medium, High and
  Ultra. Medium adds a composite pass and grain; High adds ambient occlusion,
  temporal anti-aliasing and contact shadows; Ultra adds reflections, sun
  shafts, glow and lens fringing. Medium and above soften sun shadows with
  distance from the caster (contact hardening); High, Ultra and stills add
  focus cascades around what you look at. On Auto, a performance
  governor first lowers the resolution and then gives up costs one at a time
  (baked light volume, cascades, post effects, particles) while frames stay
  slow. Choosing a tier yourself turns it off.
- **Block worlds.** Endless seeded voxel terrain with biomes, caves, ores and
  water, meshed in workers. A survival mode adds mining, crafting, health,
  hunger, day and night, and mobs.
- **Publishing.** A standalone web build of the game (a zip for any static
  host, or, from the local app, a deploy to your own Netlify, Vercel, GitHub
  Pages or itch.io account through their CLIs), share
  links that carry the whole world in the URL fragment, directed videos, 4K
  stills (including a path-traced still), GLB and glTF models, and floor plans
  as SVG or PDF.

</details>

### Connect an AI

| Option | Where | Cost per prompt |
| --- | --- | --- |
| **Codex on this computer** (ChatGPT login) | `aether start`: found automatically, or **Settings → AI connection → Sign in with ChatGPT** | your subscription |
| **Claude Code on this computer** | `aether start` with a signed-in `claude` CLI, or `npm run aether -- login --claude` | your subscription |
| **Codex / Claude Code for the hosted studio** | `curl -fsSL https://raw.githubusercontent.com/StarAtNyte/aether/main/scripts/get-aether.sh \| bash -s -- --origin https://aether-studio-lyart.vercel.app` (or `npm run aether -- start --origin …` from a clone), then enter the pairing code in the hosted studio | your subscription |
| **Hosted model** (the live site only) | the default on <https://aether-studio-lyart.vercel.app>: a small shared trial, rate limited | free to you |
| **Your own API key** (Anthropic, OpenAI, OpenRouter, Google Gemini) | **Settings → AI connection**. The browser calls the provider directly, and the key stays in the tab unless you choose to remember it | the provider's prices |
| **On-device model** (WebLLM, experimental) | Settings, WebGPU only, opt-in download | none |
| **Offline planner** (fallback, not the main path) | always available; reads English only and builds from a fixed vocabulary. The studio says when it is in use | none |

<details>
<summary><b>How local logins are sandboxed, and driving Aether from your agent (MCP)</b></summary>

<br>

When you use Codex or Claude Code locally, Aether runs your own login in a
worker process. Plain model calls run with every tool, shell, file and network
permission disabled. Deep build mode lets a coding agent write a new asset
generator inside a throwaway folder with the network off, and Aether
validates the result again before using it. The hosted studio never uses the
operator's account.

**Drive Aether from your agent (MCP).** `aether mcp` is an MCP server on stdio
with tools such as `create_world`, `edit`, `apply_patch`, `verify`,
`playtest`, `replay`, `render_still` and `export`:

```bash
claude mcp add aether -- node /abs/path/to/aether/apps/cli/bin/aether.mjs mcp --project-dir /abs/path/to/my-world
codex  mcp add aether -- node /abs/path/to/aether/apps/cli/bin/aether.mjs mcp --project-dir /abs/path/to/my-world
```

It works offline with the built-in planner. [docs/MCP.md](docs/MCP.md) has the
details.

</details>

<details>
<summary><b>The <code>aether</code> command</b></summary>

<br>

| Command | What it does |
| --- | --- |
| `aether start` (default) | Builds the studio if missing or stale, starts the server **detached**, prints `http://127.0.0.1:<port>` (4280 or the next free port). `--open`, `--port N`, `--no-build`, `--rebuild`, `--foreground`, `--origin URL` (also act as the bridge for a hosted studio) |
| `aether stop` / `status [--json]` / `logs [-f] [-n N]` | Stop, show status, read the log |
| `aether login [--device-auth] [--claude]` / `logout [--claude]` | Sign in to Codex with your own ChatGPT account, or to Claude Code |
| `aether pair` | A fresh pairing code and link for a hosted studio (needs `start --origin`) |
| `aether doctor` | Checks Node, dependencies, the build, the port, disk space, and both CLIs |
| `aether mcp [--project-dir DIR] [--provider auto\|offline\|local]` | MCP server on stdio, confined to one project folder |

The server binds 127.0.0.1 only. `--host 0.0.0.0` is refused without
`--allow-lan`, which adds an access token. State lives in
`$XDG_STATE_HOME/aether` or `~/.local/state/aether` (`%LOCALAPPDATA%\Aether`
on Windows). See [docs/SECURITY.md](docs/SECURITY.md).

</details>

<details>
<summary><b>Development, tests and configuration</b></summary>

<br>

| Command | What it does |
| --- | --- |
| `npm run typecheck` | `tsc --noEmit` across every package, app, script and test |
| `npm test` | All Vitest unit and integration tests (over 500 test files; no network) |
| `npm run smoke` | The real agent loop with the offline planner on every featured prompt plus block-world, architecture and asset prompts; every world is re-verified headless |
| `npm run bench` / `bench:quick` | The public benchmark ([docs/BENCHMARK.md](docs/BENCHMARK.md)); `bench:quick` fails when a documented claim stops holding |
| `npm run eval:edits` | Small-edit evaluation: 199 prompts over the default projects |
| `npm run build` then `npm run start` | Production build, then studio + API on one origin (port 8787) |
| `npm run e2e` | Playwright against the built studio: Chromium WebGPU, Chromium WebGL2, Firefox WebGL2 |
| `npm run e2e:verified` · `e2e:refine` · `e2e:arch` · `e2e:gameplay` · `e2e:publish` · `e2e:voxel` · `e2e:ux` | Focused browser suites (bot verification and repair, chat edits, architecture, playing flagships to the win, publishing, block worlds, UX) |
| `npm run showcase:bake` / `showcase:thumbs` / `showcase:photo-rooms` | Rebuild the featured worlds from their prompts; render their covers; rebuild the photo example rooms from their recorded runs |
| `npm run eval:photo` / `eval:design` | Replay the recorded photo-to-room runs; compare the AI design path with the offline planner |
| `npx tsx scripts/bot-probe.ts <world.json \| prompt:… \| plan:…>` | Run the playtest bot headless on one world and print timings |

Every script is in [`package.json`](package.json). For browsers, run
`npx playwright install chromium firefox` once. On a Linux machine without a
display, the Firefox suites run headed under `xvfb-run`
(`tests/e2e/support/firefox-gl.sh`).

Sharing a dev server through a tunnel (for example Cloudflare Quick Tunnel):
the dev and preview servers answer to `localhost` only. Name the tunnel host
once, comma separated, and start as usual:
`AETHER_DEV_ALLOWED_HOSTS=.trycloudflare.com npm run dev`. Vite accepts a
leading dot as a wildcard for subdomains. Point the dev proxy at a server on
another address with `AETHER_API_TARGET` (default `http://localhost:8787`).

Environment variables (`.env`, see `.env.example`) are documented in
[`apps/server/README.md`](apps/server/README.md#configuration) and
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). No key is required. The hosted
build has no server key at all.

</details>

<details>
<summary><b>Limits, stated plainly</b></summary>

<br>

- **Looks.** The renderer is real time. Flagships and generated worlds use PBR
  materials, HDR skies, baked light for interiors, AO and grading, but they
  are not a Blender Cycles still. Distant canyon walls show facets, some
  library models are stylised (kart drivers, farm animals), and flames are
  glowing cones. Software-GPU and weak machines (four cores or less) get the lower quality
  tiers.
- **The offline planner** reads English only and knows a fixed vocabulary
  (21 themes and 40+ library objects). In the benchmark it got 53 of 57
  in-vocabulary prompts fully right, but only 3 of 19 prompts outside its
  vocabulary. Anything ambitious needs a connected model.
- **Model runs take minutes.** With Codex, a forest game took 14 calls and
  222 s, and a house 16 calls and 270 s. A chat edit takes seconds to under a
  minute. Each call re-reads a cached prompt preamble of about 33k tokens.
- **The bot proves wins, not losses.** A won run shows that a game can be won.
  A lost run is not proof that it cannot be: the bot can still lose to enemies
  faster than the player, and it does not dodge during jumps. Blockfall's and
  Sakura River's own game loops are outside the general bot.
- **Replay checks** are deterministic re-simulation. They are not formal
  proofs, and a world with no tests passes trivially. A proof is tied to the
  engine version.
- **Photo-to-room** needs a vision model and minutes of calls. Measured
  fidelity in recorded runs was 0.78 to 0.84 (advisory; AI judges give the
  verdict). Vaulted ceilings, cornices,
  sash windows and some door styles cannot be built yet. The final item pass
  rate still varies from run to run (83 to 100% in the latest three runs).
- **Memory.** The heaviest worlds peak at about 4–4.7 GB in Chrome at ultra quality on an integrated GPU. On a machine with 8 GB of RAM or less, use the medium tier.
- **WebGPU and hardware.** The WebGPU path is tested on a few machines (an Intel integrated GPU and an NVIDIA card on Linux, plus software WebGPU in CI). Other GPUs, drivers and browsers may differ; the WebGL2 path is the fallback and the studio chooses it silently where WebGPU fails.
- **Live model checks.** The Codex and Claude Code paths were run live by hand on recorded prompts and photos; CI runs everything on the offline planner and never calls a paid model, so a provider-side change can break them without a red build.
- **Hosted studio:** a browser tab cannot run Codex. Use the bridge, your own
  key, or the offline planner.

</details>

<details>
<summary><b>Research inspirations</b></summary>

<br>

These papers shaped the ideas. No code, models, weights, datasets or assets
were copied from them.

| Work | What it inspired |
| --- | --- |
| PWM, [arXiv:2609.10540](https://arxiv.org/abs/2609.10540) | Explicit, code-defined world state as the source of truth, rendered live instead of by a video model |
| CoDeR, [arXiv:2609.26458](https://arxiv.org/abs/2609.26458) | Agents writing executable world code; the patch IR and generators written by a coding model |
| SceneMosaic, [arXiv:2609.05594](https://arxiv.org/abs/2609.05594) | Generate, validate, repair with physics stabilisation |
| PAT3D, [arXiv:2511.21978](https://arxiv.org/abs/2511.21978) | Simulation-in-the-loop settling (`settle`) |
| SceneSmith, [arXiv:2602.09153](https://arxiv.org/abs/2602.09153) | Designer, critic and orchestrator stages |
| Articraft, [arXiv:2605.15187](https://arxiv.org/abs/2605.15187) | Parts-and-joints SDK with an edit-execute-repair loop |
| ESG, [arXiv:2609.15392](https://arxiv.org/abs/2609.15392) | Machine-checkable scene timelines (`eventually`, `topples`) |
| WorldBench, [arXiv:2610.10622](https://arxiv.org/abs/2610.10622) | Grading worlds by running them: "physics as unit tests" |
| 3DCodeBench, [arXiv:2606.01057](https://arxiv.org/abs/2606.01057) | A small typed `GeneratorApi` and the base-at-ground convention |

</details>

## Documentation

| Document | What it covers |
| --- | --- |
| [USER_GUIDE.md](docs/USER_GUIDE.md) | Prompting, chat edits, play mode, badges, photo-to-room, publishing |
| [AGENT_TOOLS.md](docs/AGENT_TOOLS.md) | The tools the AI uses to build, look, measure and fix |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | How it works, package by package |
| [CONTRACTS.md](docs/CONTRACTS.md) | Public APIs, schemas, events |
| [PROOFS.md](docs/PROOFS.md) | Replay proof format, verifier, threat model |
| [BENCHMARK.md](docs/BENCHMARK.md) | Reproducible benchmark: winnability, edits vs regeneration, proof speed |
| [MCP.md](docs/MCP.md) | Aether as an MCP server |
| [GENERATION_BRIEF.md](docs/GENERATION_BRIEF.md) | The plan before a build and the richness review after it |
| [WRITEUP.md](docs/WRITEUP.md) | Product write-up: problem, approach, evidence, limits |
| [SECURITY.md](docs/SECURITY.md) | Threat model, sandboxes, local hardening |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md) | Vercel, local app, Docker, Fly.io, Render |
| [ASSETS.md](docs/ASSETS.md) · [THIRD_PARTY.md](docs/THIRD_PARTY.md) | Asset library, licences, credits, AI disclosure |
| [REVIEW_LOG.md](docs/REVIEW_LOG.md) | Engineering log: every stage with measurements and open issues |
| [PERFORMANCE.md](docs/PERFORMANCE.md) | Big worlds on a laptop: targets, measurements, every optimization, how to measure safely |
| [DESIGN.md](docs/DESIGN.md) · [WEBGPU.md](docs/WEBGPU.md) · [RESEARCH_LOG.md](docs/RESEARCH_LOG.md) | UI design, renderer notes, engine experiments |

## Project status

Aether is at **0.1.0, a pre-release**: the studio, engine, CLI, MCP server and bridge work end to end and are covered by
over 500 test files, a headless smoke run on every featured prompt and Playwright suites. The API surface (World IR,
package exports, MCP tools) can still change before a stable release. The change history is in [CHANGELOG.md](CHANGELOG.md)
and the measured detail in [docs/REVIEW_LOG.md](docs/REVIEW_LOG.md). The repository is private for now.

Contributions are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) and the
[code of conduct](CODE_OF_CONDUCT.md). What the non-`main` branches are: [docs/BRANCHES.md](docs/BRANCHES.md).

## Licence, third parties and AI disclosure

- **Licence:** [MIT](LICENSE), © 2026 Nitiz Khanal.
- **Third parties:** every dependency and every bundled asset (Kenney, Poly
  Haven and ambientCG CC0 models, textures and HDRIs; Microsoft Rocketbox
  characters under MIT; Quaternius farm animals under CC0; the Khronos glTF
  sample Fox, partly CC-BY 4.0 with its credit kept; fonts under OFL 1.1) is listed with its licence, source and credit line in
  [docs/THIRD_PARTY.md](docs/THIRD_PARTY.md). Only permissive licences are
  used. Real furnishings for interiors stream at run time from the
  [Amazon Berkeley Objects GLB pack](https://huggingface.co/datasets/codepawl/abo-glb) (CC BY 4.0; only a compact index is
  in the repository): "3D models by Amazon.com, Amazon Berkeley Objects (CC BY 4.0); web-optimised GLB by CodePawl". Worlds that
  use them carry that line in their credits, and published games carry it in `game.json` and `CREDITS.txt`. The IFC export's STEP writer is adapted from [Pascal Editor](https://github.com/pascalorg/editor) (MIT, © 2026 Pascal Group Inc.). In-app credits appear in the credits panel, on end-of-game screens and
  in exported `CREDITS.txt` files.
- **README images:** the photograph in the photo-to-room comparison is
  [Hotel bedroom windows (Unsplash)](https://commons.wikimedia.org/wiki/File:Hotel_bedroom_windows_(Unsplash).jpg)
  by Markus Spiske, CC0 1.0 (`tests/fixtures/photo/bedroom-cc0-hotel.jpg`).
- **AI disclosure:** this codebase was written with AI coding assistants
  under human direction and review. At runtime, the
  model you connect writes patches, generator code and scripts. All of it is
  validated, and code runs sandboxed (a locked-down worker pool for
  generators, QuickJS in WebAssembly for scripts). A few library assets were
  generated with AI; they are marked in
  [docs/THIRD_PARTY.md](docs/THIRD_PARTY.md).
