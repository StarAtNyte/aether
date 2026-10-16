/**
 * Is the built studio (`apps/studio/dist`) missing or older than its sources?
 * Sources are the studio app and every workspace package it bundles; tests,
 * node_modules and build output are ignored. The walk is capped so a huge
 * tree can never stall `aether start`.
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
/** Folders and files whose changes require a rebuild (relative to the repo root). */
export const BUILD_INPUTS = ['apps/studio/src', 'apps/studio/public', 'apps/studio/index.html', 'apps/studio/vite.config.ts', 'apps/studio/package.json', 'packages', 'scripts/vite', 'package-lock.json'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'test', 'tests', '.git', 'coverage', '.vite']);
const MAX_ENTRIES = 50_000;
/** Newest modification time (ms) under `paths`, or 0 when none exist. */
export function newestMtime(root, paths = BUILD_INPUTS) {
    let newest = 0;
    let seen = 0;
    const visit = (p, depth) => {
        if (seen++ > MAX_ENTRIES || depth > 12)
            return;
        let st;
        try {
            st = statSync(p);
        }
        catch {
            return;
        }
        if (st.isDirectory()) {
            let names;
            try {
                names = readdirSync(p);
            }
            catch {
                return;
            }
            for (const n of names)
                if (!SKIP_DIRS.has(n) && !n.startsWith('.'))
                    visit(join(p, n), depth + 1);
        }
        else if (st.isFile() && st.mtimeMs > newest)
            newest = st.mtimeMs;
    };
    for (const rel of paths)
        visit(join(root, rel), 0);
    return newest;
}
/** Why the studio needs building, or null when the build is current. */
export function buildReason(root, distIndex) {
    let built;
    try {
        built = statSync(distIndex).mtimeMs;
    }
    catch {
        return 'missing';
    }
    return newestMtime(root) > built ? 'stale' : null;
}
