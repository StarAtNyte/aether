/**
 * Settings: appearance, viewport, play, performance, AI connection and the
 * keyboard reference. Shared by the home page (app settings) and the editor
 * (studio settings, plus renderer details); the caller supplies the values
 * and the update function.
 */
import { lazy, memo, Suspense, useEffect, useState, type ReactElement } from 'react';
import type { AiPrefs } from '../ai/prefs';
// Lazy: the AI pane pulls in the agent package; the home page must not pay for it up front.
const AiConnectionPane = lazy(async () => ({ default: (await import('./ai/AiConnectionPane')).AiConnectionPane }));
import { SHORTCUTS } from '../app/useShortcuts';
import type { BackendSetting, LowMemorySetting, StudioSettings } from '../lib/storage';
import { Toggle } from './fields';
import { Dialog } from './ui/Dialog';
import { Segmented } from './ui/Segmented';

type BooleanSetting = { [K in keyof StudioSettings]: StudioSettings[K] extends boolean ? K : never }[keyof StudioSettings];

const VIEWPORT_OPTIONS: ReadonlyArray<[BooleanSetting, string, string]> = [
  ['showPerf', 'Performance overlay', 'Frame rate, draw calls and memory over the viewport.'],
  ['showLabels', 'Object labels', 'Name labels over the main objects in the viewport.'],
  ['showColliders', 'Show colliders', 'Wireframe physics colliders.'],
  ['shadows', 'Shadows', 'Soft shadows (applies after reload).'],
  ['showNavHint', 'Navigation hint', 'Mouse and touch controls shown over an idle viewport.'],
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

/** Settings sections. */
export type SettingsTab = 'general' | 'ai' | 'shortcuts';
type Tab = SettingsTab;

/** Extra (editor-only) information shown in Settings. */
export interface SettingsContext {
  memory?: { lowMemory: boolean; reason: string | null };
  gpu?: { description: string } | null;
}

/** Settings dialog. */
export const SettingsDialog = memo(function SettingsDialog({
  open,
  onClose,
  settings,
  update,
  context = {},
  initialTab = 'general',
  ai,
}: {
  open: boolean;
  onClose: () => void;
  settings: StudioSettings;
  update: (patch: Partial<StudioSettings>) => void;
  context?: SettingsContext;
  initialTab?: Tab;
  /** AI preferences (the editor's project, or the global default on the home page). */
  ai: { prefs: AiPrefs; update: (patch: Partial<AiPrefs>) => void };
}): ReactElement {
  const [tab, setTab] = useState<Tab>(initialTab);
  useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab]);
  const { memory, gpu } = context;
  return (
    <Dialog open={open} onClose={onClose} title="Settings" size="md" className="settings">
      <Segmented<Tab>
        label="Settings section"
        value={tab}
        onChange={setTab}
        options={[
          ['general', 'General'],
          ['ai', 'AI connection'],
          ['shortcuts', 'Shortcuts'],
        ]}
        stretch
      />
      {tab === 'general' && (
        <div className="settings__pane">
          <section className="settings__group">
            <h3 className="settings__heading">Appearance</h3>
            <div className="setting-row">
              <span className="setting-row__text">
                <span className="setting-row__label">Theme</span>
                <span className="setting-row__hint">Follows your system until you choose.</span>
              </span>
              <Segmented<'light' | 'dark'>
                label="Theme"
                value={settings.darkTheme ? 'dark' : 'light'}
                onChange={(v) => update({ darkTheme: v === 'dark' })}
                options={[
                  ['light', 'Light'],
                  ['dark', 'Dark'],
                ]}
              />
            </div>
          </section>
          <section className="settings__group">
            <h3 className="settings__heading">Viewport</h3>
            {VIEWPORT_OPTIONS.map(([key, label, hint]) => (
              <Toggle key={key} label={label} hint={hint} checked={settings[key]} onChange={(v) => update({ [key]: v })} />
            ))}
          </section>
          <section className="settings__group">
            <h3 className="settings__heading">Play</h3>
            <Toggle label="Capture the mouse" hint="Click the viewport in play mode to lock the pointer for mouse-look." checked={settings.pointerLock} onChange={(v) => update({ pointerLock: v })} />
          </section>
          <section className="settings__group">
            <h3 className="settings__heading">Performance</h3>
            <div className="setting-row">
              <span className="setting-row__text">
                <span className="setting-row__label">Low memory mode</span>
                <span className="setting-row__hint">
                  {memory ? (memory.lowMemory ? `On${memory.reason ? ` — ${memory.reason}` : ''}. ` : 'Off. ') : ''}Lower resolution, no bloom, smaller shadows and caches.
                </span>
              </span>
              <Segmented<LowMemorySetting> label="Low memory mode" value={settings.lowMemory} onChange={(v) => update({ lowMemory: v })} options={LOW_MEMORY_CHOICES} />
            </div>
            <div className="setting-row">
              <span className="setting-row__text">
                <span className="setting-row__label">Renderer</span>
                <span className="setting-row__hint">Auto uses WebGPU where it is reliable, WebGL2 elsewhere.{gpu?.description ? ` GPU: ${gpu.description}.` : ''}</span>
              </span>
              <Segmented<BackendSetting> label="Renderer" value={settings.backend} onChange={(v) => update({ backend: v })} options={BACKEND_CHOICES} />
            </div>
          </section>
        </div>
      )}
      {tab === 'ai' && (
        <Suspense fallback={<div className="settings__pane" aria-busy="true" />}>
          <AiConnectionPane prefs={ai.prefs} update={ai.update} repairs={settings.repairs} setRepairs={(n) => update({ repairs: n })} />
        </Suspense>
      )}
      {tab === 'shortcuts' && (
        <div className="settings__pane">
          <dl className="shortcut-list">
            {SHORTCUTS.map(([keys, what]) => (
              <div key={keys} className="shortcut-list__row">
                <dt>{what}</dt>
                <dd>
                  <kbd>{keys}</kbd>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </Dialog>
  );
});
