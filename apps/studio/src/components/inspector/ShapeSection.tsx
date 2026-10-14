/**
 * Shape section of the inspector: primitives (kind, size), procedural
 * generators (every ParamSpec as a live control, seed + reroll, bake),
 * scatter layers (count, area, scale range, spacing, painted points) and
 * editable meshes (stats, edit, re-generate).
 */
import { memo, useMemo, type ReactElement } from 'react';
import { PrimitiveKind, decodeMeshCached, hasOwn, type Entity, type Json, type WorldDoc } from '@aether/core';
import { getBuiltinGenerator, meshHealth } from '@aether/procgen';
import { assetInfo, assetShapeSize } from '@aether/assets';
import { useStudio, useUI } from '../../app/context';
import { Icon } from '../Icon';
import { FieldRow, NumberField, SelectField, Section, Switch, Vec3Field } from '../fields';
import { ParamField, type ParamSpecLike } from './ParamField';
import { isBakeable } from '../../editor/model/bake';

type Update = (set: Record<string, Json>, message: string) => void;

/** Library / imported asset: what it is, who made it, its look, size and animation. */
const AssetInfo = memo(function AssetInfo({ e, update, disabled }: { e: Entity; update: Update; disabled: boolean }): ReactElement | null {
  const studio = useStudio();
  if (e.shape.kind !== 'asset') return null;
  const shape = e.shape;
  const info = assetInfo(shape.id);
  if (!info) return <p className="section__note">Asset “{shape.id}” is not available here; a stand-in is shown{shape.fallback ? ' (its fallback shape)' : ''}.</p>;
  const entry = info.entry;
  const pack = entry ? studio.assets.state.getState().catalog?.packs.find((p) => p.id === entry.pack) : undefined;
  const variants = entry?.variants ?? [];
  const clips = info.anims?.clips ?? [];
  const size = assetShapeSize(shape);
  return (
    <>
      <FieldRow label="Asset">
        <span className="value-text">{entry?.name ?? info.user?.name ?? shape.id}</span>
      </FieldRow>
      <FieldRow label="Source">
        <span className="value-text" title={pack?.url ?? ''}>
          {info.user ? 'Your import' : `${pack?.title ?? entry?.pack ?? ''} · ${entry?.authors?.join(', ') ?? pack?.author ?? ''} · ${pack?.licence ?? ''}`}
        </span>
      </FieldRow>
      {size && (
        <FieldRow label="Size">
          <span className="value-text mono">{size.map((v) => v.toFixed(2)).join(' × ')} m</span>
        </FieldRow>
      )}
      {variants.length > 0 && (
        <FieldRow label="Look">
          <SelectField
            label="Variant"
            value={shape.variant && variants.includes(shape.variant) ? shape.variant : shape.id}
            options={[shape.id, ...variants]}
            raw
            disabled={disabled}
            onChange={(v) => update({ shape: { variant: v === shape.id ? null : v } }, `Set ${e.id} look`)}
          />
        </FieldRow>
      )}
      <FieldRow label="Fit size">
        <NumberField label="Largest dimension (m)" value={shape.fitSize ?? Math.max(...(size ?? [1]))} min={0.05} max={500} step={0.1} disabled={disabled} onCommit={(n) => update({ shape: { fitSize: n } }, `Resize ${e.id}`)} />
      </FieldRow>
      {clips.length > 0 && (
        <FieldRow label="Animation">
          <SelectField
            label="Animation"
            value={shape.animation ?? 'auto'}
            options={['auto', 'none', ...clips.slice(0, 40)]}
            raw
            disabled={disabled}
            onChange={(v) => update({ shape: { animation: v === 'auto' ? null : v } }, `Set ${e.id} animation`)}
          />
        </FieldRow>
      )}
    </>
  );
});

/** Parameter specs of a generator (custom definitions win over built-ins). */
export function generatorParams(world: WorldDoc, generator: string): Record<string, ParamSpecLike> {
  if (hasOwn(world.generators, generator)) return (world.generators[generator]?.params ?? {}) as Record<string, ParamSpecLike>;
  return (getBuiltinGenerator(generator)?.params ?? {}) as Record<string, ParamSpecLike>;
}

const ProceduralParams = memo(function ProceduralParams({ e, world, disabled }: { e: Entity; world: WorldDoc; disabled: boolean }): ReactElement | null {
  const studio = useStudio();
  if (e.shape.kind !== 'procedural') return null;
  const shape = e.shape;
  const specs = generatorParams(world, shape.generator);
  const keys = Object.keys(specs);
  const name = e.name || e.id;
  return (
    <>
      <FieldRow label="Generator">
        <span className="value-text mono" title={shape.generator}>
          {shape.generator}
        </span>
      </FieldRow>
      {keys.length === 0 && Object.keys(shape.params).length === 0 && <p className="section__note">This generator has no parameters.</p>}
      {keys.map((k) => (
        <ParamField
          key={k}
          name={k}
          spec={specs[k] as ParamSpecLike}
          value={shape.params[k]}
          disabled={disabled}
          onPreview={(v) => studio.editor.previewParams(e.id, { [k]: v })}
          onCommit={(v) => studio.editor.commitParams(e.id, { [k]: v }, `Set ${name} ${k}`)}
        />
      ))}
      <FieldRow label="Seed">
        <div className="field-inline">
          <NumberField label="Seed" value={shape.seed ?? 1} step={1} disabled={disabled} onCommit={(n) => studio.editor.commitParams(e.id, {}, `Reseed ${name}`, Math.round(n))} />
          <button type="button" className="icon-btn icon-btn--sm" disabled={disabled} aria-label="New random seed" data-tip="Reroll (new random variation)" onClick={() => studio.editor.reroll(e.id)} data-testid="reroll">
            <Icon name="dice" />
          </button>
        </div>
      </FieldRow>
    </>
  );
});

const ScatterParams = memo(function ScatterParams({ e, update, disabled }: { e: Entity; update: Update; disabled: boolean }): ReactElement | null {
  const studio = useStudio();
  if (e.shape.kind !== 'scatter') return null;
  const s = e.shape;
  const name = e.name || e.id;
  return (
    <>
      <FieldRow label="Of">
        <span className="value-text mono">{s.of.kind === 'procedural' ? s.of.generator : s.of.primitive}</span>
      </FieldRow>
      {s.points ? (
        <>
          <FieldRow label="Painted">
            <span className="value-text">{s.points.length} instances</span>
          </FieldRow>
          <div className="add-row">
            <button type="button" className="btn btn--sm" disabled={disabled} onClick={() => studio.store.getState().setTool('scatter')}>
              <Icon name="sprout" /> Paint more
            </button>
            <button type="button" className="btn btn--sm" disabled={disabled || s.points.length === 0} onClick={() => update({ shape: { points: [], count: 1 } }, `Clear painted ${name}`)}>
              Clear
            </button>
          </div>
        </>
      ) : (
        <>
          <FieldRow label="Count">
            <NumberField label="Count" value={s.count} step={1} min={1} max={200_000} disabled={disabled} onCommit={(n) => update({ shape: { count: Math.round(n) } }, `Set ${name} count`)} />
          </FieldRow>
          <FieldRow label="Area">
            <div className="vec2">
              <NumberField label="Area width" axis="x" value={s.area[0]} min={0.1} disabled={disabled} onCommit={(n) => update({ shape: { area: [n, s.area[1]] } }, `Set ${name} area`)} />
              <NumberField label="Area depth" axis="z" value={s.area[1]} min={0.1} disabled={disabled} onCommit={(n) => update({ shape: { area: [s.area[0], n] } }, `Set ${name} area`)} />
            </div>
          </FieldRow>
          <FieldRow label="Spacing">
            <NumberField label="Minimum spacing" value={s.minSpacing ?? 0} min={0} step={0.1} disabled={disabled} onCommit={(n) => update({ shape: { minSpacing: n > 0 ? n : null } }, `Set ${name} spacing`)} />
          </FieldRow>
        </>
      )}
      <FieldRow label="Scale">
        <div className="vec2">
          <NumberField label="Minimum scale" value={s.scaleRange[0]} min={0.01} step={0.05} disabled={disabled} onCommit={(n) => update({ shape: { scaleRange: [n, Math.max(n, s.scaleRange[1])] } }, `Set ${name} scale range`)} />
          <NumberField label="Maximum scale" value={s.scaleRange[1]} min={0.01} step={0.05} disabled={disabled} onCommit={(n) => update({ shape: { scaleRange: [Math.min(n, s.scaleRange[0]), n] } }, `Set ${name} scale range`)} />
        </div>
      </FieldRow>
      <FieldRow label="Random turn">
        <Switch label="Random yaw" checked={s.randomYaw} disabled={disabled} onChange={(v) => update({ shape: { randomYaw: v } }, `Set ${name} random turn`)} />
      </FieldRow>
      <FieldRow label="Seed">
        <div className="field-inline">
          <NumberField label="Seed" value={s.seed} step={1} disabled={disabled} onCommit={(n) => update({ shape: { seed: Math.round(n) } }, `Reseed ${name}`)} />
          <button type="button" className="icon-btn icon-btn--sm" disabled={disabled} aria-label="New random seed" data-tip="Reroll" onClick={() => studio.editor.reroll(e.id)}>
            <Icon name="dice" />
          </button>
        </div>
      </FieldRow>
    </>
  );
});

const MeshInfo = memo(function MeshInfo({ e, world, disabled }: { e: Entity; world: WorldDoc; disabled: boolean }): ReactElement | null {
  const studio = useStudio();
  const editing = useUI((s) => s.meshEdit?.id === e.id);
  const shape = e.shape;
  const asset = shape.kind === 'mesh' && hasOwn(world.meshes, shape.mesh) ? world.meshes[shape.mesh] : undefined;
  const health = useMemo(() => {
    // Topology analysis is linear but not free: skip it for very dense meshes.
    if (!asset || asset.vertexCount > 20_000) return null;
    try {
      return meshHealth(decodeMeshCached(asset));
    } catch {
      return null;
    }
  }, [asset]);
  if (shape.kind !== 'mesh') return null;
  if (!asset) return <p className="section__note">The mesh data is missing.</p>;
  const src = asset.source?.shape;
  return (
    <>
      <FieldRow label="Geometry">
        <span className="value-text" data-testid="mesh-stats">
          {asset.vertexCount.toLocaleString()} vertices · {asset.triangleCount.toLocaleString()} triangles
        </span>
      </FieldRow>
      {health && (
        <FieldRow label="Surface">
          <span className={`value-text${health.closed ? '' : ' is-warn'}`}>{health.closed ? 'Closed (watertight)' : `${health.boundaryEdges} open edges`}</span>
        </FieldRow>
      )}
      {src && (
        <FieldRow label="Made from">
          <span className="value-text mono">{src.kind === 'procedural' ? src.generator : src.primitive}</span>
        </FieldRow>
      )}
      <div className="add-row">
        <button type="button" className={`btn btn--sm${editing ? ' btn--primary' : ''}`} disabled={disabled} onClick={() => void studio.editor.toggleMeshEdit()} data-tip="Vertices, edges and faces" data-kbd="Tab">
          <Icon name="mesh" /> {editing ? 'Done editing' : 'Edit mesh'}
        </button>
        {src && (
          <button type="button" className="btn btn--sm" disabled={disabled} onClick={() => studio.editor.regenerate(e.id)} data-tip="Rebuild from the generator (discards hand edits; undoable)">
            <Icon name="refresh" /> Regenerate
          </button>
        )}
      </div>
    </>
  );
});

/** The shape section. */
export const ShapeSection = memo(function ShapeSection({ e, world, update, disabled }: { e: Entity; world: WorldDoc; update: Update; disabled: boolean }): ReactElement {
  const studio = useStudio();
  const s = e.shape;
  const bakeable = isBakeable(e);
  return (
    <Section
      title="Shape"
      right={
        bakeable ? (
          <button type="button" className="btn btn--xs" disabled={disabled} onClick={() => studio.editor.bake(e.id)} data-tip="Convert to an editable mesh (keeps a link to regenerate it)" data-testid="bake-mesh">
            <Icon name="mesh" size={14} /> Bake
          </button>
        ) : undefined
      }
    >
      {s.kind === 'primitive' && (
        <>
          <FieldRow label="Primitive">
            <SelectField label="Primitive" value={s.primitive} options={PrimitiveKind.options} disabled={disabled} onChange={(v) => update({ shape: { primitive: v } }, `Set ${e.id} primitive`)} />
          </FieldRow>
          <Vec3Field label="Size" value={s.size} min={0.001} disabled={disabled} onCommit={(v) => update({ shape: { size: v } }, `Resize ${e.id}`)} />
        </>
      )}
      <ProceduralParams e={e} world={world} disabled={disabled} />
      <ScatterParams e={e} update={update} disabled={disabled} />
      <MeshInfo e={e} world={world} disabled={disabled} />
      {s.kind === 'model' && (
        <FieldRow label="URL">
          <span className="value-text mono" title={s.url}>
            {s.url}
          </span>
        </FieldRow>
      )}
      <AssetInfo e={e} update={update} disabled={disabled} />
      {s.kind === 'none' && <p className="section__note">No geometry (group, light or logic holder).</p>}
    </Section>
  );
});
