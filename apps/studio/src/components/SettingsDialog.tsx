import { memo, useEffect, useRef, type ReactElement } from 'react';
import { useStudio, useUI } from '../app/context';
import { SHORTCUTS } from '../app/useShortcuts';
import type { BackendSetting, LowMemorySetting, StudioSettings } from '../lib/storage';
import { Icon } from './Icon';
import { Toggle } from './fields';

type BooleanSetting = { [K in keyof StudioSettings]: StudioSettings[K] extends boolean ? K : never }[keyof StudioSettings];

const OPTIONS: ReadonlyArray<[BooleanSetting, string, string]> = [
  ['darkTheme', 'Dark theme', 'Dim interface for low-light rooms (the default is light)'],
  ['showPerf', 'Performance overlay', 'FPS, draw calls and triangles over the viewport'],
  ['showColliders', 'Show colliders', 'Wireframe physics colliders in the viewport'],
  ['pointerLock', 'Capture mouse in play mode', 'Click the viewport to lock the pointer for mouse-look'],
  ['shadows', 'Shadows', 'Soft shadows (applies after reload)'],
];

const LOW_MEMORY_CHOICES: ReadonlyArray<[LowMemorySetting, string]> = [
  ['auto', 'Auto'],
  ['on', 'On'],
  ['off', 'Off'],
];

const BACKEND_CHOICES: ReadonlyArray<[BackendSetting, string]> = [
  ['auto', 'Auto'],
  ['webgpu', 'WebGPU'],
  ['webgl2', 'WebGL2'],
];

/** A labeled row of mutually exclusive choices (same layout as a toggle row). */
function ChoiceRow<T extends string>({ label, hint, value, choices, onChange }: { label: string; hint: string; value: T; choices: ReadonlyArray<[T, string]>; onChange: (v: T) => void }): ReactElement {
  return (
    <div className="toggle choice-row">
      <span className="toggle__text">
        <span className="toggle__label">{label}</span>
        <span className="toggle__hint">{hint}</span>
      </span>
      <span className="segmented" role="radiogroup" aria-label={label}>
        {choices.map(([v, text]) => (
          <button key={v} type="button" role="radio" aria-checked={value === v} className={`seg-btn${value === v ? ' is-active' : ''}`} onClick={() => onChange(v)}>
            {text}
          </button>
        ))}
      </span>
    </div>
  );
}

/** Settings + keyboard shortcut reference (modal dialog). */
export const SettingsDialog = memo(function SettingsDialog(): ReactElement | null {
  const studio = useStudio();
  const open = useUI((s) => s.settingsOpen);
  const settings = useUI((s) => s.settings);
  const memory = useUI((s) => s.memory);
  const gpu = useUI((s) => s.gpu);
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
          <ChoiceRow
            label="Low memory mode"
            hint={`${memory.lowMemory ? `On${memory.reason ? ` — ${memory.reason}` : ''}` : 'Off'}. Lower resolution, no bloom, smaller shadows, caches and undo history. Auto turns it on for small devices or under memory pressure.`}
            value={settings.lowMemory}
            choices={LOW_MEMORY_CHOICES}
            onChange={(v) => studio.store.getState().updateSettings({ lowMemory: v })}
          />
          <ChoiceRow
            label="Renderer"
            hint={`Auto uses WebGPU where it is reliable (WebGL2 on Firefox unless the GPU is known good).${gpu?.description ? ` GPU: ${gpu.description}` : ''}`}
            value={settings.backend}
            choices={BACKEND_CHOICES}
            onChange={(v) => studio.store.getState().updateSettings({ backend: v })}
          />
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
