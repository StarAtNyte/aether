/**
 * Right-hand inspector. With an entity selected it shows the object
 * sections; otherwise the scene: sky, light, fog, ground, simulation, play
 * camera, variables and viewport options — each section a collapsible group
 * of label-left / value-right rows. Scene edits are undoable patches.
 */
import { memo, type ReactElement } from 'react';
import { MaterialPreset, type Environment, type Json, type WorldDoc } from '@aether/core';
import { useStudio, useUI, useWorld } from '../app/context';
import { formatHour } from '../lib/worldChroma';
import { formatValue } from '../lib/ruleFormat';
import { Icon } from '../components/Icon';
import { ColorField, FieldRow, NumberField, Section, SelectField, SliderField, Switch, Toggle } from '../components/fields';
import { entityKind, ObjectInspector } from '../components/panels/Inspector';
import { PanelHeader } from './Panels';

const SKIES = ['day', 'dawn', 'sunset', 'night', 'overcast', 'space', 'studio'] as const satisfies ReadonlyArray<Environment['sky']>;
const WEATHER = ['clear', 'rain', 'snow', 'dust', 'fireflies'] as const satisfies ReadonlyArray<Environment['weather']>;
const PLAYER_MODES = ['thirdPerson', 'firstPerson', 'orbit', 'vehicle'] as const satisfies ReadonlyArray<WorldDoc['player']['mode']>;
const GROUND_PRESETS = MaterialPreset.options;
const DEFAULT_FOG = { color: '#c9d3df', density: 0.015 };

type EnvSet = (set: Record<string, Json>, message: string) => void;

/** Scene (world-level) inspector. */
const SceneInspector = memo(function SceneInspector({ playing }: { playing: boolean }): ReactElement {
  const studio = useStudio();
  const world = useWorld();
  const settings = useUI((s) => s.settings);
  const env = world.environment;
  const setEnv: EnvSet = (set, message) => studio.commitUser([{ op: 'setEnvironment', set }], message);
  const setPlayer = (set: Record<string, Json>, message: string): void => void studio.commitUser([{ op: 'setPlayer', set }], message);
  const updateSettings = studio.store.getState().updateSettings;
  const stateKeys = Object.keys(world.state);
  const hasClock = env.sky !== 'space' && env.sky !== 'studio';
  return (
    <div className="inspector">
      <Section title="Sky">
        <FieldRow label="Preset">
          <SelectField label="Sky preset" value={env.sky} options={SKIES} disabled={playing} onChange={(v) => setEnv({ sky: v, timeOfDay: null }, `Sky: ${v}`)} />
        </FieldRow>
        {hasClock && (
          <FieldRow label="Time">
            <SliderField label="Time of day" value={env.timeOfDay ?? 12} min={0} max={24} step={0.25} disabled={playing} format={formatHour} onCommit={(v) => setEnv({ timeOfDay: v }, `Time of day ${formatHour(v)}`)} />
          </FieldRow>
        )}
        <FieldRow label="Weather">
          <SelectField label="Weather" value={env.weather} options={WEATHER} disabled={playing} onChange={(v) => setEnv({ weather: v }, `Weather: ${v}`)} />
        </FieldRow>
      </Section>
      <Section title="Light">
        <FieldRow label="Sun">
          <SliderField label="Sun intensity" value={env.sunIntensity} min={0} max={8} step={0.1} disabled={playing} onCommit={(v) => setEnv({ sunIntensity: v }, 'Sun intensity')} />
        </FieldRow>
        <FieldRow label="Ambient">
          <SliderField label="Ambient intensity" value={env.ambientIntensity} min={0} max={3} step={0.05} disabled={playing} onCommit={(v) => setEnv({ ambientIntensity: v }, 'Ambient light')} />
        </FieldRow>
        <FieldRow label="Exposure">
          <SliderField label="Exposure" value={env.exposure} min={0.1} max={4} step={0.05} disabled={playing} onCommit={(v) => setEnv({ exposure: v }, 'Exposure')} />
        </FieldRow>
        <FieldRow label="Bloom">
          <SliderField label="Bloom" value={env.bloom} min={0} max={3} step={0.05} disabled={playing} onCommit={(v) => setEnv({ bloom: v }, 'Bloom')} />
        </FieldRow>
      </Section>
      <Section title="Fog" right={<Switch label="Fog" checked={env.fog !== null} disabled={playing} onChange={(on) => setEnv({ fog: on ? DEFAULT_FOG : null }, on ? 'Add fog' : 'Remove fog')} />}>
        {env.fog ? (
          <>
            <FieldRow label="Color">
              <ColorField label="Fog color" value={env.fog.color} disabled={playing} onCommit={(c) => setEnv({ fog: { color: c } }, 'Fog color')} />
            </FieldRow>
            <FieldRow label="Density">
              <SliderField label="Fog density" value={env.fog.density} min={0} max={0.2} step={0.001} disabled={playing} format={(v) => v.toFixed(3)} onCommit={(v) => setEnv({ fog: { density: v } }, 'Fog density')} />
            </FieldRow>
          </>
        ) : (
          <p className="section__note">No fog.</p>
        )}
      </Section>
      <Section
        title="Ground"
        defaultOpen={false}
        right={<Switch label="Ground" checked={env.ground !== null} disabled={playing} onChange={(on) => setEnv({ ground: on ? { material: { preset: 'grass' }, size: 400 } : null }, on ? 'Add ground' : 'Remove ground')} />}
      >
        {env.ground ? (
          <>
            <FieldRow label="Material">
              <SelectField label="Ground material" value={env.ground.material.preset ?? 'grass'} options={GROUND_PRESETS} disabled={playing} onChange={(v) => setEnv({ ground: { material: { preset: v } } }, `Ground: ${v}`)} />
            </FieldRow>
            <FieldRow label="Tint">
              <ColorField label="Ground color" value={env.ground.material.color ?? '#7c9a5b'} disabled={playing} onCommit={(c) => setEnv({ ground: { material: { color: c } } }, 'Ground color')} />
            </FieldRow>
          </>
        ) : (
          <p className="section__note">No ground plane — objects fall forever.</p>
        )}
      </Section>
      <Section title="Simulation" defaultOpen={false}>
        <FieldRow label="Gravity">
          <SliderField label="Gravity" value={env.gravity[1]} min={-30} max={0} step={0.1} disabled={playing} format={(v) => `${v.toFixed(1)} m/s²`} onCommit={(v) => setEnv({ gravity: [env.gravity[0], v, env.gravity[2]] }, 'Gravity')} />
        </FieldRow>
        <Toggle label="Show colliders" checked={settings.showColliders} onChange={(v) => updateSettings({ showColliders: v })} />
      </Section>
      <Section title="Play camera" defaultOpen={false}>
        <FieldRow label="Mode">
          <SelectField label="Play camera" value={world.player.mode} options={PLAYER_MODES} disabled={playing} onChange={(v) => setPlayer({ mode: v }, `Play camera: ${v}`)} />
        </FieldRow>
        <FieldRow label="Speed">
          <NumberField label="Move speed" value={world.player.moveSpeed} min={0.1} max={60} step={0.5} disabled={playing} onCommit={(n) => setPlayer({ moveSpeed: n }, 'Move speed')} />
        </FieldRow>
        <FieldRow label="Jump">
          <NumberField label="Jump speed" value={world.player.jumpSpeed} min={0} max={60} step={0.5} disabled={playing} onCommit={(n) => setPlayer({ jumpSpeed: n }, 'Jump speed')} />
        </FieldRow>
      </Section>
      <Section title="Variables" defaultOpen={false} right={<span className="count-badge">{stateKeys.length}</span>}>
        {stateKeys.length === 0 ? (
          <p className="section__note">No world variables. Ask for a score or a timer.</p>
        ) : (
          <dl className="kv">
            {stateKeys.map((k) => (
              <div key={k} className="kv__row">
                <dt title={k}>{k}</dt>
                <dd title={formatValue(world.state[k])}>{formatValue(world.state[k])}</dd>
              </div>
            ))}
          </dl>
        )}
        {world.hud.length > 0 && <p className="section__note">On screen: {world.hud.map((h) => h.label).join(', ')}</p>}
      </Section>
      <Section title="Viewport" defaultOpen={false}>
        <Toggle label="Shadows" checked={settings.shadows} onChange={(v) => updateSettings({ shadows: v })} />
        <Toggle label="Object labels" checked={settings.showLabels} onChange={(v) => updateSettings({ showLabels: v })} />
        <Toggle label="Performance overlay" checked={settings.showPerf} onChange={(v) => updateSettings({ showPerf: v })} />
        <Toggle label="Navigation hint" checked={settings.showNavHint} onChange={(v) => updateSettings({ showNavHint: v })} />
      </Section>
    </div>
  );
});

/** The inspector panel (header + scene or object). */
export const InspectorPanel = memo(function InspectorPanel(): ReactElement {
  const studio = useStudio();
  const world = useWorld();
  const selection = useUI((s) => s.selection);
  const playing = useUI((s) => s.mode === 'play');
  const id = selection[0];
  const e = id !== undefined && Object.prototype.hasOwnProperty.call(world.entities, id) ? world.entities[id] : undefined;
  const count = Object.keys(world.entities).length;
  return (
    <>
      {e ? (
        <PanelHeader title={e.name || e.id}>
          <span className="chip chip--quiet" title={entityKind(e)}>
            {entityKind(e)}
          </span>
          <button type="button" className="icon-btn icon-btn--sm" aria-label="Focus camera" data-tip="Focus" data-kbd="F" onClick={() => studio.focus(e.id)}>
            <Icon name="focus" />
          </button>
          <button type="button" className="icon-btn icon-btn--sm" aria-label="Delete object" data-tip="Delete" data-kbd="Del" disabled={playing} onClick={() => studio.deleteEntities(selection)}>
            <Icon name="trash" />
          </button>
          <button type="button" className="icon-btn icon-btn--sm" aria-label="Deselect" data-tip="Deselect" data-kbd="Esc" data-tip-align="end" onClick={() => studio.store.getState().select([])}>
            <Icon name="x" />
          </button>
        </PanelHeader>
      ) : (
        <PanelHeader title="Scene">
          <span className="chip chip--quiet">
            {count} {count === 1 ? 'object' : 'objects'}
          </span>
        </PanelHeader>
      )}
      <div className="panel__body scroll-y">{e ? <ObjectInspector e={e} count={selection.length} playing={playing} /> : <SceneInspector playing={playing} />}</div>
    </>
  );
});
