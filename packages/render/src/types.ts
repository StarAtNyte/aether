/**
 * Shared types of the render package. Procedural geometry types come from
 * `@aether/procgen` (type-only import, so pure modules and tests never load
 * procgen at runtime).
 */
import type { EntityId, PrimitiveShape, ProceduralShape, Vec3, WorldDoc } from '@aether/core';
import type { ColliderDesc, GeneratorOutput, MeshPart, SandboxRunner } from '@aether/procgen';

export type { ColliderDesc, GeneratorOutput, MeshPart, SandboxRunner };

/**
 * A physics/verification diagnostic to visualize. Structurally compatible with
 * `@aether/physics` `Diagnostic` (render does not depend on physics).
 */
export interface RenderDiagnostic {
  severity: 'error' | 'warning' | 'info';
  code: string;
  entities: EntityId[];
  message: string;
  suggestion?: string;
}

/** Generator output plus a stable cache key identifying it (used for geometry caching). */
export interface KeyedOutput {
  key: string;
  output: GeneratorOutput;
}

/**
 * Where entity geometry comes from. The default implementation wraps
 * `@aether/procgen`; tests inject fakes.
 */
export interface GeometrySource {
  /** Synchronous primitive geometry (same sizes physics uses). */
  primitive(shape: PrimitiveShape): KeyedOutput;
  /** Built-in or custom (sandboxed) procedural geometry. May reject. */
  procedural(shape: ProceduralShape, world: Pick<WorldDoc, 'generators'>): Promise<KeyedOutput>;
  /** Visible placeholder used when generation fails. */
  fallback(reason: string): KeyedOutput;
}

/** Camera modes supported by the renderer. */
/** `manual`: the host poses the camera every frame (`WorldRenderer.setCameraPose`, e.g. the voxel game). */
/** `shoulder`: an aiming third-person camera over the right shoulder that turns with the look yaw and pitch (shooters). */
export type CameraMode = 'orbit' | 'follow' | 'firstPerson' | 'manual' | 'shoulder';

/** Axis-aligned bounds as plain tuples. */
export interface Bounds {
  min: Vec3;
  max: Vec3;
}
