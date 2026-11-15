# Roadmap

What would turn Aether from a studio into a whole package. Most of the core already ships: prompt or photo to world,
editing, proofs, play, publishing and remix. What is missing is mostly the reasons people come back and bring others.
The items are ordered by impact within each group.

Status: **in progress**, **planned**, **open** (known defect).

## Bring people together

| # | Item | Status | Notes |
|---|---|---|---|
| 1 | **Shared visits** (multiplayer co-presence) | in progress: first version on Himalayan Valley (local app and self-hosted server) | Open a shared link and see who else is there as a VRM avatar, with names and chat. Position and pose only; the world itself stays the same for everyone. Done: versioned wire format, WebSocket relay in the server (16 per room), tab-to-tab transport for tests, Invite, names, chat, name tags (docs/USER_GUIDE.md section 9, docs/CONTRACTS.md "Shared visits"). Next: a hosted transport on Supabase Realtime so the static site gets it, more worlds, showing your chosen look on your own player. |
| 2 | **VR (WebXR)** | planned | Stand inside the hero worlds on a Quest headset: an XR session on the existing renderer, teleport movement, comfort vignette. |
| 3 | **Public gallery** | planned | A feed of worlds people made, creator pages, likes, remix counts and "remixed from" links. |

## Make each world feel finished

| # | Item | Status | Notes |
|---|---|---|---|
| 4 | **A soundscape for every world** | planned | Generated per world: wind, water that gets louder as you walk toward it, street noise, footsteps that change with the ground. |
| 5 | **Map and guided tour for large worlds** | planned | A small map with "you are here" and jump points. |
| 6 | **Photo mode** | planned | Free camera, time of day, depth of field, filters, then share. |
| 7 | **Live weather and time** | planned | Snow, rain and the sun moving while you explore, not only a slider in the editor. |

## Product basics

| # | Item | Status | Notes |
|---|---|---|---|
| 8 | **Accounts and cloud saves** | planned | A world follows you from laptop to phone. |
| 9 | **60-second first run** | planned | A visitor types one sentence and walks around their own world before any sign-up. |
| 10 | **Hosted plan** | planned | Credits for hosted generation; free local use with your own Claude Code or Codex login stays. |

## Known defects

| Item | Status |
|---|---|
| Grass grows through the floors inside the Linden Row houses | open |
| Himalayan Valley: a few props touch house walls; the waterfall pool is a narrow strip | open |
