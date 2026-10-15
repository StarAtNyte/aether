/**
 * The cast and the motion list of the character pipeline: which Rocketbox
 * bodies ship, what each one is, and which Rocketbox clips become which
 * named clips of the shared humanoid animation set.
 */

/** One shipped body. `src` is the folder name in the Rocketbox repository. */
export interface CastSource {
  id: string;
  src: string;
  gender: 'male' | 'female';
  /** Short human description used by the planner and the credits. */
  look: string;
}

/** The ten bodies (all from `Assets/Avatars/Adults`). */
export const CAST_SOURCES: readonly CastSource[] = [
  { id: 'marcus', src: 'Male_Adult_03', gender: 'male', look: 'older man, grey hair, grey jacket' },
  { id: 'dario', src: 'Male_Adult_04', gender: 'male', look: 'young man, dark curly hair, dark hoodie' },
  { id: 'tomas', src: 'Male_Adult_05', gender: 'male', look: 'man in a green jacket and tan vest' },
  { id: 'felix', src: 'Male_Adult_06', gender: 'male', look: 'young man, red sweater' },
  { id: 'kofi', src: 'Male_Adult_12', gender: 'male', look: 'man, denim jacket and white shirt' },
  { id: 'walter', src: 'Male_Adult_14', gender: 'male', look: 'balding middle-aged man, grey shirt, khakis' },
  { id: 'sophie', src: 'Female_Adult_02', gender: 'female', look: 'woman, white blouse and skirt' },
  { id: 'edith', src: 'Female_Adult_04', gender: 'female', look: 'older woman, brown jacket and trousers' },
  { id: 'rosa', src: 'Female_Adult_11', gender: 'female', look: 'woman, brown dress and boots' },
  { id: 'juno', src: 'Female_Adult_17', gender: 'female', look: 'blonde woman, green top and jeans' },
];

/** Rocketbox clip (without the `m_` / `f_` prefix) to the name the runtime uses. */
export const CLIPS: ReadonlyArray<readonly [string, string]> = [
  ['idle_neutral_01', 'idle'],
  ['idle_breathe_01', 'idle_breathe'],
  ['idle_look_around_01', 'idle_look'],
  ['idle_nervous_01', 'idle_nervous'],
  ['idle_waiting_01', 'idle_wait'],
  ['idle_neutral_03', 'idle_b'],
  ['idle_angry_01', 'idle_angry'],
  ['idle_yawn_01', 'idle_yawn'],
  ['idle_scratch_head_01', 'idle_scratch'],
  ['walk_neutral', 'walk'],
  ['walk_slow_01', 'walk_slow'],
  ['walk_fast_01', 'walk_fast'],
  ['walk_stroll_01', 'stroll'],
  ['walk_bruised', 'walk_hurt'],
  ['walk_drunk', 'walk_drunk'],
  ['walk_start', 'walk_start'],
  ['walk_stop', 'walk_stop'],
  ['run_slow_01', 'jog'],
  ['run_neutral', 'run'],
  ['run_fast_01', 'sprint'],
  ['run_start', 'run_start'],
  ['run_stop', 'run_stop'],
  ['crouch_idle', 'crouch'],
  ['crouch_gestic', 'crouch_talk'],
  ['crouch_in', 'crouch_in'],
  ['crouch_out', 'crouch_out'],
  ['gestic_talk_neutral_01', 'talk'],
  ['gestic_talk_neutral_02', 'talk_b'],
  ['gestic_talk_excited_01', 'talk_excited'],
  ['gestic_talk_angry_01', 'talk_angry'],
  ['gestic_talk_relaxed_01', 'talk_calm'],
  ['gestic_listen_neutral_01', 'listen'],
  ['gestic_listen_accept_01', 'nod'],
  ['gestic_listen_deny_01', 'shake_head'],
  ['gestic_shrug_01', 'shrug'],
  ['gestic_thoughtful_01', 'think'],
  ['gestic_laugh_loud', 'laugh'],
  ['gestic_presentation_left_01', 'present'],
  ['wave_01', 'wave'],
  ['wave_02', 'wave_b'],
  ['cheer_01', 'cheer'],
  ['claphands_01', 'clap'],
  ['sit_down_chair_01', 'sit_down'],
  ['sit_chair_idle_neutral_01', 'sit'],
  ['sit_chair_gestic_shrug_01', 'sit_shrug'],
  ['sit_chair_breathe_01', 'sit_breathe'],
  ['sit_stand_up_chair_01', 'stand_up'],
  ['documents_take', 'take'],
  ['documents_check', 'read'],
  ['documents_idle', 'hold_papers'],
  ['knock_door', 'knock'],
  ['try_door_inwards', 'door'],
  ['drink_drinking', 'drink'],
  ['cell_phone_talk_01', 'phone'],
  ['turn_left_90', 'turn_left'],
  ['turn_right_90', 'turn_right'],
  ['turn_left_180', 'turn_around'],
];
