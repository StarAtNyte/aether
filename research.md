# Victoria AR — Product and Research Brief

> Working document. Source links and time-sensitive facts were checked on 2026-09-10. The official hackathon Terms and Conditions prevail over this summary.

## 1. The challenge in one sentence

Build a **browser-based AI-native 3D application** that converts plain-language requests into **interactive 3D scenes and working logic**—not just a rendered image, video, or static 3D model.

Victoria VR's AI Builder Hackathon 2026 is a fully online international competition run by Victoria VR Group, a.s. Its official focus is browser-native creation tools and experiences: AI 3D scenes, intelligent NPCs/agents, procedural worlds, multimodal workflows, real-time interaction, and experimental interfaces.

### Official sources

- Hackathon announcement: <https://www.victoriavr.com/news/ai-builder-hackathon-2026-build-the-future-of-ai-native-3d-experiences-5915194b>
- Terms and Conditions: <https://www.victoriavr.com/hackathon/2026/terms>
- Privacy Policy: <https://www.victoriavr.com/hackathon/2026/privacy>
- Victoria VR AI Builder: <https://www.victoriavr.com/builder>

## 2. What Victoria VR is building

Victoria VR presents **VR AI Builder** as a no-code creation engine. Its stated vision is to turn natural-language prompts into 3D assets, textures, scenes, interaction logic, and complete worlds; let users edit through drag-and-drop, snapping, parametric controls, and visual logic blocks; then publish across PC, VR, AR, mobile, and web.

The product supports business/showroom/training use cases as well as games. Victoria VR positions AI Builder as a core ecosystem layer, alongside AI Avatars and AI Verse.

### Product implication

Do not try to rebuild the entire platform. Beat it on a narrow but convincing capability:

> **Prompt-to-persistent, physically coherent interactive worlds in the browser.**

The differentiator should be that generated worlds have inspectable state, obey constraints, remain coherent after edits, and are immediately playable—not merely visually attractive.

## 3. What the judges require

### Functional requirements

- The project must run in a web browser.
- It must transform plain/natural language into 3D scenes **and working logic**.
- A backend may run separately in cloud or on-premise, but must be operational during judging.
- Any browser rendering stack is allowed: Three.js, Babylon.js, WebGPU, React Three Fiber, custom engines, Unreal/Unity browser pipelines, etc.
- AI coding assistants, LLM APIs, open-source models, generative asset tools, and custom workflows are allowed.

### Required submission materials

1. Public code repository.
2. Hosted browser demo.
3. Demo video shorter than 3 minutes.
4. Short written description.
5. Selected focus category.
6. Any additional material requested by the organizer.

Public repository and demo must remain accessible throughout judging/publication. Material changes after the deadline require express permission.

### Evaluation signals

Judges can consider technical quality, originality, usefulness, UX, functionality, presentation, compliance, and overall value. They may test using prompts outside the chosen category. A narrow, reliable vertical slice is better than an unconvincing broad platform.

### Schedule and prizes

All official times are CEST (UTC+2).

| Milestone | Time |
| --- | --- |
| Registration opened | 10 July 2026, 16:00 |
| Registration closed | 8 September 2026, 16:00 |
| Build period | 11 September, 16:00 – 11 November 2026, 16:00 |
| Submission deadline | 11 November 2026, 16:30 |
| Winners announced | 25 November 2026, 16:45 |

Prize pool: EUR 20,000 — EUR 10,000 / 5,000 / 3,000 / 1,500 / 500 for places 1–5.

## 4. Recommended product: Victoria AR

### Product promise

**Describe a world. Enter it. Change it. Trust that it still makes sense.**

Victoria AR is a browser-native AI world builder for interactive rooms/small worlds. A user writes a request such as:

> “Make a cozy reading room with a desk by the window, a chair facing it, warm lamps, and a librarian who recommends books.”

The application creates a playable Three.js scene, shows the generated plan, checks physical and semantic constraints, and lets the user change it with follow-up prompts:

> “Move the desk away from glare, add two visitors, and make the librarian remember my last recommendation.”

### Why this is better than a generic prompt-to-3D demo

| Generic generator | Victoria AR |
| --- | --- |
| Outputs an image/video or arbitrary meshes | Renders a live, browser-native 3D world |
| World state is implicit or disposable | Explicit scene graph and persistent state |
| Objects may float/collide | Validated support, collision, containment, and spacing rules |
| Prompt results are opaque | “World plan” panel explains objects, relations, rules, and repairs |
| Follow-up edits regenerate unpredictably | Edit only affected entities while preserving identifiers/relationships |
| NPC is scripted dialogue | NPC has a state-backed role, memory, triggers, and actions |

### Minimum compelling demo

Build a polished “interactive room generator,” not a full metaverse.

1. Prompt input and three curated starter prompts.
2. A world-planning phase that streams a structured scene plan.
3. A playable first/third-person 3D room using licensed, web-ready GLB assets or procedural primitives.
4. A visible validation/repair panel: e.g., “chair repositioned to face desk; shelf moved to prevent wall collision.”
5. Natural-language edit loop that updates only relevant objects.
6. One NPC with a visible role and persistent memory/action state.
7. “Generate three layouts” feature, with physically valid alternatives.

## 5. Runtime architecture

“Browser-based” describes the user-facing application. Large models can and should run behind a backend/API; they do not need to run in the browser.

```text
Browser (React + Three.js / React Three Fiber)
  - UI, prompt editor, world-plan inspector
  - rendering, navigation, interactions, local state view
  - loads GLB/procedural assets and applies scene updates
                 |
                 v
Backend / API
  - authenticates/rate-limits requests and protects API keys
  - calls LLM with strict JSON schema
  - validates, repairs, and persists canonical world state
  - returns scene-delta JSON and approved asset IDs
                 |
                 v
LLM and optional specialist services
  - interprets prompts, generates scene plans and NPC actions
  - does NOT directly execute arbitrary code in the client
```

### Model roles

- **Build-time:** Codex helps write/review the code. It is not the deployed runtime model.
- **Runtime planner:** an LLM API (OpenAI, Anthropic, Google, or self-hosted) returns a strict typed scene specification. An OpenAI starting point is a balanced general model such as GPT-5.6 Terra; use a lower-cost model such as GPT-5.6 Luna for simpler/high-volume requests. See <https://developers.openai.com/api/docs/models>.
- **Runtime critic/repair:** can be the same LLM with focused context, or deterministic constraint code first with the LLM only handling ambiguous semantic repairs.
- **Optional asset/image generation:** asynchronous and non-critical. Do not make the primary demo depend on slow asset generation.

### Example scene schema

```json
{
  "scene": { "id": "reading-room-01", "theme": "cozy reading room" },
  "entities": [
    {
      "id": "desk-1",
      "asset": "oak_desk",
      "position": [1.2, 0, -2.1],
      "rotationY": 1.57,
      "tags": ["furniture", "work-surface"]
    },
    {
      "id": "chair-1",
      "asset": "armchair",
      "position": [1.2, 0, -1.25],
      "relations": [{ "type": "faces", "target": "desk-1" }]
    }
  ],
  "rules": [
    { "type": "supported_by", "subject": "chair-1", "target": "floor" },
    { "type": "clearance", "subject": "chair-1", "minimumMeters": 0.6 }
  ],
  "agents": [
    {
      "id": "librarian-1",
      "role": "librarian",
      "memory": { "lastRecommendation": null },
      "triggers": ["player_nearby", "player_asks_for_book"]
    }
  ]
}
```

Never let the model return executable JavaScript for the browser. It returns a constrained declarative plan; the app maps known asset IDs, rule types, and behavior primitives into safe code.

## 6. Research: Programmable World Model (PWM)

### Source

- Project page: <https://alaya-lab.github.io/pwm/>

### Key idea

PWM is an **explicit-state-driven world-model framework**. It separates state maintenance/evolution from generating visual observations:

```text
reference image + natural language
  -> VLM agent writes executable world specification
  -> state executor maintains canonical entity/rule state
  -> deterministic compiler converts state-augmented 3D OBBs into pixel controls
  -> video model renders observations
```

PWM argues that video-world models can make plausible frames but are weak world engines: hidden state is difficult to inspect or alter; entity-level control is missing; and off-screen entities/facts are easily lost. Its response is explicit world state, rules, event triggers, persistent off-screen entities, and deterministic state-to-render controls.

### Relevance to Victoria AR

This is the central conceptual reference. Adopt its **state architecture**, not its heavy video-generation stack.

| PWM concept | Victoria AR implementation |
| --- | --- |
| Canonical explicit state | JSON world graph persisted by backend/client store |
| State executor | Deterministic TypeScript reducer + behavior/rule engine |
| Entity OBBs and projection compiler | Three.js object bounding boxes + collision/raycast/placement utilities |
| VLM agent writes world program | LLM returns schema-validated scene plan and safe deltas |
| Video renderer | Real 3D renderer (Three.js), therefore native interaction and inspectability |
| Off-screen persistence | World graph stays authoritative regardless of camera position |

### Why not deploy PWM itself

PWM's full system is a research-grade, GPU-heavy server pipeline that produces video observations, not native browser meshes and interactions. It would introduce latency and infrastructure risk, and it may use assets/code whose licence is unsuitable for this hackathon's commercial/promotional licence requirements. It is inspiration and a research citation, not a core dependency.

## 7. Research: SceneMosaic

### Source

- Paper: [SceneMosaic: Efficient and Diverse Simulation-Ready Scene Generation via Hybrid Agentic Layout Evolution](https://arxiv.org/pdf/2609.05594)
- Project page stated by the paper: <https://rxjfighting.github.io/SceneMosaic>
- Code stated by the paper: <https://github.com/rxjfighting/SceneMosaic>

### Key idea

SceneMosaic targets simulation-ready indoor scenes. It combines fast image-based object/layout initialization with slower agentic refinement to gain efficiency and physical/semantic validity. It:

1. Builds an object inventory, object masks/meshes, room structure, and relationships.
2. Represents the scene as local sub-scenes organized in a hierarchical scene tree.
3. Stabilizes layouts through containment correction, gravity simulation, collision handling, and support checks.
4. Runs a Critic–Actor loop: a critic identifies spatial/semantic faults; an actor repairs positions/rotations.
5. Generates local layout variants independently, combines them, and selects a diverse final set using a novelty metric.

The paper reports semantic-layout quality comparable to its strongest agentic baseline with a claimed 24x speed-up on its evaluation, while reducing physical violations. It remains a research pipeline, not a browser-ready real-time dependency.

### Relevance to Victoria AR

SceneMosaic provides the product's quality strategy: **generate, validate, repair, and vary**, rather than accepting the first LLM layout.

| SceneMosaic concept | Hackathon-scale implementation |
| --- | --- |
| Object inventory and semantic relations | LLM JSON schema with known asset catalog and relations |
| Local layout units | Room zones: desk zone, seating zone, shelf zone, etc. |
| Physics stabilization | Rapier or simple AABB/OBB checks, floor support, wall bounds, clearance rules |
| Critic–Actor loop | Deterministic validator emits failures; targeted LLM repair returns an entity delta |
| Diverse variants | Generate 3 candidate layout seeds; score/validate them; let user select one |
| Orthographic spatial reasoning | Use top-down plan rendering for deterministic placement validation/debugging |

### Design principle to retain

Use the LLM for semantic judgement (“a reading chair should face the desk and not block the door”), but use deterministic code for geometry, collisions, support, bounds, and serialization. This is faster, cheaper, safer, and demonstrably more reliable.

## 8. Build plan

### Phase 1 — prove the core loop

- React + TypeScript + Vite.
- React Three Fiber / Drei for the scene.
- A fixed asset catalog of primitives and/or properly licensed GLBs.
- One generated room archetype; prompt -> strict scene JSON -> browser renderer.
- Top-down debug/plan view and first-person navigation.

### Phase 2 — make it trustworthy

- Typed world graph and delta protocol.
- Collision, bounds, floor support, containment, and clearance validators.
- Deterministic first repair, then optional LLM repair.
- “Why this changed” UI based on validation output.

### Phase 3 — make it memorable

- Three valid scene-layout alternatives.
- Follow-up prompt editing that preserves unchanged entity IDs and relationships.
- A librarian/guide NPC with a tiny state machine and persistent memory.
- Demo flow that visibly proves off-screen persistence and rule-triggered changes.

### Demo narrative (under 3 minutes)

1. Type a room/world prompt.
2. Show the structured world plan forming.
3. Enter the generated room in the browser.
4. Open the validation panel and explain an automatic repair.
5. Ask for an edit; show that the relevant area changes while the rest persists.
6. Interact with the NPC; trigger an event and show remembered state.
7. Switch to a validated alternative layout.

## 9. Technical and legal guardrails

### Reliability

- Keep API keys only on the backend.
- Validate all LLM output against a strict schema.
- Restrict the model to a known asset catalog and action vocabulary.
- Do not execute model-generated code.
- Ensure the demo works without GPU-dependent generation or long background jobs.
- Keep a deterministic fallback scene for demos if an AI provider is unavailable.

### Hackathon compliance

- Public repo and hosted demo are required.
- Credit every third-party library, model, asset, data set, API, AI-generated asset/code, and paid marketplace component with source and licence/terms.
- Only use materials whose licences allow the organizer's public, commercial, promotional, research, evaluation, and sublicensable use.
- Avoid non-commercial/personal-only/evaluation-only terms and incompatible copyleft/share-alike/source-available components unless organizer approval is explicit and written.
- Do not include confidential employer/client/university data or credentials.

### Major rights consideration

Participants retain ownership but grant Victoria VR a non-exclusive, worldwide, royalty-free, fully paid-up, perpetual, irrevocable, transferable, sublicensable licence to use, modify, distribute, test, evaluate, promote, research, and make derivative works from submissions for extensive hackathon and commercial/strategic purposes. The licence survives deletion or withdrawal. Read the official Terms before submitting.

## 10. Decision

The strongest direction is not “an AI that generates pretty 3D scenes.” It is:

> **A programmable, persistent world builder: natural language produces an explicit, editable, physically coherent 3D world that users can immediately enter and interact with in the browser.**

PWM supplies the explicit-state thesis. SceneMosaic supplies the physical-validity and layout-variation playbook. Victoria AR supplies the browser-native product experience that makes both ideas tangible and judgeable.
