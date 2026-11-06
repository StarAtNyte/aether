/**
 * Settings → AI connection → Blender: the local switch (off by default) and
 * what Blender adds. On a hosted page, or without the local server, it is
 * shown disabled and never calls the server.
 */
import { memo, useCallback, useEffect, useState, type ReactElement } from 'react';
import { createBlenderApi, type BlenderStatus } from '@aether/agent/blender';
import { aiConnection } from '../ai/connection';
import { useAi } from '../ai/useAi';
import { Toggle } from '../components/fields';
import { BLENDER_LOCAL_ONLY } from './available';
import { blenderGate } from './host';

const FEATURES = 'Blender asset (export from Blender into this project), Cycles render and Cycles bake, in Assets → Imports; the assistant gets Blender tools while Blender is ready. Python runs only after you allow it.';

/** The Blender settings group. */
export const BlenderSettings = memo(function BlenderSettings(): ReactElement {
  const local = useAi((s) => s.server.local);
  const state = useAi((s) => s.local.blender);
  const [status, setStatus] = useState<BlenderStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!local) return;
    let alive = true;
    createBlenderApi()
      .status()
      .then((s) => alive && setStatus(s))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message.slice(0, 200) : 'Blender status failed'));
    return () => {
      alive = false;
    };
  }, [local, state]);

  const toggle = useCallback(async (enabled: boolean) => {
    setBusy(true);
    setError('');
    try {
      setStatus(await createBlenderApi().setEnabled(enabled));
      if (!enabled) blenderGate().reset();
      await aiConnection().refreshLocal();
    } catch (e) {
      setError(e instanceof Error ? e.message.slice(0, 200) : 'could not change the Blender switch');
    } finally {
      setBusy(false);
    }
  }, []);

  if (!local) {
    return (
      <div className="local-setup" data-testid="blender-settings">
        <Toggle label="Blender on this computer" hint={BLENDER_LOCAL_ONLY} checked={false} disabled onChange={() => undefined} />
      </div>
    );
  }
  const badge = status?.state === 'ready' ? 'Ready' : status?.state === 'not_installed' ? 'Not installed' : status ? 'Off' : 'Checking…';
  return (
    <div className="local-setup" data-testid="blender-settings">
      <Toggle
        label={`Blender on this computer · ${badge}`}
        hint={status?.state === 'not_installed' ? `${BLENDER_LOCAL_ONLY}. ${status.detail}` : (status?.detail ?? 'Checking Blender…')}
        checked={status?.enabled ?? false}
        disabled={busy || status === null || (status.state === 'not_installed' && !status.enabled)}
        onChange={(v) => void toggle(v)}
      />
      <p className="setup-note">{FEATURES}</p>
      {error && <p className="setup-error">{error}</p>}
    </div>
  );
});
