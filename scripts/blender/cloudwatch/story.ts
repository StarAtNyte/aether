/**
 * Cloudwatch Harbour's short film (`world.story`), an original slice-of-life piece in about eighty seconds: class ran
 * late, and a girl races up the hill stair to reach the lookout before the sun touches the sea. The train passes at the
 * crossing, the lamps come on as she arrives, and the film holds on the town going blue.
 *
 * Aether coordinates (Blender (x, y, z) -> (x, z, -y)): the stair climbs north (-Z) at x = 0 with a handrail down the
 * middle, from the harbour road (y 1.6, z ~ 24) over the railway crossing (y 6, z 9.4), terraces at y 12 (z -18 .. -36),
 * 18 (the shrine gate, z -48 .. -64), 25 (z -78 .. -92) to the lookout (y 44, z -130 .. -140); the sea lies south (+Z),
 * the sun low in the south-west. People's paths are laid on the ground by the player (rays down onto the solid pieces),
 * so their heights here are rough.
 *
 * The colour script runs warm afternoon -> golden -> magenta dusk -> blue hour, with the practicals (lamps, lanterns,
 * windows) coming on as she reaches the lookout.
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

const AFTERNOON: StoryGrade = { exposureEv: 0.05, temperature: 0.15, saturation: 1.02, gradientTop: '#ffd9a8', gradientBottom: '#fff1d8', gradientAmount: 0.12, bloom: 0.8, diffusion: 0.25, godRays: 0.35, flare: 0.25, dust: 0.3, grain: 0.18, chroma: 0.2, vignette: 0.18, practicals: 0 };
const GOLDEN: StoryGrade = { exposureEv: 0, temperature: 0.3, saturation: 1.06, gradientTop: '#ffb070', gradientBottom: '#ffe0b0', gradientAmount: 0.18, bloom: 0.95, diffusion: 0.35, godRays: 0.55, flare: 0.35, dust: 0.4, grain: 0.18, chroma: 0.22, vignette: 0.22, practicals: 0.1 };
const MAGENTA: StoryGrade = { exposureEv: -0.15, temperature: 0.05, saturation: 1.1, gradientTop: '#b8428a', gradientBottom: '#ff8a6a', gradientAmount: 0.32, bloom: 1.05, diffusion: 0.4, godRays: 0.4, flare: 0.3, dust: 0.25, grain: 0.2, chroma: 0.22, vignette: 0.26, practicals: 0.7 };
const BLUE_HOUR: StoryGrade = { exposureEv: -0.6, temperature: -0.65, saturation: 0.95, gradientTop: '#22307e', gradientBottom: '#6a5ab0', gradientAmount: 0.45, bloom: 1.15, diffusion: 0.45, godRays: 0.1, flare: 0.15, dust: 0.1, grain: 0.22, chroma: 0.22, vignette: 0.3, practicals: 1 };

/** The stair's walking line (east of the middle handrail), road to lookout. */
const X = 0.75;

export const STORY: StoryInput = {
  title: 'The Last Light',
  letterbox: 1,
  playFrom: { position: PLAY_FROM, yaw: 180 },
  endCard: { title: 'Cloudwatch Harbour', lines: ['An evening on the hill', 'P to play · Tab to explore'] },
  shots: [
    {
      name: 'Opening: the sky over the sea',
      duration: 9,
      camera: { position: [2, 46.2, -131.6], target: [-58, 150, 160], fov: 50 },
      cameraTo: { position: [2, 45.8, -131.2], target: [-50, 30, 163], fov: 50 },
      ease: 'inOut',
      transition: 'fade',
      transitionSeconds: 2,
      title: 'The Last Light',
      subtitle: 'Cloudwatch Harbour',
      hour: 18.5,
      grade: AFTERNOON,
    },
    {
      name: 'The harbour road',
      duration: 6,
      camera: { position: [27, 2.7, 29.5], target: [4, 4.2, 21.5], fov: 44 },
      cameraTo: { position: [26, 2.7, 29.3], target: [1.5, 5.2, 19.5], fov: 42 },
      caption: 'Class ran late. Of all the days.',
      captionAt: [1.2, 5.6],
      moves: [{ entity: KAHO, path: [[22, 1.7, 26.8], [6, 1.7, 25.6], [X, 1.7, 23.6], [X, 4.2, 18.5]], ease: 'linear' }],
    },
    {
      name: 'Up the first steps',
      duration: 3.2,
      camera: { position: [X + 0.35, 2.35, 25.2], target: [X, 4.2, 17], fov: 36 },
      track: KAHO,
      trackOffset: [0, 0.8, 0],
      moves: [{ entity: KAHO, path: [[X, 1.7, 23.2], [X, 6.0, 13.6]], ease: 'linear' }],
    },
    {
      name: 'The crossing: the train passes',
      duration: 7.5,
      camera: { position: [5.4, 7.35, 15.2], target: [-8, 7.6, 7.6], fov: 42 },
      cameraTo: { position: [5.1, 7.35, 14.9], target: [-8, 7.7, 7.2], fov: 41 },
      caption: 'Not today. Not this sky.',
      captionAt: [4.6, 7.2],
      moves: [
        { entity: KAHO, path: [[X, 6.1, 13.4], [X, 6.1, 11.8]], end: 0.2, face: [-3, 6.5, 9.4] },
        { entity: TRAIN, path: [[70, 6.554, 9.4], [-75, 6.554, 9.4]], start: 0.06, end: 0.94, ease: 'linear', orient: false },
      ],
      grade: AFTERNOON,
    },
    {
      name: 'Up the first terraces',
      duration: 5,
      camera: { position: [2.1, 14.4, -18.9], target: [X, 9, -6], fov: 44 },
      track: KAHO,
      trackOffset: [0, 0.9, 0],
      moves: [{ entity: KAHO, path: [[X, 6.1, 9.0], [X, 6.1, -5.5], [X, 12.05, -18.0], [X, 12.05, -20]], ease: 'linear' }],
      gradeTo: GOLDEN,
    },
    {
      name: 'Through the shrine gate',
      duration: 5.5,
      camera: { position: [-0.9, 13.5, -39.6], target: [0.5, 22, -70], fov: 34 },
      cameraTo: { position: [-0.8, 13.7, -40.4], target: [0.5, 24, -70], fov: 32 },
      track: KAHO,
      trackOffset: [0, 1.6, -6],
      moves: [{ entity: KAHO, path: [[X, 12.6, -41.5], [X, 18.05, -48.4], [X, 18.05, -60]], ease: 'linear' }],
      grade: GOLDEN,
    },
    {
      name: 'Ma: the cloud and the gulls',
      duration: 5,
      camera: { position: [4, 27.6, -86], target: [-14, 44, 160], fov: 46 },
      cameraTo: { position: [4, 27.6, -86], target: [-22, 46, 160], fov: 46 },
      ease: 'linear',
      gradeTo: MAGENTA,
    },
    {
      name: 'The last stair',
      duration: 7,
      camera: { position: [-1.6, 45.9, -132.4], target: [X, 33, -104], fov: 40 },
      track: KAHO,
      trackOffset: [0, 0.6, 0],
      moves: [{ entity: KAHO, path: [[X, 29.5, -100], [X, 44.05, -129.6], [X, 44.05, -130.4]], ease: 'out' }],
      grade: MAGENTA,
    },
    {
      name: 'Arrival: the lamps come on',
      duration: 5.5,
      camera: { position: [4.4, 45.35, -134.0], target: [0.4, 45.0, -130.4], fov: 40 },
      caption: '…made it.',
      captionAt: [2.6, 5.2],
      moves: [{ entity: KAHO, path: [[X, 44.05, -130.4], KAHO_END], end: 0.45, face: [-40, 40, 160] }],
      hour: 18.7,
      grade: { ...MAGENTA, practicals: 0.15 },
      gradeTo: { ...MAGENTA, practicals: 1 },
    },
    {
      name: 'Over her shoulder, the sun on the sea',
      duration: 4.5,
      camera: { position: [1.75, 45.6, -132.35], target: [-22, 41, 2], fov: 30 },
      cameraTo: { position: [1.7, 45.6, -132.2], target: [-23, 40.6, 2], fov: 28 },
      ease: 'linear',
    },
    {
      name: 'The held wide: the sun touches the sea',
      duration: 13,
      camera: { position: [5.5, 48.8, -143.5], target: [-44, 26, 160], fov: 52 },
      cameraTo: { position: [4.5, 47.6, -139.5], target: [-46, 25, 160], fov: 50 },
      ease: 'inOut',
      grade: MAGENTA,
      gradeTo: BLUE_HOUR,
    },
    {
      name: 'The town at blue hour',
      duration: 7.5,
      camera: { position: [30, 4.5, 75], target: [0, 18, -50], fov: 40 },
      cameraTo: { position: [27, 4.6, 72], target: [0, 18, -50], fov: 38 },
      transition: 'fade',
      transitionSeconds: 1.2,
      grade: BLUE_HOUR,
    },
  ],
};
