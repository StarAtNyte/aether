/**
 * Playtest worker (module worker). Runs the autonomous playtest bot of
 * `@aether/playtest` off the main thread so a long run never blocks
 * rendering or input. Rapier (and QuickJS, only for worlds with scripts) are
 * loaded inside the worker on first use. Only our own trusted code runs
 * here; model-written behaviour scripts stay inside QuickJS.
 */
import { createScriptRunner, initScripting } from '@aether/logic';
import { createPlaytestHandler } from './handler';
import type { PlaytestReply } from './protocol';

interface WorkerScope {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

const handler = createPlaytestHandler({
  bot: () => import('@aether/playtest'),
  scripting: async () => ({
    init: initScripting,
    create: (seed: number) => createScriptRunner({ seed }),
  }),
  post: (reply: PlaytestReply, transfer?: Transferable[]) => scope.postMessage(reply, transfer ?? []),
});

scope.onmessage = (e: MessageEvent): void => {
  void handler.handle(e.data);
};
scope.postMessage({ type: 'ready' } satisfies PlaytestReply);
