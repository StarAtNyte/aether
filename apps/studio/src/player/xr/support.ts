/**
 * Whether the player offers immersive VR, and on which backend it boots for it. Small on purpose: the player imports it
 * up front; everything else of VR (`session.ts`, three's XR objects) is a lazy chunk loaded once support is detected.
 *
 * Backend: three's WebXR runs on the WebGL2 backend of the renderer (an XRWebGLBinding projection layer). Its WebGPU XR
 * path needs the experimental XRGPUBinding and the 'webgpu' session feature, which headset browsers do not ship, so the
 * player boots on WebGL2 on a headset browser (or with `?xr=1`), and a page already running on WebGPU reloads with
 * `?xr=1` when Enter VR is pressed (the visitor presses it once more: entering needs a fresh click).
 */

/** The part of `navigator.xr` the player uses. */
export interface XRSystemLike {
  isSessionSupported(mode: string): Promise<boolean>;
  requestSession(mode: string, init?: { requiredFeatures?: string[]; optionalFeatures?: string[] }): Promise<unknown>;
}

/** Session features: the visitor's real floor (their own height applies); a bounded floor and projection layers when offered. */
export const XR_SESSION_INIT = { requiredFeatures: ['local-floor'], optionalFeatures: ['bounded-floor', 'layers'] };

/** `navigator.xr` when the browser has WebXR (and a secure context), else null. */
export function xrSystem(nav: unknown = typeof navigator !== 'undefined' ? navigator : undefined): XRSystemLike | null {
  const xr = (nav as { xr?: Partial<XRSystemLike> } | undefined)?.xr;
  return xr && typeof xr.isSessionSupported === 'function' && typeof xr.requestSession === 'function' ? (xr as XRSystemLike) : null;
}

/** Whether an `immersive-vr` session can start here (false on any error, and after `timeoutMs` without an answer). */
export async function vrSupported(nav?: unknown, timeoutMs = 4000): Promise<boolean> {
  const xr = xrSystem(nav);
  if (!xr) return false;
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); });
    const ok = await Promise.race([xr.isSessionSupported('immersive-vr').then((v) => v === true), late]);
    clearTimeout(timer);
    return ok;
  } catch {
    return false;
  }
}

/** A standalone headset's browser (Meta Quest, Pico, Wolvic). */
export function isHeadsetBrowser(ua: string): boolean {
  return /OculusBrowser|\bQuest\b|PicoBrowser|Pico Neo|Wolvic/i.test(ua);
}

/** The page asked for VR (`?xr=1`, the reload from a WebGPU page). */
export function xrRequested(search: string): boolean {
  const q = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return q.get('xr') === '1';
}

/** The backend the player boots on: WebGL2 where VR is wanted (see the module docs), else the automatic choice. */
export function xrBootBackend(search: string, ua: string): 'webgl2' | 'auto' {
  return xrRequested(search) || isHeadsetBrowser(ua) ? 'webgl2' : 'auto';
}

/** The page's address with `xr=1` in its query (the fragment, which names the world, kept). */
export function xrReloadUrl(href: string): string {
  const url = new URL(href);
  url.searchParams.set('xr', '1');
  return url.toString();
}
