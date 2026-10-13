import { memo, useEffect, useRef, type ReactElement } from 'react';
import { useStudio, useUI } from '../app/context';
import { SHORTCUTS } from '../app/useShortcuts';
import type { StudioSettings } from '../lib/storage';
import { Icon } from './Icon';
import { Toggle } from './fields';

const OPTIONS: ReadonlyArray<[keyof StudioSettings, string, string]> = [
  ['darkTheme', 'Dark theme', 'Dim interface for low-light rooms (the default is light)'],
  ['showPerf', 'Performance overlay', 'FPS, draw calls and triangles over the viewport'],
  ['showColliders', 'Show colliders', 'Wireframe physics colliders in the viewport'],
  ['pointerLock', 'Capture mouse in play mode', 'Click the viewport to lock the pointer for mouse-look'],
  ['shadows', 'Shadows', 'Soft shadows (applies after reload)'],
  ['lowPower', 'Low power mode', 'No bloom, smaller shadow maps and lower resolution, for laptops and battery'],
  ['preferWebGPU', 'Prefer WebGPU', 'Falls back to WebGL2 automatically (applies after reload)'],
];

/** Settings + keyboard shortcut reference (modal dialog). */
export const SettingsDialog = memo(function SettingsDialog(): ReactElement | null {
  const studio = useStudio();
  const open = useUI((s) => s.settingsOpen);
  const settings = useUI((s) => s.settings);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);

  const close = (): void => studio.store.getState().setSettingsOpen(false);

  return (
    <dialog ref={ref} className="dialog" onClose={close} onCancel={close} aria-labelledby="settings-title">
      <div className="dialog__header">
        <h2 id="settings-title">Settings</h2>
        <button type="button" className="icon-btn" onClick={close} aria-label="Close settings">
          <Icon name="x" />
        </button>
      </div>
      <div className="dialog__body">
        <section className="settings-list">
          {OPTIONS.map(([key, label, hint]) => (
            <Toggle key={key} label={label} hint={hint} checked={settings[key]} onChange={(v) => studio.store.getState().updateSettings({ [key]: v })} />
          ))}
        </section>
        <section>
          <h3 className="section-title">Keyboard shortcuts</h3>
          <dl className="shortcut-list">
            {SHORTCUTS.map(([keys, what]) => (
              <div key={keys}>
                <dt>
                  <kbd>{keys}</kbd>
                </dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section className="dialog__danger">
          <button
            type="button"
            className="btn"
            onClick={() => {
              studio.resetToStarter();
              close();
            }}
          >
            <Icon name="refresh" /> Load the starter world
          </button>
          <span className="muted">Undoable — your current world stays in History.</span>
        </section>
      </div>
    </dialog>
  );
});
