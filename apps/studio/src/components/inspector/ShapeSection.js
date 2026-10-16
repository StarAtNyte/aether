import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Shape section of the inspector: primitives (kind, size), procedural
 * generators (every ParamSpec as a live control, seed + reroll, bake),
 * scatter layers (count, area, scale range, spacing, painted points) and
 * editable meshes (stats, edit, re-generate).
 */
import { memo, useMemo } from 'react';
import { PrimitiveKind, decodeMeshCached, hasOwn } from '@aether/core';
import { getBuiltinGenerator, meshHealth } from '@aether/procgen';
import { assetInfo, assetShapeSize } from '@aether/assets';
import { useStudio, useUI } from '../../app/context';
import { Icon } from '../Icon';
import { FieldRow, NumberField, SelectField, Section, Switch, Vec3Field } from '../fields';
import { ParamField } from './ParamField';
import { isBakeable } from '../../editor/model/bake';
/** Library / imported asset: what it is, who made it, its look, size and animation. */
const AssetInfo = memo(function AssetInfo({ e, update, disabled }) {
    const studio = useStudio();
    if (e.shape.kind !== 'asset')
        return null;
    const shape = e.shape;
    const info = assetInfo(shape.id);
    if (!info)
        return _jsxs("p", { className: "section__note", children: ["Asset \u201C", shape.id, "\u201D is not available here; a stand-in is shown", shape.fallback ? ' (its fallback shape)' : '', "."] });
    const entry = info.entry;
    const pack = entry ? studio.assets.state.getState().catalog?.packs.find((p) => p.id === entry.pack) : undefined;
    const variants = entry?.variants ?? [];
    const clips = info.anims?.clips ?? [];
    const size = assetShapeSize(shape);
    return (_jsxs(_Fragment, { children: [_jsx(FieldRow, { label: "Asset", children: _jsx("span", { className: "value-text", children: entry?.name ?? info.user?.name ?? shape.id }) }), _jsx(FieldRow, { label: "Source", children: _jsx("span", { className: "value-text", title: pack?.url ?? '', children: info.user ? 'Your import' : `${pack?.title ?? entry?.pack ?? ''} · ${entry?.authors?.join(', ') ?? pack?.author ?? ''} · ${pack?.licence ?? ''}` }) }), size && (_jsx(FieldRow, { label: "Size", children: _jsxs("span", { className: "value-text mono", children: [size.map((v) => v.toFixed(2)).join(' × '), " m"] }) })), variants.length > 0 && (_jsx(FieldRow, { label: "Look", children: _jsx(SelectField, { label: "Variant", value: shape.variant && variants.includes(shape.variant) ? shape.variant : shape.id, options: [shape.id, ...variants], raw: true, disabled: disabled, onChange: (v) => update({ shape: { variant: v === shape.id ? null : v } }, `Set ${e.id} look`) }) })), _jsx(FieldRow, { label: "Fit size", children: _jsx(NumberField, { label: "Largest dimension (m)", value: shape.fitSize ?? Math.max(...(size ?? [1])), min: 0.05, max: 500, step: 0.1, disabled: disabled, onCommit: (n) => update({ shape: { fitSize: n } }, `Resize ${e.id}`) }) }), clips.length > 0 && (_jsx(FieldRow, { label: "Animation", children: _jsx(SelectField, { label: "Animation", value: shape.animation ?? 'auto', options: ['auto', 'none', ...clips.slice(0, 40)], raw: true, disabled: disabled, onChange: (v) => update({ shape: { animation: v === 'auto' ? null : v } }, `Set ${e.id} animation`) }) }))] }));
});
/** Parameter specs of a generator (custom definitions win over built-ins). */
export function generatorParams(world, generator) {
    if (hasOwn(world.generators, generator))
        return (world.generators[generator]?.params ?? {});
    return (getBuiltinGenerator(generator)?.params ?? {});
}
const ProceduralParams = memo(function ProceduralParams({ e, world, disabled }) {
    const studio = useStudio();
    if (e.shape.kind !== 'procedural')
        return null;
    const shape = e.shape;
    const specs = generatorParams(world, shape.generator);
    const keys = Object.keys(specs);
    const name = e.name || e.id;
    return (_jsxs(_Fragment, { children: [_jsx(FieldRow, { label: "Generator", children: _jsx("span", { className: "value-text mono", title: shape.generator, children: shape.generator }) }), keys.length === 0 && Object.keys(shape.params).length === 0 && _jsx("p", { className: "section__note", children: "This generator has no parameters." }), keys.map((k) => (_jsx(ParamField, { name: k, spec: specs[k], value: shape.params[k], disabled: disabled, onPreview: (v) => studio.editor.previewParams(e.id, { [k]: v }), onCommit: (v) => studio.editor.commitParams(e.id, { [k]: v }, `Set ${name} ${k}`) }, k))), _jsx(FieldRow, { label: "Seed", children: _jsxs("div", { className: "field-inline", children: [_jsx(NumberField, { label: "Seed", value: shape.seed ?? 1, step: 1, disabled: disabled, onCommit: (n) => studio.editor.commitParams(e.id, {}, `Reseed ${name}`, Math.round(n)) }), _jsx("button", { type: "button", className: "icon-btn icon-btn--sm", disabled: disabled, "aria-label": "New random seed", "data-tip": "Reroll (new random variation)", onClick: () => studio.editor.reroll(e.id), "data-testid": "reroll", children: _jsx(Icon, { name: "dice" }) })] }) })] }));
});
const ScatterParams = memo(function ScatterParams({ e, update, disabled }) {
    const studio = useStudio();
    if (e.shape.kind !== 'scatter')
        return null;
    const s = e.shape;
    const name = e.name || e.id;
    return (_jsxs(_Fragment, { children: [_jsx(FieldRow, { label: "Of", children: _jsx("span", { className: "value-text mono", children: s.of.kind === 'procedural' ? s.of.generator : s.of.primitive }) }), s.points ? (_jsxs(_Fragment, { children: [_jsx(FieldRow, { label: "Painted", children: _jsxs("span", { className: "value-text", children: [s.points.length, " instances"] }) }), _jsxs("div", { className: "add-row", children: [_jsxs("button", { type: "button", className: "btn btn--sm", disabled: disabled, onClick: () => studio.store.getState().setTool('scatter'), children: [_jsx(Icon, { name: "sprout" }), " Paint more"] }), _jsx("button", { type: "button", className: "btn btn--sm", disabled: disabled || s.points.length === 0, onClick: () => update({ shape: { points: [], count: 1 } }, `Clear painted ${name}`), children: "Clear" })] })] })) : (_jsxs(_Fragment, { children: [_jsx(FieldRow, { label: "Count", children: _jsx(NumberField, { label: "Count", value: s.count, step: 1, min: 1, max: 200_000, disabled: disabled, onCommit: (n) => update({ shape: { count: Math.round(n) } }, `Set ${name} count`) }) }), _jsx(FieldRow, { label: "Area", children: _jsxs("div", { className: "vec2", children: [_jsx(NumberField, { label: "Area width", axis: "x", value: s.area[0], min: 0.1, disabled: disabled, onCommit: (n) => update({ shape: { area: [n, s.area[1]] } }, `Set ${name} area`) }), _jsx(NumberField, { label: "Area depth", axis: "z", value: s.area[1], min: 0.1, disabled: disabled, onCommit: (n) => update({ shape: { area: [s.area[0], n] } }, `Set ${name} area`) })] }) }), _jsx(FieldRow, { label: "Spacing", children: _jsx(NumberField, { label: "Minimum spacing", value: s.minSpacing ?? 0, min: 0, step: 0.1, disabled: disabled, onCommit: (n) => update({ shape: { minSpacing: n > 0 ? n : null } }, `Set ${name} spacing`) }) })] })), _jsx(FieldRow, { label: "Scale", children: _jsxs("div", { className: "vec2", children: [_jsx(NumberField, { label: "Minimum scale", value: s.scaleRange[0], min: 0.01, step: 0.05, disabled: disabled, onCommit: (n) => update({ shape: { scaleRange: [n, Math.max(n, s.scaleRange[1])] } }, `Set ${name} scale range`) }), _jsx(NumberField, { label: "Maximum scale", value: s.scaleRange[1], min: 0.01, step: 0.05, disabled: disabled, onCommit: (n) => update({ shape: { scaleRange: [Math.min(n, s.scaleRange[0]), n] } }, `Set ${name} scale range`) })] }) }), _jsx(FieldRow, { label: "Random turn", children: _jsx(Switch, { label: "Random yaw", checked: s.randomYaw, disabled: disabled, onChange: (v) => update({ shape: { randomYaw: v } }, `Set ${name} random turn`) }) }), _jsx(FieldRow, { label: "Seed", children: _jsxs("div", { className: "field-inline", children: [_jsx(NumberField, { label: "Seed", value: s.seed, step: 1, disabled: disabled, onCommit: (n) => update({ shape: { seed: Math.round(n) } }, `Reseed ${name}`) }), _jsx("button", { type: "button", className: "icon-btn icon-btn--sm", disabled: disabled, "aria-label": "New random seed", "data-tip": "Reroll", onClick: () => studio.editor.reroll(e.id), children: _jsx(Icon, { name: "dice" }) })] }) })] }));
});
const MeshInfo = memo(function MeshInfo({ e, world, disabled }) {
    const studio = useStudio();
    const editing = useUI((s) => s.meshEdit?.id === e.id);
    const shape = e.shape;
    const asset = shape.kind === 'mesh' && hasOwn(world.meshes, shape.mesh) ? world.meshes[shape.mesh] : undefined;
    const health = useMemo(() => {
        // Topology analysis is linear but not free: skip it for very dense meshes.
        if (!asset || asset.vertexCount > 20_000)
            return null;
        try {
            return meshHealth(decodeMeshCached(asset));
        }
        catch {
            return null;
        }
    }, [asset]);
    if (shape.kind !== 'mesh')
        return null;
    if (!asset)
        return _jsx("p", { className: "section__note", children: "The mesh data is missing." });
    const src = asset.source?.shape;
    return (_jsxs(_Fragment, { children: [_jsx(FieldRow, { label: "Geometry", children: _jsxs("span", { className: "value-text", "data-testid": "mesh-stats", children: [asset.vertexCount.toLocaleString(), " vertices \u00B7 ", asset.triangleCount.toLocaleString(), " triangles"] }) }), health && (_jsx(FieldRow, { label: "Surface", children: _jsx("span", { className: `value-text${health.closed ? '' : ' is-warn'}`, children: health.closed ? 'Closed (watertight)' : `${health.boundaryEdges} open edges` }) })), src && (_jsx(FieldRow, { label: "Made from", children: _jsx("span", { className: "value-text mono", children: src.kind === 'procedural' ? src.generator : src.primitive }) })), _jsxs("div", { className: "add-row", children: [_jsxs("button", { type: "button", className: `btn btn--sm${editing ? ' btn--primary' : ''}`, disabled: disabled, onClick: () => void studio.editor.toggleMeshEdit(), "data-tip": "Vertices, edges and faces", "data-kbd": "Tab", children: [_jsx(Icon, { name: "mesh" }), " ", editing ? 'Done editing' : 'Edit mesh'] }), src && (_jsxs("button", { type: "button", className: "btn btn--sm", disabled: disabled, onClick: () => studio.editor.regenerate(e.id), "data-tip": "Rebuild from the generator (discards hand edits; undoable)", children: [_jsx(Icon, { name: "refresh" }), " Regenerate"] }))] })] }));
});
/** The shape section. */
export const ShapeSection = memo(function ShapeSection({ e, world, update, disabled }) {
    const studio = useStudio();
    const s = e.shape;
    const bakeable = isBakeable(e);
    return (_jsxs(Section, { title: "Shape", right: bakeable ? (_jsxs("button", { type: "button", className: "btn btn--xs", disabled: disabled, onClick: () => studio.editor.bake(e.id), "data-tip": "Convert to an editable mesh (keeps a link to regenerate it)", "data-testid": "bake-mesh", children: [_jsx(Icon, { name: "mesh", size: 14 }), " Bake"] })) : undefined, children: [s.kind === 'primitive' && (_jsxs(_Fragment, { children: [_jsx(FieldRow, { label: "Primitive", children: _jsx(SelectField, { label: "Primitive", value: s.primitive, options: PrimitiveKind.options, disabled: disabled, onChange: (v) => update({ shape: { primitive: v } }, `Set ${e.id} primitive`) }) }), _jsx(Vec3Field, { label: "Size", value: s.size, min: 0.001, disabled: disabled, onCommit: (v) => update({ shape: { size: v } }, `Resize ${e.id}`) })] })), _jsx(ProceduralParams, { e: e, world: world, disabled: disabled }), _jsx(ScatterParams, { e: e, update: update, disabled: disabled }), _jsx(MeshInfo, { e: e, world: world, disabled: disabled }), s.kind === 'model' && (_jsx(FieldRow, { label: "URL", children: _jsx("span", { className: "value-text mono", title: s.url, children: s.url }) })), _jsx(AssetInfo, { e: e, update: update, disabled: disabled }), s.kind === 'none' && _jsx("p", { className: "section__note", children: "No geometry (group, light or logic holder)." })] }));
});
