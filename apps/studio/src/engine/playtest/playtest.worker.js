/**
 * Playtest worker (module worker). Runs the autonomous playtest bot of
 * `@aether/playtest` off the main thread so a long run never blocks
 * rendering or input. Rapier (and QuickJS, only for worlds with scripts) are
 * loaded inside the worker on first use. Only our own trusted code runs
 * here; model-written behaviour scripts stay inside QuickJS.
 */
import { createScriptRunner, initScripting } from '@aether/logic';
import { createPlaytestHandler } from './handler';
const scope = self;
const handler = createPlaytestHandler({
    bot: () => import('@aether/playtest'),
    scripting: async () => ({
        init: initScripting,
        create: (seed) => createScriptRunner({ seed }),
    }),
    post: (reply, transfer) => scope.postMessage(reply, transfer ?? []),
});
scope.onmessage = (e) => {
    void handler.handle(e.data);
};
scope.postMessage({ type: 'ready' });
