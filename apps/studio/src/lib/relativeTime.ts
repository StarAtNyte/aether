/** Human relative timestamps for project cards ("Updated 2h ago"). Pure. */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/**
 * Compact relative time: "Just now", "5m ago", "2h ago", "Yesterday",
 * "3d ago", then a calendar date ("Mar 4", or "Mar 4, 2025" in another
 * year). Future or invalid timestamps read as "Just now".
 *
 * @param ts epoch milliseconds of the event
 * @param now epoch milliseconds of "now" (injectable for tests)
 */
export function formatRelative(ts: number, now: number = Date.now()): string {
  if (!Number.isFinite(ts) || !Number.isFinite(now)) return 'Just now';
  const d = now - ts;
  if (d < MINUTE) return 'Just now';
  if (d < HOUR) return `${Math.floor(d / MINUTE)}m ago`;
  if (d < DAY) return `${Math.floor(d / HOUR)}h ago`;
  if (d < 2 * DAY) return 'Yesterday';
  if (d < 7 * DAY) return `${Math.floor(d / DAY)}d ago`;
  const date = new Date(ts);
  const label = `${MONTHS[date.getMonth()] ?? ''} ${date.getDate()}`;
  return date.getFullYear() === new Date(now).getFullYear() ? label : `${label}, ${date.getFullYear()}`;
}

/** Full timestamp for tooltips ("4 Mar 2026, 14:05"). */
export function formatTimestamp(ts: number): string {
  if (!Number.isFinite(ts)) return '';
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getDate()} ${MONTHS[d.getMonth()] ?? ''} ${d.getFullYear()}, ${hh}:${mm}`;
}
