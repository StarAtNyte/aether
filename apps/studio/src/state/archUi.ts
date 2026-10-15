/**
 * UI state of the architecture tools (pure, unit-tested): the 3D view modes
 * of buildings, the 2D floor-plan view and its drawing tool, the render
 * quality, the daylight study and the walkthrough photo mode. The engine
 * (`engine/arch.ts`) applies it to the renderer; components only read it.
 */
import type { RoomType } from '@aether/arch';

/** Wall display mode (see @aether/render `ArchViewState`). */
export type ArchWalls = 'up' | 'cutaway' | 'down';
/** Storey display mode. */
export type ArchLevels = 'stacked' | 'exploded' | 'solo';
/** Floor-plan tool. */
export type PlanTool = 'select' | 'rect' | 'polygon' | 'door' | 'window';
/** Render quality. */
export type ArchQuality = 'realtime' | 'studio';

/** One storey of the active building (for the level selector). */
export interface ArchLevelInfo {
  index: number;
  name: string;
  height: number;
}

/** Architecture UI state. */
export interface ArchUiState {
  /** Id of the building the tools act on (null: the world has none). */
  building: string | null;
  /** Storeys of {@link building}, ground floor first. */
  levels: ArchLevelInfo[];
  walls: ArchWalls;
  levelMode: ArchLevels;
  /** Selected storey (solo view, floor plan, drawing). */
  level: number;
  xray: boolean;
  /** Section height above the ground floor (metres), or null. */
  section: number | null;
  /** The 2D floor-plan view is open. */
  plan: boolean;
  planTool: PlanTool;
  /** Room type of rooms drawn on the plan. */
  roomType: RoomType;
  quality: ArchQuality;
  /** Studio quality can run on this device. */
  studioAvailable: boolean;
  /** Daylight study: sun hour shown instead of the document's (null: the document's). */
  sunHour: number | null;
  /** Walkthrough photo mode (interface hidden, studio quality). */
  photo: boolean;
  /** Plan reveal in progress: progress 0..1 (null: not running). */
  reveal: number | null;
}

/** Initial state (no building). */
export const DEFAULT_ARCH_UI: Readonly<ArchUiState> = Object.freeze({
  building: null,
  levels: [],
  walls: 'up',
  levelMode: 'stacked',
  level: 0,
  xray: false,
  section: null,
  plan: false,
  planTool: 'select',
  roomType: 'living',
  quality: 'realtime',
  studioAvailable: true,
  sunHour: null,
  photo: false,
  reveal: null,
}) as Readonly<ArchUiState>;

/** Section heights the slider offers (metres above the ground floor). */
export const SECTION_RANGE: readonly [number, number] = Object.freeze([0.3, 12]) as readonly [number, number];

const WALLS: readonly ArchWalls[] = ['up', 'cutaway', 'down'];
const LEVELS: readonly ArchLevels[] = ['stacked', 'exploded', 'solo'];
const TOOLS: readonly PlanTool[] = ['select', 'rect', 'polygon', 'door', 'window'];
const ROOM_TYPES: readonly RoomType[] = ['living', 'kitchen', 'dining', 'bedroom', 'bathroom', 'office', 'hall', 'entry', 'cafe', 'meeting', 'open-office', 'lobby', 'storage', 'laundry', 'terrace', 'garage', 'studio', 'kids'];

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Merge a patch into the state, keeping every field valid (unknown values fall back to the current ones). */
export function mergeArchUi(cur: ArchUiState, patch: Partial<ArchUiState>): ArchUiState {
  const n = { ...cur, ...patch };
  const levels = Array.isArray(n.levels) ? n.levels.slice(0, 64) : cur.levels;
  const maxLevel = Math.max(0, levels.length - 1);
  return {
    building: typeof n.building === 'string' && n.building.length > 0 ? n.building.slice(0, 64) : null,
    levels,
    walls: WALLS.includes(n.walls) ? n.walls : cur.walls,
    levelMode: LEVELS.includes(n.levelMode) ? n.levelMode : cur.levelMode,
    level: finite(n.level) ? Math.max(0, Math.min(maxLevel, Math.round(n.level))) : 0,
    xray: n.xray === true,
    section: n.section === null ? null : finite(n.section) ? Math.max(SECTION_RANGE[0], Math.min(SECTION_RANGE[1], n.section)) : cur.section,
    plan: n.plan === true,
    planTool: TOOLS.includes(n.planTool) ? n.planTool : cur.planTool,
    roomType: ROOM_TYPES.includes(n.roomType) ? n.roomType : cur.roomType,
    quality: n.quality === 'studio' ? 'studio' : 'realtime',
    studioAvailable: n.studioAvailable !== false,
    sunHour: n.sunHour === null ? null : finite(n.sunHour) ? Math.max(0, Math.min(24, n.sunHour)) : cur.sunHour,
    photo: n.photo === true,
    reveal: n.reveal === null || n.reveal === undefined ? null : finite(n.reveal) ? Math.max(0, Math.min(1, n.reveal)) : null,
  };
}

/** Sky preset and hour for a daylight-study hour (night before dawn and after dusk). */
export function skyForHour(hour: number): { sky: 'day' | 'dawn' | 'sunset' | 'night'; timeOfDay: number } {
  const h = finite(hour) ? ((hour % 24) + 24) % 24 : 12;
  if (h < 5.8 || h >= 20.6) return { sky: 'night', timeOfDay: h };
  if (h < 8) return { sky: 'dawn', timeOfDay: h };
  if (h >= 17.2) return { sky: 'sunset', timeOfDay: h };
  return { sky: 'day', timeOfDay: h };
}

/** Walkthrough time-of-day presets (keys 1–4). */
export const TIME_PRESETS: ReadonlyArray<{ key: string; label: string; hour: number }> = Object.freeze([
  { key: '1', label: 'Morning', hour: 8.4 },
  { key: '2', label: 'Midday', hour: 13 },
  { key: '3', label: 'Golden hour', hour: 18.1 },
  { key: '4', label: 'Night', hour: 22 },
]);

/** Label of a sun hour ("14:30"). */
export function hourLabel(hour: number): string {
  const h = finite(hour) ? Math.max(0, Math.min(24, hour)) : 12;
  const whole = Math.floor(h);
  const min = Math.round((h - whole) * 60);
  const hh = min === 60 ? whole + 1 : whole;
  return `${String(hh % 24).padStart(2, '0')}:${String(min === 60 ? 0 : min).padStart(2, '0')}`;
}

/** Storey a horizontal section at `height` (metres above the ground floor) cuts through: only its rooms are labelled. */
export function sectionLevel(levels: ReadonlyArray<{ index: number; height: number }>, height: number): number | null {
  let base = 0;
  for (const l of levels) {
    if (height < base + l.height) return l.index;
    base += l.height;
  }
  return levels.length > 0 ? (levels[levels.length - 1] as { index: number }).index : null;
}
