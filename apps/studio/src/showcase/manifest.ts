/**
 * THE single place that lists the bundled default projects (the projects
 * home's Featured gallery and "Start from a template" row, the Templates page, the command
 * palette and the agent's empty state all read it).
 *
 * Curate here:
 *   - reorder entries to reorder every list (array order is display order);
 *   - `curation: 'featured'` shows an entry in the home page's Featured gallery
 *     (the first is the large lead card, the next two sit beside it; keep it to
 *     about 7: the best published worlds, one of each kind where possible), at
 *     the top of the Templates page and in the agent's empty state;
 *     `'candidate'` lists it under "More worlds" (and in the home template row);
 *     `'hidden'` keeps its files but shows it nowhere (and `#/new/<slug>`
 *     still works for old links).
 *
 * Each entry ships two static files, loaded lazily:
 *   - `public/templates/<slug>.webp` — card thumbnail (≤ 30 KB, eager on the home page);
 *   - `public/templates/worlds/<slug>.json` — the saved world (fetched only when opened).
 * `npm run showcase:bake` regenerates the worlds from `prompt` with the
 * offline planner; `npm run showcase:thumbs` makes the thumbnails (flagships
 * from a fresh render, gallery entries from their `shot`).
 */

/** Template category (shown as a neutral label). */
export type TemplateKind = 'scene' | 'physics' | 'game' | 'story' | 'architecture';

/** Where an entry is shown (see the file comment). */
export type Curation = 'featured' | 'candidate' | 'hidden';

/** How a generated world was made: the offline planner (no AI connected), or a live run with a connected Claude Code or Codex login. */
export type Provenance = 'offline-planner' | 'claude-code' | 'claude-api' | 'codex';

/** Card text for each way a world can have been generated. */
export const PROVENANCE_LABEL: Readonly<Record<Provenance, string>> = Object.freeze({
  'offline-planner': 'Built by the offline planner (no AI connected)',
  'claude-code': 'Generated live by Claude Code',
  'claude-api': 'Generated live by Claude (API)',
  codex: 'Generated live by Codex',
});

/** Card line for a film: a real Cycles render made through the local Blender harness (procedural, no outside assets). */
export const FILM_PROVENANCE = 'Local run · Blender';

/**
 * A short film instead of a saved world (`origin: 'film'`, `kind: 'story'`): it is listed in Stories, opens a video
 * player and has no Remix or editor. Files live in `public/stories/<slug>/` (each ≤ 6 MB, poster ≤ 60 KB);
 * `scripts/stories/add-film.ts` copies them in and adds the entry.
 */
export interface FilmInfo {
  /** URL of the 1280x720 WebP poster (also the card image). */
  poster: string;
  /** H.264 MP4 (the fallback source). */
  mp4: string;
  /** WebM (tried first). */
  webm: string;
  /** Duration in seconds. */
  seconds: number;
  /** Credit line shown under the player. */
  credit: string;
  /** What the footage is (shown under the credit). */
  note: string;
}

/** One bundled default project. */
export interface ShowcaseEntry {
  /** URL-safe id (`#/new/<slug>`, file names). */
  slug: string;
  /** Card title. */
  title: string;
  /** One-line description for cards. */
  description: string;
  /** The prompt the world was built from (typing it in the chat rebuilds it). Empty for a film. */
  prompt: string;
  kind: TemplateKind;
  curation: Curation;
  /**
   * 'flagship': an art-directed showcase world; 'gallery': a saved gallery render; 'photo': an example room rebuilt from a photograph;
   * 'agent': a world the agent generated from the prompt in a recorded run, stored as it came out (re-validated and re-verified by
   * `showcase:bake`, not re-planned); 'blender': a world assembled around pieces modelled and baked in Blender by the scripts in
   * `scripts/blender/<slug>/` (procedural only), stored as built (re-validated and re-verified, not re-planned).
   */
  origin: 'flagship' | 'gallery' | 'photo' | 'agent' | 'blender' | 'film';
  /** Required for `origin: 'film'` (and only there): the footage; there is no world, so no thumbnail, saved world or publish row. */
  film?: FilmInfo;
  /** Required for `origin: 'agent'`: how the stored world was made (shown on the card). */
  provenance?: Provenance;
  /** Gallery screenshot (in docs/screenshots/gallery) the thumbnail was cut from. */
  shot?: string;
  /** For `origin: 'photo'`: the photograph the room was rebuilt from (credit, licence, source page; see docs/THIRD_PARTY.md). */
  photo?: PhotoCredit;
  /** Games: opening the template goes straight into play mode, so the game's title card is the first screen. */
  launch?: boolean;
}

/** Credit of the photograph an example room was rebuilt from (permissive licences only). */
export interface PhotoCredit {
  /** Fixture id of the photo (tests/fixtures/photo/<file>). */
  file: string;
  author: string;
  licence: string;
  /** Page of the photograph. */
  url: string;
}

/** Every bundled default project, in display order. */
export const SHOWCASE: readonly ShowcaseEntry[] = Object.freeze([
  // --- Flagships -------------------------------------------------------------------
  // --- Featured on the home page (best first: the lead, then the side pair, then the row) ---
  { slug: 'cloudwatch-harbour', title: 'Cloudwatch Harbour', kind: 'story', curation: 'featured', origin: 'blender', description: 'An anime short: a harbour town at summer dusk, painted. Watch the film, then step in and play as the character.', prompt: 'Cloudwatch Harbour at summer dusk' },
  { slug: 'morning-kitchen', title: 'Morning Kitchen', kind: 'story', curation: 'candidate', origin: 'film', description: 'A render, not a recording: a stone-kitchen corner built and lit procedurally in Blender (Cycles, no downloaded assets) through Aether\'s local harness, 10 seconds at 1080p.', prompt: '', film: { poster: '/stories/morning-kitchen/poster.webp', mp4: '/stories/morning-kitchen/morning-kitchen.mp4', webm: '/stories/morning-kitchen/morning-kitchen.webm', seconds: 10, credit: 'Made by Aether: Blender and Cycles, driven through Aether\'s Blender harness', note: 'Rendered on a local GPU' } },
  { slug: 'sanctuary-falls', title: 'Sanctuary Falls', kind: 'scene', curation: 'featured', origin: 'agent', provenance: 'claude-code', description: 'A cliff sanctuary framed as one view, built in hardcore mode: arrive on a stone quay over a turquoise lagoon, climb the marble stair up a limestone cliff between three waterfalls to a Doric temple and a colossal goddess, with cypresses, villas and snowy mountains behind.', prompt: 'A classical cliff sanctuary as one postcard view: a lagoon quay, a limestone cliff with three waterfalls, a marble stair, a Doric temple and a colossal goddess statue, golden-hour light' },
  { slug: 'dusk-lake-house', title: 'Dusk House by the Lake', kind: 'architecture', curation: 'featured', origin: 'flagship', description: 'A glass house lit from inside at dusk — explode it, cut it, walk to the jetty.', prompt: 'Dusk House by the Lake: a two-storey glass house with a pool terrace and a jetty, lit at dusk' },
  { slug: 'lisbon-hills', title: 'Lisbon Hills', kind: 'scene', curation: 'featured', origin: 'agent', provenance: 'claude-api', description: 'A terraced Lisbon hillside to walk: pastel townhouses in real plaster, tile and stone, cobbled streets and stairs up to a castle, a tram line, and a quay with boats under a red suspension bridge. Every street, plaza and stair is reachable on foot.', prompt: 'A large walkable and driveable Lisbon hillside district with terraced streets, pastel azulejo townhouses, trams, squares, a castle on the crest, a river with quays and a red suspension bridge' },
  { slug: 'highland-trail', title: 'Highland Trail', kind: 'game', curation: 'featured', origin: 'flagship', description: 'A river valley at first light: log six survey stakes, cross the footbridge and climb to the summit before the daylight runs out.', prompt: 'Highland Trail: a realistic hiking game in a misty river valley with a trail, a footbridge, six survey stakes and a summit cairn' },
  { slug: 'kestrel-outpost', title: 'Kestrel Outpost', kind: 'game', curation: 'featured', origin: 'flagship', launch: true, description: 'A third-person shooter: hold a cliff-ringed relay outpost against five waves of raiders at golden hour.', prompt: 'Kestrel Outpost: a third-person shooter where you defend a mountain relay outpost against five waves of raiders coming through three passes' },
  { slug: 'lantern-isles', title: 'Lantern Isles', kind: 'game', curation: 'candidate', origin: 'flagship', description: 'Find twelve lost lanterns across floating islands at golden hour.', prompt: 'Lantern Isles: an exploration game on floating islands at golden hour — find the twelve lost lanterns' },
  { slug: 'hollow-gate', title: 'The Hollow Gate', kind: 'game', curation: 'candidate', origin: 'flagship', description: 'Earn gold, buy the key, sneak past the guard and outwit the wolves — every character is a prompt.', prompt: 'The Hollow Gate: a walled hamlet at night with a locked gate, a patrolling guard, a shopkeeper who sells the key and a wolf pack that fears fire' },
  { slug: 'chain-reaction', title: 'Chain Reaction', kind: 'physics', curation: 'candidate', origin: 'flagship', description: 'Five Rube-Goldberg machines set each other off — every bounce verified.', prompt: 'Chain Reaction: five Rube-Goldberg machines wired into one physics chain reaction' },
  { slug: 'kart-canyon', title: 'Kart Canyon', kind: 'game', curation: 'candidate', origin: 'flagship', description: 'Three laps of a sandstone canyon: checkpoints, boost pads and two rivals.', prompt: 'Kart Canyon: an arcade kart race with three laps, checkpoints and boost pads in a sandstone canyon' },
  { slug: 'blockfall', title: 'Blockfall', kind: 'game', curation: 'candidate', origin: 'flagship', description: 'Mine, craft and survive the night in an endless block world.', prompt: 'Blockfall: a voxel survival sandbox with a village, a castle, crafting, mobs and a day/night cycle' },
  { slug: 'neon-rain-city', title: 'Neon Rain City', kind: 'game', curation: 'candidate', origin: 'flagship', description: 'A rain-soaked downtown at night, lit window by window — find the five neon cats.', prompt: 'Neon Rain City: a rain-soaked downtown at night with neon signs, wet streets and traffic' },
  { slug: 'kyoto-temple', title: 'Kyoto Temple Lanterns', kind: 'story', curation: 'candidate', origin: 'flagship', description: 'Rain on a thousand torii: a story in four chapters and a silent bell.', prompt: 'Kyoto Temple Lanterns: a story in four chapters on a rainy temple hill at dusk, with torii gates and lanterns' },
  { slug: 'painterly-meadow', title: 'Painterly Meadow', kind: 'scene', curation: 'candidate', origin: 'flagship', description: 'A steam train circles a wildflower valley on a summer morning.', prompt: 'Painterly Meadow: a steam train circling a wildflower valley on a summer morning, with a windmill and grazing animals' },
  { slug: 'four-seasons-garden', title: 'Four-Seasons Garden', kind: 'scene', curation: 'candidate', origin: 'flagship', description: 'Blossom, green, fire and frost around a koi pond — switch seasons with 1–5.', prompt: 'Four-Seasons Garden: a Japanese garden with a koi pond whose four quarters live in four seasons' },
  { slug: 'orbital-lab', title: 'Orbital Lab', kind: 'game', curation: 'candidate', origin: 'flagship', description: 'Bound through a low-gravity station above a blue planet to restart its reactor.', prompt: 'Orbital Lab: a low-gravity space station with motor-driven machines — recover five power cells and restart the reactor' },
  { slug: 'sakura-river', title: 'Sakura River Journey', kind: 'game', curation: 'candidate', origin: 'flagship', description: 'Paddle a canoe through four seasons of blossom, waterfalls and snow.', prompt: 'Sakura River Journey: a canoe ride down a cherry-blossom river through the four seasons' },
  { slug: 'casa-patio', title: 'Casa del Patio', kind: 'architecture', curation: 'candidate', origin: 'flagship', description: 'A courtyard house above Sintra: walk the rooms, then open every drawer.', prompt: 'Casa del Patio: a courtyard house in the hills above Sintra with a stone patio and a lap pool' },
  { slug: 'skyline-penthouse', title: 'Skyline Penthouse', kind: 'architecture', curation: 'candidate', origin: 'flagship', description: 'A rooftop penthouse at golden hour: walk it, switch lights, change the hour.', prompt: 'Skyline Penthouse: a three-bedroom penthouse with a terrace pool above a sunset city' },
  // --- Saved gallery worlds ----------------------------------------------------------
  { slug: 'lakeside-camp', title: 'Lakeside camp', kind: 'scene', curation: 'hidden', origin: 'gallery', shot: 'a-cozy-lakeside-camp-at-sunset.png', description: 'Sunset camp with a campfire, tents and fireflies.', prompt: 'A cozy lakeside camp at sunset with a campfire, tents and fireflies' },
  { slug: 'canyon-of-colossi', title: 'Canyon of colossi', kind: 'scene', curation: 'hidden', origin: 'gallery', description: 'A million trees and ancient statues: 200M+ triangles, drawn by the screen.', prompt: 'A canyon with a million trees and ancient statues' },
  { slug: 'medieval-village', title: 'Medieval village', kind: 'scene', curation: 'hidden', origin: 'gallery', shot: 'a-medieval-village-with-a-windmill.png', description: 'Windmill, market stalls and a patrolling guard.', prompt: 'A medieval village with a windmill, market stalls and a patrolling guard' },
  { slug: 'haunted-forest', title: 'Haunted forest', kind: 'story', curation: 'hidden', origin: 'gallery', shot: 'haunted-forest-at-night-with-fog.png', description: 'Foggy woods at night and a storyteller.', prompt: 'Haunted forest at night with fog and an NPC who tells a story' },
  { slug: 'coin-island', title: 'Coin island', kind: 'game', curation: 'hidden', origin: 'gallery', shot: 'a-coin-collecting-game-on-a.png', description: 'Collect 10 coins on a tropical island in 60 s.', prompt: 'A coin collecting game on a tropical island — collect 10 coins in 60 seconds' },
  { slug: 'obstacle-course', title: 'Obstacle course', kind: 'game', curation: 'hidden', origin: 'gallery', shot: 'obstacle-course-with-moving-platforms-lava.png', description: 'Moving platforms, lava and a goal flag.', prompt: 'Obstacle course with moving platforms, lava and a goal flag' },
  { slug: 'domino-run', title: 'Domino run', kind: 'physics', curation: 'hidden', origin: 'gallery', shot: 'build-a-domino-run-that-knocks.png', description: 'A chain of dominoes that topples a bell tower.', prompt: 'Build a domino run that knocks over a bell tower' },
  { slug: 'bowling-alley', title: 'Bowling alley', kind: 'physics', curation: 'hidden', origin: 'gallery', shot: 'bowling-alley-knock-down-a-pyramid.png', description: 'Knock down a pyramid of 15 crates.', prompt: 'Bowling alley: knock down a pyramid of 15 crates with a heavy ball' },
  { slug: 'asteroid-field', title: 'Asteroid field', kind: 'physics', curation: 'hidden', origin: 'gallery', shot: 'low-gravity-asteroid-field-with-glowing.png', description: 'Low gravity rocks and glowing crystals.', prompt: 'Low-gravity asteroid field with glowing crystals' },
  { slug: 'apartment', title: 'Two-bedroom apartment', kind: 'architecture', curation: 'hidden', origin: 'gallery', shot: 'arch-a-modern-two-bedroom-apartment-overview.png', description: 'A furnished modern apartment you can walk through.', prompt: 'a modern two-bedroom apartment' },
  { slug: 'villa-pool', title: 'Villa with a pool', kind: 'architecture', curation: 'hidden', origin: 'gallery', shot: 'arch-a-two-storey-villa-with-a-overview.png', description: 'Two storeys, a stair, a terrace and a pool.', prompt: 'a two-storey villa with a pool' },
  { slug: 'cafe-interior', title: 'Café interior', kind: 'architecture', curation: 'hidden', origin: 'gallery', shot: 'arch-a-small-caf-interior-overview.png', description: 'A corner café with a counter, kitchen and washroom.', prompt: 'a small café interior' },
  { slug: 'office-floor', title: 'Office floor', kind: 'architecture', curation: 'hidden', origin: 'gallery', shot: 'arch-an-office-floor-with-meeting-rooms-overview.png', description: 'Open office, meeting rooms, reception and break room.', prompt: 'an office floor with meeting rooms' },
  { slug: 'scandinavian-living', title: 'Scandinavian living room', kind: 'architecture', curation: 'hidden', origin: 'gallery', shot: 'arch-scandinavian-living-room-with-a-fireplace-overview.png', description: 'A bright living room around a fireplace.', prompt: 'scandinavian living room with a fireplace' },
  { slug: 'survival-world', title: 'Survival world', kind: 'game', curation: 'hidden', origin: 'gallery', shot: 'a-minecraft-like-survival-world.png', description: 'Endless block terrain: mine, craft and survive the night.', prompt: 'a minecraft-like survival world' },
  { slug: 'forest-camp', title: 'Forest camp', kind: 'scene', curation: 'hidden', origin: 'gallery', shot: 'a-cozy-forest-camp-with-a.png', description: 'Tents around a campfire under the pines.', prompt: 'a cozy forest camp with a campfire and tents' },
  { slug: 'domino-bell', title: 'Domino bell', kind: 'physics', curation: 'hidden', origin: 'gallery', shot: 'a-domino-run-that-knocks-over.png', description: 'A rainbow domino chain that rings a bell.', prompt: 'a domino run that knocks over a bell' },
  { slug: 'coin-rush', title: 'Coin rush', kind: 'game', curation: 'hidden', origin: 'gallery', shot: 'a-coin-collecting-game-grab-8.png', description: 'Grab 8 coins before time runs out.', prompt: 'a coin collecting game: grab 8 coins before time runs out' },
  // --- Worlds generated by the agent (saved as generated; open one and change it by chat) ---
  { slug: 'pool-house', title: 'Modern pool house', kind: 'architecture', curation: 'candidate', origin: 'agent', provenance: 'offline-planner', description: 'A two-storey modern house with a pool garden, open-plan living and two bedrooms, lived in by residents.', prompt: 'a two-storey modern house with a pool, an open-plan living room and kitchen, 2 bedrooms and residents' },
  { slug: 'cosy-apartment', title: 'Cosy two-bedroom apartment', kind: 'architecture', curation: 'candidate', origin: 'agent', provenance: 'offline-planner', description: 'A furnished two-bedroom apartment with an open living room, kitchen and bathroom you can walk through.', prompt: 'a cozy two-bedroom apartment' },
  { slug: 'scandi-living-room', title: 'Scandi living room with a fireplace', kind: 'architecture', curation: 'candidate', origin: 'agent', provenance: 'offline-planner', description: 'A bright living room with a fireplace, a sofa and two armchairs, and pale oak floors.', prompt: 'a Scandinavian living room with a fireplace' },
  { slug: 'linden-row', title: 'Linden Row', kind: 'architecture', curation: 'featured', origin: 'agent', provenance: 'claude-api', description: 'A new neighbourhood of ten real family houses round a village green: white-rendered and timber, brick terraces and two modern glass houses, each with its own plan, furnished and lit rooms you can walk into, plus a community hall with a cafe.', prompt: 'Build Linden Row: a new residential colony of ten real family houses around a village green, each a real building with its own plan, furnished and lit rooms, front gardens, streets and a community hall with a cafe.' },
  { slug: 'kepler-base', title: 'Kepler Base', kind: 'game', curation: 'candidate', origin: 'agent', provenance: 'claude-api', description: 'A Mars colony to walk and drive through: habitat domes linked by glass corridors and airlocks, a greenhouse, a command centre, a solar farm and turbines. The base has lost power: switch on the three solar arrays, then send the distress call.', prompt: 'Build Kepler Base: a large Mars colony a visitor can walk and drive through, with domes, corridors, airlocks, a greenhouse, a command centre, a workshop with a rover, a solar farm; the power is out and the player must restore it and send a distress call.' },
  { slug: 'starlight-cinema', title: 'Starlight Cinema', kind: 'architecture', curation: 'candidate', origin: 'agent', provenance: 'codex', description: 'A brick cinema with raked red seating, acoustic walls, a screen and stage, a projection booth and a lit lobby: 177 pieces with crafted seats, steps and panels.', prompt: 'make a cinema hall' },
  { slug: 'orion-cinema', title: 'Orion Cinema', kind: 'architecture', curation: 'candidate', origin: 'agent', provenance: 'claude-code', description: 'A cinema hall with tiered red seats, a painted screen with curtains, aisle lights and a lobby behind a lit canopy entrance.', prompt: 'a cinema hall' },
  { slug: 'evening-bistro', title: 'Evening Bistro', kind: 'architecture', curation: 'candidate', origin: 'agent', provenance: 'claude-code', description: 'A brick bistro with laid tables, pendant lamps, a bar and a kitchen, lit for the evening.', prompt: 'a restaurant' },
  { slug: 'cliff-sanctuary', title: 'Cliff Sanctuary', kind: 'scene', curation: 'candidate', origin: 'agent', provenance: 'claude-code', description: 'Work in progress: the classical cliff sanctuary after hardcore pass 6 (detail). A marble temple and a colossal goddess on a limestone cliff over a lagoon, an aqueduct, cypresses and snowy mountains.', prompt: 'A classical cliff sanctuary: a marble temple and colossal statue on a limestone cliff above a turquoise lagoon, waterfalls, cypresses, snowy mountains' },
  { slug: 'sanctuary-terraces', title: 'Sanctuary Terraces', kind: 'scene', curation: 'featured', origin: 'agent', provenance: 'claude-code', description: 'The cliff sanctuary reworked as a town on the hill: whitewashed stone houses on stratified limestone terraces, cypresses and olives, the waterfalls into the lagoon, the marble stair to a gilded Doric temple and its goddess, snowy ranges behind.', prompt: 'A classical cliff sanctuary town: whitewashed houses on limestone terraces, cypress and olive, waterfalls into a lagoon, a marble stair to a Doric temple and a colossal goddess' },
  { slug: 'sanctuary-ascent', title: 'Sanctuary Ascent', kind: 'scene', curation: 'candidate', origin: 'agent', provenance: 'claude-code', description: 'Built end to end by the app on Opus in hardcore mode: a terraced limestone crag rising from a turquoise lagoon, a zigzag marble stair climbing between two waterfalls to a Doric temple and a colossal Athena, cypress rows and snowy ranges behind.', prompt: 'A classical cliff sanctuary composed as one postcard view: a lagoon quay, a limestone cliff with waterfalls, a zigzag marble stair, a Doric temple and a colossal goddess statue, golden-hour light' },
  // --- Example rooms rebuilt from a photograph (saved runs of the photo-to-room flow; credit on each card) ---
  { slug: 'photo-hotel-bedroom', title: 'Hotel bedroom (from a photo)', kind: 'architecture', curation: 'candidate', origin: 'photo', description: 'A hotel bedroom with a tall window wall, rebuilt from a photograph: walk it, open the doors and change it by chat.', prompt: 'Make this hotel bedroom in 3D', photo: { file: 'bedroom-cc0-hotel.jpg', author: 'Markus Spiske', licence: 'CC0 1.0', url: 'https://commons.wikimedia.org/wiki/File:Hotel_bedroom_windows_(Unsplash).jpg' } },
  { slug: 'photo-twin-room', title: 'Twin room (from a photo)', kind: 'architecture', curation: 'candidate', origin: 'photo', description: 'A twin room with two single beds and a wardrobe, rebuilt from a photograph.', prompt: 'Recreate this twin room from the photo', photo: { file: 'bedroom-cc0-twin.jpg', author: 'Profpcde', licence: 'CC0 1.0', url: 'https://commons.wikimedia.org/wiki/File:Twin_room_in_a_German_youth_hostel_with_single_beds_and_wardrobe_A.jpg' } },
  { slug: 'photo-four-poster', title: 'Four-poster bedroom (from a photo)', kind: 'architecture', curation: 'candidate', origin: 'photo', description: 'A white bedroom with a four-poster bed and beams, rebuilt from a photograph.', prompt: 'Make this four-poster bedroom in 3D', photo: { file: 'bedroom-pd-1.jpg', author: 'Government of the United States Virgin Islands', licence: 'Public domain', url: 'https://commons.wikimedia.org/wiki/File:USVI_IMG_5175_-_White-walled_bedroom_with_a_four-poster_bed_colorful_rug_and_modern_furniture_in_bright_airy_setting.jpg' } },
  { slug: 'photo-vaulted-bedroom', title: 'Vaulted bedroom (from a photo)', kind: 'architecture', curation: 'candidate', origin: 'photo', description: 'A bright bedroom under a white vaulted ceiling with a zigzag rug, rebuilt from a photograph.', prompt: 'Make this vaulted bedroom in 3D', photo: { file: 'bedroom-pd-2.jpg', author: 'Government of the United States Virgin Islands', licence: 'Public domain', url: 'https://commons.wikimedia.org/wiki/File:USVI_IMG_5201_-_Bright_modern_bedroom_with_a_white_vaulted_ceiling_a_colorful_zigzag_rug_and_a_four-poster_bed.jpg' } },
] satisfies ShowcaseEntry[]);
