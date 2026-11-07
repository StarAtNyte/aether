/**
 * The publish kind (`world.profile`) and start mode (`world.startMode`) a world is presented with, from its content:
 *
 * - a game goal (a win, goals, pickups, checkpoints, enemies), a title card, a weapon or a vehicle: `game`, started in
 *   `play` (a city with a goal is still a city: `city`, played);
 * - a world with a short film (`world.story`) or a narrative brief (a film, an anime short, a tale): `story`, opened on
 *   the film (`story`), then P plays as the character and Tab explores;
 * - a district of buildings or streets: `city`, opened on its street-level hero view (`orbit`);
 * - a building or an interior: `walkthrough`, toured at eye level (`walkthrough`);
 * - a landscape or a scene: `showcase`, opened on its short film (`story`) when it has or can have one.
 *
 * `defaultPresentation` is the rule without a model; `suggestPresentation` asks the model, with the rule's choice and the
 * world's signals as evidence, and falls back to the rule.
 */
import type { Patch, WorldDoc } from '@aether/core';
import type { Provider, ToolDef } from '../types';
import { worldPeople } from './poi';

export type PresentKind = 'game' | 'walkthrough' | 'showcase' | 'city' | 'vr' | 'story';
export type PresentStart = 'play' | 'walkthrough' | 'orbit' | 'story';
export const PRESENT_KINDS: readonly PresentKind[] = ['game', 'walkthrough', 'showcase', 'city', 'vr', 'story'];
export const PRESENT_STARTS: readonly PresentStart[] = ['play', 'walkthrough', 'orbit', 'story'];

/** What the choice rests on. */
export interface PresentationSignals {
  entities: number;
  buildings: number;
  rooms: number;
  streets: number;
  /** Win actions, goals, pickups, checkpoints, enemies. */
  goals: number;
  people: number;
  intro: boolean;
  weapon: boolean;
  vehicle: boolean;
  terrain: boolean;
  water: boolean;
  voxel: boolean;
  story: boolean;
  /** The brief reads as a story (a film, an anime short, a tale, someone's journey). */
  narrative: boolean;
}

/** A presentation choice and why. */
export interface PresentationChoice {
  profile: PresentKind;
  startMode: PresentStart;
  reason: string;
  /** Who chose it: the model, the rule without a model, or the user (the publish dialog). */
  source: 'ai' | 'default' | 'user';
}

/** Words of a narrative brief. */
const NARRATIVE = /\b(story|stories|short film|film|anime|cinematic|tale|narrative|episode|scene where|journey of|races? (up|to|home)|a (girl|boy|woman|man) who)\b/i;

const GOAL_BEHAVIORS = new Set(['collectible', 'goal', 'checkpoint', 'hazard']);

/** The content signals of `world`. */
export function presentationSignals(world: WorldDoc): PresentationSignals {
  let buildings = 0;
  let rooms = 0;
  let streets = 0;
  let goals = 0;
  let terrain = false;
  let water = false;
  let n = 0;
  for (const id in world.entities) {
    const e = world.entities[id];
    if (!e || e.template) continue;
    n++;
    if (e.arch?.role === 'building') buildings++;
    if (e.arch?.role === 'room') rooms++;
    const tags = e.tags;
    if (tags.some((t) => t === 'road' || t === 'roads' || t === 'street' || t === 'district' || t === 'city')) streets++;
    if (tags.some((t) => t === 'terrain' || t === 'land' || t === 'hill')) terrain = true;
    if (tags.includes('water') || /water|lake|sea|river|ocean/i.test(e.id)) water = true;
    for (const b of e.behaviors) if (b.enabled && GOAL_BEHAVIORS.has(b.type)) goals++;
    if (e.npc && (e.npc.archetype === 'predator' || /enem|hostile|bandit/.test(e.npc.faction))) goals++;
  }
  for (const r of world.rules) if (r.enabled && r.then.some((a) => a.do === 'win' || a.do === 'lose')) goals++;
  return {
    entities: n,
    buildings,
    rooms,
    streets,
    goals,
    people: worldPeople(world, 64).length,
    intro: world.intro !== undefined,
    weapon: world.player.weapon !== undefined,
    vehicle: world.player.mode === 'vehicle' || world.player.controls !== undefined,
    terrain,
    water,
    voxel: world.voxel !== undefined,
    story: world.story !== undefined,
    narrative: NARRATIVE.test(`${world.name} ${world.description}`),
  };
}

/** The rule's choice, without a model. */
export function defaultPresentation(world: WorldDoc, sig: PresentationSignals = presentationSignals(world)): PresentationChoice {
  const city = sig.buildings >= 4 || sig.streets >= 3 || (sig.buildings >= 2 && sig.streets >= 1);
  const game = sig.goals > 0 || sig.intro || sig.weapon || sig.vehicle || sig.voxel;
  if (game) {
    const why = sig.goals > 0 ? `${sig.goals} game goal${sig.goals === 1 ? '' : 's'} (a win, pickups, goals)` : sig.intro ? 'a title card' : sig.weapon ? 'the player carries a weapon' : sig.vehicle ? 'the player drives' : 'a block world';
    return { profile: city ? 'city' : 'game', startMode: 'play', reason: `A game: ${why}${city ? ', in a city' : ''}.`, source: 'default' };
  }
  if (sig.story || sig.narrative) return { profile: 'story', startMode: 'story', reason: sig.story ? 'A short film: the world has one, so it plays first; P plays as the character, Tab explores.' : 'A narrative brief: a short film plays first; P plays as the character, Tab explores.', source: 'default' };
  if (city) return { profile: 'city', startMode: 'orbit', reason: `A city: ${sig.buildings} buildings, ${sig.streets} street pieces.`, source: 'default' };
  if (sig.buildings > 0 || sig.rooms > 0) return { profile: 'walkthrough', startMode: 'walkthrough', reason: `A building${sig.rooms > 0 ? ` with ${sig.rooms} room${sig.rooms === 1 ? '' : 's'}` : ''}: toured at eye level.`, source: 'default' };
  if (sig.entities === 0) return { profile: 'showcase', startMode: 'orbit', reason: 'An empty world: an orbit camera.', source: 'default' };
  return { profile: 'showcase', startMode: 'story', reason: `A ${sig.terrain || sig.water ? 'landscape' : 'scene'} to look at: it opens on a short film, then P plays and Tab explores.`, source: 'default' };
}

/** Whether a run built a world new enough to choose its presentation: none chosen yet and most of it new. */
export function wantsPresentation(start: WorldDoc, world: WorldDoc): boolean {
  if (world.profile !== undefined || world.startMode !== undefined) return false;
  const now = Object.keys(world.entities);
  if (now.length === 0) return false;
  const before = new Set(Object.keys(start.entities));
  let fresh = 0;
  for (const id of now) if (!before.has(id)) fresh++;
  return fresh >= now.length * 0.5;
}

/** Whether a world presented as `choice` wants a short film. */
export function wantsStory(choice: Pick<PresentationChoice, 'startMode'>): boolean {
  return choice.startMode === 'story';
}

/** The patch storing a choice in the IR. */
export function presentationPatch(choice: Pick<PresentationChoice, 'profile' | 'startMode'>): Patch {
  return { op: 'setMeta', profile: choice.profile, startMode: choice.startMode };
}

export const CHOOSE_PRESENTATION_TOOL: ToolDef = {
  name: 'choose_presentation',
  description: 'Choose how the published world is presented: its kind (profile) and how it starts.',
  inputSchema: {
    type: 'object',
    properties: {
      profile: { type: 'string', enum: [...PRESENT_KINDS] },
      startMode: { type: 'string', enum: [...PRESENT_STARTS] },
      reason: { type: 'string', description: 'One sentence the user reads in the publish dialog.' },
    },
    required: ['profile', 'startMode', 'reason'],
    additionalProperties: false,
  },
};

const SYSTEM = `You choose how a 3D world is presented when it is published. Kinds (profile): game (a title card, then play as the character), walkthrough (an architectural tour at eye level through a building or interior), showcase (a landscape or scene to look at), city (a district: a street-level hero view, then a drone tour), vr (a headset game), story (a short film or anime short that plays first, then P plays as the character and Tab explores). Start modes: play, walkthrough, orbit (free camera), story (the world's short film first, then P plays and Tab explores).
Rules of thumb: a game goal or a player with a purpose means game/play; a building or interior means walkthrough/walkthrough; a city means city/orbit (a city with a goal: city/play); a world with a film or a narrative brief means story/story; a landscape or a scene means showcase/story: it opens on a short film that the director writes from its views at publish, then P plays and Tab explores (choose orbit only when the world is a single object to turn round, with nothing to film). Call choose_presentation once.`;

/** Valid choice from untrusted tool input, or null. */
export function parseChoice(input: unknown): Omit<PresentationChoice, 'source'> | null {
  if (typeof input !== 'object' || input === null) return null;
  const r = input as Record<string, unknown>;
  const profile = PRESENT_KINDS.find((k) => k === r['profile']);
  const startMode = PRESENT_STARTS.find((k) => k === r['startMode']);
  if (!profile || !startMode) return null;
  const reason = typeof r['reason'] === 'string' ? r['reason'].slice(0, 240) : '';
  return { profile, startMode, reason };
}

/** A summary of `world` a model can choose from. */
export function presentationBrief(world: WorldDoc, sig: PresentationSignals, rule: PresentationChoice): string {
  const names = Object.values(world.entities)
    .filter((e) => !e.template && e.name)
    .slice(0, 40)
    .map((e) => e.name)
    .join(', ');
  return `World "${world.name}": ${world.description.slice(0, 400) || '(no description)'}
Signals: ${JSON.stringify(sig)}
Named things: ${names || '(none)'}
Rule without a model: ${rule.profile}/${rule.startMode} (${rule.reason})`;
}

/**
 * The model's choice for `world` (one call; the rule's choice when there is no provider, the call fails or the answer is
 * not a valid choice).
 */
export async function suggestPresentation(provider: Provider | null, world: WorldDoc, signal?: AbortSignal): Promise<PresentationChoice> {
  const sig = presentationSignals(world);
  const rule = defaultPresentation(world, sig);
  if (!provider) return rule;
  try {
    const res = await provider.complete({ role: 'critic', system: SYSTEM, messages: [{ role: 'user', content: presentationBrief(world, sig, rule) }], tools: [CHOOSE_PRESENTATION_TOOL], maxTokens: 1200, temperature: 0 });
    if (signal?.aborted) return rule;
    const call = res.content.find((b) => b.type === 'tool_use' && b.name === CHOOSE_PRESENTATION_TOOL.name);
    const got = call && call.type === 'tool_use' ? parseChoice(call.input) : null;
    return got ? { ...got, reason: got.reason || rule.reason, source: 'ai' } : rule;
  } catch {
    return rule;
  }
}
