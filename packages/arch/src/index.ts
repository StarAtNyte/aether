/**
 * @aether/arch — parametric architecture and interiors for Aether.
 *
 * Pure TypeScript on top of @aether/core: plan geometry, wall networks with
 * mitred joins, CSG-free openings, slabs, ceilings, roofs, stairs, doors,
 * windows, railings, pools, a procedural furniture catalogue, building plans
 * compiled into World IR patches, agent operations, navigation and
 * clearance checks. Geometry builders return typed arrays with metric UVs;
 * @aether/procgen wraps them as the `arch-*` and `furn-*` built-in
 * generators.
 */
export * from './math2';
export { triangulate, triangulatedArea } from './triangulate';
export { Geom, box, boxC, roundedBox, cylinder, lathe, sphere, extrude, tube, type MeshData } from './mesh';
export type { ArchCollider, ArchOutput, ArchPart } from './types';
export { FINISHES, FINISH_IDS, finish, type FinishDef, type FinishPattern } from './finishes';
export { PartSet, MAX_ELEMENT_COLLIDERS, MAX_ELEMENT_PARTS } from './parts';
export * from './params';
export { buildWall, openingSpans, clipConvexX, SKIRTING_HEIGHT, SKIRTING_DEPTH, type OpeningSpan } from './wall';
export { solveWallJoins, JOIN_TOLERANCE, type JoinWall, type WallJoin } from './wall-joins';
export { wallNetwork, type NetworkRoom, type NetworkWall } from './wall-network';
export { buildSlab, buildCeiling, buildColumn, buildRailing, buildBasin, slabArea } from './elements';
export { buildRoof, roofRise } from './roof';
export { buildStair, stairFootprint, stairLayout, stairRisers, DEFAULT_RISER } from './stair';
export { buildDoor, buildFrame, buildWindow, DOOR_CLEARANCE, LINING } from './openings';
export { STRUCTURE_IDS, STRUCTURE_DESCRIPTIONS, isStructureId, parseStructureParams, buildStructure, ArchParamsError } from './structure';
export { FURNITURE, furnitureById, furnitureByKind, furnitureSize, furnitureReader, buildFurniture, resolveSpec, glowMaterial, type FurnitureDef, type Mount, type ParamReader } from './furniture/index';
export { checkBuildings, navigableVerdict, furnitureFootprint, NAV_CELL, MAX_NAV_CELLS, type BuildingReport } from './checks';
