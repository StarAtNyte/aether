/**
 * Prompts waiting to run when a freshly created project opens in the
 * editor ("from template" / "from prompt"). In-memory hand-off only: a
 * reload before the editor starts simply opens the (empty) project.
 */

/** A prompt queued for a project. */
export interface PendingRun {
  prompt: string;
  /** Use the built-in offline planner (templates are deterministic). */
  offline: boolean;
  /** The project was created only for this prompt (an answer that builds nothing removes it again). */
  fresh?: boolean;
}

const pending = new Map<string, PendingRun>();
const MAX_PENDING = 16;

/** Queue a prompt for a project. */
export function queueRun(projectId: string, run: PendingRun): void {
  if (pending.size >= MAX_PENDING) {
    const oldest = pending.keys().next().value;
    if (oldest !== undefined) pending.delete(oldest);
  }
  pending.set(projectId, { prompt: run.prompt.slice(0, 4000), offline: run.offline, ...(run.fresh ? { fresh: true } : {}) });
}

/** Take (and forget) the queued prompt of a project. */
export function takeRun(projectId: string): PendingRun | null {
  const r = pending.get(projectId) ?? null;
  pending.delete(projectId);
  return r;
}

/** Projects that open straight into play mode (game templates marked `launch`): the title card is the first screen. */
const launches = new Set<string>();

/** Open this project in play mode once its world is ready. */
export function queueLaunch(projectId: string): void {
  if (launches.size >= MAX_PENDING) launches.clear();
  launches.add(projectId);
}

/** Take (and forget) the launch request of a project. */
export function takeLaunch(projectId: string): boolean {
  return launches.delete(projectId);
}
