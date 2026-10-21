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
export { buildWall, openingSpans, clipConvexX, SKIRTING_HEIGHT, SKIRTING_DEPTH, SECTION_CAP, type OpeningSpan } from './wall';
export { solveWallJoins, JOIN_TOLERANCE, type JoinWall, type WallJoin } from './wall-joins';
export { wallNetwork, type NetworkRoom, type NetworkWall } from './wall-network';
export { buildSlab, buildCeiling, buildColumn, buildRailing, buildBasin, slabArea } from './elements';
export { buildRoof, roofRise } from './roof';
export { buildStair, stairFootprint, stairLayout, stairRisers, stairWalkLine, STAIR_WALK_LINE_RUN_OUT, DEFAULT_RISER } from './stair';
export { buildDoor, buildFrame, buildWindow, DOOR_CLEARANCE, LINING } from './openings';
export { STRUCTURE_IDS, STRUCTURE_DESCRIPTIONS, isStructureId, parseStructureParams, buildStructure, ArchParamsError } from './structure';
export { FURNITURE, furnitureById, furnitureByKind, furnitureSize, furnitureReader, buildFurniture, resolveSpec, glowMaterial, type FurnitureDef, type Mount, type ParamReader } from './furniture/index';
export { buildPart, parsePartParams, type PartParams } from './furniture/part';
export { furnitureMovables, buildFurniturePart, type MovableSpec, type MovableMotion } from './furniture/index';
export { FURNITURE_SLOTS, findSlot, slotNames, slotPatch, type SlotDef } from './furniture/slots';
export { navigableVerdict } from './checks';
export { analyzeRoomPlacements, wallViews, summarizePlacementIssues, describeWallPlacements, wallMountIndex, type PlacementIssue, type PlacementFix, type WallView, type WallMount, type WallOpeningInfo } from './placement';
export { WALL_MOUNT_KINDS, freeWallSpans, nearestMountCentre, mountRule, collisions as wallCollisions, type WallBlocker, type MountSpec } from './wall-space';
export { BuildingPlan, type BuildingPlanInput } from './plan';
export { compileBuilding, parsePlan, PlanError, variantsFor, MAX_BUILDING_LIGHTS, FLOOR_THICKNESS, type CompiledBuilding, type ExteriorWall, type ExteriorOpening } from './compile';
export { checkStair, fitStair, levelDoors, settleStairs, stairJson, stairLandingDepth, stairShape, stairSizes, STAIR_LANDING, STAIR_MIN_LANDING, type StairCheck, type StairFit, type StairSettlement, type StairShape } from './stair-fit';
export { fitWindow, planWindowAddition, clearStretches as windowClearStretches, type WindowSpot, type WindowAddition } from './window-fit';
export { applyArchOps, describeBuilding, planOf, ArchOp, MAX_ARCH_OPS, type ArchOpError, type ArchOpsResult } from './ops';
export { checkBuilding, checkBuildings, summarizeBuildingReports, placedPolygon, NAV_CELL, type ArchIssue, type BuildingReport } from './nav';
export { RoomType, ArchStyle, Compass, PlanRoom, PlanDoor, PlanWindow, PlanStair, PlanLevel, PlanRoof, PlanItem, PlanSite, MAX_BUILDING_ENTITIES } from './plan';
export { floorPlan2d, listBuildings, listLevels, planToWorld, worldToPlan, type FloorPlan2d, type Plan2dRoom, type Plan2dWall, type Plan2dDoor, type Plan2dWindow, type Plan2dItem, type Plan2dStair, type Plan2dDimension, type Plan2dLevel } from './plan2d';
export { snapPlanPoint, nextRoomId, roomShape, drawRoomOp, drawRoomCandidates, pickWall, doorAtFraction, doorAtOp, windowAtOp, levelPolygons, PLAN_GRID, SNAP_REACH, MIN_DRAWN_ROOM_AREA, MAX_DRAWN_POINTS, WALL_PICK_REACH, type WallPick } from './plan-edit';
export * from './scene/index';
export { DesignRecord, DesignItem, DesignRelation, DesignProgramme, DesignCirculation, RELATION_TYPES, ItemHandle } from './design-record';
// The room-from-photo modules (./photo) are large and loaded on demand: import them from '@aether/arch/photo'.
