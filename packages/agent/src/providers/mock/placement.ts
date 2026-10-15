/**
 * Offline answers to "why is the curtain over the door": the world summary
 * lists every placement problem of a building (wall piece over a door, a
 * window or another piece, with the entity id and a ready fix), so the
 * planner can explain what is wrong and apply the minimal patch: move the
 * piece to the nearest clear stretch of its wall, or remove it when the wall
 * has none.
 */
import type { PatchInput } from '@aether/core';
import type { MockPlan } from './planner';

const DECOR = /\b(curtains?|drapes?|paintings?|pictures?|art(?:work)?|mirrors?|tv|television|whiteboard|sconces?|switch(?:es)?|frames?)\b/;
const OPENING = /\b(doors?|doorway|windows?)\b/;
const WHY = /\b(why|how come|what(?:'s| is) (?:wrong|going on)|explain)\b/;
const FIX = /\b(fix|correct|repair|sort out|wrong|misplaced|mis-?placed|overlap\w*|clip(?:s|ping)?|collid\w*|covering|blocking|in the way|hides?|hiding)\b/;

interface Issue {
  code: string;
  id: string;
  wall: string;
  room: string;
  fix: { remove: true } | { position: [number, number, number] };
  message: string;
}

/** Placement problems listed under a building in the summary (`placement-issue …` lines). */
export function placementIssues(summary: string): Issue[] {
  const out: Issue[] = [];
  for (const raw of summary.split('\n')) {
    const m = /^\s*placement-issue (\w+) (\S+) (\w+ wall) (\S*) t=\S+ fix=(remove|move to (-?[\d.]+),(-?[\d.]+),(-?[\d.]+)) — (.*)$/.exec(raw);
    if (!m) continue;
    out.push({
      code: m[1] as string,
      id: m[2] as string,
      wall: m[3] as string,
      room: m[4] as string,
      fix: m[5] === 'remove' ? { remove: true } : { position: [Number(m[6]), Number(m[7]), Number(m[8])] },
      message: m[9] as string,
    });
  }
  return out;
}

/** True when the request asks why decor sits over an opening, or asks to fix it. */
export function asksAboutPlacement(text: string): boolean {
  if (!DECOR.test(text)) return false;
  if (WHY.test(text) && (OPENING.test(text) || /\b(over|on top of|in front of|covering|blocking|overlap|wrong|there)\b/.test(text))) return true;
  return FIX.test(text) && (OPENING.test(text) || /\b(placement|decor|wall|position)\b/.test(text));
}

/** Answer (and fix) a placement question about the building in `summary`, or null when it is not one. */
export function planPlacement(request: string, summary: string): MockPlan | null {
  const text = request.toLowerCase();
  if (!asksAboutPlacement(text)) return null;
  const issues = placementIssues(summary);
  if (issues.length === 0) {
    if (!/placement-check|building-parts/.test(summary)) return null;
    return {
      plan: '',
      patches: [],
      message: 'I checked every wall of the building: no curtain, picture, mirror, TV or switch overlaps a door, a window or another wall piece, and curtains hang beside their windows. If something still looks wrong, name the wall (north, south, east or west) and the piece and I will move it.',
    };
  }
  const patches: PatchInput[] = [];
  const told: string[] = [];
  for (const i of issues.slice(0, 12)) {
    if ('remove' in i.fix) {
      patches.push({ op: 'remove', id: i.id });
      told.push(`${i.message}; removed it (no clear stretch of that wall)`);
    } else {
      patches.push({ op: 'update', id: i.id, set: { transform: { position: i.fix.position } } });
      told.push(`${i.message}; moved it to the nearest clear stretch of the same wall`);
    }
  }
  const more = issues.length > 12 ? ` (${issues.length - 12} more remain; ask again to continue)` : '';
  return {
    plan: `Plan: fix ${patches.length} wall placement problem(s) by moving wall pieces off doors, windows and each other.`,
    patches,
    message: `Found ${issues.length} wall placement problem(s). ${told.join('. ')}.${more}`,
  };
}
