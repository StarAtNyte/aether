/**
 * One-time migration from the single-world localStorage layout (before
 * projects existed) into the first project. The legacy keys are left in
 * place as a backup; a marker key makes the migration run at most once.
 */
import { STORAGE_KEYS } from '../config';
import { loadChat, loadWorld, readJson, writeJson, type StorageLike } from '../lib/storage';
import type { ProjectMeta } from './model';
import type { ProjectRepo } from './repo';

/** Marker written once the legacy world has been migrated (or found absent). */
export const MIGRATION_KEY = 'aether.studio.projects-migrated.v1';

/**
 * Move the legacy saved world (and chat) into a new project. Returns the
 * created project, or null when there was nothing to migrate, it was
 * migrated before, or the legacy world is invalid.
 */
export async function migrateLegacyWorld(storage: StorageLike | null, repo: ProjectRepo): Promise<ProjectMeta | null> {
  if (!storage || readJson(storage, MIGRATION_KEY) === true) return null;
  const world = loadWorld(storage);
  if (!world) {
    writeJson(storage, MIGRATION_KEY, true);
    return null;
  }
  const created = await repo.create({ world, chat: loadChat(storage) });
  // A failed write (quota, blocked storage) is retried on the next visit.
  if (!created.ok) return null;
  writeJson(storage, MIGRATION_KEY, true);
  return created.value;
}

/** Legacy storage keys kept as a backup after migration (for docs/tests). */
export const LEGACY_KEYS = [STORAGE_KEYS.world, STORAGE_KEYS.chat] as const;
