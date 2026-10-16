/**
 * Physics verification worker (module worker). Runs `@aether/physics`
 * verify / diagnose / settle off the main thread so a long verification
 * never blocks rendering or input. Rapier (and QuickJS, only for worlds with
 * scripts) are loaded inside the worker on first use. Only our own trusted
 * code runs here; model-written behaviour scripts stay inside QuickJS, and
 * generator code never runs here at all (its colliders arrive as data).
 */
import { createScriptRunner, initScripting } from '@aether/logic';
import { createVerifyHandler } from './handler';
const scope = self;
const handler = createVerifyHandler({
    physics: () => import('@aether/physics'),
    scripting: async () => ({
        init: initScripting,
        create: (seed) => createScriptRunner({ seed }),
    }),
    post: (reply) => scope.postMessage(reply),
});
scope.onmessage = (e) => {
    void handler.handle(e.data);
};
scope.postMessage({ type: 'ready' });
