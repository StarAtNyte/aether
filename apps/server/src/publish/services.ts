/**
 * The local app's publishing services in one place — the build library,
 * deploy jobs and the LAN share — shared by the HTTP routes
 * (`routes/publish.ts`, same-origin studio) and the token-paired bridge
 * (hosted copies of the studio, `BridgePublish`).
 */
import { z } from 'zod';
import type { BridgePublish } from '@aether/bridge';
import { DeployRequest } from './hosts';
import { DeployError, DeployJobs, type DeployDeps } from './jobs';
import { LanShare } from './lan';
import { PublishStore, PublishStoreError } from './store';

/** Largest build upload to the local library (bytes). */
export const MAX_BUILD_UPLOAD_BYTES = 256 * 1024 * 1024;

/** The services. */
export interface PublishServices {
  store: PublishStore;
  jobs: DeployJobs;
  lan: LanShare;
  dispose(): Promise<void>;
}

/** Options of {@link createPublishServices}. */
export interface PublishServiceOptions {
  dir: string;
  env?: NodeJS.ProcessEnv;
  spawn?: DeployDeps['spawn'];
  tmpRoot?: string;
  lanHost?: string;
  lanAddresses?: () => string[];
  now?: () => number;
}

/** Create the services (nothing listens until LAN sharing is turned on). */
export function createPublishServices(o: PublishServiceOptions): PublishServices {
  const store = new PublishStore(o.dir, undefined, o.now);
  const jobs = new DeployJobs({ store, ...(o.env ? { env: o.env } : {}), ...(o.spawn ? { spawn: o.spawn } : {}), ...(o.tmpRoot ? { tmpRoot: o.tmpRoot } : {}), ...(o.now ? { now: o.now } : {}) });
  const lan = new LanShare({ store, ...(o.lanHost ? { host: o.lanHost } : {}), ...(o.lanAddresses ? { addresses: o.lanAddresses } : {}), ...(o.now ? { now: o.now } : {}) });
  return {
    store,
    jobs,
    lan,
    dispose: async () => {
      jobs.dispose();
      await lan.stop();
    },
  };
}

/** An error the bridge maps to its codes (see `BridgePublish`). */
class StatusError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'StatusError';
  }
}

const LanRequest = z.object({ on: z.boolean(), build: z.string().regex(/^[a-z0-9]{12}$/).optional() }).strict();

/** The services as the bridge exposes them to a paired hosted studio. */
export function bridgePublish(s: PublishServices): BridgePublish {
  return {
    maxBuildBytes: MAX_BUILD_UPLOAD_BYTES,
    targets: async (fresh) => ({ targets: await s.jobs.status(fresh) }),
    builds: async () => ({ builds: await s.store.list() }),
    addBuild: async (zip) => {
      try {
        // No local URL: the hosted studio cannot open this computer's library page.
        return { build: await s.store.add(zip), url: null };
      } catch (e) {
        if (e instanceof PublishStoreError) throw new StatusError(e.status, e.message);
        throw e;
      }
    },
    deploy: async (body) => {
      const req = DeployRequest.safeParse(body);
      if (!req.success) throw new StatusError(400, 'The deploy request is not valid (check the name: lowercase letters, digits and dashes).');
      try {
        return { job: await s.jobs.start(req.data) };
      } catch (e) {
        if (e instanceof DeployError) throw new StatusError(e.status === 404 || e.status === 400 ? e.status : 409, e.message);
        throw e;
      }
    },
    job: (id) => s.jobs.view(id),
    cancel: (id) => s.jobs.cancel(id),
    lan: () => s.lan.status(),
    setLan: async (body) => {
      const r = LanRequest.safeParse(body);
      if (!r.success) throw new StatusError(400, 'Expected { on, build }.');
      if (!r.data.on) return s.lan.stop();
      if (!r.data.build) throw new StatusError(400, 'Choose the build to share.');
      try {
        return await s.lan.start(r.data.build);
      } catch (e) {
        throw new StatusError(409, e instanceof Error ? e.message.slice(0, 200) : 'Could not share on the local network.');
      }
    },
  };
}
