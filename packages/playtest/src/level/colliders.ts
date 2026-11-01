/**
 * The colliders of custom-generator shapes, for the level tools. Physics falls back to a 1 m placeholder box for a shape whose
 * generator only ever runs in the sandbox, so a terrain, a stepped street or a building made by one would measure as a box and
 * every reach and grounding answer would be wrong. The host that has the sandbox (the studio renderer, Node) hands the provider
 * to `runLevelTool`, which holds it for the duration of that call.
 */
import type { ColliderProvider } from '@aether/physics';

let current: ColliderProvider | undefined;

/** Set by {@link runLevelTool} around one tool call. */
export function setLevelColliders(provider: ColliderProvider | undefined): void {
  current = provider;
}

/** The provider of the running tool call, for the physics worlds the level tools build. */
export function levelColliders(): { colliders: ColliderProvider } | Record<string, never> {
  return current ? { colliders: current } : {};
}

/** True while a provider is set (part of the walking-map cache key). */
export function hasLevelColliders(): boolean {
  return current !== undefined;
}

/** What the world's custom generators draw as plain colour (see `worldSurfaceStats`), measured by the host that has the sandbox. */
export interface LevelSurfaces {
  area: number;
  flatArea: number;
  flatShare: number;
  generators: Array<{ generator: string; flatArea: number; area: number; entities: string[] }>;
  /** Triangles per m2 of each generator's surface (geometric detail). */
  detail?: Array<{ generator: string; tris: number; area: number; parts: number; trisPerM2: number; entities: string[] }>;
  /** Groups of entities that are the same piece repeated unchanged. */
  repeats?: Array<{ generator: string; count: number; entities: string[] }>;
}

let currentSurfaces: LevelSurfaces | undefined;

/** Set by {@link runLevelTool} around one tool call. */
export function setLevelSurfaces(surfaces: LevelSurfaces | undefined): void {
  currentSurfaces = surfaces;
}

/** The surface measurement of the running tool call, when the host made one. */
export function levelSurfaces(): LevelSurfaces | undefined {
  return currentSurfaces;
}
