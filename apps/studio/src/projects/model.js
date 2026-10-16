/**
 * Project records persisted in the browser. Everything read back from
 * storage is untrusted (another tab, an older build, a hand-edited
 * database): metadata is parsed with zod, worlds with `validateWorld`
 * (via `validateImportedValue`) and transcripts with `reviveChat`.
 */
import { z } from 'zod';
/** Schema version of the stored records (bump with a migration in `idb.ts`). */
export const PROJECTS_SCHEMA_VERSION = 1;
/** Longest project name (characters). */
export const MAX_PROJECT_NAME = 80;
/** Most projects kept (creation is refused beyond this). */
export const MAX_PROJECTS = 200;
/** Largest serialized project (world + chat), in characters. */
export const MAX_PROJECT_CHARS = 6 * 1024 * 1024;
/** Largest stored thumbnail (bytes). */
export const MAX_THUMBNAIL_BYTES = 60 * 1024;
const ID = /^[a-z0-9]{8,32}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+){0,7}$/;
const Timestamp = z.number().finite().nonnegative().max(8.64e15);
/** Project metadata (one small record per project, listed on the home page). */
export const ProjectMeta = z.object({
    v: z.literal(PROJECTS_SCHEMA_VERSION),
    id: z.string().regex(ID),
    name: z.string().min(1).max(MAX_PROJECT_NAME),
    createdAt: Timestamp,
    updatedAt: Timestamp,
    openedAt: Timestamp,
    /** Template slug the project started from (null for blank / imported). */
    template: z.string().regex(SLUG).nullable(),
    entityCount: z.number().int().nonnegative().max(1_000_000),
    /** True once a thumbnail blob has been stored. */
    hasThumbnail: z.boolean(),
});
/** Normalize a user-entered project name ("" when nothing usable is left). */
export function cleanProjectName(name) {
    return (typeof name === 'string' ? name : '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_PROJECT_NAME);
}
/** Parse one stored metadata record; null when invalid. */
export function parseProjectMeta(value) {
    const r = ProjectMeta.safeParse(value);
    return r.success ? r.data : null;
}
/** A fresh random project id (12 base36 chars from the platform CSPRNG). */
export function newProjectId(random = defaultRandom) {
    const bytes = random(new Uint8Array(12));
    let out = '';
    for (let i = 0; i < 12; i++)
        out += ((bytes[i] ?? 0) % 36).toString(36);
    return out;
}
function defaultRandom(bytes) {
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function')
        return crypto.getRandomValues(bytes);
    for (let i = 0; i < bytes.length; i++)
        bytes[i] = Math.floor(Math.random() * 256);
    return bytes;
}
