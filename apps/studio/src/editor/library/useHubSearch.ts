/**
 * Realtime search over the Aether asset hub for the palette: as the query changes (debounced) the hub's compact index is
 * searched in memory. The index is fetched on the first query only, so opening the palette costs nothing; when the hub is
 * unavailable (offline, dataset not public yet, blocked) the state says so and the palette shows the bundled library alone.
 */
import { useEffect, useState } from 'react';
import type { HubHit } from '@aether/assets/hub';

export interface HubSearchView {
  status: 'idle' | 'loading' | 'ready' | 'unavailable';
  hits: Array<HubHit & { thumbUrl: string }>;
  reason?: string;
}

const IDLE: HubSearchView = { status: 'idle', hits: [] };
export const HUB_MIN_QUERY = 2;
export const HUB_DEBOUNCE_MS = 220;

/** `exclude`: ids the bundled library already shows (the hub repeats them). */
export function useHubSearch(query: string, exclude: ReadonlySet<string>, limit = 24): HubSearchView {
  const [view, setView] = useState<HubSearchView>(IDLE);
  useEffect(() => {
    const q = query.trim();
    if (q.length < HUB_MIN_QUERY) {
      setView(IDLE);
      return;
    }
    let live = true;
    setView((v) => ({ ...v, status: v.status === 'unavailable' ? 'unavailable' : 'loading' }));
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const { hubClient } = await import('../../assets/hub');
          const r = await (await hubClient()).search(q, { limit: limit + exclude.size });
          if (!live) return;
          if (!r.ok) setView({ status: 'unavailable', hits: [], reason: r.reason });
          else setView({ status: 'ready', hits: r.hits.filter((h) => !exclude.has(h.item.id)).slice(0, limit) });
        } catch {
          if (live) setView({ status: 'unavailable', hits: [], reason: 'The asset hub could not be reached.' });
        }
      })();
    }, HUB_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, exclude, limit]);
  return view;
}
