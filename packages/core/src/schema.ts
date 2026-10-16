/**
 * Aether World IR — the single source of truth shared by every package.
 *
 * Conventions:
 * - Units are meters, seconds, kilograms. Y is up. Ground plane is y = 0.
 * - Rotations are Euler angles in DEGREES (XYZ order) — friendlier for LLMs.
 * - Colors are CSS hex strings ("#aabbcc").
 * - Everything is plain JSON so it can be diffed, persisted and sent to an LLM.
 *
 * The LLM never edits this structure directly: it emits `Patch` operations,
 * which are validated and applied by `applyPatches` in this package.
 */
import './zod-config';
import { z } from 'zod';
import { VoxelEdit, VoxelTerrain } from './voxel-schema';
import { NpcSpec } from './npc-schema';
import { CharacterSpec } from './character-schema';

export * from './voxel-schema';
export * from './npc-schema';
export * from './character-schema';

export const Vec3 = z.tuple([z.number(), z.number(), z.number()]);
export type Vec3 = z.infer<typeof Vec3>;
export const Vec2 = z.tuple([z.number(), z.number()]);
export type Vec2 = z.infer<typeof Vec2>;
export const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'color must be #rrggbb');
export type Color = z.infer<typeof Color>;

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export const Json: z.ZodType<Json> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(Json), z.record(z.string(), Json)]),
);

/** Entity id: lowercase slug, e.g. "red-car", "tower-block-12". */
export const EntityId = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, 'ids are lowercase slugs');
export type EntityId = z.infer<typeof EntityId>;

/**
 * Selector — how rules/tests/behaviors refer to entities:
 * - "some-id"   a single entity
 * - "#tag"      every entity carrying the tag
 * - "player"    the player avatar / controlled entity
 * - "*"         every entity
 */
export const Selector = z.string().min(1);
export type Selector = z.infer<typeof Selector>;

// ---------------------------------------------------------------------------
// Transform
// ---------------------------------------------------------------------------

export const Transform = z.object({
  position: Vec3.default([0, 0, 0]),
  rotation: Vec3.default([0, 0, 0]),
  scale: Vec3.default([1, 1, 1]),
});
export type Transform = z.infer<typeof Transform>;

// ---------------------------------------------------------------------------
// Material
// ---------------------------------------------------------------------------

export const MaterialPreset = z.enum([
  'plastic', 'wood', 'stone', 'brick', 'concrete', 'metal', 'gold', 'glass', 'water', 'ice',
  'grass', 'dirt', 'sand', 'snow', 'lava', 'neon', 'rubber', 'fabric', 'leaf', 'bark', 'crystal', 'emissive',
]);
export type MaterialPreset = z.infer<typeof MaterialPreset>;

/**
 * Additive: physically based surface finishes for architecture and interiors.
 * The renderer gives each one procedural, tileable albedo / roughness /
 * normal maps at real-world scale (metre UVs), so a finish looks the same on
 * a 2 m wall and a 20 m facade. Tintable finishes (plaster, paint, fabric,
 * velvet, leather, carpet, tile, subway-tile, ceramic) take their colour from
 * `color`; natural ones (woods, marble, terrazzo, stone, brick, metals) carry
 * their own and `color` tints them.
 */
export const MaterialFinish = z.enum([
  'oak', 'walnut', 'ash', 'herringbone', 'marble', 'terrazzo', 'concrete', 'plaster', 'paint', 'tile', 'subway-tile',
  'stone', 'brick', 'fabric', 'velvet', 'leather', 'carpet', 'brushed-metal', 'chrome', 'brass', 'black-metal', 'glass',
  'frosted-glass', 'ceramic', 'mirror', 'roof-tile', 'metal-roof', 'decking', 'grass', 'gravel', 'water',
  // Additive: natural ground and trunk surfaces (photographed detail under the stylised presets).
  'bark', 'rock', 'soil', 'snow', 'sand', 'asphalt',
  // Additive: wall coverings (tintable papers with a pattern, shaker panelling, timber slats).
  'wallpaper', 'wallpaper-stripe', 'wallpaper-floral', 'wallpaper-damask', 'wallpaper-geometric', 'panelling', 'wood-slats',
  // Additive: dense overlapping leaves for tree crowns and hedges.
  'foliage',
]);
export type MaterialFinish = z.infer<typeof MaterialFinish>;

export const MaterialSpec = z.object({
  preset: MaterialPreset.optional(),
  /** Additive: physically based finish with procedural texture maps (see {@link MaterialFinish}). */
  finish: MaterialFinish.optional(),
  color: Color.optional(),
  roughness: z.number().min(0).max(1).optional(),
  metalness: z.number().min(0).max(1).optional(),
  emissive: Color.optional(),
  emissiveIntensity: z.number().min(0).max(50).optional(),
  opacity: z.number().min(0).max(1).optional(),
  flatShading: z.boolean().optional(),
  /** Use per-vertex colors produced by a procedural generator. */
  vertexColors: z.boolean().optional(),
  /**
   * Additive: terrain layering. The generator's part carries four per-vertex layer weights (grass,
   * rock, dry ground, snow) and the renderer blends the photographed grass, rock, soil and snow
   * surfaces by them, keeping the vertex colours as the base tint. Without the flag (or without
   * weights) the part is drawn with its plain vertex colours.
   */
  splat: z.boolean().optional(),
  /**
   * Additive: alpha-tested foliage cards. The part is a set of quads with 0..1 UVs; the renderer draws
   * a procedural leaf cluster, needle spray, grass blade or fern frond cut out of each quad (no
   * sorting, real leaf shadows), tinted by the vertex colours.
   */
  foliage: z.enum(['broadleaf', 'shrub', 'needles', 'grass', 'fern', 'blossom', 'flower']).optional(),
});
export type MaterialSpec = z.infer<typeof MaterialSpec>;

// ---------------------------------------------------------------------------
// Shape — what an entity looks like
// ---------------------------------------------------------------------------

export const PrimitiveKind = z.enum(['box', 'sphere', 'cylinder', 'cone', 'capsule', 'torus', 'plane']);
export type PrimitiveKind = z.infer<typeof PrimitiveKind>;

export const PrimitiveShape = z.object({
  kind: z.literal('primitive'),
  primitive: PrimitiveKind,
  /**
   * Full dimensions in meters (width, height, depth).
   * sphere: diameter = size[0]; cylinder/cone/capsule: diameter = size[0], height = size[1];
   * torus: outer diameter = size[0], tube thickness = size[1]; plane: width = size[0], depth = size[2].
   */
  size: Vec3.default([1, 1, 1]),
});

export const ProceduralShape = z.object({
  kind: z.literal('procedural'),
  /** Built-in generator id (see @aether/procgen catalog) or id of a custom generator in `world.generators`. */
  generator: z.string().min(1),
  params: z.record(z.string(), Json).default({}),
  seed: z.number().int().optional(),
});

export const ModelShape = z.object({
  kind: z.literal('model'),
  url: z.string().min(1),
  /** Target size of the model's largest dimension in meters (auto-fit). */
  fitSize: z.number().positive().optional(),
});

export const ScatterShape = z.object({
  kind: z.literal('scatter'),
  /** The repeated thing. Rendered with GPU instancing. */
  of: z.union([PrimitiveShape, ProceduralShape]),
  /**
   * Instances. Layers of 2000+ render as culled, level-of-detail instance
   * fields, so very large counts (a million trees) stay interactive.
   */
  count: z.number().int().min(1).max(1_000_000),
  /** Area (width, depth) centered on the entity position. */
  area: Vec2,
  seed: z.number().int().default(1),
  scaleRange: Vec2.default([0.8, 1.2]),
  /** Random yaw per instance. */
  randomYaw: z.boolean().default(true),
  /** Optional terrain entity id to place instances on its surface. */
  onSurface: EntityId.optional(),
  /** Minimum spacing between instances in meters (best effort). */
  minSpacing: z.number().min(0).optional(),
  /**
   * Hand-placed instances (scatter painting): local positions relative to the
   * entity. When present they replace the random layout (`count`, `area` and
   * `minSpacing` are then ignored for placement); yaw and scale still come
   * from `seed`. With `onSurface` the height is re-projected onto the surface.
   */
  points: z.array(Vec3).max(20_000).optional(),
});

/** Mesh asset id (same syntax as entity ids). */
export const MeshId = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, 'mesh ids are lowercase slugs');
export type MeshId = z.infer<typeof MeshId>;

/**
 * An editable mesh (baked from a procedural object or edited by hand). The
 * data lives in `world.meshes[mesh]` so documents stay plain JSON.
 */
export const MeshShape = z.object({
  kind: z.literal('mesh'),
  mesh: MeshId,
});

export const NoneShape = z.object({ kind: z.literal('none') });

/** Asset id: a library catalog id ("sofa", "tree-oak") or a user import ("user-1a2b3c4d5e6f"). */
export const AssetRef = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, 'asset ids are lowercase slugs');

/**
 * Additive: a ready-made asset from the curated library (@aether/assets
 * catalog) or one the user imported. Models are real-world sized (metres,
 * base on y = 0, centred), so no scale is needed; physics colliders come
 * from the catalog. Fallback chain: when the asset is unknown or fails to
 * load, `fallback` is shown (a built-in or custom generator, or a
 * primitive), else a box of the asset's size — never nothing.
 */
export const AssetShape = z.object({
  kind: z.literal('asset'),
  /** Catalog id or user asset id. */
  id: AssetRef,
  /** Alternative look: one of the catalog entry's `variants` (another catalog id). */
  variant: AssetRef.optional(),
  /** Optional uniform resize: the largest dimension in metres (default: the asset's real size). */
  fitSize: z.number().positive().max(500).optional(),
  /**
   * Animated models: "auto" (default) plays idle / walk / run from the
   * entity's movement; a clip name loops that clip; "none" holds the rest pose.
   */
  animation: z.string().min(1).max(64).optional(),
  /** Shown when the asset is unavailable. */
  fallback: z.union([PrimitiveShape, ProceduralShape]).optional(),
});

export const ShapeSpec = z.discriminatedUnion('kind', [PrimitiveShape, ProceduralShape, ModelShape, ScatterShape, NoneShape, MeshShape, AssetShape]);
export type ShapeSpec = z.infer<typeof ShapeSpec>;
export type MeshShape = z.infer<typeof MeshShape>;
export type PrimitiveShape = z.infer<typeof PrimitiveShape>;
export type ProceduralShape = z.infer<typeof ProceduralShape>;
export type ModelShape = z.infer<typeof ModelShape>;
export type ScatterShape = z.infer<typeof ScatterShape>;
export type AssetShape = z.infer<typeof AssetShape>;

// ---------------------------------------------------------------------------
// Physics
// ---------------------------------------------------------------------------

export const BodyType = z.enum(['static', 'dynamic', 'kinematic']);
export type BodyType = z.infer<typeof BodyType>;

export const ColliderKind = z.enum(['auto', 'box', 'sphere', 'capsule', 'cylinder', 'hull', 'trimesh', 'heightfield', 'none']);
export type ColliderKind = z.infer<typeof ColliderKind>;

export const PhysicsSpec = z.object({
  body: BodyType.default('static'),
  /** 'auto' picks the best collider from the shape (primitive → matching collider, procedural → generator colliders, else hull). */
  collider: ColliderKind.default('auto'),
  /** Total mass in kg. If omitted, derived from density × volume. */
  mass: z.number().positive().optional(),
  density: z.number().positive().optional(),
  friction: z.number().min(0).max(5).default(0.6),
  restitution: z.number().min(0).max(1).default(0.1),
  /** Sensor colliders detect overlaps (triggers) but do not collide. */
  sensor: z.boolean().default(false),
  linearDamping: z.number().min(0).default(0),
  angularDamping: z.number().min(0).default(0.05),
  gravityScale: z.number().default(1),
  lockRotation: z.boolean().default(false),
  ccd: z.boolean().default(false),
  initialVelocity: Vec3.optional(),
  initialAngularVelocity: Vec3.optional(),
});
export type PhysicsSpec = z.infer<typeof PhysicsSpec>;

/** Joints make articulated objects: doors, wheels, catapults, drawbridges, pendulums. */
export const JointSpec = z.object({
  type: z.enum(['fixed', 'revolute', 'prismatic', 'spherical']),
  /** The other body. The joint connects THIS entity to `target`. Use "world" to pin to the static world. */
  target: z.union([EntityId, z.literal('world')]),
  /** Anchor in this entity's local space. */
  anchor: Vec3.default([0, 0, 0]),
  /** Anchor in the target's local space (world space if target = "world"). */
  targetAnchor: Vec3.default([0, 0, 0]),
  /** Hinge / slide axis (local to this entity). */
  axis: Vec3.default([0, 1, 0]),
  /** Revolute: degrees. Prismatic: meters. */
  limits: Vec2.optional(),
  motor: z
    .object({
      /** Revolute: degrees/s. Prismatic: m/s. */
      targetVelocity: z.number().default(0),
      /** Optional target position (degrees or meters) — acts as a servo. */
      targetPosition: z.number().optional(),
      stiffness: z.number().min(0).default(0),
      damping: z.number().min(0).default(10),
      maxForce: z.number().positive().default(1000),
    })
    .optional(),
});
export type JointSpec = z.infer<typeof JointSpec>;

// ---------------------------------------------------------------------------
// Lights
// ---------------------------------------------------------------------------

/**
 * Additive: photometric profile of a spot light, shaping its falloff like an IES file
 * (`soft` cosine falloff, `downlight` flat with a soft edge, `narrow` a tight beam, `wash` wide and
 * even, `batwing` dimmer on the axis with a bright ring).
 */
export const LightProfile = z.enum(['soft', 'downlight', 'narrow', 'wash', 'batwing']);
export type LightProfile = z.infer<typeof LightProfile>;

export const LightSpec = z.object({
  /**
   * `area` (additive) is a rectangular panel of `size` metres that shines along the entity's local −Y
   * axis, like a spot light (soft, wrapped illumination: windows, ceiling panels, strip lights).
   */
  type: z.enum(['point', 'spot', 'directional', 'ambient', 'hemisphere', 'area']),
  color: Color.default('#ffffff'),
  intensity: z.number().min(0).default(1),
  /** point/spot range in meters (0 = infinite). */
  range: z.number().min(0).default(0),
  /** spot cone angle in degrees. */
  angle: z.number().min(1).max(89).default(30),
  castShadow: z.boolean().default(false),
  /** Additive: width and depth in metres of an `area` light (default 1 × 1). */
  size: z.tuple([z.number().min(0.01).max(100), z.number().min(0.01).max(100)]).optional(),
  /** Additive: IES-like falloff of a `spot` light (default: the plain cone). */
  profile: LightProfile.optional(),
});
export type LightSpec = z.infer<typeof LightSpec>;

// ---------------------------------------------------------------------------
// Behaviors — reusable per-entity logic components (executed by @aether/logic)
// ---------------------------------------------------------------------------

/**
 * Built-in behavior types. Parameters are documented in @aether/logic's catalog,
 * which is what the agent prompt is generated from.
 */
export const BuiltinBehavior = z.enum([
  'spin', 'bob', 'orbit', 'patrol', 'follow', 'lookAt', 'wander', 'flee',
  'collectible', 'door', 'pressurePlate', 'spawner', 'lifetime', 'explosive',
  'playerController', 'vehicle', 'npc', 'pulseLight', 'conveyor', 'buoyancy',
  'windZone', 'checkpoint', 'goal', 'hazard', 'launcher', 'magnet',
  // Additive: drawers, cabinet doors, windows and taps used by aiming at them (see `Entity.interact`).
  'operable', 'toggle',
]);
export type BuiltinBehavior = z.infer<typeof BuiltinBehavior>;

export const BehaviorSpec = z.object({
  /** Built-in behavior id, or "script" for a sandboxed custom script (see `world.scripts`). */
  type: z.union([BuiltinBehavior, z.literal('script')]),
  params: z.record(z.string(), Json).default({}),
  enabled: z.boolean().default(true),
});
export type BehaviorSpec = z.infer<typeof BehaviorSpec>;

// ---------------------------------------------------------------------------
// Architecture metadata (additive) — see @aether/arch
// ---------------------------------------------------------------------------

/**
 * Role of an entity in a parametric building. The geometry itself comes from
 * the `arch-*` / `furn-*` procedural generators; this metadata lets tools,
 * views (cutaway, exploded levels, floor plan) and checks (navigation, door
 * clearance) understand the building without parsing generator params.
 */
export const ArchRole = z.enum([
  'building', 'level', 'wall', 'room', 'ceiling', 'door', 'window', 'opening', 'stair', 'roof', 'railing', 'column',
  'furniture', 'fixture', 'light', 'switch', 'site', 'pool',
  // Additive: a drawer, cabinet door or appliance door that is its own entity (child of its piece).
  'part',
]);
export type ArchRole = z.infer<typeof ArchRole>;

export const ArchMeta = z.object({
  role: ArchRole,
  /** Display name (room "Kitchen", level "Ground floor", furniture "Sofa"). */
  name: z.string().max(80).optional(),
  /** Levels: storey index (0 = ground floor, negative = basement). */
  level: z.number().int().min(-8).max(200).optional(),
  /** Levels: floor-to-floor height in metres. */
  height: z.number().min(1).max(30).optional(),
  /** Furniture / fixtures / lights / switches: the room entity they belong to. */
  room: EntityId.optional(),
  /** Doors / windows / openings: the host wall entity. */
  wall: EntityId.optional(),
  /** Furniture / fixture kind ("sofa", "bed", "pendant") or room type ("kitchen"). */
  kind: z.string().max(40).optional(),
  /**
   * Alternative looks for the interactive material swap (walkthrough key R):
   * each is a set of procedural-shape param overrides (e.g. `{ "upholstery":
   * "velvet", "color": "#3f5a52" }` for a sofa, `{ "finish": { "finish":
   * "marble" } }` for a floor) applied as a runtime override.
   */
  variants: z.array(z.record(z.string(), Json)).max(6).optional(),
  /**
   * Buildings: the plan they were compiled from (see @aether/arch
   * `BuildingPlan`), so architecture tools can edit and re-compile the
   * building parametrically. Opaque JSON here; validated by @aether/arch.
   */
  plan: Json.optional(),
  /**
   * Property edits made to this generated piece (by hand or by a prompt),
   * keyed by dotted entity path ("shape.params.color", "transform.position").
   * They are re-applied when the building is re-compiled, so a small edit
   * is not lost when the plan changes. Compiled pieces only.
   */
  overrides: z.record(z.string(), Json).refine((r) => Object.keys(r).length <= 64, 'at most 64 recorded edits per piece').optional(),
  /** Building entity only: ids of compiled pieces the user removed; they stay removed on re-compile. */
  removed: z.array(EntityId).max(400).optional(),
});
export type ArchMeta = z.infer<typeof ArchMeta>;

// ---------------------------------------------------------------------------
// Entity
// ---------------------------------------------------------------------------

/**
 * Additive: something the player can use in play mode by aiming at it
 * (crosshair + "E: open"). The motion itself is an `operable` / `toggle` /
 * `door` behavior (or a physical joint); this field names the verb and the
 * reach for the prompt, and marks pick-up-able props.
 */
export const InteractSpec = z.object({
  kind: z.enum(['door', 'drawer', 'cabinet', 'window', 'appliance', 'switch', 'tap', 'pickup', 'seat']),
  /** Noun shown in the prompt ("drawer", "front door"). */
  label: z.string().max(40).optional(),
  /** How close (metres) the player must be; default 2.4. */
  reach: z.number().min(0.4).max(6).optional(),
});
export type InteractSpec = z.infer<typeof InteractSpec>;

export const Entity = z.object({
  id: EntityId,
  name: z.string().default(''),
  /** Short semantic description; used by the agent for reasoning and by the outliner. */
  description: z.string().optional(),
  parent: EntityId.nullable().default(null),
  tags: z.array(z.string()).default([]),
  transform: Transform.default({ position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }),
  shape: ShapeSpec.default({ kind: 'none' }),
  material: MaterialSpec.optional(),
  physics: PhysicsSpec.optional(),
  joint: JointSpec.optional(),
  light: LightSpec.optional(),
  behaviors: z.array(BehaviorSpec).default([]),
  /** Per-entity variables readable/writable by rules (e.g. health, open). */
  state: z.record(z.string(), Json).default({}),
  visible: z.boolean().default(true),
  castShadow: z.boolean().default(true),
  receiveShadow: z.boolean().default(true),
  /** When true the entity is a template for `spawn` actions and is not instantiated. */
  template: z.boolean().default(false),
  /**
   * Locked by the user in the editor: not selectable in the viewport, and the
   * agent must not change it (its patches are refused with an explanation).
   */
  locked: z.boolean().optional(),
  /** Additive: role in a parametric building (walls, rooms, doors, furniture …). */
  arch: ArchMeta.optional(),
  /**
   * Additive: an intelligent character (perception, behaviour graph,
   * waypoints, dialogue). See `npc-schema.ts` and `@aether/logic` `npc/`.
   */
  npc: NpcSpec.optional(),
  /**
   * Additive: a human look (a person from the cast, tinted and animated) shown
   * instead of the entity's own shape; the shape stays the collider. See
   * `character-schema.ts`.
   */
  character: CharacterSpec.optional(),
  /** Additive: usable by aiming at it in play mode (see {@link InteractSpec}). */
  interact: InteractSpec.optional(),
});
export type Entity = z.infer<typeof Entity>;
export type EntityInput = z.input<typeof Entity>;

// ---------------------------------------------------------------------------
// Rules — world-level "when / if / then" logic (executed by @aether/logic)
// ---------------------------------------------------------------------------

export const CompareOp = z.enum(['==', '!=', '>', '<', '>=', '<=']);
export type CompareOp = z.infer<typeof CompareOp>;

export const Trigger = z.discriminatedUnion('on', [
  z.object({ on: z.literal('start') }),
  z.object({ on: z.literal('tick'), every: z.number().positive().default(1) }),
  z.object({ on: z.literal('timer'), at: z.number().min(0) }),
  z.object({ on: z.literal('collision'), a: Selector, b: Selector.default('*'), minImpulse: z.number().min(0).default(0) }),
  z.object({ on: z.literal('enter'), zone: Selector, who: Selector.default('player') }),
  z.object({ on: z.literal('exit'), zone: Selector, who: Selector.default('player') }),
  z.object({ on: z.literal('key'), key: z.string().min(1) }),
  z.object({ on: z.literal('click'), target: Selector }),
  z.object({ on: z.literal('state'), key: z.string(), op: CompareOp, value: Json }),
  z.object({ on: z.literal('event'), name: z.string().min(1) }),
  z.object({ on: z.literal('fallBelow'), target: Selector, y: z.number() }),
]);
export type Trigger = z.infer<typeof Trigger>;

/** Condition on a world state variable ("score") or entity state ("door-1.open"). */
export const Condition = z.object({ key: z.string(), op: CompareOp, value: Json });
export type Condition = z.infer<typeof Condition>;

export const Action = z.discriminatedUnion('do', [
  z.object({ do: z.literal('set'), key: z.string(), value: Json }),
  z.object({ do: z.literal('add'), key: z.string(), amount: z.number() }),
  z.object({ do: z.literal('spawn'), template: EntityId, at: z.union([Vec3, Selector]).optional(), count: z.number().int().min(1).max(500).default(1), spread: z.number().min(0).default(0) }),
  z.object({ do: z.literal('destroy'), target: Selector }),
  z.object({ do: z.literal('impulse'), target: Selector, vector: Vec3 }),
  z.object({ do: z.literal('setVelocity'), target: Selector, vector: Vec3 }),
  z.object({ do: z.literal('teleport'), target: Selector, to: z.union([Vec3, Selector]) }),
  z.object({ do: z.literal('setProperty'), target: Selector, path: z.string(), value: Json }),
  z.object({ do: z.literal('enableBehavior'), target: Selector, behavior: z.string(), enabled: z.boolean() }),
  z.object({ do: z.literal('explode'), at: z.union([Vec3, Selector]), force: z.number().positive().default(20), radius: z.number().positive().default(5) }),
  z.object({ do: z.literal('setGravity'), vector: Vec3 }),
  z.object({ do: z.literal('emit'), event: z.string().min(1), delay: z.number().min(0).default(0) }),
  z.object({ do: z.literal('message'), text: z.string(), duration: z.number().positive().default(3) }),
  z.object({ do: z.literal('sound'), sound: z.enum(['pickup', 'hit', 'explosion', 'win', 'lose', 'click', 'whoosh', 'bell']) }),
  z.object({ do: z.literal('win'), text: z.string().default('You win!') }),
  z.object({ do: z.literal('lose'), text: z.string().default('Game over') }),
  z.object({ do: z.literal('reset') }),
]);
export type Action = z.infer<typeof Action>;

export const Rule = z.object({
  id: z.string().min(1),
  description: z.string().optional(),
  when: Trigger,
  if: z.array(Condition).default([]),
  then: z.array(Action).min(1),
  /** Fire at most once per play session. */
  once: z.boolean().default(false),
  enabled: z.boolean().default(true),
});
export type Rule = z.infer<typeof Rule>;
export type RuleInput = z.input<typeof Rule>;

// ---------------------------------------------------------------------------
// Environment and player
// ---------------------------------------------------------------------------

export const Environment = z.object({
  sky: z.enum(['day', 'dawn', 'sunset', 'night', 'overcast', 'space', 'studio']).default('day'),
  /** 0–24 hours; drives sun direction and color when set. */
  timeOfDay: z.number().min(0).max(24).optional(),
  fog: z
    .object({
      color: Color,
      density: z.number().min(0).max(1),
      /**
       * Additive: aerial-perspective range in metres. Distant scenery reaches about 63 % haze at this distance whatever
       * the content-size policy does to `density` (which keeps small worlds crisp): a river valley with a mountain 400 m
       * away sets about 600 and the mountain turns blue-grey.
       */
      visibility: z.number().min(30).max(20000).optional(),
    })
    .nullable()
    .default(null),
  /** Particle weather. Additive: 'petals' (drifting blossom) and 'leaves' (tumbling autumn leaves). */
  weather: z.enum(['clear', 'rain', 'snow', 'dust', 'fireflies', 'petals', 'leaves']).default('clear'),
  ambientIntensity: z.number().min(0).default(0.4),
  sunIntensity: z.number().min(0).default(2.5),
  /** Infinite ground plane at y=0 with a collider. Set to null for no ground (space, sky islands). */
  ground: z.object({ material: MaterialSpec, size: z.number().positive().default(400) }).nullable().default({ material: { preset: 'grass' }, size: 400 }),
  gravity: Vec3.default([0, -9.81, 0]),
  /** Post effects. */
  bloom: z.number().min(0).max(3).default(0.4),
  exposure: z.number().min(0.1).max(4).default(1),
  /**
   * Additive: image-based lighting and background from an HDR environment
   * map — a library HDRI id (kind "hdri" in the asset catalog) or a user
   * import ("user-…"). The analytic sky stays the fallback while it loads
   * or when the id is unknown.
   */
  hdri: AssetRef.optional(),
  /** HDRI lighting strength (default 1). */
  hdriIntensity: z.number().min(0).max(8).optional(),
  /** Show the HDRI as the background (default true); false keeps the analytic sky behind HDRI lighting. */
  hdriBackground: z.boolean().optional(),
});
export type Environment = z.infer<typeof Environment>;

export const PlayerSpec = z.object({
  mode: z.enum(['orbit', 'firstPerson', 'thirdPerson', 'vehicle']).default('thirdPerson'),
  spawn: Vec3.default([0, 1, 8]),
  /** Additive: the heading (degrees, 0 faces −Z, counter-clockwise from above) a first-person start looks along; default: toward the building's entrance, else where the editor camera looked. */
  yaw: z.number().min(-720).max(720).optional(),
  /** Entity the player controls in vehicle mode, or the avatar entity in third-person. */
  controls: EntityId.optional(),
  moveSpeed: z.number().positive().default(6),
  jumpSpeed: z.number().min(0).default(6),
  /** Additive: how the player's body looks in third person (default: chosen from the world's seed). */
  character: CharacterSpec.optional(),
});
export type PlayerSpec = z.infer<typeof PlayerSpec>;

// ---------------------------------------------------------------------------
// Custom code generated at runtime by the coding model (sandboxed)
// ---------------------------------------------------------------------------

export const ParamSpec = z.object({
  type: z.enum(['number', 'int', 'boolean', 'color', 'enum']),
  default: Json,
  min: z.number().optional(),
  max: z.number().optional(),
  options: z.array(z.string()).optional(),
  description: z.string().optional(),
});
export type ParamSpec = z.infer<typeof ParamSpec>;

/**
 * A procedural geometry generator written by the coding model.
 * `source` is the BODY of `function generate(params, api) { ... }` and must return
 * the result of `api.build()` — see @aether/procgen GeneratorApi.
 */
export const GeneratorDef = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/),
  description: z.string(),
  params: z.record(z.string(), ParamSpec).default({}),
  source: z.string().min(1).max(60_000),
});
export type GeneratorDef = z.infer<typeof GeneratorDef>;

/**
 * A custom behavior script written by the coding model. `source` is the BODY of
 * `function update(ctx) { ... }` called every fixed tick — see @aether/logic ScriptContext.
 */
export const ScriptDef = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/),
  description: z.string(),
  source: z.string().min(1).max(30_000),
});
export type ScriptDef = z.infer<typeof ScriptDef>;

// ---------------------------------------------------------------------------
// Verification tests — expectations proven by running the physics headless
// ---------------------------------------------------------------------------

export const WorldTest = z.discriminatedUnion('kind', [
  /** Targets come to rest without drifting more than maxDrift meters. */
  z.object({ id: z.string(), kind: z.literal('stable'), target: Selector.default('*'), seconds: z.number().positive().default(3), maxDrift: z.number().positive().default(0.15) }),
  /** No dynamic bodies start interpenetrating. */
  z.object({ id: z.string(), kind: z.literal('noOverlap'), target: Selector.default('*') }),
  /** Target's position enters a zone (entity bounds or sphere) within N seconds of simulation. */
  z.object({ id: z.string(), kind: z.literal('reaches'), target: Selector, zone: z.union([Selector, z.object({ center: Vec3, radius: z.number().positive() })]), within: z.number().positive().default(10) }),
  /** A world/entity state condition becomes true within N seconds (rules run headless). */
  z.object({ id: z.string(), kind: z.literal('eventually'), condition: Condition, within: z.number().positive().default(10) }),
  /** Target moves at least `distance` meters (e.g. a domino chain actually falls). */
  z.object({ id: z.string(), kind: z.literal('moves'), target: Selector, distance: z.number().positive().default(0.5), within: z.number().positive().default(10) }),
  /** Target tips over (rotation from upright exceeds `degrees`). */
  z.object({ id: z.string(), kind: z.literal('topples'), target: Selector, degrees: z.number().positive().default(45), within: z.number().positive().default(10) }),
  /** Target stays above y (never falls through the world / off the island). */
  z.object({ id: z.string(), kind: z.literal('staysAbove'), target: Selector, y: z.number().default(-1), within: z.number().positive().default(10) }),
  /**
   * Additive: the building(s) matched by `target` are physically usable —
   * every room is reachable on foot from the entrance over a coarse
   * navigation grid (walls, closed glass and furniture block; doorways and
   * stairs connect), every door can swing open without hitting anything,
   * walkways keep `clearance` metres, and no furniture floats or overlaps.
   */
  z.object({ id: z.string(), kind: z.literal('navigable'), target: Selector.default('*'), clearance: z.number().min(0.4).max(2).default(0.8) }),
  /**
   * Additive: the NPCs matched by `target` work. Decided from the document at
   * t = 0 (spawn and waypoints stand on walkable floor, every patrol point is
   * reachable on the navigation grid, dialogue trees have no dead ends) and
   * then over `seconds` of simulation (nobody falls through the floor and no
   * NPC that should be walking is stuck for `stuckAfter` seconds).
   */
  z.object({ id: z.string(), kind: z.literal('npcs'), target: Selector.default('*'), seconds: z.number().positive().default(20), stuckAfter: z.number().positive().default(6) }),
]);
export type WorldTest = z.infer<typeof WorldTest>;

// ---------------------------------------------------------------------------
// Mesh assets — editable geometry stored in the document (see core mesh codec)
// ---------------------------------------------------------------------------

/**
 * Binary data as base64 chunks (each ≤ 64 Ki characters, so no single string
 * exceeds the untrusted-input string limit). Little-endian.
 */
export const Base64Chunks = z.array(z.string().max(65_536).regex(/^[A-Za-z0-9+/]*={0,2}$/, 'chunks must be base64')).max(256);
export type Base64Chunks = z.infer<typeof Base64Chunks>;

/**
 * Indexed triangle mesh. Encoding (see `encodeMesh` / `decodeMesh`):
 * `positions` float32 xyz, `indices` uint16 (3 per triangle, counter-clockwise
 * front faces), `colors` uint8 sRGB rgb per vertex, `uvs` float32 uv per
 * vertex, `faceMaterials` uint8 slot per triangle into `materials`.
 * Normals are derived (smooth, split where vertices are split).
 */
export const MeshAsset = z.object({
  id: MeshId,
  vertexCount: z.number().int().min(3).max(65_536),
  triangleCount: z.number().int().min(1).max(131_072),
  positions: Base64Chunks,
  indices: Base64Chunks,
  colors: Base64Chunks.optional(),
  uvs: Base64Chunks.optional(),
  faceMaterials: Base64Chunks.optional(),
  /** Material slots (merged under the entity material, like generator parts). */
  materials: z.array(MaterialSpec).max(16).default([]),
  /** What the mesh was baked from (lets the editor re-generate it). */
  source: z.object({ shape: z.union([PrimitiveShape, ProceduralShape]) }).optional(),
});
export type MeshAsset = z.infer<typeof MeshAsset>;
export type MeshAssetInput = z.input<typeof MeshAsset>;

// ---------------------------------------------------------------------------
// Title card (additive)
// ---------------------------------------------------------------------------

/**
 * Additive: the title card shown when play starts — the world's name as a
 * game title, a one-line tagline, the objective and up to six control
 * hints. Plain text only (rendered as text, never as HTML).
 */
export const WorldIntro = z.object({
  title: z.string().min(1).max(80),
  tagline: z.string().max(200).default(''),
  objective: z.string().max(240).optional(),
  /** Control hints such as "WASD — walk", "E — talk". */
  controls: z.array(z.string().min(1).max(60)).max(6).default([]),
  /** Accent colour of the card (defaults to the theme accent). */
  accent: Color.optional(),
});
export type WorldIntro = z.infer<typeof WorldIntro>;

// ---------------------------------------------------------------------------
// World document
// ---------------------------------------------------------------------------

export const WorldDoc = z.object({
  version: z.literal(1).default(1),
  id: z.string().default('world'),
  name: z.string().default('Untitled world'),
  description: z.string().default(''),
  seed: z.number().int().default(1),
  environment: Environment.default(Environment.parse({})),
  player: PlayerSpec.default(PlayerSpec.parse({})),
  entities: z.record(EntityId, Entity).default({}),
  rules: z.array(Rule).default([]),
  /** Global world variables (score, lives, flags) readable by rules and HUD. */
  state: z.record(z.string(), Json).default({}),
  /** HUD bindings: show these state keys on screen. */
  hud: z.array(z.object({ key: z.string(), label: z.string() })).default([]),
  generators: z.record(z.string(), GeneratorDef).default({}),
  scripts: z.record(z.string(), ScriptDef).default({}),
  tests: z.array(WorldTest).default([]),
  /** Editable mesh data referenced by `mesh` shapes. */
  meshes: z.record(MeshId, MeshAsset).default({}),
  /**
   * Additive: block terrain (Minecraft-like voxel world) with its edits and
   * game-kit settings. Absent for ordinary worlds. See `voxel-schema.ts`.
   */
  voxel: VoxelTerrain.optional(),
  /** Additive: title card shown when play starts (see {@link WorldIntro}). */
  intro: WorldIntro.optional(),
});
export type WorldDoc = z.infer<typeof WorldDoc>;
export type WorldDocInput = z.input<typeof WorldDoc>;

// ---------------------------------------------------------------------------
// Patches — the ONLY way the agent (or the editor UI) mutates a world
// ---------------------------------------------------------------------------

/** Deep-partial entity used by `update`. Arrays are replaced, objects merged. */
export const EntityUpdate = z.record(z.string(), Json);

export const Patch = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add'), entity: Entity }),
  z.object({ op: z.literal('update'), id: EntityId, set: EntityUpdate }),
  z.object({ op: z.literal('remove'), id: EntityId, /** also remove children */ recursive: z.boolean().default(true) }),
  z.object({ op: z.literal('rename'), id: EntityId, newId: EntityId }),
  z.object({ op: z.literal('addRule'), rule: Rule }),
  z.object({ op: z.literal('updateRule'), id: z.string(), set: z.record(z.string(), Json) }),
  z.object({ op: z.literal('removeRule'), id: z.string() }),
  z.object({ op: z.literal('setEnvironment'), set: z.record(z.string(), Json) }),
  z.object({ op: z.literal('setPlayer'), set: z.record(z.string(), Json) }),
  z.object({ op: z.literal('setState'), key: z.string(), value: Json }),
  z.object({ op: z.literal('setHud'), hud: z.array(z.object({ key: z.string(), label: z.string() })) }),
  z.object({ op: z.literal('defineGenerator'), generator: GeneratorDef }),
  z.object({ op: z.literal('defineScript'), script: ScriptDef }),
  z.object({ op: z.literal('addTest'), test: WorldTest }),
  z.object({ op: z.literal('removeTest'), id: z.string() }),
  z.object({
    op: z.literal('setMeta'),
    name: z.string().optional(),
    description: z.string().optional(),
    seed: z.number().int().optional(),
    /** Additive: set the title card, or with `null` remove it. */
    intro: WorldIntro.nullable().optional(),
  }),
  z.object({ op: z.literal('clear'), /** keep environment/player */ keepEnvironment: z.boolean().default(true) }),
  /** Additive: delete a custom generator (rejected while entities still use it). Needed so `defineGenerator` is invertible. */
  z.object({ op: z.literal('removeGenerator'), id: z.string().min(1) }),
  /** Additive: delete a custom script. Needed so `defineScript` is invertible. */
  z.object({ op: z.literal('removeScript'), id: z.string().min(1) }),
  /** Additive: add or replace an editable mesh asset (editor bake / mesh edits). */
  z.object({ op: z.literal('setMesh'), mesh: MeshAsset }),
  /** Additive: delete a mesh asset (rejected while entities still use it). */
  z.object({ op: z.literal('removeMesh'), id: MeshId }),
  /**
   * Additive: create, configure (deep merge, arrays replace) or with `set: null`
   * remove the voxel terrain.
   */
  z.object({ op: z.literal('setVoxel'), set: z.record(z.string(), Json).nullable() }),
  /** Additive: append block edits (boxes, spheres, structures, pixel art …) to the voxel terrain. */
  z.object({ op: z.literal('voxelEdit'), edits: z.array(VoxelEdit).min(1).max(256) }),
]);
export type Patch = z.infer<typeof Patch>;
export type PatchInput = z.input<typeof Patch>;
