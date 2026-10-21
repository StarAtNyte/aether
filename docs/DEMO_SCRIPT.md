# Aether demo video: script and shot list

Target length: 2 min 40 s (hard limit 3 min). Screen recording at 1920x1080, 60 fps, one take per segment, voice-over
recorded separately. Every beat below was exercised in the acceptance runs (`docs/REVIEW_LOG.md`); nothing here relies on
a feature that is not shipped. Record with Codex connected so the AI is visibly the brain, on a GPU machine at the
High tier.

## Before recording

- Fresh browser profile, studio on the hosted build, Codex selected as the AI.
- Warm the asset cache by opening each world once; keep the console closed.
- Prompts are typed live, not pasted, at a readable pace. Cut waiting with a speed ramp, never with a jump cut that hides
  a failure; show the elapsed time on screen when a build takes longer than 20 s.

## Beat sheet

| Time | Screen | Voice-over |
|---|---|---|
| 0:00 - 0:12 | Cold open: a flagship cover (Highland Trail) orbiting, then the prompt box | "Describe a world. Aether builds it, then proves it works." |
| 0:12 - 0:50 | Prompt: "a night forest adventure: collect 5 lanterns, avoid the wolves, reach the shrine on the hill". Show the AI planning, placing, the review renders with numbered marks, the final world | "The AI is the brain. It plans, places pieces with measuring tools, looks at its own renders and fixes what it sees." |
| 0:50 - 1:15 | The verified-playable badge, the bot's ghost replay, the sealed proof; then play it with the keyboard for 10 s | "A bot plays the level on a forked physics world, far faster than real time. The badge only appears after a real winning run." |
| 1:15 - 1:40 | Three chat edits: "make the wolves slower", "move the shrine onto the hill", "warmer lanterns". Show the one-line diff and Undo | "Edits are small patches, not regeneration. The shrine's light and goal move with it, and the proof re-runs." |
| 1:40 - 2:10 | Prompt: "a two-storey modern house with a pool, open-plan living room, kitchen and two bedrooms, people living in it". Exterior, doll's-house cutaway, walk inside, a resident takes the stairs, open a drawer and a door | "Same engine for architecture: real rooms, doors and stairs that work, rigged people with daily routines, and a walkthrough bot that checks every room is reachable." |
| 2:10 - 2:25 | Photo-to-room: drop the bedroom photo, show the checklist, the round-by-round fidelity score, the rebuilt room beside the photo | "Give it a photo and it reconstructs the room, then compares its render to the photo until they agree." |
| 2:25 - 2:40 | Montage of the featured worlds, then the repository, `aether-verify` on a published game, the MCP tool list | "Open source, offline-capable, verifiable by anyone. Aether: language in, a working world out." |

## What to say honestly

- The sealed proof is a deterministic replay check, not a formal proof.
- Quality: strong on the featured worlds; prompt-built worlds are good but not yet photographic. Do not claim
  parity with offline renderers.
- Offline mode works without an API key; the AI-driven build needs Codex, Claude Code or an API key.

## Shots to capture separately (b-roll)

Kart Canyon driving, Neon Rain City at night, Kyoto Temple, Orbital Lab, the interior of Skyline Penthouse, the
game-feel burst (damage flash, explosion, confetti), a resident on a stair, the Blockfall day and night cycle.

## Recording checklist

1. Run `npm run smoke` and open the hosted site; confirm the build is the latest commit.
2. Confirm the GPU is free (`nvidia-smi`); stop any other GPU job for the take.
3. Record segments in order; keep raw footage under `~/Videos/aether-demo/` (outside the repo).
4. Export H.264 1080p, under 3 minutes, captions burned in, music at -24 LUFS under the voice.
