/**
 * Assets → Imports → Blender: "Blender asset" (export from the user's Blender
 * and import as a user asset, like a dropped .glb), "Cycles render" and
 * "Cycles bake". Each one shows its Python for confirmation first. Disabled
 * with the local-only label on a hosted page or while Blender is not ready.
 */
import { memo, useCallback, useState, type ReactElement } from 'react';
import type { BlenderPlanRequest } from '@aether/agent/blender';
import { useStudio, useUI } from '../app/context';
import { useAi } from '../ai/useAi';
import { Dialog } from '../components/ui/Dialog';
import { BLENDER_LOCAL_ONLY, blenderReady } from './available';

/** The Blender tools section. */
export const BlenderTools = memo(function BlenderTools({ disabled }: { disabled: boolean }): ReactElement {
  const studio = useStudio();
  const toast = useUI((s) => s.toast);
  const ready = useAi(blenderReady);
  const [busy, setBusy] = useState<string | null>(null);
  const [object, setObject] = useState('');
  const [picture, setPicture] = useState<{ title: string; src: string; text: string } | null>(null);

  const run = useCallback(
    async (label: string, request: BlenderPlanRequest) => {
      setBusy(label);
      try {
        const { runStudioBlenderAction } = await import('./host');
        const out = await runStudioBlenderAction(studio.assets, request);
        if (!out.ok) {
          if (!out.declined) toast(out.text.slice(0, 200), 'error', 6);
          return;
        }
        if (out.asset) {
          await studio.assets.place(out.asset.id);
          toast(`Imported from Blender: ${out.asset.summary}`, 'success', 4);
        }
        if (out.image) setPicture({ title: label, src: out.image, text: out.text });
      } catch (e) {
        toast(e instanceof Error ? e.message.slice(0, 200) : 'Blender failed', 'error', 6);
      } finally {
        setBusy(null);
      }
    },
    [studio, toast],
  );

  const off = disabled || !ready || busy !== null;
  const tip = ready ? undefined : BLENDER_LOCAL_ONLY;
  return (
    <section className="assets__section" aria-labelledby="assets-blender" data-testid="blender-tools">
      <header className="assets__head">
        <h3 id="assets-blender" className="assets__title">
          Blender
        </h3>
        <span className="assets__hint">{busy ? `${busy}…` : ready ? 'On this computer' : 'Local only'}</span>
      </header>
      {!ready && <p className="panel-note">{BLENDER_LOCAL_ONLY}</p>}
      <div className="blender-tools" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        <button type="button" className="btn btn--sm" disabled={off} title={tip} onClick={() => void run('Blender asset', { action: 'export_glb', input: { name: 'Blender asset' } })}>
          Blender asset
        </button>
        <button type="button" className="btn btn--sm" disabled={off} title={tip} onClick={() => void run('Cycles render', { action: 'render', input: {} })}>
          Cycles render
        </button>
        <input className="input input--sm" style={{ flex: '1 1 8em', minWidth: 0 }} placeholder="Object to bake" aria-label="Blender object to bake" value={object} disabled={off} maxLength={120} onChange={(e) => setObject(e.target.value)} />
        <button type="button" className="btn btn--sm" disabled={off || object.trim() === ''} title={tip} onClick={() => void run('Cycles bake', { action: 'bake', input: { object: object.trim() } })}>
          Cycles bake
        </button>
      </div>
      {picture && (
        <Dialog open onClose={() => setPicture(null)} title={picture.title} description={picture.text} size="lg">
          <img src={picture.src} alt={picture.title} style={{ maxWidth: '100%', height: 'auto', display: 'block' }} />
          <a className="btn btn--sm" href={picture.src} download={`${picture.title.toLowerCase().replace(/\s+/g, '-')}.png`}>
            Save PNG
          </a>
        </Dialog>
      )}
    </section>
  );
});
