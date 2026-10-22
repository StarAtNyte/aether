/**
 * Look tuning as an edit: the `tune_look` tool. The assistant looks at renders and sets how light and colour are
 * presented (exposure, white balance, saturation, contrast, bloom, fog, light and foliage tints, interior warmth,
 * lamp strength, vignette). The renderer's constants are only the defaults; what is set here is stored in the World
 * IR (`environment`, `environment.grade`, `environment.look`) by ordinary patches, so it is one undo step, shows in a
 * diff, survives saving and sharing, and every render (studio, stills, review images) respects it.
 *
 * Nothing here judges: it applies what the assistant decided and says what changed, from what, to what.
 */
import { z } from 'zod';
import { Color as HexColor, type Patch, type WorldDoc } from '@aether/core';
import { bakeText } from './bake-edit';

const unit = (min: number, max: number) => z.number().min(min).max(max);

/** Names the model may reset to the renderer's default. */
export const LOOK_RESET_KEYS = [
  'exposure', 'bloom', 'ambientIntensity', 'sunIntensity', 'hdriIntensity', 'fog',
  'temperature', 'tint', 'saturation', 'contrast', 'exposureEv',
  'interiorWarmth', 'interiorBalance', 'sunTint', 'ambientTint', 'foliageTint', 'lampStrength', 'vignette',
] as const;
export type LookResetKey = (typeof LOOK_RESET_KEYS)[number];

/** Input of the `tune_look` tool. Every field is optional; what is omitted is left as it is. */
export const TuneLookInput = z.object({
  /** Overall exposure multiplier of the tone mapping (1 = neutral). */
  exposure: unit(0.1, 4).optional(),
  /** Extra exposure in stops on top of `exposure` (the grade's own). */
  exposureEv: unit(-3, 3).optional(),
  /** White balance: warm (+) / cool (-). */
  temperature: unit(-1, 1).optional(),
  /** Green (+) / magenta (-) tint. */
  tint: unit(-1, 1).optional(),
  saturation: unit(0.4, 1.8).optional(),
  contrast: unit(0.6, 1.6).optional(),
  bloom: unit(0, 3).optional(),
  /** Strength of the ambient (sky) light. */
  ambientIntensity: unit(0, 8).optional(),
  /** Strength of the sun. */
  sunIntensity: unit(0, 16).optional(),
  /** Strength of an image-based (HDRI) light, when the world has one. */
  hdriIntensity: unit(0, 8).optional(),
  /** Fog colour (#rrggbb). Needs a density when the world has no fog yet. */
  fogColor: HexColor.optional(),
  fogDensity: unit(0, 1).optional(),
  /** Aerial-perspective range in metres (distant scenery hazes at this distance). */
  fogVisibility: unit(30, 20000).optional(),
  /** Warm shift of the white balance in a lit interior, in grade temperature units (renderer default 0.45). */
  interiorWarmth: unit(-1, 1.5).optional(),
  /** How much of a room light's own colour cast the interior white balance removes, 0 none .. 1.5 (default 1). */
  interiorBalance: unit(0, 1.5).optional(),
  /** Colour multiplier of the sun light (#rrggbb; #ffffff keeps it). */
  sunTint: HexColor.optional(),
  /** Colour multiplier of the sky/ambient light. */
  ambientTint: HexColor.optional(),
  /** Colour multiplier of leaf, needle and grass cards. */
  foliageTint: HexColor.optional(),
  /** Strength of the room lamps in the baked interior light, 0 none .. 3 (default 1). */
  lampStrength: unit(0, 3).optional(),
  /** Edge darkening, 0 none .. 1 strong (default 0.22). */
  vignette: unit(0, 1).optional(),
  /** Parameters to put back to the renderer's default (also valid with new values for others). */
  reset: z.array(z.enum(LOOK_RESET_KEYS)).max(LOOK_RESET_KEYS.length).optional(),
  /** Why, in a sentence: shown in the history. */
  message: z.string().max(200).optional(),
});
export type TuneLookInput = z.infer<typeof TuneLookInput>;

const ENV_FIELDS = ['exposure', 'bloom', 'ambientIntensity', 'sunIntensity', 'hdriIntensity'] as const;
const GRADE_FIELDS = ['temperature', 'tint', 'saturation', 'contrast', 'exposureEv'] as const;
const LOOK_FIELDS = ['interiorWarmth', 'interiorBalance', 'sunTint', 'ambientTint', 'foliageTint', 'lampStrength', 'vignette'] as const;

/** Result of {@link lookPatches}. */
export interface LookEditResult {
  patches: Patch[];
  /** What changed ("exposure 1 → 1.4; grade.temperature unset → 0.2"), for the model or the chat. */
  summary: string;
  refused: string[];
}

function show(v: unknown): string {
  return v === undefined || v === null ? 'default' : typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : String(v);
}

/** The current value of a look parameter in `world` (undefined: not set, the renderer's default applies). */
export function currentLook(world: WorldDoc, key: LookResetKey | 'fogColor' | 'fogDensity' | 'fogVisibility'): unknown {
  const env = world.environment;
  if ((ENV_FIELDS as readonly string[]).includes(key)) return (env as Record<string, unknown>)[key];
  if ((GRADE_FIELDS as readonly string[]).includes(key)) return (env.grade as Record<string, unknown> | undefined)?.[key];
  if ((LOOK_FIELDS as readonly string[]).includes(key)) return (env.look as Record<string, unknown> | undefined)?.[key];
  if (key === 'fogColor') return env.fog?.color;
  if (key === 'fogDensity') return env.fog?.density;
  if (key === 'fogVisibility') return env.fog?.visibility;
  if (key === 'fog') return env.fog ?? undefined;
  return undefined;
}

/** Patches and words for a `tune_look` call. Never throws; input is assumed validated by {@link TuneLookInput}. */
export function lookPatches(world: WorldDoc, input: TuneLookInput): LookEditResult {
  const set: Record<string, unknown> = {};
  const grade: Record<string, unknown> = {};
  const look: Record<string, unknown> = {};
  const notes: string[] = [];
  const refused: string[] = [];
  const reset = new Set<string>(input.reset ?? []);
  const note = (name: string, key: Parameters<typeof currentLook>[1], to: unknown): void => {
    const from = currentLook(world, key);
    if (JSON.stringify(from ?? null) !== JSON.stringify(to ?? null)) notes.push(`${name} ${show(from)} → ${show(to)}`);
  };
  for (const k of ENV_FIELDS) {
    const v = input[k];
    if (v !== undefined) {
      set[k] = v;
      note(k, k, v);
    } else if (reset.has(k)) {
      // The schema default applies once the key is deleted (null deletes under the merge rules).
      set[k] = null;
      note(k, k, undefined);
    }
  }
  for (const k of GRADE_FIELDS) {
    const v = input[k];
    if (v !== undefined) {
      grade[k] = v;
      note(`grade.${k}`, k, v);
    } else if (reset.has(k)) {
      grade[k] = null;
      note(`grade.${k}`, k, undefined);
    }
  }
  for (const k of LOOK_FIELDS) {
    const v = input[k];
    if (v !== undefined) {
      look[k] = v;
      note(`look.${k}`, k, v);
    } else if (reset.has(k)) {
      look[k] = null;
      note(`look.${k}`, k, undefined);
    }
  }
  if (Object.keys(grade).length > 0) set['grade'] = grade;
  if (Object.keys(look).length > 0) set['look'] = look;
  // Fog: a colour, density or range changes the fog object; without any fog, a density is needed to create one.
  if (reset.has('fog')) {
    if (world.environment.fog) notes.push('fog removed');
    set['fog'] = null;
  } else if (input.fogColor !== undefined || input.fogDensity !== undefined || input.fogVisibility !== undefined) {
    const cur = world.environment.fog;
    const density = input.fogDensity ?? cur?.density;
    if (density === undefined) refused.push('fog: the world has no fog yet, so give fogDensity (0..1) with the colour');
    else {
      const fog: Record<string, unknown> = { color: input.fogColor ?? cur?.color ?? '#c9d6e3', density };
      const vis = input.fogVisibility ?? cur?.visibility;
      if (vis !== undefined) fog['visibility'] = vis;
      set['fog'] = fog;
      if (input.fogColor !== undefined) note('fog.color', 'fogColor', input.fogColor);
      if (input.fogDensity !== undefined) note('fog.density', 'fogDensity', input.fogDensity);
      if (input.fogVisibility !== undefined) note('fog.visibility', 'fogVisibility', input.fogVisibility);
    }
  }
  const patches: Patch[] = Object.keys(set).length > 0 && notes.length > 0 ? [{ op: 'setEnvironment', set: set as never }] : [];
  const summary = notes.length > 0 ? `Look changed: ${notes.join('; ')}.` : refused.length > 0 ? 'Nothing changed.' : 'Nothing changed: those values are already set.';
  return { patches, summary, refused };
}

/** The look of a world in words, for the assistant that is about to tune it (defaults named). */
export function lookText(world: WorldDoc): string {
  const e = world.environment;
  const g = e.grade ?? {};
  const l = e.look ?? {};
  const d = (v: unknown, def: string): string => (v === undefined ? `${def} (default)` : String(typeof v === 'number' ? Math.round(v * 1000) / 1000 : v));
  return [
    `sky ${e.sky}${e.timeOfDay !== undefined ? ` at ${e.timeOfDay} h` : ''}; exposure ${d(e.exposure, '1')}, bloom ${d(e.bloom, '0.4')}, ambient ${d(e.ambientIntensity, '0.4')}, sun ${d(e.sunIntensity, '2.5')}`,
    `grade: temperature ${d(g.temperature, 'preset')}, tint ${d(g.tint, 'preset')}, saturation ${d(g.saturation, 'preset')}, contrast ${d(g.contrast, 'preset')}, exposureEv ${d(g.exposureEv, 'preset')}`,
    `look: interiorWarmth ${d(l.interiorWarmth, '0.45')}, interiorBalance ${d(l.interiorBalance, '1')}, sunTint ${d(l.sunTint, 'white')}, ambientTint ${d(l.ambientTint, 'white')}, foliageTint ${d(l.foliageTint, 'white')}, lampStrength ${d(l.lampStrength, '1')}, vignette ${d(l.vignette, '0.22')}`,
    bakeText(world),
    `fog: ${e.fog ? `${e.fog.color}, density ${e.fog.density}${e.fog.visibility ? `, range ${e.fog.visibility} m` : ''}` : 'none'}`,
  ].join('\n');
}
