/**
 * URL policy for `ModelShape.url`. Model URLs come from LLM output and shared
 * worlds, so letting them name arbitrary hosts would make every viewer's
 * browser contact attacker-chosen servers (IP/timing/referrer leaks,
 * tracking). Allowed:
 * - same-origin relative paths (`/x.glb`, `./x.glb`, `../x.glb`, `models/x.glb`),
 * - `blob:` URLs (user-imported files) and glTF `data:` URIs,
 * - `https:` URLs whose host is in {@link MODEL_URL_HTTPS_HOSTS}.
 * Plain `http:`, protocol-relative `//host`, `javascript:`, `file:` and any
 * other scheme are rejected. The same rule is enforced by world validation
 * and by the renderer's model loader.
 */
/** Longest accepted model URL. */
export const MAX_MODEL_URL_LENGTH = 2048;
/**
 * Explicit allowlist of asset hosts for `https:` model URLs (exact hostnames,
 * lowercase). Empty by default: only same-origin and local data are loaded.
 * A deployment that serves models from a CDN adds its host here and to the
 * server CSP `connect-src`.
 */
export const MODEL_URL_HTTPS_HOSTS = Object.freeze([]);
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000-\u001f\s\\]/;
const SCHEME = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;
const BARE_RELATIVE = /^[\w.-]+(\/[\w.%-]+)*\.(glb|gltf)$/i;
const GLTF_DATA = /^data:(model\/gltf-binary|model\/gltf\+json|application\/octet-stream);base64,/i;
/** True when `url` satisfies the model URL policy (see module docs). */
export function isAllowedModelUrl(url, httpsHosts = MODEL_URL_HTTPS_HOSTS) {
    if (typeof url !== 'string' || url.length === 0 || url.length > MAX_MODEL_URL_LENGTH)
        return false;
    if (UNSAFE_CHARS.test(url) || url.startsWith('//'))
        return false;
    if (url.startsWith('/') || url.startsWith('./') || url.startsWith('../'))
        return true;
    const scheme = SCHEME.exec(url)?.[1]?.toLowerCase();
    if (scheme === undefined)
        return BARE_RELATIVE.test(url);
    if (scheme === 'blob')
        return true;
    if (scheme === 'data')
        return GLTF_DATA.test(url);
    if (scheme !== 'https')
        return false;
    let host;
    try {
        const parsed = new URL(url);
        if (parsed.username !== '' || parsed.password !== '')
            return false;
        host = parsed.hostname.toLowerCase();
    }
    catch {
        return false;
    }
    return httpsHosts.includes(host);
}
