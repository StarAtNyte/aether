/**
 * Offline play for published builds: a downloaded / self-hosted game ships
 * a `manifest.webmanifest` (installable as an app) and an `sw.js` that
 * precaches every file of the build. The service worker is registered only
 * on pages that link a manifest — published builds — never on the studio's
 * own origin, where it would sit in front of the editor.
 */

/** Register `./sw.js` for this build (no-op where unsupported or not a build). */
export function registerOfflineCache(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  if (typeof document === 'undefined' || !document.querySelector('link[rel="manifest"]')) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => undefined);
  });
}

/**
 * Source of the service worker for a build with these files (relative
 * URLs). The cache is named after the scope and the build id, and only
 * this scope's older caches are removed (hosts like itch.io serve many
 * games from one origin).
 */
export function serviceWorkerSource(buildId: string, files: readonly string[]): string {
  const id = buildId.replace(/[^a-z0-9-]/gi, '').slice(0, 40) || 'build';
  const list = JSON.stringify(['./', ...files.filter((f) => /^[A-Za-z0-9._~/-]+$/.test(f) && !f.split('/').includes('..')).map((f) => `./${f}`)]);
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
