/**
 * The player's "Enter VR" button: shown only where an `immersive-vr` session is supported (`support.ts`). Support found,
 * the session chunk (`session.ts`) loads in the background, so the click itself requests the session inside its user
 * activation. On a page running on WebGPU the click reloads into WebGL2 first (see `support.ts`).
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { Simulation } from '../../engine/Simulation';
import type { ExploreController } from '../explore';
import { vrSupported, xrReloadUrl, xrRequested, xrSystem, XR_SESSION_INIT } from './support';

type SessionModule = typeof import('./session');
type VRSession = InstanceType<SessionModule['VRSession']>;

declare global {
  interface Window {
    /** The running VR session (tests, diagnostics). */
    __aetherVR?: { readonly stats: VRSession['stats']; exit(): Promise<void> } | null;
  }
}

export function VRButton({ sim, explore, show, onToast, onActive }: { sim: Simulation | null; explore: () => ExploreController | null; show: boolean; onToast: (text: string) => void; onActive?: (on: boolean) => void }): ReactElement | null {
  const [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(false);
  const mod = useRef<Promise<SessionModule> | null>(null);

  useEffect(() => {
    let live = true;
    void vrSupported().then((ok) => {
      if (!live || !ok) return;
      setSupported(true);
      mod.current ??= import('./session');
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => () => void window.__aetherVR?.exit(), []);

  if (!supported || !sim || (!show && !active)) return null;

  const enter = (): void => {
    const xr = xrSystem();
    if (!xr || busy || active) return;
    if (sim.backend !== 'webgl2') {
      // three's WebXR runs on the WebGL2 backend: load again on it (a fresh click enters, it needs the user activation).
      if (!xrRequested(location.search)) {
        location.assign(xrReloadUrl(location.href));
        return;
      }
      onToast('VR needs WebGL2, which this browser could not start.');
      return;
    }
    setBusy(true);
    // Requested here, inside the click's user activation; the chunk is normally loaded already.
    const requested = xr.requestSession('immersive-vr', XR_SESSION_INIT) as Promise<XRSession>;
    void (async () => {
      try {
        const [session, m] = await Promise.all([requested, (mod.current ??= import('./session'))]);
        const vr = await m.enterVR(sim, explore(), session, {
          onEnd: (_spot, failure) => {
            window.__aetherVR = null;
            if (failure) onToast(failure);
            setActive(false);
            onActive?.(false);
          },
        });
        window.__aetherVR = vr;
        setActive(true);
        onActive?.(true);
      } catch (e) {
        console.warn('[vr] could not enter VR', e);
        onToast(`Could not enter VR: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <button type="button" className="pl-vrbtn" data-testid="pl-enter-vr" aria-label={active ? 'Exit VR' : 'Enter VR (beta)'} title={active ? 'Exit VR' : 'Enter VR (headset). Beta: still in development'} disabled={busy} onClick={active ? () => void window.__aetherVR?.exit() : enter}>
      VR
      {!active && <span className="pl-vrbtn__beta">Beta</span>}
    </button>
  );
}
