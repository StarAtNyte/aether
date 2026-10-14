/**
 * Interface sounds: a few quiet, procedural cues (prompt sent, proof passed,
 * play started) through the game's synth. Opt-in (`settings.uiSounds`);
 * the audio context is created on the first cue, which always follows a
 * user gesture.
 */
import { SoundBoard } from '../engine/sound';

/** Interface cues. */
export type UiSound = 'send' | 'proof' | 'play' | 'tick';

let board: SoundBoard | null = null;

/** Play an interface cue when the user turned interface sounds on. Never throws. */
export function playUiSound(settings: { readonly uiSounds: boolean }, sound: UiSound): void {
  if (!settings.uiSounds) return;
  try {
    board ??= new SoundBoard();
    board.play(`ui-${sound}`);
  } catch {
    /* audio unavailable */
  }
}
