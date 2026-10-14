/**
 * One-line verdict of the `navigable` verification test, on top of the
 * building checks in `nav.ts` (reachability, door swings, furniture).
 */
import type { WorldDoc } from '@aether/core';
import { checkBuildings } from './nav';

/** Most problems listed in a verdict. */
const MAX_LISTED = 6;

/** Verdict for a `navigable` test (`target` selects buildings, '*' = all). */
export function navigableVerdict(world: WorldDoc, target: string, clearance: number): { passed: boolean; message: string } {
  const reports = checkBuildings(world, target, clearance);
  if (reports.length === 0) return { passed: false, message: `no building matches '${target}' (buildings carry arch.role "building")` };
  const failed = reports.filter((r) => !r.passed);
  if (failed.length === 0) {
    const rooms = reports.reduce((s, r) => s + r.rooms, 0);
    return { passed: true, message: `${reports.length} building(s): all ${rooms} rooms reachable on foot, doors open freely, furniture grounded without overlaps` };
  }
  const issues = failed.flatMap((r) => r.issues);
  const shown = issues.slice(0, MAX_LISTED).map((i) => `${i.message} — ${i.hint}`).join('; ');
  return { passed: false, message: `${issues.length} problem(s): ${shown}${issues.length > MAX_LISTED ? ` (+${issues.length - MAX_LISTED} more)` : ''}` };
}
