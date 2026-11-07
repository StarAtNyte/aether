/**
 * Cloudwatch Harbour's short film (`world.story`), "Two Whistles", an original slice-of-life piece of about 100 seconds.
 * Kaho's best friend Mio leaves town tonight on the evening train, which Mio's father drives. Class ran late: Kaho races
 * up from the harbour to say goodbye at the level crossing, arrives as the train is already passing, and misses her. Then
 * she remembers Mio's promise: "If you ever miss me, run to the lookout. Dad always whistles twice at the cape." She runs
 * the whole hill stair, reaches the lookout as the train runs along the coast far below, and it whistles twice. The
 * lamps come on and the town goes blue.
 *
 * Beat sheet: the goal (shots 1-4), the turn (5-8: the train is already passing, a Dutch tilt, a held silence), the
 * memory (9), the run (10-14), the payoff (15-19: the train far below, two whistles, her wave, the crane up), coda (20).
 * Screen direction: her way is screen right all film long (the cameras stay on the inland or east side of her line, which
 * also puts the low sun ahead of the lens: back light and rims); the train runs against her, screen left.
 *
 * Aether coordinates (Blender (x, y, z) -> (x, z, -y)): the stair climbs north (-Z) at x = 0 with a handrail down the
 * middle, from the harbour road (y 1.6, z ~ 24) over the railway crossing (y 6, z 9.4), terraces at y 12 (z -18 .. -36),
 * 18 (the shrine gate, z -48 .. -64), 25 (z -78 .. -92) to the lookout (y 44, z -130 .. -140); the sea lies south (+Z),
 * the sun low in the south-west. People's paths are laid on the ground by the player (rays down onto the solid pieces),
 * so their heights here are rough.
 *
 * The colour script runs warm afternoon -> golden -> magenta dusk -> blue hour, with the practicals (lamps, lanterns,
 * windows) coming on as she reaches the lookout. Music cues and sounds are the player's procedural score and sound set.
 */
import type { StoryInput, StoryGrade } from '@aether/core';

type V3 = [number, number, number];

/** The girl (an entity of the world: `cw-kaho`). */
export const KAHO = 'cw-kaho';
/** The local train (`cw-train`, a separate baked piece; its moves are skipped while the world has no such entity). */
export const TRAIN = 'cw-train';

/** Where she ends the film: at the lookout railing, facing the sea. */
export const KAHO_END: V3 = [0.9, 44.05, -130.9];
/** Where the visitor starts when playing from the story (behind her spot). */
export const PLAY_FROM: V3 = [0.9, 44.1, -132.2];

const AFTERNOON: StoryGrade = { exposureEv: -0.05, contrast: 1.12, temperature: 0.15, saturation: 1.04, gradientTop: '#ffd9a8', gradientBottom: '#fff1d8', gradientAmount: 0.1, bloom: 0.8, diffusion: 0.22, godRays: 0.4, flare: 0.25, dust: 0.3, grain: 0.18, chroma: 0.2, vignette: 0.24, practicals: 0 };
const GOLDEN: StoryGrade = { exposureEv: -0.08, contrast: 1.14, temperature: 0.3, saturation: 1.08, gradientTop: '#ffb070', gradientBottom: '#ffe0b0', gradientAmount: 0.16, bloom: 0.95, diffusion: 0.32, godRays: 0.6, flare: 0.35, dust: 0.4, grain: 0.18, chroma: 0.22, vignette: 0.26, practicals: 0.1 };
const MAGENTA: StoryGrade = { exposureEv: -0.2, contrast: 1.12, temperature: 0.05, saturation: 1.1, gradientTop: '#b8428a', gradientBottom: '#ff8a6a', gradientAmount: 0.3, bloom: 1.05, diffusion: 0.4, godRays: 0.45, flare: 0.3, dust: 0.25, grain: 0.2, chroma: 0.22, vignette: 0.28, practicals: 0.7 };
const BLUE_HOUR: StoryGrade = { exposureEv: -0.6, contrast: 1.08, temperature: -0.65, saturation: 0.95, gradientTop: '#22307e', gradientBottom: '#6a5ab0', gradientAmount: 0.45, bloom: 1.15, diffusion: 0.45, godRays: 0.1, flare: 0.15, dust: 0.1, grain: 0.22, chroma: 0.22, vignette: 0.3, practicals: 1 };

/** The stair's walking line (east of the middle handrail), road to lookout. */
const X = 0.75;
/** Where she waits at the crossing: a step right of the stair line, clear of the mother and child. */
const XC = 2.1;
const CROSS: V3 = [XC, 6.1, 11.7];
/** The western cape, where the line runs on round the coast (seen from the lookout). */
const CAPE: V3 = [-197, 20, 90];
/** The railway (Aether z) and the train's height on it. */
const RAIL_Z = 9.4;
const TRAIN_Y = 6.554;
/** The ambience beds by place. */
const AMB_HARBOUR = { wind: 0.5, waves: 0.8, cicadas: 0.25, gulls: 0.55, town: 0.4 };
const AMB_HILL = { wind: 0.45, waves: 0.35, cicadas: 0.85, gulls: 0.2, town: 0.3 };
const AMB_TOP = { wind: 0.75, waves: 0.3, cicadas: 0.45, gulls: 0.35, town: 0.2 };

export const STORY: StoryInput = {
  title: 'Two Whistles',
  letterbox: 1,
  playFrom: { position: PLAY_FROM, yaw: 180 },
  endCard: { title: 'Two Whistles', lines: ['Cloudwatch Harbour, an evening on the hill', 'P to play · Tab to explore'] },
  shots: [
    {
      name: '1 Opening: the sky over the sea',
      duration: 8,
      camera: { position: [2, 46.2, -131.6], target: [-58, 150, 160], fov: 50 },
      cameraTo: { position: [2, 45.8, -131.2], target: [-50, 30, 163], fov: 50 },
      ease: 'inOut',
      transition: 'fade',
      transitionSeconds: 2,
      title: 'Two Whistles',
      subtitle: 'Cloudwatch Harbour',
      hour: 18.5,
      grade: AFTERNOON,
      music: 'intro',
      ambience: AMB_HARBOUR,
      sounds: [{ at: 3.5, sound: 'gull', gain: 0.6 }],
    },
    {
      name: '2 Insert: running shoes on the harbour road',
      duration: 2.6,
      camera: { position: [21.5, 1.95, 24.4], target: [19, 1.9, 26.7], fov: 36 },
      cameraTo: { position: [15.2, 1.95, 24.1], target: [13, 1.9, 26.4], fov: 36 },
      ease: 'linear',
      track: KAHO,
      trackOffset: [0, 0.22, 0],
      trackLag: 0.12,
      music: 'run',
      sounds: [{ at: 0, sound: 'steps', seconds: 2.6 }],
      moves: [{ entity: KAHO, path: [[24, 1.7, 26.9], [12, 1.7, 26.3]], ease: 'linear' }],
    },
    {
      name: '3 The harbour road, long lens into the sun',
      duration: 5,
      camera: { position: [52, 2.3, 26.9], target: [12, 3.0, 25.6], fov: 8 },
      cameraTo: { position: [51.5, 2.3, 26.8], target: [3, 3.3, 24.5], fov: 8.5 },
      track: KAHO,
      trackOffset: [0, 1.1, 0],
      trackLag: 0.45,
      caption: '6:31. Mio’s train passes the crossing at 6:40.',
      captionAt: [0.6, 4.6],
      moves: [{ entity: KAHO, path: [[13, 1.7, 26.2], [6, 1.7, 25.6], [X, 1.7, 23.6], [X, 3.0, 20.6]], ease: 'linear' }],
    },
    {
      name: '4 Leading her up the first steps, the sea behind',
      duration: 4,
      camera: { position: [2.1, 5.7, 17.4], target: [X, 3.6, 21], fov: 34 },
      cameraTo: { position: [2.1, 8.6, 10.6], target: [X, 7.0, 13.6], fov: 34 },
      ease: 'linear',
      track: KAHO,
      trackOffset: [0, 1.05, 0],
      trackLag: 0.2,
      moves: [{ entity: KAHO, path: [[X, 2.7, 21.2], [X, 6.1, 13.6]], ease: 'linear' }],
    },
    {
      name: '5 Insert: the crossing lamps',
      duration: 2.2,
      camera: { position: [-0.4, 6.5, 13.8], target: [-1.9, 8.6, 11.8], fov: 24 },
      cameraTo: { position: [-0.45, 6.5, 13.6], target: [-1.9, 8.65, 11.8], fov: 22 },
      music: 'tension',
      // The crossing's lamps are practicals: lit for the insert (the windows behind come on with them).
      grade: { ...AFTERNOON, practicals: 0.85 },
      sounds: [{ at: 0, sound: 'crossing-bell', gain: 0.9, seconds: 12 }],
      moves: [{ entity: TRAIN, path: [[95, TRAIN_Y, RAIL_Z]], orient: false }],
    },
    {
      name: '6 The crossing: the train is already passing',
      duration: 6,
      camera: { position: [5.6, 7.2, 15.6], target: [-6, 7.7, 8.2], fov: 34 },
      cameraTo: { position: [4.9, 7.25, 14.9], target: [-6, 7.75, 8.0], fov: 30 },
      caption: 'Mio—!',
      captionAt: [2.6, 4.4],
      moves: [
        { entity: KAHO, path: [[X, 6.1, 13.7], [X, 6.1, 12.3], CROSS], end: 0.3, face: [XC - 1, 6.5, 0] },
        { entity: TRAIN, path: [[42, TRAIN_Y, RAIL_Z], [-30, TRAIN_Y, RAIL_Z]], start: 0.1, end: 1, ease: 'linear', orient: false },
      ],
      actions: [{ entity: KAHO, at: 2.4, clip: 'wave' }],
      sounds: [{ at: 0.5, sound: 'train-pass', seconds: 7 }],
      grade: AFTERNOON,
    },
    {
      name: '7 Close on her profile, Dutch, the train behind',
      duration: 3,
      camera: { position: [3.7, 7.5, 11.25], target: [XC, 7.45, 11.7], fov: 19, roll: 11 },
      cameraTo: { position: [3.55, 7.5, 11.28], target: [XC, 7.47, 11.7], fov: 17, roll: 13 },
      ease: 'linear',
      moves: [
        { entity: KAHO, path: [CROSS], face: [XC - 1, 6.5, 0] },
        { entity: TRAIN, path: [[-30, TRAIN_Y, RAIL_Z], [-68, TRAIN_Y, RAIL_Z]], ease: 'linear', orient: false },
      ],
    },
    {
      name: '8 Held wide: too late',
      duration: 4.2,
      camera: { position: [7.5, 7.5, 14.8], target: [-8, 7.4, 10.5], fov: 36 },
      caption: '…I didn’t even say goodbye.',
      captionAt: [1.4, 4.0],
      music: 'hush',
      ambience: { ...AMB_HARBOUR, cicadas: 0.6, gulls: 0.25 },
      moves: [
        { entity: KAHO, path: [CROSS], face: [-40, 6.5, RAIL_Z] },
        { entity: TRAIN, path: [[-68, TRAIN_Y, RAIL_Z], [-112, TRAIN_Y, RAIL_Z]], end: 0.7, ease: 'out', orient: false },
      ],
    },
    {
      name: '9 Low, against the sky: she remembers',
      duration: 6.4,
      camera: { position: [XC + 0.4, 6.32, 9.2], target: [XC, 7.5, 11.7], fov: 27 },
      cameraTo: { position: [XC + 0.38, 6.3, 9.45], target: [XC, 7.55, 11.7], fov: 24 },
      caption: '“If you ever miss me, run to the lookout. Dad always whistles twice at the cape.”',
      captionAt: [0.8, 5.0],
      music: 'hope',
      moves: [{ entity: KAHO, path: [CROSS, [XC, 6.1, 11.5]], start: 0.05, end: 0.3, face: [XC, 9, 0] }],
      sounds: [{ at: 0.6, sound: 'chime', gain: 0.6 }],
      gradeTo: GOLDEN,
    },
    {
      name: '10 High, down the stair (wide)',
      duration: 5,
      camera: { position: [2.1, 11.4, -12.2], target: [X, 7.5, 2], fov: 44 },
      cameraTo: { position: [2.0, 11.5, -12.6], target: [X, 9.5, -7], fov: 42 },
      track: KAHO,
      trackOffset: [0, 0.6, 0],
      trackLag: 0.5,
      ambience: AMB_HILL,
      sounds: [{ at: 0.2, sound: 'steps', gain: 0.6, seconds: 4.5 }],
      moves: [{ entity: KAHO, path: [[X, 6.1, 4.0], [X, 6.1, -5.5], [X, 8.6, -8.4]], ease: 'linear' }],
      grade: GOLDEN,
    },
    {
      name: '11 Through the shrine gate, long lens from above',
      duration: 5,
      camera: { position: [0.3, 20.6, -67], target: [X, 18.4, -46], fov: 22 },
      cameraTo: { position: [0.3, 20.5, -66.6], target: [X, 19.0, -54], fov: 23 },
      track: KAHO,
      trackOffset: [0, 0.9, 0],
      trackLag: 0.6,
      moves: [{ entity: KAHO, path: [[X, 12.6, -40.5], [X, 18.05, -48.4], [X, 18.05, -57]], ease: 'linear' }],
    },
    {
      name: '12 Ma: the cloud and the gulls',
      duration: 4.5,
      camera: { position: [4, 27.6, -86], target: [-14, 44, 160], fov: 46 },
      cameraTo: { position: [4, 27.6, -86], target: [-17, 44.5, 160], fov: 46 },
      ease: 'inOut',
      ambience: { ...AMB_TOP, gulls: 0.7 },
      sounds: [{ at: 1.2, sound: 'gull', gain: 0.8 }, { at: 3.0, sound: 'gull', gain: 0.5 }],
      gradeTo: MAGENTA,
    },
    {
      name: '13 Insert: her feet on the last steps',
      duration: 2.6,
      camera: { position: [0.5, 40.25, -121.4], target: [X, 38.5, -118.8], fov: 30 },
      cameraTo: { position: [0.5, 44.0, -128.6], target: [X, 42.7, -126.2], fov: 30 },
      ease: 'linear',
      track: KAHO,
      trackOffset: [0, 0.25, 0],
      trackLag: 0.15,
      sounds: [{ at: 0, sound: 'steps', seconds: 2.6 }, { at: 0.2, sound: 'heartbeat', gain: 0.5, seconds: 2.4 }],
      moves: [{ entity: KAHO, path: [[X, 38.2, -118.6], [X, 42.4, -126.2]], ease: 'linear' }],
      grade: MAGENTA,
    },
    {
      name: '14 Reverse from the lookout: she climbs into frame',
      duration: 5,
      camera: { position: [-1.4, 45.9, -133.6], target: [X, 41, -118], fov: 34 },
      cameraTo: { position: [-1.0, 45.7, -132.6], target: [X, 44.6, -128.5], fov: 25 },
      track: KAHO,
      trackOffset: [0, 0.9, 0],
      trackLag: 0.5,
      moves: [{ entity: KAHO, path: [[X, 36.4, -115], [X, 44.05, -129.6], [X, 44.05, -130.3]], ease: 'out' }],
    },
    {
      name: '15 Arrival: her profile against the sky',
      duration: 4.2,
      camera: { position: [3.1, 44.45, -129.5], target: [0.9, 45.35, -130.9], fov: 27 },
      cameraTo: { position: [2.95, 44.47, -129.6], target: [0.9, 45.37, -130.9], fov: 25 },
      music: 'hush',
      ambience: AMB_TOP,
      sounds: [{ at: 0.3, sound: 'wind-gust', gain: 0.7, seconds: 3 }],
      moves: [{ entity: KAHO, path: [[X, 44.05, -130.3], KAHO_END], end: 0.4, face: [-40, 40, 160] }],
      hour: 18.7,
    },
    {
      name: '16 Over her shoulder: the cape where the line runs on',
      duration: 5,
      camera: { position: [1.75, 45.95, -132.7], target: [-70, 22, 30], fov: 28 },
      cameraTo: { position: [1.75, 45.95, -132.6], target: [-72, 21, 33], fov: 26 },
      sounds: [{ at: 0.4, sound: 'train-pass', gain: 0.18, seconds: 5 }],
      moves: [{ entity: KAHO, path: [KAHO_END], face: CAPE }],
    },
    {
      name: '17 Long lens on the cape: two whistles',
      duration: 4.6,
      camera: { position: [2.6, 46.2, -132.4], target: [CAPE[0] + 6, CAPE[1] + 9, CAPE[2]], fov: 13 },
      cameraTo: { position: [2.6, 46.2, -132.4], target: [CAPE[0] + 8, CAPE[1] + 9.4, CAPE[2]], fov: 12 },
      caption: '(Two long whistles from the cape.)',
      captionAt: [0.9, 4.2],
      sounds: [{ at: 0.6, sound: 'train-whistle' }],
    },
    {
      name: '18 Close, low and frontal: see you, Mio',
      duration: 5.2,
      camera: { position: [0.95, 45.05, -129.55], target: [0.9, 45.38, -130.9], fov: 24 },
      cameraTo: { position: [0.95, 45.08, -129.75], target: [0.9, 45.4, -130.9], fov: 22 },
      caption: '…See you, Mio.',
      captionAt: [2.6, 5.0],
      music: 'climax',
      moves: [{ entity: KAHO, path: [KAHO_END], face: [0.9, 44, 160] }],
      actions: [{ entity: KAHO, at: 0.9, clip: 'wave' }],
      grade: { ...MAGENTA, practicals: 0.2 },
    },
    {
      name: '19 Crane up: the town, the sea, the sun on the water',
      duration: 12,
      camera: { position: [0.95, 44.9, -133.3], target: [0.9, 45.4, -128], fov: 40 },
      via: [{ position: [1.8, 47.5, -136.0], target: [-6, 41, -40], fov: 46 }],
      cameraTo: { position: [5.5, 53.5, -146], target: [-40, 24, 160], fov: 52 },
      ease: 'inOut',
      moves: [{ entity: KAHO, path: [KAHO_END], face: [-40, 40, 160] }],
      grade: { ...MAGENTA, practicals: 0.3 },
      gradeTo: { ...BLUE_HOUR, practicals: 1 },
    },
    {
      name: '20 The town at blue hour',
      duration: 7,
      camera: { position: [30, 4.5, 75], target: [0, 18, -50], fov: 40 },
      cameraTo: { position: [27, 4.6, 72], target: [0, 18, -50], fov: 38 },
      transition: 'fade',
      transitionSeconds: 1.2,
      music: 'coda',
      ambience: { ...AMB_HARBOUR, cicadas: 0.15, gulls: 0.1 },
      grade: BLUE_HOUR,
    },
  ],
};
