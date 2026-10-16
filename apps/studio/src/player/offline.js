/**
 * Offline play for published builds: a downloaded / self-hosted game ships
 * a `manifest.webmanifest` (installable as an app) and an `sw.js` that
 * precaches every file of the build. The service worker is registered only
 * on pages that link a manifest — published builds — never on the studio's
 * own origin, where it would sit in front of the editor.
 */
/** Register `./sw.js` for this build (no-op where unsupported or not a build). */
export function registerOfflineCache() {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator))
        return;
    if (typeof document === 'undefined' || !document.querySelector('link[rel="manifest"]'))
        return;
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1')
        return;
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => undefined);
    });
}
/** The generated `sw.js` of a build (shared with the local app's build library, which verifies it). */
export { serviceWorkerSource } from '@aether/assets/offline-sw';
