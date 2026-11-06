/**
 * Wire contract of Blender on the local Aether server (`/api/local/blender/*`,
 * loopback + session secret only; never on the paired bridge of hosted
 * studios). The server drives the user's own Blender through an MCP server
 * (`mcp-for-blender`) and exposes an allow-list of actions:
 *
 *   GET  /api/local/blender/status    → BlenderStatus
 *   POST /api/local/blender/settings  { enabled } → BlenderStatus
 *   POST /api/local/blender/plan      BlenderPlanRequest → BlenderPlan (nothing runs; Python actions return the exact code)
 *   POST /api/local/blender/run       { planId, confirm? } → BlenderRunResult (export_glb: model/gltf-binary bytes)
 *
 * Actions that run Python in Blender (`execute_blender_code` and the Aether
 * templates export_glb, render, bake) are refused unless the run request
 * carries `confirm: true`, which only the studio's confirmation dialog sets
 * after showing the plan's code. The agent's tool inputs never carry it.
 */
import { z } from 'zod';

/** Blender availability: `not_installed` (no Blender, add-on or uvx), `off` (switch off or Blender not listening), `ready`. */
export const BLENDER_STATES = ['ready', 'off', 'not_installed'] as const;
/** Blender availability. */
export type BlenderState = (typeof BLENDER_STATES)[number];

/** The MCP server's tools the server may call (everything else it offers is dropped). */
export const BLENDER_MCP_TOOLS = ['get_scene_info', 'look', 'execute_blender_code'] as const;
/** Actions of `/api/local/blender/plan`. */
export const BLENDER_ACTIONS = ['get_scene_info', 'look', 'execute_blender_code', 'export_glb', 'render', 'bake'] as const;
/** One Blender action. */
export type BlenderAction = (typeof BLENDER_ACTIONS)[number];
/** Actions that run Python in Blender: confirmation required on every run. */
export const BLENDER_PYTHON_ACTIONS: readonly BlenderAction[] = ['execute_blender_code', 'export_glb', 'render', 'bake'];

/** Does `action` run Python in Blender? */
export function blenderActionRunsPython(action: BlenderAction): boolean {
  return BLENDER_PYTHON_ACTIONS.includes(action);
}

/** `GET …/blender/status`. */
export const BlenderStatusSchema = z.object({
  state: z.enum(BLENDER_STATES),
  /** The local settings switch (off by default). */
  enabled: z.boolean(),
  detail: z.string().max(300),
});
/** Blender status. */
export type BlenderStatus = z.infer<typeof BlenderStatusSchema>;

/** `POST …/blender/settings` body. */
export const BlenderSettingsRequestSchema = z.object({ enabled: z.boolean() }).strict();

const objectName = z.string().min(1).max(120);
const BAKE_TYPES = ['COMBINED', 'DIFFUSE', 'AO', 'SHADOW', 'EMIT', 'ROUGHNESS', 'NORMAL', 'GLOSSY'] as const;

/** Inputs per action (strict: unknown keys, a confirmation flag included, are refused). */
export const BlenderInputs = {
  get_scene_info: z
    .object({
      query: z.string().max(80).optional(),
      root: objectName.optional(),
      fields: z.array(z.enum(['location', 'size', 'ground', 'rotation', 'scale', 'parent', 'children', 'hidden', 'details', 'materials', 'modifiers', 'animation', 'topology', 'weights', 'settings'])).max(15).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    })
    .strict(),
  look: z
    .object({
      mode: z.enum(['viewport', 'camera', 'angles']).optional(),
      target: z.array(objectName).max(16).optional(),
      shading: z.enum(['solid', 'material', 'rendered', 'wireframe', 'xray']).optional(),
      max_size: z.number().int().min(128).max(1024).optional(),
    })
    .strict(),
  execute_blender_code: z.object({ code: z.string().min(1).max(20_000) }).strict(),
  export_glb: z.object({ selection_only: z.boolean().optional(), name: z.string().min(1).max(64).optional() }).strict(),
  render: z
    .object({
      width: z.number().int().min(64).max(2048).optional(),
      height: z.number().int().min(64).max(2048).optional(),
      samples: z.number().int().min(1).max(1024).optional(),
    })
    .strict(),
  bake: z
    .object({
      object: objectName,
      type: z.enum(BAKE_TYPES).optional(),
      size: z.number().int().min(64).max(4096).optional(),
      samples: z.number().int().min(1).max(1024).optional(),
    })
    .strict(),
} as const satisfies Record<BlenderAction, z.ZodType>;

/** `POST …/blender/plan` body. */
export const BlenderPlanRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('get_scene_info'), input: BlenderInputs.get_scene_info }).strict(),
  z.object({ action: z.literal('look'), input: BlenderInputs.look }).strict(),
  z.object({ action: z.literal('execute_blender_code'), input: BlenderInputs.execute_blender_code }).strict(),
  z.object({ action: z.literal('export_glb'), input: BlenderInputs.export_glb }).strict(),
  z.object({ action: z.literal('render'), input: BlenderInputs.render }).strict(),
  z.object({ action: z.literal('bake'), input: BlenderInputs.bake }).strict(),
]);
/** A plan request. */
export type BlenderPlanRequest = z.infer<typeof BlenderPlanRequestSchema>;

/** Plan ids. */
export const BLENDER_PLAN_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A planned action: Python actions carry the exact code a confirmed run executes. */
export const BlenderPlanSchema = z.object({
  planId: z.string().regex(BLENDER_PLAN_ID_RE),
  action: z.enum(BLENDER_ACTIONS),
  python: z.boolean(),
  code: z.string().max(40_000).optional(),
  expiresAt: z.number(),
});
/** A planned action. */
export type BlenderPlan = z.infer<typeof BlenderPlanSchema>;

/** `POST …/blender/run` body: `confirm` is set only by the studio's confirmation dialog. */
export const BlenderRunRequestSchema = z.object({ planId: z.string().regex(BLENDER_PLAN_ID_RE), confirm: z.literal(true).optional() }).strict();

/** `POST …/blender/run` JSON result (every action but export_glb). */
export const BlenderRunResultSchema = z.object({
  text: z.string().max(20_000),
  /** A PNG data URL (look, render, bake). */
  image: z
    .string()
    .max(24 * 1024 * 1024)
    .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/)
    .optional(),
});
/** A run result. */
export type BlenderRunResult = z.infer<typeof BlenderRunResultSchema>;

/** Largest GLB an export may return. */
export const BLENDER_MAX_GLB_BYTES = 64 * 1024 * 1024;
