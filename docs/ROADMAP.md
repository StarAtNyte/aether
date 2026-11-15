# Roadmap

What would turn Aether from a studio into a whole package. Most of the core already ships: prompt or photo to world,
editing, proofs, play, publishing and remix. What is missing is mostly the reasons people come back and bring others.
The items are ordered by impact within each group.

Status: **in progress**, **planned**, **open** (known defect).

## Bring people together

| # | Item | Status | Notes |
|---|---|---|---|
| 1 | **Shared visits** (multiplayer co-presence) | in progress: first version on Himalayan Valley and on any world published with the Multiplayer switch (local app, self-hosted server, and the hosted site over Supabase Realtime) | Open a shared link and see who else is there as a VRM avatar, with names and chat. Position and pose only; the world itself stays the same for everyone. Done: versioned wire format, WebSocket relay in the server (16 per room), tab-to-tab transport for tests, Invite, names, chat, name tags, outfit colours, a Supabase Realtime transport for the static hosted site (broadcast and presence, the relay's limits enforced in the client), a per-world Multiplayer switch in the Publish dialog (`game.json` and link `sharedVisits: true`, presence and chat only), a Multiplayer mark on Featured and Templates cards (docs/USER_GUIDE.md section 9, docs/CONTRACTS.md "Shared visits"). Next: more built-in worlds, showing your chosen look on your own player. |
| 1b | **Spatial voice in shared visits** | done (first version) | Peer-to-peer WebRTC audio in a full mesh, signalled over the shared-visit transport (`voice` and addressed `rtc` messages, added within protocol version 1; the relay forwards `rtc` to its one addressee, the tab and Supabase transports drop what is not for them). Positional through Web Audio (HRTF panner at the avatar's head, inverse distance from 2 m, silent by 40 m). Mic off until clicked, open mic or push-to-talk (V), mute and volume per person, speaking light on name tags. Up to 8 in voice; past that, text only. Public STUN only: networks that block direct UDP cannot connect (the UI says so); a TURN server, and an SFU for bigger rooms, are the next steps (docs/USER_GUIDE.md section 9, docs/CONTRACTS.md "Shared visits"). |
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
