/**
 * How the player presents a world, by kind, and its keys. Pure (unit-tested); the player and the explore controller
 * (`explore.ts`) act on it.
 *
 * | Kind | Opens in | Explore camera |
 * |---|---|---|
 * | game | the title card, then play as the character | orbit (a city's: drone) |
 * | arch (houses, interiors, photo rooms) | a curated hero view, then a guided tour of the rooms | walk at eye level: click the floor to glide there, WASD optional, no jump or sprint, no avatar; dollhouse and plan |
 * | showcase (landscapes, gardens) | a slow cinematic fly-in, then orbit | orbit, viewpoints, photo mode |
 * | city | a street-level hero view, then a drone tour | drone (orbit), viewpoints |
 *
 * Everywhere: P plays as the human character (game controls), Tab or O explores, Esc pauses.
 */

export type ExperienceKind = 'game' | 'arch' | 'showcase' | 'city';
/** The camera of explore mode. */
export type ExploreStyle = 'walk' | 'orbit' | 'drone';
/** What the player shows first. */
export type ExperienceEntry = 'title' | 'hero-tour' | 'fly-in' | 'street-drone';

/** A world's presentation. */
export interface Experience {
  kind: ExperienceKind;
  entry: ExperienceEntry;
  explore: ExploreStyle;
  /** Dollhouse and floor-plan views (a building). */
  dollhouse: boolean;
  /** Photo mode in the bar. */
  photo: boolean;
  /** Label of the stops bar. */
  stopsLabel: string;
}

export type StartModeLike = 'play' | 'walkthrough' | 'orbit' | null | undefined;
export type ProfileLike = 'game' | 'walkthrough' | 'showcase' | 'city' | 'vr' | null | undefined;

/**
 * The presentation of a world from its start mode and profile. A world that starts in play is a game (its explore camera
 * follows its profile: a city's is the drone); a walkthrough is architecture; a city profile is a city; the rest is a
 * showcase. No start mode at all (an old game build) is a game.
 */
export function experienceFor(startMode: StartModeLike, profile: ProfileLike, hasBuilding = false): Experience {
  if (startMode === 'play' || (!startMode && (!profile || profile === 'game' || profile === 'vr'))) {
    const explore: ExploreStyle = profile === 'city' ? 'drone' : profile === 'walkthrough' ? 'walk' : 'orbit';
    return { kind: 'game', entry: 'title', explore, dollhouse: explore === 'walk' && hasBuilding, photo: true, stopsLabel: profile === 'city' ? 'Districts' : 'Viewpoints' };
  }
  if (startMode === 'walkthrough' || profile === 'walkthrough') return { kind: 'arch', entry: 'hero-tour', explore: 'walk', dollhouse: hasBuilding, photo: true, stopsLabel: 'Tour' };
  if (profile === 'city') return { kind: 'city', entry: 'street-drone', explore: 'drone', dollhouse: false, photo: true, stopsLabel: 'Districts' };
  return { kind: 'showcase', entry: 'fly-in', explore: 'orbit', dollhouse: false, photo: true, stopsLabel: 'Viewpoints' };
}

/** The player's phases (PlayerApp). */
export type PlayerPhase = 'booting' | 'title' | 'starting' | 'exploring' | 'playing' | 'paused' | 'over' | 'failed';

/** What a key does. */
export type KeyAction = 'play' | 'explore' | 'pause' | 'resume' | 'next' | 'prev' | 'autoplay' | 'dollhouse' | 'photo' | 'time' | null;

/** The key event fields {@link keyAction} reads. */
export interface KeyLike {
  code: string;
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  repeat?: boolean;
}

/**
 * The action of a key press in `phase`. `typing`: the focus is in a text field (keys belong to it). `voxel`: a block world
 * (Esc is its own inventory key while playing).
 */
export function keyAction(e: KeyLike, phase: PlayerPhase, exp: Experience, typing = false, voxel = false): KeyAction {
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return null;
  if (e.code === 'Escape' || e.key === 'Escape') {
    if (phase === 'playing') return voxel ? null : 'pause';
    if (phase === 'paused') return 'resume';
    if (phase === 'exploring') return 'pause';
    return null;
  }
  if (e.repeat) return null;
  if (e.code === 'KeyP') return phase === 'title' || phase === 'exploring' ? 'play' : null;
  if (e.code === 'Tab' || e.code === 'KeyO') return phase === 'title' || phase === 'playing' ? 'explore' : null;
  if (phase !== 'exploring') return null;
  if (e.code === 'BracketRight' || e.code === 'PageDown') return 'next';
  if (e.code === 'BracketLeft' || e.code === 'PageUp') return 'prev';
  if (e.code === 'Space') return 'autoplay';
  if (e.code === 'KeyM') return exp.dollhouse ? 'dollhouse' : null;
  if (e.code === 'KeyF') return exp.photo ? 'photo' : null;
  if (/^Digit[1-4]$/.test(e.code)) return 'time';
  return null;
}

/** The small key hint of a phase (touch screens get the touch wording). */
export function keyHint(phase: PlayerPhase, exp: Experience, touch = false): string {
  if (phase === 'exploring') {
    if (touch) return exp.explore === 'walk' ? 'Tap the floor to move · drag to look' : 'Drag to look around · pinch to zoom';
    const move = exp.explore === 'walk' ? 'Click the floor to move · WASD walk · drag to look' : 'Drag to orbit · scroll to zoom';
    return `${move} · P play · Esc menu`;
  }
  if (phase === 'playing') return touch ? '' : 'Tab explore · Esc pause';
  if (phase === 'title') return touch ? '' : 'P play · Tab explore';
  return '';
}
