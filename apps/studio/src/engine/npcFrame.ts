/**
 * What the play UI shows of the NPC system: the running conversation, the
 * "talk" hint and the speech bubbles above characters (projected to viewport
 * fractions). Sampled a few times a second by the simulation; the shapes are
 * plain data so React can diff them and tests can build them by hand.
 */
import type { NpcSystem } from '@aether/logic';

/** The running conversation. */
export interface NpcDialogueFrame {
  npc: string;
  speaker: string;
  text: string;
  choices: string[];
  mode: 'talk' | 'trade';
  /** Bumps whenever the node changes (restarts the typewriter). */
  version: number;
  /** The character can hold a free conversation. */
  chat: boolean;
  /** `text` is a free reply. */
  free: boolean;
}

/** A line above a character; `x`/`y` are fractions of the viewport (0,0 = top left). */
export interface NpcBubbleFrame {
  id: string;
  name: string;
  text: string;
  x: number;
  y: number;
}

/** Everything the NPC overlay needs. */
export interface NpcFrame {
  dialogue: NpcDialogueFrame | null;
  prompt: { npc: string; name: string } | null;
  bubbles: NpcBubbleFrame[];
}

/** Column-major 4×4 matrices as `THREE.Matrix4.elements`. */
export interface ViewMatrices {
  view: ArrayLike<number>;
  projection: ArrayLike<number>;
}

/**
 * Project a world point to viewport fractions with the camera matrices.
 * Returns false (and leaves `out` alone) when the point is behind the camera
 * or outside the view by more than a small margin.
 */
export function projectToViewport(m: ViewMatrices, x: number, y: number, z: number, out: { x: number; y: number }): boolean {
  const v = m.view;
  const p = m.projection;
  const vx = (v[0] as number) * x + (v[4] as number) * y + (v[8] as number) * z + (v[12] as number);
  const vy = (v[1] as number) * x + (v[5] as number) * y + (v[9] as number) * z + (v[13] as number);
  const vz = (v[2] as number) * x + (v[6] as number) * y + (v[10] as number) * z + (v[14] as number);
  const cx = (p[0] as number) * vx + (p[4] as number) * vy + (p[8] as number) * vz + (p[12] as number);
  const cy = (p[1] as number) * vx + (p[5] as number) * vy + (p[9] as number) * vz + (p[13] as number);
  const cw = (p[3] as number) * vx + (p[7] as number) * vy + (p[11] as number) * vz + (p[15] as number);
  if (!(cw > 0.05)) return false;
  const nx = cx / cw;
  const ny = cy / cw;
  if (Math.abs(nx) > 1.15 || Math.abs(ny) > 1.15) return false;
  out.x = nx * 0.5 + 0.5;
  out.y = 0.5 - ny * 0.5;
  return true;
}

const scratch = { x: 0, y: 0 };

/** Longest bubble text kept in a frame. */
const MAX_BUBBLE_TEXT = 140;

/**
 * Sample the NPC system. Returns null when there is nothing to show (no
 * conversation, no prompt, no bubbles).
 */
export function buildNpcFrame(npcs: NpcSystem, matrices: ViewMatrices | null): NpcFrame | null {
  const d = npcs.dialogue;
  const prompt = npcs.prompt;
  const count = npcs.bubbleCount;
  if (!d && !prompt && count === 0) return null;
  const bubbles: NpcBubbleFrame[] = [];
  if (matrices) {
    for (let i = 0; i < count; i++) {
      const b = npcs.bubbleAt(i);
      if (!b || !projectToViewport(matrices, b.x, b.y, b.z, scratch)) continue;
      bubbles.push({ id: b.npc, name: b.name, text: b.text.slice(0, MAX_BUBBLE_TEXT), x: scratch.x, y: scratch.y });
    }
  }
  return {
    dialogue: d ? { npc: d.npc, speaker: d.speaker, text: d.text, choices: d.choices.slice(0, 6), mode: d.mode, version: d.version, chat: d.chat, free: d.free } : null,
    prompt: prompt ? { npc: prompt.npc, name: prompt.name } : null,
    bubbles,
  };
}

/** Cheap structural signature of a frame (bubble positions rounded to 0.5% of the viewport). */
export function frameSignature(f: NpcFrame | null): string {
  if (!f) return '';
  const d = f.dialogue;
  let s = d ? `d${d.npc}:${d.version}` : '';
  if (f.prompt) s += `|p${f.prompt.npc}`;
  for (const b of f.bubbles) s += `|b${b.id}:${b.text.length}:${Math.round(b.x * 200)}:${Math.round(b.y * 200)}`;
  return s;
}
