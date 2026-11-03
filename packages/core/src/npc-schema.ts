/**
 * Intelligent NPCs in the World IR (additive, optional `entity.npc`).
 *
 * A character is plain JSON: who it is (role, faction, relations), how it
 * perceives (sight cone, hearing, memory), how it behaves (an archetype with
 * a prioritised transition graph over the states idle, patrol, investigate,
 * chase, flee, attack, trade, talk and follow), where it walks (waypoints)
 * and what it says (a dialogue tree whose choices have conditions and
 * effects). The agent creates and edits NPCs with ordinary `add` / `update`
 * patches (objects merge, arrays replace), so "make the guard faster" is the
 * three-token patch `{ "npc": { "speed": 2.4 } }`.
 *
 * The deterministic runtime lives in `@aether/logic` (`npc/`). Everything
 * here is bounded: list lengths, text lengths and condition depth are capped
 * so an untrusted document cannot make an NPC expensive.
 */
import './zod-config';
import { z } from 'zod';

const Vec3Tuple = z.tuple([z.number(), z.number(), z.number()]);
/** Lowercase slug used for factions, items, node ids and tags. */
const Slug = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, 'use a lowercase slug');
const Scalar = z.union([z.string().max(200), z.number(), z.boolean()]);

// ---------------------------------------------------------------------------
// Behaviour graph
// ---------------------------------------------------------------------------

/** The states of an NPC's behaviour graph. */
export const NpcMode = z.enum(['idle', 'patrol', 'investigate', 'chase', 'flee', 'attack', 'trade', 'talk', 'follow']);
export type NpcMode = z.infer<typeof NpcMode>;

/**
 * Built-in personalities. Each one expands into a default set of transitions
 * (see `defaultTransitions` in `@aether/logic`); `npc.transitions` are added
 * on top and win ties.
 *
 * - `villager`  wanders near home, talks, runs from foes
 * - `guard`     patrols waypoints, investigates noise, chases and attacks foes, returns to its post
 * - `merchant`  stands at the stall, greets and trades, never leaves
 * - `predator`  roams, hunts foes it sees/smells (optionally only at night), flees fire or low health
 * - `prey`      grazes, bolts from foes
 * - `follower`  idles until asked to follow, then keeps close to the player
 * - `sentinel`  stationary lookout that turns toward foes and attacks in reach
 */
export const NpcArchetype = z.enum(['villager', 'guard', 'merchant', 'predator', 'prey', 'follower', 'sentinel']);
export type NpcArchetype = z.infer<typeof NpcArchetype>;

const CompareOpNpc = z.enum(['==', '!=', '>', '<', '>=', '<=']);

/** A condition on what an NPC senses, its own state or the world state. */
export type NpcCond =
  | { k: 'seesFoe' }
  | { k: 'hearsFoe' }
  | { k: 'remembersFoe' }
  | { k: 'foeWithin'; r: number }
  | { k: 'foeBeyond'; r: number }
  | { k: 'healthBelow'; frac: number }
  | { k: 'fearNear' }
  | { k: 'playerWithin'; r: number }
  | { k: 'playerBeyond'; r: number }
  | { k: 'timer'; t: number }
  | { k: 'arrived' }
  | { k: 'time'; from: number; to: number }
  | { k: 'flag'; key: string; op: z.infer<typeof CompareOpNpc>; value: string | number | boolean }
  | { k: 'talkRequested' }
  | { k: 'following' }
  | { k: 'farFromHome'; r: number }
  | { k: 'always' }
  | { k: 'not'; c: NpcCond }
  | { k: 'all'; cs: NpcCond[] }
  | { k: 'any'; cs: NpcCond[] };

/**
 * Condition grammar of transitions. `foe` = an entity the NPC is hostile to
 * (the player and/or factions it fights). `time` is an hour range that may
 * wrap midnight (`from: 20, to: 5`).
 */
export const NpcCond: z.ZodType<NpcCond> = z.lazy(() =>
  z.discriminatedUnion('k', [
    z.object({ k: z.literal('seesFoe') }),
    z.object({ k: z.literal('hearsFoe') }),
    z.object({ k: z.literal('remembersFoe') }),
    z.object({ k: z.literal('foeWithin'), r: z.number().min(0).max(500) }),
    z.object({ k: z.literal('foeBeyond'), r: z.number().min(0).max(500) }),
    z.object({ k: z.literal('healthBelow'), frac: z.number().min(0).max(1) }),
    z.object({ k: z.literal('fearNear') }),
    z.object({ k: z.literal('playerWithin'), r: z.number().min(0).max(500) }),
    z.object({ k: z.literal('playerBeyond'), r: z.number().min(0).max(500) }),
    z.object({ k: z.literal('timer'), t: z.number().min(0).max(3600) }),
    z.object({ k: z.literal('arrived') }),
    z.object({ k: z.literal('time'), from: z.number().min(0).max(24), to: z.number().min(0).max(24) }),
    z.object({ k: z.literal('flag'), key: z.string().min(1).max(80), op: CompareOpNpc, value: Scalar }),
    z.object({ k: z.literal('talkRequested') }),
    z.object({ k: z.literal('following') }),
    z.object({ k: z.literal('farFromHome'), r: z.number().min(0).max(1000) }),
    z.object({ k: z.literal('always') }),
    z.object({ k: z.literal('not'), c: NpcCond }),
    z.object({ k: z.literal('all'), cs: z.array(NpcCond).min(1).max(8) }),
    z.object({ k: z.literal('any'), cs: z.array(NpcCond).min(1).max(8) }),
  ]),
);

/** One edge of the behaviour graph. Highest `priority` first, then list order. */
export const NpcTransition = z.object({
  /** Source state, or "*" for any state. */
  from: z.union([NpcMode, z.literal('*')]).default('*'),
  to: NpcMode,
  when: NpcCond,
  priority: z.number().int().min(-100).max(100).default(50),
  /** Optional line shown as a speech bubble when the edge fires. */
  say: z.string().max(120).optional(),
});
export type NpcTransition = z.infer<typeof NpcTransition>;

// ---------------------------------------------------------------------------
// Perception, combat, movement
// ---------------------------------------------------------------------------

export const NpcPerception = z.object({
  /** Sight distance (m). */
  sight: z.number().min(0).max(200).default(14),
  /** Full width of the vision cone (degrees); 360 sees all around. */
  fov: z.number().min(10).max(360).default(110),
  /** Hearing distance (m) for noises the player makes (running, jumping, fighting). */
  hearing: z.number().min(0).max(100).default(7),
  /** Seconds a lost foe stays remembered at its last known position. */
  memory: z.number().min(0).max(120).default(6),
  /** Radius (m) in which seeing a foe alerts friendly NPCs. */
  alert: z.number().min(0).max(100).default(0),
});
export type NpcPerception = z.infer<typeof NpcPerception>;

export const NpcAttack = z.object({
  range: z.number().min(0.3).max(30).default(1.7),
  damage: z.number().min(0).max(1000).default(12),
  cooldown: z.number().min(0.1).max(60).default(1.1),
  /**
   * Additive: a ranged attack (a gun, a bow): every attack shows a muzzle flash at the attacker and an impact at the
   * target instead of a melee blow, and it can miss (see `accuracy`).
   */
  ranged: z.boolean().optional(),
  /** Additive: chance (0..1) that an attack lands; default 1 (every attack in reach lands). For a ranged attack it is the chance up close. */
  accuracy: z.number().min(0).max(1).optional(),
  /** Additive, ranged attacks: chance (0..1) to land at the edge of `range` (linear from `accuracy` up close); default `accuracy`. */
  farAccuracy: z.number().min(0).max(1).optional(),
  /**
   * Additive, melee attacks: seconds between the start of the swing (a warning sound and flash) and the blow; a foe who
   * steps out of reach in time is missed. Default 0 (the blow lands at once).
   */
  windup: z.number().min(0).max(3).optional(),
});
export type NpcAttack = z.infer<typeof NpcAttack>;

// ---------------------------------------------------------------------------
// Dialogue
// ---------------------------------------------------------------------------

/** What a dialogue node or choice does when it is taken. Items are world-state counters. */
export const DialogueEffect = z.discriminatedUnion('do', [
  z.object({ do: z.literal('set'), key: z.string().min(1).max(80), value: Scalar }),
  z.object({ do: z.literal('add'), key: z.string().min(1).max(80), amount: z.number().min(-1e6).max(1e6) }),
  /** Add `count` of an item to the player (world state counter named after the item). */
  z.object({ do: z.literal('give'), item: Slug, count: z.number().int().min(1).max(999).default(1) }),
  /** Remove `count` of an item from the player. */
  z.object({ do: z.literal('take'), item: Slug, count: z.number().int().min(1).max(999).default(1) }),
  /** Unlock a door: sets the world flag "<target>-unlocked" (doors with `trigger: "state"` and that stateKey open). */
  z.object({ do: z.literal('openDoor'), target: Slug }),
  z.object({ do: z.literal('emit'), event: z.string().min(1).max(100) }),
  z.object({ do: z.literal('message'), text: z.string().min(1).max(200) }),
  /** The NPC turns hostile to the player. */
  z.object({ do: z.literal('provoke') }),
  /** The NPC stops being hostile and forgets the player. */
  z.object({ do: z.literal('calm') }),
  /** Ask the NPC to follow the player (or stop). */
  z.object({ do: z.literal('follow'), on: z.boolean().default(true) }),
  z.object({ do: z.literal('win'), text: z.string().max(200).default('You win!') }),
]);
export type DialogueEffect = z.infer<typeof DialogueEffect>;

/** A world-state test (`coins >= 5`, `key >= 1`, `guard.angry == true`). */
export const DialogueCondition = z.object({ key: z.string().min(1).max(80), op: CompareOpNpc, value: Scalar });
export type DialogueCondition = z.infer<typeof DialogueCondition>;

export const DialogueChoice = z.object({
  text: z.string().min(1).max(140),
  /** Offered only while every condition holds. */
  if: z.array(DialogueCondition).max(6).default([]),
  effects: z.array(DialogueEffect).max(8).default([]),
  /** Next node; `null` (or omitted) ends the conversation. */
  next: Slug.nullable().default(null),
  /** Disappears once taken (per play session). */
  once: z.boolean().default(false),
});
export type DialogueChoice = z.infer<typeof DialogueChoice>;

export const DialogueNode = z.object({
  /** What the NPC says. */
  text: z.string().min(1).max(320),
  /** Display name override (defaults to the entity name). */
  speaker: z.string().max(60).optional(),
  /** First variant whose conditions hold replaces `text` ("You again!" once you carry the key). */
  variants: z.array(z.object({ if: z.array(DialogueCondition).min(1).max(6), text: z.string().min(1).max(320) })).max(6).default([]),
  choices: z.array(DialogueChoice).max(6).default([]),
  /** Effects run when the node is shown. */
  effects: z.array(DialogueEffect).max(8).default([]),
  /** Node after a plain advance when there are no choices; `null` ends. */
  next: Slug.nullable().default(null),
  /** `trade` shows the trade state/animation while this node is up. */
  mode: z.enum(['talk', 'trade']).default('talk'),
});
export type DialogueNode = z.infer<typeof DialogueNode>;

export const Dialogue = z
  .object({
    /** Node a conversation starts at. */
    start: Slug.default('start'),
    nodes: z.record(Slug, DialogueNode).refine((n) => Object.keys(n).length <= 48, 'a dialogue has at most 48 nodes'),
  })
  .superRefine((d, ctx) => {
    if (!Object.hasOwn(d.nodes, d.start)) {
      ctx.addIssue({ code: 'custom', path: ['start'], message: `start node '${d.start}' does not exist` });
    }
    for (const id of Object.keys(d.nodes)) {
      const node = d.nodes[id] as DialogueNode;
      if (node.next !== null && !Object.hasOwn(d.nodes, node.next)) {
        ctx.addIssue({ code: 'custom', path: ['nodes', id, 'next'], message: `next node '${node.next}' does not exist` });
      }
      node.choices.forEach((c, i) => {
        if (c.next !== null && !Object.hasOwn(d.nodes, c.next)) {
          ctx.addIssue({ code: 'custom', path: ['nodes', id, 'choices', i, 'next'], message: `next node '${c.next}' does not exist` });
        }
      });
    }
  });
export type Dialogue = z.infer<typeof Dialogue>;

/**
 * Optional free conversation (a language model plays the character). It is
 * off whenever no model is connected, and the authored `dialogue` tree stays
 * the fallback. Text is data for the model: it has no tools and its replies
 * are plain text, capped in length and in turns.
 */
export const NpcChat = z.object({
  /** Who the character is and how it talks (second person: "You are a gruff gate guard..."). */
  persona: z.string().min(1).max(500),
  /** Things it knows and may mention. */
  facts: z.array(z.string().min(1).max(160)).max(8).default([]),
  /** Most free turns per play session with this character. */
  maxTurns: z.number().int().min(1).max(50).default(12),
});
export type NpcChat = z.infer<typeof NpcChat>;

/** Short lines shown above the NPC when something happens to it. */
export const NpcBarks = z.object({
  /** Notices a foe. */
  spot: z.array(z.string().min(1).max(100)).max(6).optional(),
  /** Loses a foe. */
  lose: z.array(z.string().min(1).max(100)).max(6).optional(),
  /** Starts to flee. */
  flee: z.array(z.string().min(1).max(100)).max(6).optional(),
  /** Gets hurt. */
  hurt: z.array(z.string().min(1).max(100)).max(6).optional(),
  /** Hears something. */
  alert: z.array(z.string().min(1).max(100)).max(6).optional(),
  /** Ambient mutters while idle (rarely). */
  idle: z.array(z.string().min(1).max(100)).max(6).optional(),
});
export type NpcBarks = z.infer<typeof NpcBarks>;

/**
 * One stop of a daily routine: where the character goes (`at`, world coordinates; `y` is the floor it stands on,
 * which picks the storey in a building with stairs), how long it stays, and how far it drifts there. A stop with
 * `hours` is where it is during those hours; stops without hours are visited in turn, `stay` seconds each.
 */
export const NpcRoutineStop = z.object({
  at: Vec3Tuple,
  stay: z.number().min(0).max(3600).default(30),
  hours: z.tuple([z.number().min(0).max(24), z.number().min(0).max(24)]).optional(),
  wander: z.number().min(0).max(20).default(0.6),
  name: z.string().max(40).optional(),
  /**
   * A seat (entity id: sofa, armchair, chair, stool, bed) to sit on at this stop. `at` is where the character stands in front of it;
   * it turns to face out of the seat, lowers onto it, sits for the stay (or the hours) and stands up before moving on.
   */
  sit: z.string().min(1).max(100).optional(),
});
export type NpcRoutineStop = z.infer<typeof NpcRoutineStop>;

// ---------------------------------------------------------------------------
// The NPC itself
// ---------------------------------------------------------------------------

export const NpcSpec = z.object({
  /** What it is, for addressing it in chat ("the guard", "the wolves"). */
  role: z.string().max(40).default(''),
  /** Faction name. NPCs of one faction are friends; "player" is the human. */
  faction: Slug.default('neutral'),
  archetype: NpcArchetype.default('villager'),
  /** Factions (or "player") it attacks on sight. */
  enemies: z.array(Slug).max(8).default([]),
  /** Factions (or "player") it never attacks, whatever `enemies` says. */
  allies: z.array(Slug).max(8).default([]),
  /** Tags of entities it is afraid of (e.g. "fire", "torch"): it flees any carrier within `fearRange`. */
  fears: z.array(z.string().min(1).max(40)).max(8).default([]),
  fearRange: z.number().min(0).max(100).default(7),
  /** Walk / run speeds (m/s) and turn rate (deg/s). */
  speed: z.number().min(0).max(30).default(1.5),
  runSpeed: z.number().min(0).max(40).default(4.2),
  turnRate: z.number().min(10).max(1440).default(420),
  /** Body size used for navigation clearance (m). */
  radius: z.number().min(0.1).max(3).default(0.4),
  height: z.number().min(0.3).max(8).default(1.8),
  /** Hit points; 0 or less kills it. */
  health: z.number().min(1).max(100000).default(100),
  perception: NpcPerception.default(NpcPerception.parse({})),
  attack: NpcAttack.optional(),
  /** Flee below this fraction of health (0 = never). Archetype default applies when omitted. */
  fleeAt: z.number().min(0).max(1).optional(),
  /** Gives up a chase farther than this from home (m). */
  leash: z.number().min(2).max(500).default(40),
  /** Patrol route (world coordinates; y is ignored, the floor decides). */
  waypoints: z.array(Vec3Tuple).max(32).default([]),
  patrol: z.object({ mode: z.enum(['loop', 'pingpong', 'random']).default('loop'), wait: z.number().min(0).max(120).default(1.5) }).default({ mode: 'loop', wait: 1.5 }),
  /** Idle roaming radius around home (m); 0 stands still. */
  wander: z.number().min(0).max(100).default(0),
  /** Roam: idle wandering meanders continuously (a steering wander) instead of walking from spot to spot. */
  roam: z.boolean().optional(),
  /** Keep with the pack (0..1): cohesion and alignment with nearby characters of the same faction (herds, wolf packs, flocks). */
  flock: z.number().min(0).max(1).optional(),
  /** A daily routine of places (idle characters walk it, across floors by the stairs); replaces wandering around home. */
  routine: z.array(NpcRoutineStop).max(12).optional(),
  /** Only active (hunting / patrolling) during this hour range, e.g. [19, 6]; otherwise it rests. */
  activeHours: z.tuple([z.number().min(0).max(24), z.number().min(0).max(24)]).optional(),
  /** Starts out following the player (a companion); a dialogue can also recruit it. */
  follow: z.boolean().default(false),
  /** Items it carries (visual props live in child entities): `["torch"]`. */
  carries: z.array(Slug).max(8).default([]),
  /** Distance (m) within which the player can start a conversation. */
  talkRange: z.number().min(0.5).max(20).default(2.8),
  dialogue: Dialogue.optional(),
  /** Free conversation with a connected language model (falls back to `dialogue`). */
  chat: NpcChat.optional(),
  barks: NpcBarks.optional(),
  /** Extra edges added on top of the archetype's defaults. */
  transitions: z.array(NpcTransition).max(24).default([]),
  /**
   * Additive: what it leaves behind when it dies. Each entry spawns a clone of a template entity (`template: true`,
   * as the `spawn` action does) where it fell, with the given chance (0..1, seeded per character). At most one item
   * per entry.
   */
  drops: z.array(z.object({ template: Slug, chance: z.number().min(0).max(1).default(1) })).max(6).optional(),
  /** Additive: seconds its body stays after death before it is removed (default: it stays). */
  corpse: z.number().min(0).max(600).optional(),
});
export type NpcSpec = z.infer<typeof NpcSpec>;
export type NpcSpecInput = z.input<typeof NpcSpec>;

/** Runtime animation hints published as `npcAnim` on the entity state. */
export const NPC_ANIMS = ['idle', 'walk', 'run', 'attack', 'talk', 'hurt', 'dead', 'sit'] as const;
export type NpcAnim = (typeof NPC_ANIMS)[number];
