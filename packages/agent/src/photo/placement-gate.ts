/**
 * MEASURED PLACEMENT IS THE DEFAULT. After the first build from the measurements every linked piece has an ANCHOR: the pose the
 * measurements gave it (position, size, facing). The model may still move or resize a piece, but a change that takes it more than
 * `MOVE_TOL` metres (or 15 percent in size, or 20 degrees of facing) away from the anchor has to say why, citing evidence (the mask
 * is occluded, a collision, the photo shows it behind the curtain). Without a reason the edit is not applied and the reply asks for
 * one; with it the edit goes through and the reason is kept in the ledger. Moving back toward the anchor is free. Advisory: the model
 * decides, the gate only makes drift costly and visible. Pieces without an anchor are not touched.
 */
import { PHOTO_BUILDING_ID } from '@aether/arch/photo';
import { readScene, runDesignTool } from '@aether/arch';
import type { WorldDoc } from '@aether/core';

export const MOVE_TOL = 0.15;
export const SIZE_TOL = 0.15;
export const YAW_TOL = 20;
/** A reason shorter than this is not a reason. */
const MIN_REASON = 12;

/** Measured placement as the default; `AETHER_PLACEMENT_GATE=off` restores the earlier behaviour (the model places freely) for before/after runs. */
export const placementGateOn = (): boolean => (typeof process !== 'undefined' ? process.env['AETHER_PLACEMENT_GATE'] !== 'off' : true);

export interface Anchor {
  itemId: string;
  label: string;
  pos: [number, number, number];
  size: [number, number, number];
  yaw: number;
}

export interface Pose {
  pos: [number, number, number];
  size: [number, number, number];
  yaw: number;
}

export function posesOf(world: WorldDoc): Map<string, Pose> {
  const out = new Map<string, Pose>();
  const scene = readScene(world, PHOTO_BUILDING_ID);
  if (scene) for (const i of scene.items) out.set(i.id, { pos: i.pos, size: i.size, yaw: i.yaw });
  return out;
}

const yawGap = (a: number, b: number): number => Math.abs((((a - b) % 360) + 540) % 360 - 180);
const xz = (a: Pose, b: Pose): number => Math.hypot(a.pos[0] - b.pos[0], a.pos[2] - b.pos[2]);
const sizeGap = (a: Pose, b: Pose): number => Math.max(...[0, 2].map((k) => Math.abs((a.size[k] as number) / Math.max(0.01, b.size[k] as number) - 1)));

/** How far a pose is from its anchor. */
export function driftOf(p: Pose, a: Anchor): { m: number; size: number; yaw: number } {
  return { m: xz(p, a), size: sizeGap(p, a), yaw: yawGap(p.yaw, a.yaw) };
}

export interface GateResult {
  /** The input to run (unexplained edits left out); null: nothing is left to run. */
  input: unknown | null;
  /** Reasons accepted: entity id -> text, to keep in the ledger. */
  reasons: Array<{ entity: string; reason: string }>;
  /** Text for the model about edits not applied. */
  refusal: string;
  /** Edits left out. */
  held: number;
}

interface RawEdit { op?: unknown; ref?: unknown; reason?: unknown; [k: string]: unknown }

const reasonOf = (e: RawEdit, whole: string): string => {
  const own = typeof e.reason === 'string' ? e.reason.trim() : '';
  return own.length >= MIN_REASON ? own : whole;
};

/**
 * Check an `edit_items` input against the anchors. `reason` may stand on each edit or on the call. Edits are dry-run on the world;
 * an edit whose piece ends up beyond the tolerance of its anchor (and further than before) without a reason is held back.
 */
export function gateEdits(world: WorldDoc, rawInput: unknown, anchors: ReadonlyMap<string, Anchor>): GateResult {
  const none: GateResult = { input: rawInput, reasons: [], refusal: '', held: 0 };
  if (anchors.size === 0 || typeof rawInput !== 'object' || rawInput === null) return none;
  const top = rawInput as { edits?: unknown; reason?: unknown; [k: string]: unknown };
  if (!Array.isArray(top.edits)) return none;
  const whole = typeof top.reason === 'string' && top.reason.trim().length >= MIN_REASON ? top.reason.trim() : '';
  const edits = top.edits.filter((e): e is RawEdit => typeof e === 'object' && e !== null);
  const strip = (e: RawEdit): RawEdit => { const { reason: _r, ...rest } = e; return rest; };
  const { reason: _wr, ...topRest } = top;
  const before = posesOf(world);
  // Per edit, alone from the current world (the common case is independent pieces).
  const held: Array<{ edit: RawEdit; text: string }> = [];
  const kept: RawEdit[] = [];
  const reasons: Array<{ entity: string; reason: string }> = [];
  for (const e of edits) {
    const ref = typeof e.ref === 'string' ? e.ref : '';
    const anchor = anchors.get(ref);
    if (!anchor || e.op === 'remove' || e.op === 'declare_plan') { kept.push(e); continue; }
    const res = runDesignTool(world, 'edit_items', { ...topRest, edits: [strip(e)] });
    if (!res.ok) { kept.push(e); continue; }
    const after = posesOf(res.world).get(ref);
    const was = before.get(ref);
    if (!after || !was) { kept.push(e); continue; }
    const now = driftOf(after, anchor);
    const prev = driftOf(was, anchor);
    const worseM = now.m > MOVE_TOL && now.m > prev.m + 0.02;
    const worseS = now.size > SIZE_TOL && now.size > prev.size + 0.02;
    const worseY = now.yaw > YAW_TOL && now.yaw > prev.yaw + 2;
    if (!(worseM || worseS || worseY)) { kept.push(e); continue; }
    const why = reasonOf(e, whole);
    const what = [worseM ? `${Math.round(now.m * 100)} cm from the measured spot` : '', worseS ? `${Math.round(now.size * 100)} percent off the measured size` : '', worseY ? `${Math.round(now.yaw)} degrees off the measured facing` : ''].filter(Boolean).join(', ');
    if (why) { kept.push(e); reasons.push({ entity: ref, reason: `${what}: ${why}`.slice(0, 300) }); continue; }
    held.push({ edit: e, text: `${anchor.label} (${ref}) would end ${what}. The measurements put it at (${anchor.pos[0].toFixed(2)}, ${anchor.pos[2].toFixed(2)}), size ${anchor.size.map((v) => v.toFixed(2)).join(' x ')}, yaw ${Math.round(anchor.yaw)}.` });
  }
  if (held.length === 0) return { input: { ...topRest, edits: kept.map(strip) }, reasons, refusal: '', held: 0 };
  const refusal = `NOT APPLIED, measured placement is the default: ${held.map((h) => h.text).join(' ')} Resend the edit with a "reason" that cites evidence (for example the mask is occluded by another piece so the measured footprint is unreliable, a collision with the wall, the photo shows it behind the curtain), or keep the measured pose. A reason is recorded in the ledger.`;
  return { input: kept.length > 0 ? { ...topRest, edits: kept.map(strip) } : null, reasons, refusal, held: held.length };
}
