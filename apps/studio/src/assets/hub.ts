/**
 * The studio's handle on the Aether asset hub: a lazily built client of the pinned Hugging Face dataset (`assets/hub.json`).
 * Nothing here runs, and no request is made, until a search or a hub model is asked for; the client code itself is a
 * separate chunk. In `vite dev` the dataset is read through `/__hub` (scripts/vite/hub-proxy.ts), which adds the token on
 * the server side or serves a local staging folder, so a private dataset works for the developer and the browser never sees
 * a credential. In a build the browser reads the public dataset directly; while it is private the hub is simply
 * unavailable and the bundled library is all there is.
 */
import hubConfig from '../../../../assets/hub.json';
import type { HubClient, HubState } from '@aether/assets/hub-client';

let client: Promise<HubClient> | null = null;

/** The shared client (built on first use). */
export function hubClient(): Promise<HubClient> {
  client ??= (async () => {
    const [{ HubClient: Client, browserHubCache }, { HubConfig }] = await Promise.all([import('@aether/assets/hub-client'), import('@aether/assets/hub')]);
    const dev = import.meta.env.DEV;
    return new Client({ config: HubConfig.parse(hubConfig), ...(dev ? { base: '/__hub' } : {}), privateOk: dev, cache: await browserHubCache() });
  })();
  return client;
}

export type { HubState };

/** `hub:<dataset>@<revision>/<id>`: what a stored hub model records as its origin. */
export const hubOrigin = (dataset: string, revision: string, id: string): string => `hub:${dataset}@${revision}/${id}`.slice(0, 160);
