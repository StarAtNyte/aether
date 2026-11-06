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
import { EntityVfx, FeelEvent, FeelSpec, VfxPreset } from './feel-schema';
import { MAX_SURFACE_LAYERS, SHADER_LIMITS, SURFACE_LAYER_KINDS, shaderChannelError, type ShaderChannel } from './shader-lang';

export * from './voxel-schema';
export * from './feel-schema';
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
  // Additive: building facades (window grid with recessed glass and mullions; a share of the windows glows after dark).
  'facade',
  // Additive: ground and wall surfaces with real relief (granite setts, rough limestone masonry, dry packed earth, pine cladding).
  'cobble', 'limestone', 'dry-earth', 'cladding',
  // Additive: roof coverings (bundled reed straw, riven slate courses).
  'thatch', 'slate',
  // Additive: the cut face of a sectioned wall (architectural poche: dark solid with a diagonal hatch).
  'poche',
]);
export type MaterialFinish = z.infer<typeof MaterialFinish>;

/** Ids of texture sets: `tex-` + 12 hex characters of the maps' content hash. */
export const TEXTURE_ID = /^tex-[0-9a-f]{12}$/;
export const TextureId = z.string().regex(TEXTURE_ID, 'texture ids are tex- plus 12 hex characters');
export type TextureId = z.infer<typeof TextureId>;

/** Where the pixels of a texture set came from (shown to the user, never hidden). */
export const TextureProvenance = z.enum(['photographed', 'ai-generated', 'procedural']);
export type TextureProvenance = z.infer<typeof TextureProvenance>;

/**
 * Additive: a texture set of the project (albedo, occlusion / roughness, normal maps kept in the project's asset store, described
 * by `WorldDoc.textures[id]`) drawn instead of the finish's procedural maps. `tile` overrides the real-world size of one tile (m).
 * The material's `color` still multiplies the albedo (the maps hold ratios around 1), so tints and prompts keep working.
 */
export const TextureRef = z.object({
  id: TextureId,
  tile: z.number().min(0.05).max(16).optional(),
});
export type TextureRef = z.infer<typeof TextureRef>;

/**
 * Additive: where a surface layer applies. `up` / `down`: the faces at least this much facing up / down (0..1, the normal's
 * vertical part); `slope`: faces whose angle from horizontal-up lies in [min, max] degrees; `height`: world y range (m);
 * `noise`: share 0..1 of the surface covered, in large irregular patches; `invert` flips the whole mask.
 */
export const SurfaceMask = z.object({
  up: z.number().min(0).max(1).optional(),
  down: z.number().min(0).max(1).optional(),
  slope: z.tuple([z.number().min(0).max(180), z.number().min(0).max(180)]).optional(),
  height: z.tuple([z.number().min(-10_000).max(10_000), z.number().min(-10_000).max(10_000)]).optional(),
  noise: z.number().min(0).max(1).optional(),
  invert: z.boolean().optional(),
});
export type SurfaceMask = z.infer<typeof SurfaceMask>;

/** Additive: one procedural weathering / effect layer of `material.surface` (see the renderer's surface-layers.ts). */
export const SurfaceLayer = z.object({
  kind: z.enum(SURFACE_LAYER_KINDS),
  color: Color.optional(),
  /** Strength / coverage 0..1 (default 0.5). */
  amount: z.number().min(0).max(1).optional(),
  /** Feature size in metres (a pulse's period in seconds); each kind has its own default. */
  scale: z.number().min(0.005).max(500).optional(),
  mask: SurfaceMask.optional(),
});
export type SurfaceLayer = z.infer<typeof SurfaceLayer>;

/** Additive: layered, world-space procedural weathering; works on any mesh without UVs. `scale` multiplies every layer's size. */
export const MaterialSurface = z.object({
  layers: z.array(SurfaceLayer).min(1).max(MAX_SURFACE_LAYERS),
  scale: z.number().min(0.05).max(20).optional(),
});
export type MaterialSurface = z.infer<typeof MaterialSurface>;

const shaderChannel = (channel: ShaderChannel) =>
  z
    .string()
    .max(SHADER_LIMITS.chars)
    .superRefine((src, ctx) => {
      const err = shaderChannelError(channel, src);
      if (err) ctx.addIssue({ code: 'custom', message: err });
    });

/**
 * Additive: per-channel shader expressions in the material expression language (see `shader-lang.ts`): `color` / `emissive`
 * vec3, `roughness` / `metalness` / `opacity` / `bump` (height in metres) / `displace` (metres along the normal) float.
 */
export const MaterialShader = z.object({
  color: shaderChannel('color').optional(),
  roughness: shaderChannel('roughness').optional(),
  metalness: shaderChannel('metalness').optional(),
  emissive: shaderChannel('emissive').optional(),
  bump: shaderChannel('bump').optional(),
  opacity: shaderChannel('opacity').optional(),
  displace: shaderChannel('displace').optional(),
});
export type MaterialShader = z.infer<typeof MaterialShader>;

export const MaterialSpec = z.object({
  preset: MaterialPreset.optional(),
  /** Additive: physically based finish with procedural texture maps (see {@link MaterialFinish}). */
  finish: MaterialFinish.optional(),
  /** Additive: a texture set of the project (photographed, AI-generated or procedural) replacing the finish's maps. */
  texture: TextureRef.optional(),
  color: Color.optional(),
  roughness: z.number().min(0).max(1).optional(),
  metalness: z.number().min(0).max(1).optional(),
  emissive: Color.optional(),
  emissiveIntensity: z.number().min(0).max(50).optional(),
  opacity: z.number().min(0).max(1).optional(),
  flatShading: z.boolean().optional(),
  /** Additive: draw both faces of the part, so a shell (a dome, a tent, a greenhouse, a glass wall) is visible from inside as well as outside. */
  doubleSided: z.boolean().optional(),
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
  /**
   * Additive: the scale of a water surface (preset "water"): `puddle`, `pond`, `stream`, `river`, `lake` or `sea`. It sets
   * the wave length and steepness, the clarity (how deep the eye sees), whether it flows and how much foam it shows.
   * `fall` is falling water (a waterfall sheet, e.g. `api.ribbon` down a drop with v = metres from the lip): streaks that
   * speed up as they fall, glassy at the lip, aerated white lower down, ragged translucent edges.
   * Without it the renderer reads the scale from the entity's size and tags.
   */
  waterKind: z.enum(['puddle', 'pond', 'stream', 'river', 'lake', 'sea', 'fall']).optional(),
  /** Additive: the current of flowing water as a world-space velocity `[x, z]` in metres per second (rivers, streams). */
  waterFlow: z.tuple([z.number().min(-12).max(12), z.number().min(-12).max(12)]).optional(),
  /** Additive: layered procedural weathering and effects (moss, grime, edge wear, glowing cracks, rim glow ...), see {@link MaterialSurface}. */
  surface: MaterialSurface.optional(),
  /** Additive: per-channel shader expressions (lava, holograms, force fields, flags ...), see {@link MaterialShader}. */
  shader: MaterialShader.optional(),
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
  // Additive: a person placed in a building by the compiler (`BuildingPlan.residents`); `arch.room` names the room.
  'resident',
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
  /**
   * Furniture and fixtures: texture sets for parts of the piece, keyed by the part's finish (`fabric`) or finish and colour
   * (`fabric#f7f4ee`, the more specific key wins). A part whose material matches draws the set instead of the procedural maps.
   */
  skins: z.record(z.string().regex(/^[a-z][a-z-]{1,24}(#[0-9a-f]{6})?$/), TextureRef).refine((r) => Object.keys(r).length <= 8, 'at most 8 skins per piece').optional(),
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
  /**
   * Additive: the object this one belongs to without being its child (a
   * shrine's light or goal zone, a statue's plinth). It keeps its own world
   * transform but moves with its owner, and an edit of the owner may change
   * it. A missing owner is ignored. See `dependents.ts`.
   */
  attachedTo: EntityId.optional(),
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
  /** Additive: a continuous particle emitter that follows the entity (visual only; see `feel-schema.ts`). */
  vfx: EntityVfx.optional(),
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
  z.object({ do: z.literal('sound'), sound: z.enum(['pickup', 'hit', 'explosion', 'win', 'lose', 'click', 'whoosh', 'bell', 'shot', 'alarm']) }),
  z.object({ do: z.literal('win'), text: z.string().default('You win!') }),
  z.object({ do: z.literal('lose'), text: z.string().default('Game over') }),
  z.object({ do: z.literal('reset') }),
  /**
   * Additive: a particle burst (and optionally the cue of a feel event: shake, flash, hit-stop …) at a place.
   * Visual only: it never changes the simulation. `at` defaults to the entity running the script, else the player.
   */
  z.object({
    do: z.literal('effect'),
    vfx: z.union([VfxPreset, z.literal('none')]).default('sparks'),
    at: z.union([Vec3, Selector]).optional(),
    feel: FeelEvent.optional(),
    color: Color.optional(),
    scale: z.number().min(0.2).max(4).optional(),
  }),
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
  ground: z
    .object({
      material: MaterialSpec,
      size: z.number().positive().default(400),
      /** Additive: false leaves out the decorative horizon skirt (a rooftop or island that must end at its edge). */
      skirt: z.boolean().optional(),
    })
    .nullable()
    .default({ material: { preset: 'grass' }, size: 400 }),
  gravity: Vec3.default([0, -9.81, 0]),
  /**
   * Additive: the wind. `speed` in metres per second (0 calm, 4 breeze, 10 strong, 20 storm) and `direction` in degrees
   * (0 blows toward -Z, counter-clockwise from above). It bends grass and trees, roughens lakes and seas and sets the
   * heading of their waves. Without it the air moves gently.
   */
  wind: z.object({ speed: z.number().min(0).max(30), direction: z.number().min(-720).max(720).default(0) }).optional(),
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
  /**
   * Additive: a colour grade that replaces the fields of the sky's own look (a room rebuilt from a photograph carries the
   * photograph's white balance, saturation, contrast and exposure). Each field is optional; omitted fields keep the preset's.
   */
  grade: z
    .object({
      /** Warm (+) / cool (-) white balance. */
      temperature: z.number().min(-1).max(1).optional(),
      /** Green (+) / magenta (-) tint. */
      tint: z.number().min(-1).max(1).optional(),
      saturation: z.number().min(0.4).max(1.8).optional(),
      contrast: z.number().min(0.6).max(1.6).optional(),
      /** Exposure offset in stops, on top of `exposure`. */
      exposureEv: z.number().min(-3).max(3).optional(),
    })
    .optional(),
  /**
   * Additive: look parameters a reviewer (the assistant, after viewing renders) tunes per world. Each field is optional;
   * omitted fields keep the renderer's default (the defaults are named in docs/CONTRACTS.md). They change how light and
   * colour are presented, never the simulation.
   */
  look: z
    .object({
      /** Warm (+) shift of the white balance in a fully adapted, lit interior, in grade temperature units (default 0.45). */
      interiorWarmth: z.number().min(-1).max(1.5).optional(),
      /** How much of a room light's own colour cast (wood bounce, warm lamps) the interior white balance takes out, 0 none .. 1.5 more than all (default 1). */
      interiorBalance: z.number().min(0).max(1.5).optional(),
      /** Multiplies the sun's colour (a hex tint; white keeps it). */
      sunTint: Color.optional(),
      /** Multiplies the sky/hemisphere ambient colour. */
      ambientTint: Color.optional(),
      /** Multiplies the colour of leaf, needle and grass cards (a hex tint; white keeps it). */
      foliageTint: Color.optional(),
      /**
       * How many distinct `surface` / `shader` materials the renderer compiles: `normal` (default) half of the render tier's
       * cap, `hero` all of it (a world refined for its art, e.g. by the hardcore passes). Beyond the cap the rest draw plain.
       */
      shaderBudget: z.enum(['normal', 'hero']).optional(),
      /** Strength of the room lamps in the baked interior light, 0 none .. 3 triple (default 1). */
      lampStrength: z.number().min(0).max(3).optional(),
      /** Edge darkening of the picture, 0 none .. 1 strong (default: the grade preset's). */
      vignette: z.number().min(0).max(1).optional(),
      /**
       * The lighting INTENT of the world, stated by the author instead of guessing an exposure: `key` is how bright the picture
       * should read at eye height (dim: a cinema or lounge, moderate: most rooms, bright: an airy cafe or a bright gallery) and
       * `text` is the author's own words. The renderer derives the exposure from the measured picture against the key (the
       * closed-loop trim); `exposure` and `grade.exposureEv` then act only as a bias. Presentation only: the baked light does
       * not depend on it.
       */
      intent: z.object({ key: z.enum(['dim', 'moderate', 'bright']).optional(), text: z.string().max(120).optional() }).optional(),
      /**
       * Additive, opt-in: the presentation style. `anime` is for worlds whose surfaces carry their own painted, cel-shaded colour
       * (baked toon light, unlit pieces): a palette-preserving linear tone curve on every tier, a neutral grade (no sky-derived
       * warmth or saturation caps), no automatic exposure, and no screen-space shading passes (ambient occlusion, contact
       * shadows, reflections, GI, sun shafts, aberration, grain) that would muddy flat colour. Bloom stays. Absent: realistic.
       */
      style: z.enum(['realistic', 'anime']).optional(),
    })
    .optional(),
  /**
   * Additive: exterior context beyond the plot, seen through windows and from a cutaway: distant hills that melt into the horizon
   * haze, a tree line and groves of instanced trees, and a patchwork of fields past the lawn. A `preset` sets sensible values
   * (`meadow`, `countryside` (default), `woodland`, `suburb`, `alpine` (snow-capped mountains behind conifer hills), `none`); every other field overrides the preset. Presentation
   * only: it never changes the simulation, the physics world, the light volume or the baked lightmap.
   */
  surroundings: z
    .object({
      preset: z.enum(['none', 'meadow', 'countryside', 'woodland', 'suburb', 'alpine']).optional(),
      /** Ridge height of the nearer hills in metres (0 = no hills). */
      hills: z.number().min(0).max(200).optional(),
      /** Distance of the nearer hill layer in metres. */
      hillDistance: z.number().min(150).max(1500).optional(),
      /** Density of the tree line and groves, 0 none .. 1 dense. */
      trees: z.number().min(0).max(1).optional(),
      species: z.enum(['broadleaf', 'conifer', 'mixed']).optional(),
      /** Patchwork of fields beyond the plot. */
      fields: z.boolean().optional(),
      /** Radius around the origin (metres) kept free of trees. */
      clearRadius: z.number().min(10).max(400).optional(),
      /** Peak height (metres) of a far mountain range with snow on its summits (0 = none; `alpine` sets 650). */
      mountains: z.number().min(0).max(2000).optional(),
      /** Distance of the mountain range in metres. */
      mountainDistance: z.number().min(600).max(2100).optional(),
      /** Layout seed (the same data always draws the same landscape). */
      seed: z.number().int().min(0).max(1_000_000).optional(),
    })
    .optional(),
  /**
   * Additive: the baked lightmap of a building's interior (bounce light and sky occlusion per surface texel, path traced on the
   * CPU and cached by content). Absent: the renderer decides (an automatic bake on the medium and high tiers). `quality` picks
   * the atlas size and the rays per texel (low 256 px / 24 rays, medium 512 / 48, high 1024 / 96), `off` keeps the probe volume
   * alone; `samples` overrides the ray count. It changes how light is presented, never the simulation.
   */
  lightBake: z
    .object({
      quality: z.enum(['off', 'low', 'medium', 'high']),
      samples: z.number().int().min(8).max(512).optional(),
    })
    .optional(),
});
export type Environment = z.infer<typeof Environment>;

/**
 * Additive: the player's gun (third-person and first-person play). The fire input (left mouse button, the touch fire
 * button) shoots along the crosshair: a hitscan ray that damages NPCs (`entity.npc`; above 85 % of a character's height
 * counts as a head shot) and stops at solid geometry. Ammunition lives in world state (`ammoKey` in the magazine,
 * `reserveKey` in reserve), so the HUD, rules and pickups (a `collectible` with `scoreKey: "reserve"`) work with it.
 * R reloads (also automatic when the magazine runs dry). In third person a weapon puts the camera over the shoulder.
 */
export const WeaponSpec = z.object({
  name: z.string().max(40).default('Rifle'),
  /** Damage of one hit (NPC health points). */
  damage: z.number().min(0).max(10000).default(25),
  /** Shots per second. */
  fireRate: z.number().min(0.2).max(30).default(8),
  /** Fires while the trigger is held (false: one shot per press). */
  automatic: z.boolean().default(true),
  /** Rounds in a full magazine. */
  magazine: z.number().int().min(1).max(500).default(30),
  /** Rounds in reserve at the start. */
  reserve: z.number().int().min(0).max(100000).default(120),
  /** Seconds a reload takes. */
  reloadTime: z.number().min(0.1).max(10).default(1.6),
  /** Reach of a shot (m). */
  range: z.number().min(1).max(500).default(90),
  /** Random cone of a shot (degrees, full width). */
  spread: z.number().min(0).max(30).default(1.2),
  /** Damage multiplier of a head shot. */
  headshot: z.number().min(1).max(10).default(2),
  /** Radius (m) in which NPCs hear a shot. */
  noise: z.number().min(0).max(200).default(30),
  /** Push (N·s) a shot gives a dynamic body it hits. */
  impulse: z.number().min(0).max(100).default(3),
  ammoKey: z.string().min(1).max(40).default('ammo'),
  reserveKey: z.string().min(1).max(40).default('reserve'),
});
export type WeaponSpec = z.infer<typeof WeaponSpec>;
export type WeaponSpecInput = z.input<typeof WeaponSpec>;

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
  /** Additive: the player's gun (see {@link WeaponSpec}). */
  weapon: WeaponSpec.optional(),
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
  /** Additive: label of the start button (default "Start"). */
  button: z.string().min(1).max(24).optional(),
});
export type WorldIntro = z.infer<typeof WorldIntro>;

/**
 * Additive: the view the editor opens a world on: a camera inside the world at eye height or a little above (about 1.6 to 8 m over
 * the ground), looking at the landmark or the liveliest part. Absent: the studio computes one (an open, walkable spot near the
 * content's middle). The zoomed-out overview stays one click away; play mode starts from the player spawn as before.
 */
export const OpeningView = z.object({
  position: Vec3,
  target: Vec3,
  /** Vertical field of view in degrees (default: the editor camera's). */
  fov: z.number().min(20).max(100).optional(),
});
export type OpeningView = z.infer<typeof OpeningView>;

// ---------------------------------------------------------------------------
// World document
// ---------------------------------------------------------------------------

/** Largest edge (px) of a stored texture tier; the tiers a set may carry. */
export const TEXTURE_TIERS = [256, 512, 1024] as const;
export type TextureTier = (typeof TEXTURE_TIERS)[number];

/**
 * Additive: the description of one texture set. The maps themselves (`tex-<id>.albedo|orm|normal.<tier>.webp`) live in the
 * project's asset store (studio: IndexedDB, packages: `assets/`, bundled worlds: `templates/textures/`); the world keeps only
 * this record so the provenance travels with it.
 */
export const TextureSetDef = z.object({
  name: z.string().max(64),
  provenance: TextureProvenance,
  /** Real-world size of one tile in metres. */
  tile: z.number().min(0.05).max(16),
  /** Tiers stored (edge length in px). */
  tiers: z.array(z.union([z.literal(256), z.literal(512), z.literal(1024)])).min(1).max(3),
  /** The albedo map holds linear ratios around 1 divided by this; the material colour is multiplied by it. */
  albedoScale: z.number().min(1).max(8).default(2.5),
  /** Mean colour of the source (the colour the surface had in the photo or the generated image). */
  mean: Color,
  /** The finish the maps stand in for (roughness and relief class), when there is one. */
  finish: MaterialFinish.optional(),
  /** What it was made from (shown in the credits): the photo region, the prompt, the model. */
  source: z
    .object({
      region: z.string().max(80).optional(),
      photo: z.string().max(80).optional(),
      prompt: z.string().max(400).optional(),
      model: z.string().max(64).optional(),
      /** The set this one refines. */
      from: TextureId.optional(),
    })
    .optional(),
  /** Bundled worlds: relative folder the maps are served from (same origin, no `..`). */
  base: z.string().max(120).regex(/^[A-Za-z0-9._/-]*$/).refine((b) => !b.split('/').includes('..') && !b.startsWith('/'), 'a relative folder').optional(),
});
export type TextureSetDef = z.infer<typeof TextureSetDef>;

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
  /** Additive: the view the editor opens the world on (see {@link OpeningView}). */
  opening: OpeningView.optional(),
  /**
   * Additive: how a published (cooked) world starts at its opening: `play` (the game, from its title card), `walkthrough`
   * (on foot through an architectural world) or `orbit` (a free camera around a showcase scene). Absent: the player decides
   * from the world. The editor ignores it.
   */
  startMode: z.enum(['play', 'walkthrough', 'orbit']).optional(),
  /** Additive: game feel — feedback tier and per-event cues (visual only; absent = the `normal` tier). See `feel-schema.ts`. */
  feel: FeelSpec.optional(),
  /** Additive: texture sets of the project (see {@link TextureSetDef}); absent for worlds without photographed or generated maps. */
  textures: z.record(TextureId, TextureSetDef).refine((r) => Object.keys(r).length <= 48, 'at most 48 texture sets per world').optional(),
  /**
   * Additive: world-wide texture skins. A part whose finish (or whose preset's finish: dirt draws as soil) matches a key draws that
   * texture set instead of the procedural maps, in every piece; a piece's own `arch.skins` win. Keys as in `ArchMeta.skins`, with an
   * optional `@generator` that limits the skin to the pieces of one custom generator (`paint@town-row`: the walls, not the tram).
   */
  skins: z.record(z.string().regex(/^[a-z][a-z-]{1,24}(#[0-9a-f]{6})?(@[a-z0-9][a-z0-9_-]{0,63})?$/), TextureRef).refine((r) => Object.keys(r).length <= 24, 'at most 24 world skins').optional(),
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
    /** Additive: set the opening view (`world.opening`), or with `null` remove it (the studio computes one). */
    opening: OpeningView.nullable().optional(),
    /** Additive: replace the game feel (`world.feel`), or with `null` remove it (back to the `normal` tier). */
    feel: FeelSpec.nullable().optional(),
    /** Additive: add or replace texture sets of the project by id, or with `null` remove one (`WorldDoc.textures`). */
    textures: z.record(TextureId, TextureSetDef.nullable()).optional(),
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
