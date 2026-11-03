/**
 * @aether/playtest — the autonomous playtest agent: it derives the goals of
 * a World IR, plays the game headless on the real character controller and
 * logic runtime, and reports whether it can be won (and what is broken).
 */
export { probeLevel, type LevelProbe, type LevelObjectiveReach, type LevelReachAnswer } from './agent';
export { playtest, walkthrough, unsupportedReason, withoutEntities, downsample, PlaytestAbortedError } from './agent';
export { deriveGoals, touches, winThresholds, entityPosition, type GoalModel, type GoalObjective, type DoorInfo, type HazardZone, type TouchVolume } from './goals';
export { driveRace, patrolLoops } from './drive';
export { NavGraph, EdgeKind, jumpHeight, jumpReach, dropReach, type NavParams } from './nav';
export { Session, STEP, KILL_Y } from './session';
export { PLAYER_CAPSULE, PLAYER_ID } from './host';
export { BOT_VERSION, playtestKindOf, hashWorld, toProof, parseProof, proofTrace, proofFreshness, proofIsGreen, ProofWire, EvidenceWire, EVIDENCE_LIMITS, toEvidence, thinTrace, evidenceTrace, evidenceSentence, type Evidence, type Proof, type ProofFreshness } from './proof';
export {
  PLAYTEST_LIMITS,
  TRACE_STRIDE,
  type Finding,
  type FindingCode,
  type Objective,
  type ObjectiveKind,
  type ObjectiveResult,
  type ObjectiveStatus,
  type PlaytestKind,
  type PlaytestOptions,
  type PlaytestProgress,
  type PlaytestReport,
  type PlaytestStatus,
  type PlaytestTrace,
  type TraceEvent,
} from './types';
export { selfRepair, proposeRepairs, countdownOf, type RepairProposal, type RepairRound, type SelfRepairOptions, type SelfRepairResult } from './repair';
export { ReportWire, ProgressWire, parseReport, parseProgress } from './wire';
export * from './level';
export { LiftClock, readLift } from './lifts';
export { reviewGame, gameShape, isGameWorld, playGame, SKILL_PROFILES, type GameReview, type GameReviewOptions, type GameRun, type GameShape, type SkillProfile } from './game';
