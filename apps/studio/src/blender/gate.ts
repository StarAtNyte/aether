/**
 * The confirmation gate of Blender actions that run Python. Each one is shown
 * to the user with its exact code; the choices are "Allow once", "Allow for
 * this session" (this tab only: kept in memory and sessionStorage, never
 * persisted beyond the session) and "Cancel". A run carries the server's
 * `confirm` flag only when this gate said yes; the agent cannot set it.
 */
import type { BlenderAction } from '@aether/agent/blender';

/** The user's answer. */
export type GateChoice = 'once' | 'session' | 'cancel';

/** What the dialog shows. */
export interface GateRequest {
  action: BlenderAction;
  code: string;
}

/** sessionStorage key of the actions allowed for this session. */
export const SESSION_KEY = 'aether.blender.allowed';

type SessionLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultSession(): SessionLike | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/** Ask-or-remember for Python actions. */
export class BlenderGate {
  private readonly allowed = new Set<BlenderAction>();
  private readonly session: SessionLike | null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly ask: (request: GateRequest) => Promise<GateChoice>,
    session: SessionLike | null = defaultSession(),
  ) {
    this.session = session;
    try {
      const raw = JSON.parse(session?.getItem(SESSION_KEY) ?? '[]') as unknown;
      if (Array.isArray(raw)) for (const a of raw) if (typeof a === 'string') this.allowed.add(a as BlenderAction);
    } catch {
      /* nothing remembered */
    }
  }

  /** Was `action` allowed for the rest of this session? */
  allowedForSession(action: BlenderAction): boolean {
    return this.allowed.has(action);
  }

  /** Resolve true when the user allows this run (one dialog at a time). */
  confirm(request: GateRequest): Promise<boolean> {
    const next = this.queue.then(async () => {
      if (this.allowed.has(request.action)) return true;
      const choice = await this.ask(request);
      if (choice === 'session') {
        this.allowed.add(request.action);
        try {
          this.session?.setItem(SESSION_KEY, JSON.stringify([...this.allowed]));
        } catch {
          /* memory only */
        }
      }
      return choice === 'once' || choice === 'session';
    });
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Forget every "for this session" allowance. */
  reset(): void {
    this.allowed.clear();
    try {
      this.session?.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
  }
}
