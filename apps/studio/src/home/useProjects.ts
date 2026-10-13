/**
 * Project list + thumbnail object URLs for the home page. Thumbnails are
 * loaded only for the ids asked for, cached per (id, updatedAt) and revoked
 * when they go stale or the page unmounts (no leaked blob URLs).
 */
import { useEffect, useRef, useState } from 'react';
import type { ProjectMeta } from '../projects/model';
import type { ProjectRepo } from '../projects/repo';

/** Projects, or null while loading. */
export function useProjectList(repo: ProjectRepo | null): ProjectMeta[] | null {
  const [list, setList] = useState<ProjectMeta[] | null>(null);
  useEffect(() => {
    if (!repo) return;
    let live = true;
    const load = (): void => {
      void repo.list().then((l) => {
        if (live) setList(l);
      });
    };
    load();
    const off = repo.subscribe(load);
    return () => {
      live = false;
      off();
    };
  }, [repo]);
  return list;
}

/** Object URLs of stored thumbnails for `projects` (id → url). */
export function useThumbnails(repo: ProjectRepo | null, projects: readonly ProjectMeta[]): ReadonlyMap<string, string> {
  const cache = useRef(new Map<string, { key: string; url: string }>());
  const [urls, setUrls] = useState<ReadonlyMap<string, string>>(() => new Map());
  const wanted = projects
    .filter((p) => p.hasThumbnail)
    .map((p) => `${p.id}:${p.updatedAt}`)
    .join(',');

  useEffect(() => {
    if (!repo) return;
    let live = true;
    const want = new Map(projects.filter((p) => p.hasThumbnail).map((p) => [p.id, `${p.id}:${p.updatedAt}`]));
    // Drop stale entries.
    for (const [id, entry] of cache.current) {
      if (want.get(id) !== entry.key) {
        URL.revokeObjectURL(entry.url);
        cache.current.delete(id);
      }
    }
    const missing = [...want].filter(([id]) => !cache.current.has(id));
    void Promise.all(
      missing.map(async ([id, key]) => {
        const blob = await repo.thumbnail(id);
        if (!blob || !live) return;
        cache.current.set(id, { key, url: URL.createObjectURL(blob) });
      }),
    ).then(() => {
      if (live) setUrls(new Map([...cache.current].map(([id, e]) => [id, e.url])));
    });
    return () => {
      live = false;
    };
    // `wanted` captures exactly the (id, updatedAt) pairs that matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, wanted]);

  useEffect(() => {
    const c = cache.current;
    return () => {
      for (const e of c.values()) URL.revokeObjectURL(e.url);
      c.clear();
    };
  }, []);

  return urls;
}
