/**
 * Scene tools of @aether/arch: the measuring tools and the parts library the
 * AI designs with (see `docs/CONTRACTS.md`, "Design tools").
 */
export type { Scene, SceneItem, SceneLevel, SceneObstacle, SceneOpening, SceneRoom, SceneWall, ItemMount } from './types';
export { readScene, buildingIds, itemGeometry, parseCompass } from './read';
export {
  findRoom,
  findItem,
  findWall,
  findOpening,
  isLookupError,
  wallBlockers,
  queryWall,
  wallQueryText,
  tDirection,
  measurable,
  measure,
  listEntities,
  itemLine,
  facingOf,
  type LookupError,
  type WallQuery,
  type Measurement,
  type Measurable,
  type ListFilter,
} from './facts';
export {
  reviewScene,
  reviewBuildings,
  overlapFindings,
  boundaryFindings,
  windowFindings,
  doorwayFindings,
  clearanceFindings,
  reachabilityFindings,
  sanityFindings,
  programmeFindings,
  walkability,
  freeFrontDepth,
  scoreFindings,
  findingKey,
  findingsText,
  type Finding,
  type FindingSeverity,
  type ReviewOptions,
  type Walkability,
} from './checks';
export { listParts, partInfo, partKinds, describeParts, describePartLine, resolvePartParams, defaultWallBottom, wallBottomRange, itemEntity, fittingLight, KIND_SIZE_LIMITS, type PartInfo, type PartParam, type ItemSpec } from './parts';
export {
  placeItem,
  moveItem,
  rotateItem,
  resizeItem,
  removeItem,
  snapToWall,
  anchorToOpening,
  centerOver,
  resolveBuilding,
  describePlaced,
  itemEntityId,
  openingsOf,
  type EditResult,
  type PlaceSpec,
  type Target,
} from './edit';
export {
  DesignPlan,
  DesignRoom,
  DesignOpening,
  DesignLevel,
  validateDesign,
  designToBuildingPlan,
  describeShell,
  checkConformance,
  kindHint,
  type DesignValidation,
} from './design';
export {
  DESIGN_TOOL_NAMES,
  DESIGN_LIMITS,
  DesignToolInputs,
  PlaceItemInput,
  EditItemInput,
  QueryInput,
  isDesignTool,
  runDesignTool,
  reviewFindings,
  hasBuilding,
  buildingIdsOf,
  type DesignToolName,
  type DesignToolResult,
} from './dispatch';
export { roomAdvice, type PlanOverlay, type RoomAdvice } from './advice';
export { projectOverlays, type ImageOverlay } from './views';
export { reviewPoses, markIndex, projectMarks, legendText, customPose, entityGeometry, planDelta, projectGeometry, type EntityGeometry, type ImageBox, type ReviewPose, type MarkEntry, type ImageMark, type PoseOptions, type CustomPoseSpec } from './views';
