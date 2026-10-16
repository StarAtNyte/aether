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
export { Geom, box, boxC, roundedBox, cylinder, lathe, sphere, extrude, tube } from './mesh';
export { FINISHES, FINISH_IDS, finish } from './finishes';
export { PartSet, MAX_ELEMENT_COLLIDERS, MAX_ELEMENT_PARTS } from './parts';
export * from './params';
export { buildWall, openingSpans, clipConvexX, SKIRTING_HEIGHT, SKIRTING_DEPTH, SECTION_CAP } from './wall';
export { solveWallJoins, JOIN_TOLERANCE } from './wall-joins';
export { wallNetwork } from './wall-network';
export { buildSlab, buildCeiling, buildColumn, buildRailing, buildBasin, slabArea } from './elements';
export { buildRoof, roofRise } from './roof';
export { buildStair, stairFootprint, stairLayout, stairRisers, DEFAULT_RISER } from './stair';
export { buildDoor, buildFrame, buildWindow, DOOR_CLEARANCE, LINING } from './openings';
export { STRUCTURE_IDS, STRUCTURE_DESCRIPTIONS, isStructureId, parseStructureParams, buildStructure, ArchParamsError } from './structure';
export { FURNITURE, furnitureById, furnitureByKind, furnitureSize, furnitureReader, buildFurniture, resolveSpec, glowMaterial } from './furniture/index';
export { buildPart, parsePartParams } from './furniture/part';
export { furnitureMovables, buildFurniturePart } from './furniture/index';
export { FURNITURE_SLOTS, findSlot, slotNames, slotPatch } from './furniture/slots';
export { navigableVerdict } from './checks';
export { analyzeRoomPlacements, wallViews, summarizePlacementIssues, describeWallPlacements, wallMountIndex } from './placement';
export { WALL_MOUNT_KINDS, freeWallSpans, nearestMountCentre, mountRule, collisions as wallCollisions } from './wall-space';
export { BuildingPlan } from './plan';
export { compileBuilding, parsePlan, PlanError, variantsFor, MAX_BUILDING_LIGHTS, FLOOR_THICKNESS } from './compile';
export { applyArchOps, describeBuilding, planOf, ArchOp, MAX_ARCH_OPS } from './ops';
export { checkBuilding, checkBuildings, summarizeBuildingReports, placedPolygon, NAV_CELL } from './nav';
export { RoomType, ArchStyle, Compass, PlanRoom, PlanDoor, PlanWindow, PlanStair, PlanLevel, PlanRoof, PlanItem, PlanSite, MAX_BUILDING_ENTITIES } from './plan';
export { floorPlan2d, listBuildings, listLevels, planToWorld, worldToPlan } from './plan2d';
export { snapPlanPoint, nextRoomId, roomShape, drawRoomOp, drawRoomCandidates, pickWall, doorAtFraction, doorAtOp, windowAtOp, levelPolygons, PLAN_GRID, SNAP_REACH, MIN_DRAWN_ROOM_AREA, MAX_DRAWN_POINTS, WALL_PICK_REACH } from './plan-edit';
export * from './scene/index';
export { DesignRecord, DesignItem, DesignRelation, DesignProgramme, DesignCirculation, RELATION_TYPES, ItemHandle } from './design-record';
// The room-from-photo modules (./photo) are large and loaded on demand: import them from '@aether/arch/photo'.
