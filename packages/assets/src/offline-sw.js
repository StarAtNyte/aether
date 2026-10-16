/**
 * The offline-cache service worker of a published game build (`sw.js`),
 * shared by the studio (which writes it into every build) and the local
 * app's build library (which accepts an uploaded `sw.js` only when it is
 * exactly this generated text). A service worker is code that runs on the
 * origin serving the build, so the library never accepts a hand-made one.
 */
/** Longest build id kept in the cache name. */
const MAX_ID = 40;
/** Most files an offline cache lists. */
const MAX_FILES = 4096;
/** File names the cache may list (relative, no traversal, no spaces or quotes). */
const SAFE_FILE = /^[A-Za-z0-9._~/-]+$/;
function cleanId(buildId) {
    return buildId.replace(/[^a-z0-9-]/gi, '').slice(0, MAX_ID) || 'build';
}
function cleanFiles(files) {
    return files.filter((f) => SAFE_FILE.test(f) && !f.split('/').includes('..')).slice(0, MAX_FILES);
}
/**
 * Source of the service worker for a build with these files (relative
 * URLs). The cache is named after the scope and the build id, and only
 * this scope's older caches are removed (hosts like itch.io serve many
 * games from one origin).
 */
export function serviceWorkerSource(buildId, files) {
    const id = cleanId(buildId);
    const list = JSON.stringify(['./', ...cleanFiles(files).map((f) => `./${f}`)]);
    return `/* Offline cache of a published Aether game (generated). */
const PREFIX = 'aether-game:' + self.registration.scope + ':';
const CACHE = PREFIX + ${JSON.stringify(id)};
const FILES = ${list};
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  e.respondWith(caches.open(CACHE).then((c) => c.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req))));
});
`;
}
/**
 * True when `text` is exactly a service worker {@link serviceWorkerSource}
 * generates (for some build id and file list). Pure; never throws.
 */
export function isGeneratedServiceWorker(text) {
    if (typeof text !== 'string' || text.length > 512 * 1024)
        return false;
    const id = /\nconst CACHE = PREFIX \+ "([a-z0-9-]{1,40})";\n/i.exec(text)?.[1];
    const filesJson = /\nconst FILES = (\[[^\n]*\]);\n/.exec(text)?.[1];
    if (id === undefined || filesJson === undefined)
        return false;
    let files;
    try {
        files = JSON.parse(filesJson);
    }
    catch {
        return false;
    }
    if (!Array.isArray(files) || files[0] !== './' || files.length > MAX_FILES + 1)
        return false;
    const rel = [];
    for (const f of files.slice(1)) {
        if (typeof f !== 'string' || !f.startsWith('./'))
            return false;
        rel.push(f.slice(2));
    }
    return serviceWorkerSource(id, rel) === text;
}
