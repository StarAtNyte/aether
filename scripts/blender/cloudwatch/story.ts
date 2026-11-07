/**
 * Cloudwatch Harbour's short film (`world.story`), "Two Whistles", an original slice-of-life piece of about 105 seconds.
 *
 * Beat sheet (every shot moves the story):
 * - **Promise** (1-3, a flashback, "Last summer."): Kaho and her best friend Mio at the lookout at sunset. Mio holds up
 *   two fingers: when the train takes her to the city, her father (who drives it) will whistle twice at the cape. Kaho
 *   promises to be up here.
 * - **Today** (4-7): the title over the sea; 6:31, Kaho runs along the harbour road. Cross-cut: the train in the east
 *   cutting, Mio at its window, looking out for her.
 * - **The crossing** (8-12): the bell; Kaho reaches the crossing as the train passes; through the glass Mio sees her,
 *   presses a hand to her chest and holds up two fingers; Kaho's face as it goes (the film's one Dutch tilt), then she
 *   understands: the cape.
 * - **The race** (13-17): she turns and runs up the hill, intercut with the train coming out of the west tunnel onto the
 *   cape line; the shrine gate; near the top she stumbles (the near miss) and climbs on.
 * - **Payoff** (18-21): the lookout, over her shoulder the little train on the cape far below; two long whistles; Mio's
 *   tiny wave from the window on a long lens; Kaho, in tears and smiling, waves back. The camera cranes up over the
 *   town and the sea as the lamps come on.
 * - **Coda** (22): the town at blue hour.
 *
 * Screen direction: Kaho's way is screen right (the cameras keep to the inland or east side of her line, the low sun
 * ahead of the lens); the train runs against her, screen left. Captions name who speaks.
 *
 * Aether coordinates (Blender (x, y, z) -> (x, z, -y)): the stair climbs north (-Z) at x = 0 from the harbour road
 * (y 1.6, z ~ 24) over the railway crossing (y 6, z 9.4), the shrine gate (y 18, z -49.6), to the lookout (y 44,
 * z -130 .. -140); the sea lies south (+Z), the sun low in the south-west. People's paths are laid on the ground by the
 * player, so their heights here are rough. Mio and the train move together (`ride`).
 */
import type { StoryInput, StoryGrade, StoryMove } from '@aether/core';

type V3 = [number, number, number];
type MoveIn = Omit<StoryMove, 'start' | 'end' | 'ease' | 'orient' | 'ground'> & Partial<Pick<StoryMove, 'start' | 'end' | 'ease' | 'orient' | 'ground'>>;

/** The girl (an entity of the world: `cw-kaho`). */
export const KAHO = 'cw-kaho';
/** Her friend (`cw-mio`, in the world once her body is in the cast; her moves are skipped without her). */
export const MIO = 'cw-mio';
/** The local train (`cw-train`). */
export const TRAIN = 'cw-train';

/** Where she ends the film: at the lookout railing, facing the sea. */
export const KAHO_END: V3 = [0.9, 44.05, -130.9];
/** Where the visitor starts when playing from the story (behind her spot). */
export const PLAY_FROM: V3 = [0.9, 44.1, -132.2];
/** The flashback's places at the rail: Kaho on the right, Mio on the left (seen from behind). */
const KAHO_PAST: V3 = [1.45, 44.05, -130.85];
export const MIO_START: V3 = [0.35, 44.05, -130.85];

const AFTERNOON: StoryGrade = { exposureEv: -0.05, contrast: 1.12, temperature: 0.15, saturation: 1.04, gradientTop: '#ffd9a8', gradientBottom: '#fff1d8', gradientAmount: 0.1, bloom: 0.8, diffusion: 0.22, godRays: 0.4, flare: 0.25, dust: 0.3, grain: 0.18, chroma: 0.2, vignette: 0.24, practicals: 0 };
const GOLDEN: StoryGrade = { exposureEv: -0.08, contrast: 1.14, temperature: 0.3, saturation: 1.08, gradientTop: '#ffb070', gradientBottom: '#ffe0b0', gradientAmount: 0.16, bloom: 0.95, diffusion: 0.32, godRays: 0.6, flare: 0.35, dust: 0.4, grain: 0.18, chroma: 0.22, vignette: 0.26, practicals: 0.1 };
const MAGENTA: StoryGrade = { exposureEv: -0.2, contrast: 1.12, temperature: 0.05, saturation: 1.1, gradientTop: '#b8428a', gradientBottom: '#ff8a6a', gradientAmount: 0.3, bloom: 1.05, diffusion: 0.4, godRays: 0.45, flare: 0.3, dust: 0.25, grain: 0.2, chroma: 0.22, vignette: 0.28, practicals: 0.7 };
const BLUE_HOUR: StoryGrade = { exposureEv: -0.6, contrast: 1.08, temperature: -0.65, saturation: 0.95, gradientTop: '#22307e', gradientBottom: '#6a5ab0', gradientAmount: 0.45, bloom: 1.15, diffusion: 0.45, godRays: 0.1, flare: 0.15, dust: 0.1, grain: 0.22, chroma: 0.22, vignette: 0.3, practicals: 1 };
/** Memory: softer, warmer, less saturated, a strong glow and vignette. */
const MEMORY: StoryGrade = { exposureEv: 0.1, contrast: 0.96, temperature: 0.45, saturation: 0.82, gradientTop: '#ffcf9a', gradientBottom: '#fff0dc', gradientAmount: 0.3, bloom: 1.2, diffusion: 0.7, godRays: 0.55, flare: 0.4, dust: 0.55, grain: 0.3, chroma: 0.3, vignette: 0.42, practicals: 0 };

/** The stair's walking line (east of the middle handrail), road to lookout. */
const X = 0.75;
/** Where she reaches the crossing: a step right of the stair line. */
const XC = 2.1;
const CROSS: V3 = [XC, 6.1, 11.7];
/** The railway (Aether z) and the train's height on it. */
const RAIL_Z = 9.4;
const TRAIN_Y = 6.554;
/**
 * Mio's place in the train relative to its origin (Aether metres): standing at a sea-side window of the first car.
 * Kept in step with the train model's windows.
 */
const MIO_IN_TRAIN: V3 = [-11.09, 1.18, 0.95];
/** The line on the cape, past the west tunnel, as the lookout sees it (Aether points, kept in step with the model). */
const CAPE_LINE: V3[] = [[-100.2, 6.58, 40], [-108.5, 6.58, 56], [-120.1, 6.58, 68], [-136.1, 6.58, 80], [-150.5, 6.58, 88], [-169.8, 6.58, 96], [-198.1, 6.58, 104]];
/** Where the lookout's long lens finds the cape (the line's open stretch). */
const CAPE: V3 = [-150.5, 9, 88];
/** The ambience beds by place. */
const AMB_HARBOUR = { wind: 0.5, waves: 0.8, cicadas: 0.25, gulls: 0.55, town: 0.4 };
const AMB_HILL = { wind: 0.45, waves: 0.35, cicadas: 0.85, gulls: 0.2, town: 0.3 };
const AMB_TOP = { wind: 0.75, waves: 0.3, cicadas: 0.45, gulls: 0.35, town: 0.2 };

/**
 * The train along `path`, and Mio at her window riding with it (the same timing). The train turns to the way it goes
 * (its length lies along its x axis, the cab at -x: a quarter turn of offset), and her place turns with it.
 */
function ride(path: V3[], o: { start?: number; end?: number; ease?: StoryMove['ease'] } = {}): MoveIn[] {
  const heading = (i: number): number => {
    const a = path[Math.max(0, i - 1)] as V3;
    const b = path[Math.min(path.length - 1, Math.max(1, i))] as V3;
    const dx = b[0] - a[0];
    const dz = b[2] - a[2];
    // The model's -x along the way it goes (0 on the main line, which runs toward -x).
    return Math.hypot(dx, dz) > 1e-6 ? Math.atan2(dz, -dx) : 0;
  };
  const place = (p: V3, i: number): V3 => {
    const th = heading(i);
    const [ox, oy, oz] = MIO_IN_TRAIN;
    return [p[0] + ox * Math.cos(th) + oz * Math.sin(th), p[1] + oy, p[2] - ox * Math.sin(th) + oz * Math.cos(th)];
  };
  const t = { start: o.start ?? 0, end: o.end ?? 1, ease: o.ease ?? 'linear' };
  const n = path.length - 1;
  const last = place(path[n] as V3, n);
  const th = heading(n);
  // She faces out of the sea-side window (the train's +z side).
  const out: V3 = [last[0] + 30 * Math.sin(th), 7.5, last[2] + 30 * Math.cos(th)];
  return [
    { entity: TRAIN, path, ...t, orient: path.length > 1, yawOffset: -90 },
    { entity: MIO, path: path.map(place), ...t, orient: false, face: out, ground: false },
  ];
}

export const STORY: StoryInput = {
  title: 'Two Whistles',
  letterbox: 1,
  playFrom: { position: PLAY_FROM, yaw: 180 },
  endCard: { title: 'Two Whistles', lines: ['Cloudwatch Harbour, an evening on the hill', 'P to play · Tab to explore'] },
  shots: [
    // ---- Promise (last summer) ----
    {
      name: '1 Last summer: the two of them at the rail',
      duration: 6,
      camera: { position: [0.9, 45.5, -134.4], target: [0.9, 45.0, -128], fov: 36 },
      cameraTo: { position: [0.9, 45.4, -133.6], target: [0.9, 44.9, -128], fov: 34 },
      ease: 'inOut',
      transition: 'fade',
      transitionSeconds: 2,
      caption: 'Last summer.',
      captionAt: [1.4, 4.6],
      hour: 18.5,
      grade: MEMORY,
      music: 'intro',
      ambience: { ...AMB_TOP, gulls: 0.5 },
      moves: [
        { entity: KAHO, path: [KAHO_PAST], face: [1.45, 40, 160] },
        { entity: MIO, path: [MIO_START], face: [0.35, 40, 160] },
      ],
    },
    {
      name: '2 Mio holds up two fingers',
      duration: 6.5,
      camera: { position: [3.2, 45.25, -129.6], target: [0.6, 45.35, -130.9], fov: 30 },
      cameraTo: { position: [3.0, 45.25, -129.7], target: [0.55, 45.38, -130.9], fov: 27 },
      caption: 'Mio: When the train takes me to the city, Dad will whistle twice at the cape. Two whistles. That’s me.',
      captionAt: [0.6, 5.8],
      moves: [
        { entity: KAHO, path: [KAHO_PAST], face: [MIO_START[0], 45, MIO_START[2]] },
        { entity: MIO, path: [MIO_START], face: [KAHO_PAST[0], 45, KAHO_PAST[2]] },
      ],
      actions: [
        { entity: MIO, at: 1.6, clip: 'two_fingers' },
        { entity: MIO, at: 1.4, expression: 'smile', weight: 0.8 },
      ],
    },
    {
      name: '3 Kaho promises',
      duration: 4.2,
      camera: { position: [-0.4, 45.3, -129.9], target: [1.45, 45.4, -130.85], fov: 24 },
      cameraTo: { position: [-0.35, 45.3, -129.95], target: [1.45, 45.42, -130.85], fov: 22 },
      caption: 'Kaho: Then I’ll be up here. Promise.',
      captionAt: [0.5, 3.8],
      moves: [{ entity: KAHO, path: [KAHO_PAST], face: [MIO_START[0], 45, MIO_START[2]] }],
      actions: [{ entity: KAHO, at: 0.3, expression: 'smile' }, { entity: KAHO, at: 2.6, clip: 'nod' }],
    },
    // ---- Today ----
    {
      name: '4 Today: the title over the sea',
      duration: 6,
      camera: { position: [2, 46.2, -131.6], target: [-58, 150, 160], fov: 50 },
      cameraTo: { position: [2, 45.8, -131.2], target: [-50, 30, 163], fov: 50 },
      ease: 'inOut',
      transition: 'flash',
      transitionSeconds: 0.8,
      title: 'Two Whistles',
      subtitle: 'Cloudwatch Harbour',
      grade: AFTERNOON,
      moves: [
        { entity: KAHO, path: [[24, 1.7, 26.9]], face: [12, 1.7, 26.3] },
        ...ride([[95, TRAIN_Y, RAIL_Z]]),
      ],
      actions: [{ entity: KAHO, at: 0, expression: 'smile', weight: 0 }, { entity: MIO, at: 0, expression: 'smile', weight: 0 }],
    },
    {
      name: '5 6:31, the harbour road (long lens)',
      duration: 5,
      camera: { position: [52, 2.3, 26.9], target: [12, 3.0, 25.6], fov: 8 },
      cameraTo: { position: [51.5, 2.3, 26.8], target: [3, 3.3, 24.5], fov: 8.5 },
      track: KAHO,
      trackOffset: [0, 1.1, 0],
      trackLag: 0.45,
      caption: 'Today, 6:31. Mio’s train passes the crossing at 6:40.',
      captionAt: [0.4, 4.6],
      music: 'run',
      ambience: AMB_HARBOUR,
      sounds: [{ at: 0, sound: 'steps', gain: 0.5, seconds: 5 }],
      moves: [{ entity: KAHO, path: [[22, 1.7, 26.9], [6, 1.7, 25.6], [X, 1.7, 23.6], [X, 3.0, 20.6]], ease: 'linear' }],
    },
    {
      name: '6 Cross-cut: Mio at the train window',
      duration: 4,
      camera: { position: [68 + MIO_IN_TRAIN[0] + 0.8, TRAIN_Y + 2.5, RAIL_Z + 4.6], target: [68 + MIO_IN_TRAIN[0], TRAIN_Y + 2.55, RAIL_Z + 1.2], fov: 22 },
      cameraTo: { position: [56 + MIO_IN_TRAIN[0] + 0.8, TRAIN_Y + 2.5, RAIL_Z + 4.6], target: [56 + MIO_IN_TRAIN[0], TRAIN_Y + 2.55, RAIL_Z + 1.2], fov: 22 },
      ease: 'linear',
      caption: 'Mio: …She’s not coming.',
      captionAt: [1.6, 3.8],
      moves: ride([[68, TRAIN_Y, RAIL_Z], [56, TRAIN_Y, RAIL_Z]]),
      actions: [{ entity: MIO, at: 0.5, expression: 'sad' }],
    },
    {
      name: '7 Leading her up the first steps',
      duration: 3.6,
      camera: { position: [2.1, 5.7, 17.4], target: [X, 3.6, 21], fov: 34 },
      cameraTo: { position: [2.1, 8.6, 10.6], target: [X, 7.0, 13.6], fov: 34 },
      ease: 'linear',
      track: KAHO,
      trackOffset: [0, 1.05, 0],
      trackLag: 0.2,
      moves: [{ entity: KAHO, path: [[X, 2.7, 21.2], [X, 6.1, 13.6]], ease: 'linear' }],
      actions: [{ entity: KAHO, at: 0, expression: 'determined' }],
    },
    // ---- The crossing ----
    {
      name: '8 Insert: the crossing lamps',
      duration: 2,
      camera: { position: [-0.4, 6.5, 13.8], target: [-1.9, 8.6, 11.8], fov: 24 },
      cameraTo: { position: [-0.45, 6.5, 13.6], target: [-1.9, 8.65, 11.8], fov: 22 },
      music: 'tension',
      grade: { ...AFTERNOON, practicals: 0.85 },
      sounds: [{ at: 0, sound: 'crossing-bell', gain: 0.9, seconds: 11 }],
      moves: ride([[36, TRAIN_Y, RAIL_Z], [20, TRAIN_Y, RAIL_Z]]),
    },
    {
      name: '9 The crossing: the train is already passing',
      duration: 4.5,
      camera: { position: [5.6, 7.2, 15.6], target: [-6, 7.7, 8.2], fov: 34 },
      cameraTo: { position: [4.9, 7.25, 14.9], target: [-6, 7.75, 8.0], fov: 30 },
      caption: 'Kaho: Mio—!',
      captionAt: [1.8, 3.8],
      grade: AFTERNOON,
      moves: [
        { entity: KAHO, path: [[X, 6.1, 13.7], [X, 6.1, 12.3], CROSS], end: 0.35, face: [XC - 1, 6.5, 0] },
        ...ride([[20, TRAIN_Y, RAIL_Z], [-16, TRAIN_Y, RAIL_Z]]),
      ],
      actions: [{ entity: KAHO, at: 1.8, clip: 'wave' }, { entity: KAHO, at: 1.6, expression: 'surprised' }],
      sounds: [{ at: 0, sound: 'train-pass', seconds: 9 }],
    },
    {
      name: '10 Through the glass: two fingers',
      duration: 4.5,
      camera: { position: [-16 + MIO_IN_TRAIN[0] + 1.2, TRAIN_Y + 2.45, RAIL_Z + 4.2], target: [-16 + MIO_IN_TRAIN[0], TRAIN_Y + 2.5, RAIL_Z + 1.2], fov: 20 },
      cameraTo: { position: [-28 + MIO_IN_TRAIN[0] + 1.2, TRAIN_Y + 2.45, RAIL_Z + 4.2], target: [-28 + MIO_IN_TRAIN[0], TRAIN_Y + 2.5, RAIL_Z + 1.2], fov: 20 },
      ease: 'linear',
      caption: 'Mio: Two whistles!',
      captionAt: [1.6, 4.2],
      moves: ride([[-16, TRAIN_Y, RAIL_Z], [-28, TRAIN_Y, RAIL_Z]]),
      actions: [
        { entity: MIO, at: 0.3, expression: 'surprised' },
        { entity: MIO, at: 0.9, clip: 'hand_to_chest' },
        { entity: MIO, at: 2.0, clip: 'two_fingers' },
        { entity: MIO, at: 2.0, expression: 'smile' },
      ],
    },
    {
      name: '11 Her face as it goes (Dutch)',
      duration: 3,
      camera: { position: [3.7, 7.5, 11.25], target: [XC, 7.45, 11.7], fov: 19, roll: 11 },
      cameraTo: { position: [3.55, 7.5, 11.28], target: [XC, 7.47, 11.7], fov: 17, roll: 13 },
      ease: 'linear',
      music: 'hush',
      moves: [{ entity: KAHO, path: [CROSS], face: [XC - 1, 6.5, 0] }, ...ride([[-28, TRAIN_Y, RAIL_Z], [-52, TRAIN_Y, RAIL_Z]])],
      actions: [{ entity: KAHO, at: 0.2, expression: 'teary', weight: 0.6 }],
    },
    {
      name: '12 Low, against the sky: the cape',
      duration: 3.6,
      camera: { position: [XC + 0.4, 6.32, 9.2], target: [XC, 7.5, 11.7], fov: 27 },
      cameraTo: { position: [XC + 0.38, 6.3, 9.45], target: [XC, 7.55, 11.7], fov: 24 },
      caption: 'Kaho: …The cape.',
      captionAt: [0.9, 3.2],
      music: 'hope',
      moves: [{ entity: KAHO, path: [CROSS, [XC, 6.1, 11.5]], start: 0.05, end: 0.3, face: [XC, 9, 0] }, ...ride([[-52, TRAIN_Y, RAIL_Z], [-80, TRAIN_Y, RAIL_Z]])],
      actions: [
        { entity: KAHO, at: 0.4, expression: 'determined' },
        { entity: KAHO, at: 0.4, expression: 'teary', weight: 0 },
        { entity: KAHO, at: 1.0, clip: 'look_up' },
      ],
      sounds: [{ at: 0.4, sound: 'chime', gain: 0.6 }],
      gradeTo: GOLDEN,
    },
    // ---- The race ----
    {
      name: '13 Up the stair, high and wide',
      duration: 4.2,
      camera: { position: [2.1, 11.4, -12.2], target: [X, 7.5, 2], fov: 44 },
      cameraTo: { position: [2.0, 11.5, -12.6], target: [X, 9.5, -7], fov: 42 },
      track: KAHO,
      trackOffset: [0, 0.6, 0],
      trackLag: 0.5,
      music: 'run',
      ambience: AMB_HILL,
      sounds: [{ at: 0.2, sound: 'steps', gain: 0.6, seconds: 4 }],
      moves: [{ entity: KAHO, path: [[X, 6.1, 4.0], [X, 6.1, -5.5], [X, 8.6, -8.4]], ease: 'linear' }],
      grade: GOLDEN,
    },
    {
      name: '14 Cross-cut: the train out onto the cape line',
      duration: 3.6,
      camera: { position: [-100, 14, 95], target: [-104, 7.6, 50], fov: 30 },
      cameraTo: { position: [-101, 14, 95], target: [-116, 7.4, 64], fov: 28 },
      ease: 'linear',
      sounds: [{ at: 0, sound: 'train-pass', gain: 0.5, seconds: 4 }],
      moves: ride([CAPE_LINE[0] as V3, CAPE_LINE[1] as V3, CAPE_LINE[2] as V3, CAPE_LINE[3] as V3]),
    },
    {
      name: '15 Through the shrine gate, long lens from above',
      duration: 4,
      camera: { position: [0.3, 20.6, -67], target: [X, 18.4, -46], fov: 22 },
      cameraTo: { position: [0.3, 20.5, -66.6], target: [X, 19.0, -54], fov: 23 },
      track: KAHO,
      trackOffset: [0, 0.9, 0],
      trackLag: 0.6,
      moves: [{ entity: KAHO, path: [[X, 12.6, -40.5], [X, 18.05, -48.4], [X, 18.05, -57]], ease: 'linear' }],
      gradeTo: MAGENTA,
    },
    {
      name: '16 The near miss: she stumbles on the last steps',
      duration: 3.4,
      camera: { position: [0.5, 40.25, -121.4], target: [X, 38.5, -118.8], fov: 30 },
      cameraTo: { position: [0.5, 42.5, -125.6], target: [X, 40.0, -121.6], fov: 30 },
      ease: 'linear',
      track: KAHO,
      trackOffset: [0, 0.5, 0],
      trackLag: 0.15,
      grade: MAGENTA,
      sounds: [{ at: 0, sound: 'steps', seconds: 1.4 }, { at: 1.3, sound: 'heartbeat', gain: 0.7, seconds: 2 }],
      moves: [{ entity: KAHO, path: [[X, 38.2, -118.6], [X, 40.0, -121.6]], end: 0.45, ease: 'out' }],
      actions: [{ entity: KAHO, at: 1.4, clip: 'run_stop' }, { entity: KAHO, at: 1.4, expression: 'surprised' }],
    },
    {
      name: '17 Reverse from the lookout: she climbs into frame',
      duration: 4.2,
      camera: { position: [-1.4, 45.9, -133.6], target: [X, 41, -118], fov: 34 },
      cameraTo: { position: [-1.0, 45.7, -132.6], target: [X, 44.6, -128.5], fov: 25 },
      track: KAHO,
      trackOffset: [0, 0.9, 0],
      trackLag: 0.5,
      moves: [{ entity: KAHO, path: [[X, 38.4, -120], [X, 44.05, -129.6], [X, 44.05, -130.3], KAHO_END], ease: 'out', face: CAPE }],
      actions: [{ entity: KAHO, at: 0, expression: 'determined' }],
    },
    // ---- Payoff ----
    {
      name: '18 Over her shoulder: toward the cape',
      duration: 4.4,
      camera: { position: [1.75, 45.95, -132.7], target: [-70, 22, 30], fov: 28 },
      cameraTo: { position: [1.75, 45.95, -132.6], target: [-72, 21, 33], fov: 26 },
      music: 'hush',
      ambience: AMB_TOP,
      sounds: [{ at: 0.2, sound: 'train-pass', gain: 0.15, seconds: 5 }],
      moves: [{ entity: KAHO, path: [KAHO_END], face: CAPE }, ...ride([CAPE_LINE[3] as V3, CAPE_LINE[4] as V3])],
      hour: 18.7,
    },
    {
      name: '19 Two whistles on the cape; Mio waves from the window',
      duration: 5,
      camera: { position: [-112, 10.5, 138], target: [-140, 9.0, 83], fov: 6.5 },
      cameraTo: { position: [-118, 10.5, 140], target: [-156, 9.0, 91], fov: 6.5 },
      ease: 'linear',
      track: MIO,
      trackOffset: [0, 1.2, 0],
      trackLag: 0.25,
      caption: '(Two long whistles from the cape.)',
      captionAt: [0.5, 3.6],
      music: 'climax',
      sounds: [{ at: 0.3, sound: 'train-whistle' }],
      // One straight stretch of the viaduct: her place turns with the car exactly.
      moves: ride([CAPE_LINE[3] as V3, CAPE_LINE[4] as V3]),
      actions: [{ entity: MIO, at: 1.2, clip: 'wave' }, { entity: MIO, at: 1.0, expression: 'smile' }],
    },
    {
      name: '20 See you, Mio',
      duration: 5.2,
      camera: { position: [0.95, 45.05, -129.55], target: [0.9, 45.38, -130.9], fov: 24 },
      cameraTo: { position: [0.95, 45.08, -129.75], target: [0.9, 45.4, -130.9], fov: 22 },
      caption: 'Kaho: See you, Mio!',
      captionAt: [1.6, 4.8],
      moves: [{ entity: KAHO, path: [KAHO_END], face: [0.9, 44, 160] }],
      actions: [
        { entity: KAHO, at: 0.1, expression: 'determined', weight: 0 },
        { entity: KAHO, at: 0.2, expression: 'teary', weight: 0.8 },
        { entity: KAHO, at: 0.6, expression: 'smile' },
        { entity: KAHO, at: 0.9, clip: 'wave' },
      ],
      grade: { ...MAGENTA, practicals: 0.2 },
    },
    {
      name: '21 Crane up: the town, the sea, the sun on the water',
      duration: 11,
      camera: { position: [0.95, 44.9, -133.3], target: [0.9, 45.4, -128], fov: 40 },
      via: [{ position: [1.8, 47.5, -136.0], target: [-6, 41, -40], fov: 46 }],
      cameraTo: { position: [5.5, 53.5, -146], target: [-40, 24, 160], fov: 52 },
      ease: 'inOut',
      moves: [{ entity: KAHO, path: [KAHO_END], face: [-40, 40, 160] }],
      grade: { ...MAGENTA, practicals: 0.3 },
      gradeTo: { ...BLUE_HOUR, practicals: 1 },
    },
    {
      name: '22 The town at blue hour',
      duration: 6,
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
