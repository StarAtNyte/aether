/**
 * Scene model of a building, read from a World IR document.
 *
 * Conventions (all tools and reports use them):
 * - Plan frame of a level: x east, z SOUTH (north is −Z), y up from the floor
 *   top of that level. The building's origin and rotation are not applied.
 * - Wall `t`: metres along one face of a room's wall, measured from the LEFT
 *   end as seen from inside the room facing that wall (north wall: west to
 *   east; east wall: north to south; south wall: east to west; west wall:
 *   south to north). It equals the room edge's own `t` (see `rooms.ts`).
 * - A wall is named by the compass side it faces from the room's inside
 *   ("the north wall" is the wall at the room's north).
 */
import type { EntityId } from '@aether/core';
import type { Compass, RoomType } from '../plan';
import type { P2 } from '../math2';

/** Kinds of things the scene knows how to measure. */
export type ItemMount = 'floor' | 'wall' | 'ceiling' | 'surface';

/** One opening of a wall, seen from one room. */
export interface SceneOpening {
  /** Entity id of the frame / window (stable handle for tools). */
  id: EntityId;
  kind: 'door' | 'window' | 'opening';
  /** Metres along the room wall (see module docs). */
  t0: number;
  t1: number;
  centre: number;
  width: number;
  /** Bottom and top above the floor. */
  sill: number;
  top: number;
  /** The room (plan id) on the other side, `outside`, or null when unknown. */
  leadsTo: string | null;
  /** The swinging / sliding leaf entity of a door. */
  leaf?: EntityId;
  /** The wall entity that carries the opening. */
  wall: EntityId;
  /**
   * Floor area each swinging leaf sweeps into this room while it opens (a convex quarter disc per leaf, plan metres); absent for
   * sliding doors, openings without a leaf and leaves that swing into the room on the other side.
   */
  swing?: P2[][];
}

/** One wall face of a room: its edge, openings and the pieces on it. */
export interface SceneWall {
  /** Room entity id. */
  room: EntityId;
  /** Index of the edge in the room's outline (positive winding). */
  edge: number;
  compass: Compass;
  /** Edge length (centreline to centreline). */
  length: number;
  /** Half the wall's thickness: distance from the centreline to the room-side face. */
  inset: number;
  /** Start (left end seen from inside) and end of the centreline. */
  a: P2;
  b: P2;
  /** Unit direction a → b (the direction of growing `t`). */
  dir: P2;
  /** Outward unit normal (away from the room). */
  out: P2;
  exterior: boolean;
  openings: SceneOpening[];
}

/** A room of a level. */
export interface SceneRoom {
  id: EntityId;
  /** Plan id ("bedroom"). */
  key: string;
  name: string;
  type: RoomType | string;
  level: number;
  levelId: EntityId;
  /** Positive-winding outline (level plan frame). */
  polygon: P2[];
  walls: SceneWall[];
  area: number;
  bbox: [number, number, number, number];
  /** Floor-to-ceiling height. */
  ceiling: number;
  /**
   * Pieces and lights standing in this room that belong to no level (instanced layouts from `shape_land`, lights made by hand): they
   * are not items, but they furnish and light the room, so the checks count them.
   */
  free?: { pieces: number; lights: number; kinds: string[] };
}

/** A piece of furniture, decor, fixture or light. */
export interface SceneItem {
  id: EntityId;
  kind: string;
  name: string;
  mount: ItemMount;
  room: EntityId | null;
  level: number;
  levelId: EntityId;
  /** Position of the entity origin (footprint centre; wall pieces: bottom centre on the wall face). */
  pos: [number, number, number];
  /** Yaw in degrees (0: front faces +Z). */
  yaw: number;
  /** Width (X), height (Y), depth (Z). */
  size: [number, number, number];
  /** Floor footprint (oriented rectangle) for every piece; thin for wall pieces. */
  footprint: P2[];
  /** Lowest and highest point above the floor. */
  y0: number;
  y1: number;
  /** Wall pieces: the wall face they hang on. */
  wall?: { room: EntityId; edge: number; compass: Compass; t: number; width: number };
  /** Floor pieces standing within 12 cm of a wall face (their back or side against it). */
  against?: Array<{ room: EntityId; edge: number; compass: Compass; gap: number; t0: number; t1: number }>;
  /** Library asset id when the piece is a library model. */
  asset?: string;
  /** Placed through the design tools (the document, not the plan, owns it). */
  placed: boolean;
}

/** Something solid and fixed that is not furniture: stairs and stairwell holes. */
export interface SceneObstacle {
  id: EntityId;
  kind: 'stair' | 'hole';
  level: number;
  polygon: P2[];
}

/** One level of a building. */
export interface SceneLevel {
  id: EntityId;
  index: number;
  height: number;
  ceiling: number;
}

/** A building read from the document. */
export interface Scene {
  building: EntityId;
  levels: SceneLevel[];
  rooms: SceneRoom[];
  items: SceneItem[];
  obstacles: SceneObstacle[];
  /** Name of the style, when the plan is stored on the building. */
  style?: string;
}
