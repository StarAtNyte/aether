/**
 * Runs a {@link PhotoBuild} through the design tools: the plan first, then the placement steps in phases,
 * each phase one `place_items` call. What can only be known after earlier steps (the built id of a window,
 * the top of the bed a picture hangs above) is resolved from the world between phases.
 *
 * The tool caller is injected: the agent passes one that commits through the host (so the run shows in the
 * chat and the undo history); the default applies the patches to a document in memory (tests, evaluation).
 */
import { applyPatches, type Json, type WorldDoc } from '@aether/core';
import { runDesignTool } from '../scene/dispatch';
import { findItem, isLookupError } from '../scene/facts';
import { readScene } from '../scene/read';
import type { Scene } from '../scene/types';
import { PHOTO_BUILDING_ID, PHOTO_ROOM_ID, type PhotoBuild, type PlaceStep } from './derive';

/** What a tool call returned to the runner. */
export interface ToolReply {
  /** The world after the call (the same one when nothing changed). */
  world: WorldDoc;
  /** The tool's text (facts and refusals). */
  text: string;
  /** The call was accepted (at least partly). */
  ok: boolean;
}

/** Calls one design tool. */
export type ToolCaller = (name: 'design_plan' | 'place_items', input: Record<string, unknown>) => Promise<ToolReply> | ToolReply;

/** What happened to one placement step. */
export interface StepOutcome {
  id: string;
  kind: string;
  ok: boolean;
  /** Refusal reason or the note the tool gave. */
  text: string;
}

/** Result of {@link runBuild}. */
export interface BuildRun {
  world: WorldDoc;
  /** The plan was accepted and the shell built. */
  shellOk: boolean;
  shellText: string;
  outcomes: StepOutcome[];
  /** Plan opening id → built entity id. */
  openings: Record<string, string>;
}

/** A caller that runs the design tools on a document and applies the patches in memory. */
export function memoryCaller(initial: WorldDoc): { call: ToolCaller; world: () => WorldDoc } {
  let world = initial;
  return {
    call: (name, input) => {
      const res = runDesignTool(world, name, input);
      if (res.patches.length > 0) world = applyPatches(world, res.patches).world;
      return { world, text: res.text, ok: res.ok || res.accepted > 0 };
    },
    world: () => world,
  };
}

function sceneOf(world: WorldDoc): Scene | null {
  return readScene(world, PHOTO_BUILDING_ID);
}

/** Built ids of the plan's openings, matched by wall and centre. */
export function builtOpenings(world: WorldDoc, build: PhotoBuild): Record<string, string> {
  const scene = sceneOf(world);
  const out: Record<string, string> = {};
  const room = scene?.rooms.find((r) => r.key === PHOTO_ROOM_ID);
  if (!room) return out;
  for (const o of build.plan.levels[0]?.openings ?? []) {
    if (!o.id) continue;
    const found = room.walls
      .filter((w) => w.compass === o.wall)
      .flatMap((w) => w.openings)
      .find((x) => Math.abs(x.centre - o.along) < 0.35 && (o.kind === 'window') === (x.kind === 'window'));
    if (found) out[o.id] = found.id;
  }
  return out;
}

/** The `place_items` items of one phase with their world-dependent fields filled in. */
export function resolveStep(world: WorldDoc, step: PlaceStep, openings: Readonly<Record<string, string>>): { item: Record<string, Json> } | { error: string } {
  const item: Record<string, Json> = { ...step.input };
  if (step.openingAlias !== undefined) {
    const built = openings[step.openingAlias];
    if (!built) return { error: `window "${step.openingAlias}" was not built, so the curtains have nothing to hang beside` };
    item['opening'] = built;
  }
  if (step.aboveOf) {
    const scene = sceneOf(world);
    const host = scene ? findItem(scene, step.aboveOf.target) : null;
    if (!host || isLookupError(host)) return { error: `"${step.aboveOf.target}" is not placed, so ${step.id} cannot hang above it` };
    item['y'] = Math.round((host.y1 + step.aboveOf.gap) * 100) / 100;
  }
  return { item };
}

const PHASES: ReadonlyArray<PlaceStep['phase'][]> = [['rug', 'floor'], ['surface'], ['wall'], ['curtain'], ['ceiling', 'trim']];

/** Build the shell and place every step. Never throws; refusals are in the outcomes. */
export async function runBuild(world: WorldDoc, build: PhotoBuild, call: ToolCaller): Promise<BuildRun> {
  let current = world;
  const plan = await call('design_plan', { plan: build.plan });
  current = plan.world;
  const outcomes: StepOutcome[] = [];
  if (!plan.ok) return { world: current, shellOk: false, shellText: plan.text, outcomes, openings: {} };
  const openings = builtOpenings(current, build);
  // An opening the builder dropped (it says so in a note) must not pass unnoticed: the compare loop is told.
  for (const o of build.plan.levels[0]?.openings ?? []) {
    if (o.id && !openings[o.id]) outcomes.push({ id: o.id, kind: o.kind, ok: false, text: `the ${o.kind} ${o.id} on the ${o.wall} wall was not built (${(plan.text.split('\n').find((l) => /^Note:/.test(l)) ?? 'it did not fit the wall').slice(0, 200)})` });
  }
  for (const phases of PHASES) {
    const steps = build.steps.filter((s) => phases.includes(s.phase));
    // Pieces hung above another need that piece placed first: split the phase when one names a piece of the same phase.
    const now = steps.filter((s) => !s.aboveOf);
    const later = steps.filter((s) => s.aboveOf);
    for (const group of [now, later]) {
      if (group.length === 0) continue;
      const items: Array<{ step: PlaceStep; item: Record<string, Json> }> = [];
      for (const step of group) {
        const r = resolveStep(current, step, openings);
        if ('error' in r) outcomes.push({ id: step.id, kind: String(step.input['kind']), ok: false, text: r.error });
        else items.push({ step, item: r.item });
      }
      if (items.length === 0) continue;
      const reply = await call('place_items', { items: items.map((i) => i.item), message: `Place ${items.map((i) => i.step.id).slice(0, 4).join(', ')}${items.length > 4 ? '…' : ''}` });
      current = reply.world;
      const refused = refusedByIndex(reply.text);
      const results = items.map(({ step }, k) => ({ step, bad: refused.get(k + 1) ?? (reply.ok || reply.text.includes('applied') ? undefined : reply.text.slice(0, 300)) }));
      // A real model that does not fit where the part would (it is bigger, or its footprint meets a neighbour) gives way to the
      // parametric part, which the room was laid out for: the same piece is sent again without its model.
      const retry = items.map((it, k) => ({ it, k })).filter(({ it, k }) => results[k]!.bad !== undefined && it.item['model'] !== undefined);
      if (retry.length > 0) {
        const again = await call('place_items', { items: retry.map(({ it }) => { const { model: _m, fit: _f, ...rest } = it.item; return rest; }), message: `Place ${retry.map(({ it }) => it.step.id).slice(0, 4).join(', ')} as parts` });
        current = again.world;
        const refusedAgain = refusedByIndex(again.text);
        retry.forEach(({ k }, j) => {
          results[k] = { step: results[k]!.step, bad: refusedAgain.get(j + 1) ?? (again.ok || again.text.includes('applied') ? undefined : again.text.slice(0, 300)) };
        });
      }
      // A refusal that only asks for a hand's breadth (the reply names the spot: "Move x 0.06 m south (to 2.25, 2.66)") would drop a
      // piece the photo shows over a few centimetres of a rounded size: it is placed there instead, facing as it did.
      const nudge = items.map((it, k) => ({ it, k, to: nudgeTarget(results[k]!.bad, it.step.id) })).filter((n) => n.to !== null);
      if (nudge.length > 0) {
        const again = await call('place_items', { items: nudge.map(({ it, to }) => nudgedItem(it.item, to as [number, number])), message: `Place ${nudge.map(({ it }) => it.step.id).join(', ')} a few centimetres from where the photo puts them` });
        current = again.world;
        const refusedAgain = refusedByIndex(again.text);
        nudge.forEach(({ k }, j) => {
          results[k] = { step: results[k]!.step, bad: refusedAgain.get(j + 1) ?? (again.ok || again.text.includes('applied') ? undefined : again.text.slice(0, 300)) };
        });
      }
      for (const { step, bad } of results) outcomes.push({ id: step.id, kind: String(step.input['kind']), ok: bad === undefined, text: bad ?? '' });
    }
  }
  return { world: current, shellOk: true, shellText: plan.text, outcomes, openings };
}

/** The refusal reason of each item index (1-based, as the tool numbers them) that `place_items` reported refused. */
function refusedByIndex(text: string): Map<number, string> {
  const out = new Map<number, string>();
  // A refusal can span lines (a heading and one line per problem): split before each `[n …]` label.
  for (const block of text.split(/\n(?=\[\d+[^\]]*\] )/)) {
    const m = /^\[(\d+)[^\]]*\] refused: ([\s\S]*)$/.exec(block);
    if (m) out.set(Number(m[1]), (m[2] ?? '').replace(/\s*\n\s*/g, ' ').slice(0, 1400));
  }
  return out;
}

/** The spot a refusal suggests for a piece when it is at most 0.15 m from where it was asked to stand. */
function nudgeTarget(text: string | undefined, id: string): [number, number] | null {
  if (!text) return null;
  const m = /Move \S*?([a-z0-9-]+) ([\d.]+) m (?:north|south|east|west)[a-z]* \(to (-?[\d.]+), (-?[\d.]+)\)/.exec(text);
  if (!m || !id.endsWith(m[1] as string) && !(m[1] as string).endsWith(id)) return null;
  if (Number(m[2]) > 0.15) return null;
  return [Number(m[3]), Number(m[4])];
}

/** Unit step of the direction a piece faces when it stands against the named wall (away from it). */
const AWAY_FROM_WALL: Record<string, [number, number]> = { north: [0, 1], south: [0, -1], east: [-1, 0], west: [1, 0] };

/** The same item standing at a point, facing as it did (away from the wall it stood against). */
function nudgedItem(item: Record<string, Json>, to: [number, number]): Record<string, Json> {
  const { wall, t, along, gap, align, ...rest } = item as Record<string, Json>;
  void t; void along; void gap; void align;
  const dir = typeof wall === 'string' ? AWAY_FROM_WALL[wall] : undefined;
  const faced = rest['faces'] !== undefined || rest['yaw'] !== undefined;
  return { ...rest, at: to, ...(!faced && dir ? { faces: { point: [Math.round((to[0] + dir[0]) * 1000) / 1000, Math.round((to[1] + dir[1]) * 1000) / 1000] } } : {}) };
}
