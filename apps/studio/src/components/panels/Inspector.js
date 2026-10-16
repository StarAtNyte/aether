import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Object inspector: sections for the selected entity (object, transform,
 * shape, material, physics, joint, light, behaviours, raw JSON) and, for a
 * multi-selection, arrange / batch tools. Every edit is one undoable 'user'
 * patch; locked objects are read-only until unlocked.
 */
import { memo, useEffect, useState } from 'react';
import { isEntityId, slugify } from '@aether/core';
import { useStudio, useWorld } from '../../app/context';
import { entityReplacePatches, entityToJson, parseEntityJson, parseTags } from '../../lib/entityEdit';
import { Icon } from '../Icon';
import { ColorField, FieldRow, NumberField, Section, TextField, Toggle, Vec3Field } from '../fields';
import { ShapeSection } from '../inspector/ShapeSection';
import { MaterialSection } from '../inspector/MaterialSection';
import { JointSection, PhysicsSection } from '../inspector/PhysicsSection';
import { BehaviorsSection } from '../inspector/BehaviorsSection';
import { MATERIAL_LIBRARY } from '../../lib/materials';
/** Short kind label of an entity ("Box", "Tree pine", "Light", …). */
export function entityKind(e) {
    if (e.light)
        return `${e.light.type.charAt(0).toUpperCase()}${e.light.type.slice(1)} light`;
    switch (e.shape.kind) {
        case 'primitive':
            return e.shape.primitive.charAt(0).toUpperCase() + e.shape.primitive.slice(1);
        case 'procedural':
            return e.shape.generator.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
        case 'scatter':
            return `Scatter ×${e.shape.points ? e.shape.points.length : e.shape.count}`;
        case 'model':
            return 'Model';
        case 'mesh':
            return 'Mesh';
        case 'asset':
            return 'Asset';
        default:
            return 'Group';
    }
}
const LightSection = memo(function LightSection({ e, update, disabled }) {
    const l = e.light;
    if (!l)
        return null;
    return (_jsxs(Section, { title: "Light", children: [_jsx(FieldRow, { label: "Color", children: _jsx(ColorField, { label: "Light color", value: l.color, disabled: disabled, onCommit: (c) => update({ light: { color: c } }, `Set ${e.id} light color`) }) }), _jsx(FieldRow, { label: "Intensity", children: _jsx(NumberField, { label: "Intensity", value: l.intensity, min: 0, step: 0.25, disabled: disabled, onCommit: (n) => update({ light: { intensity: n } }, `Set ${e.id} intensity`) }) }), (l.type === 'point' || l.type === 'spot') && (_jsx(FieldRow, { label: "Range", children: _jsx(NumberField, { label: "Range", value: l.range, min: 0, step: 1, disabled: disabled, onCommit: (n) => update({ light: { range: n } }, `Set ${e.id} range`) }) })), l.type === 'spot' && (_jsx(FieldRow, { label: "Angle", children: _jsx(NumberField, { label: "Spot angle", value: l.angle, min: 1, max: 89, step: 1, disabled: disabled, onCommit: (n) => update({ light: { angle: n } }, `Set ${e.id} spot angle`) }) })), _jsx(Toggle, { label: "Cast shadows", checked: l.castShadow, disabled: disabled, onChange: (v) => update({ light: { castShadow: v } }, `Set ${e.id} light shadows`) })] }));
});
const RawJson = memo(function RawJson({ e, disabled }) {
    const studio = useStudio();
    const [text, setText] = useState(() => entityToJson(e));
    const [error, setError] = useState(null);
    const [dirty, setDirty] = useState(false);
    useEffect(() => {
        if (!dirty)
            setText(entityToJson(e));
    }, [e, dirty]);
    const apply = () => {
        const r = parseEntityJson(text, e.id);
        if (!r.ok) {
            setError(r.error);
            return;
        }
        const patches = entityReplacePatches(studio.history.current, r.entity);
        const err = patches.length > 0 ? studio.commitUser(patches, `Edit ${e.id} JSON`) : null;
        setError(err);
        if (!err)
            setDirty(false);
    };
    return (_jsxs(Section, { title: "Advanced (JSON)", defaultOpen: false, children: [_jsx("textarea", { className: `code-input${error ? ' has-error' : ''}`, value: text, spellCheck: false, disabled: disabled, "aria-label": "Entity JSON", "aria-invalid": error !== null, onChange: (ev) => {
                    setText(ev.target.value);
                    setDirty(true);
                    setError(null);
                }, rows: 14 }), error && (_jsx("p", { className: "field-error", role: "alert", children: error })), _jsxs("div", { className: "add-row add-row--end", children: [_jsx("button", { type: "button", className: "btn btn--sm", disabled: !dirty, onClick: () => {
                            setText(entityToJson(e));
                            setDirty(false);
                            setError(null);
                        }, children: "Revert" }), _jsx("button", { type: "button", className: "btn btn--primary btn--sm", disabled: !dirty || disabled, onClick: apply, children: "Apply" })] })] }));
});
/** Inspector for one entity. */
export const ObjectInspector = memo(function ObjectInspector({ e, count, playing }) {
    const studio = useStudio();
    const world = useWorld();
    const locked = e.locked === true;
    const disabled = playing || locked;
    const update = (set, message) => studio.commitUser([{ op: 'update', id: e.id, set }], message);
    return (_jsxs("div", { className: "inspector", children: [count > 1 && _jsxs("p", { className: "inspector__note", children: [count, " selected \u2014 editing the first."] }), locked && (_jsxs("div", { className: "inspector__locked", role: "note", children: [_jsx(Icon, { name: "lock" }), _jsx("span", { children: "Locked: it cannot be selected in the viewport, moved, or changed by the agent." }), _jsx("button", { type: "button", className: "btn btn--xs", disabled: playing, onClick: () => studio.editor.setLocked([e.id], false), children: "Unlock" })] })), _jsxs(Section, { title: "Object", children: [_jsx(FieldRow, { label: "Name", children: _jsx(TextField, { label: "Name", value: e.name, disabled: disabled, placeholder: e.id, onCommit: (v) => update({ name: v.slice(0, 120) }, `Rename ${e.id}`) }) }), _jsx(FieldRow, { label: "Id", children: _jsx(TextField, { label: "Entity id", value: e.id, maxLength: 64, disabled: disabled, mono: true, onCommit: (v) => {
                                const next = isEntityId(v) ? v : slugify(v);
                                if (next && next !== e.id) {
                                    if (studio.commitUser([{ op: 'rename', id: e.id, newId: next }], `Rename id ${e.id} → ${next}`) === null)
                                        studio.store.getState().select([next]);
                                }
                            } }) }), _jsx(FieldRow, { label: "Tags", children: _jsx(TextField, { label: "Tags", value: e.tags.join(', '), disabled: disabled, placeholder: "coin, pickup", onCommit: (v) => update({ tags: parseTags(v) }, `Tag ${e.id}`) }) }), e.description && _jsx("p", { className: "section__note", children: e.description }), _jsx(Toggle, { label: "Visible", checked: e.visible, disabled: disabled, onChange: (v) => update({ visible: v }, `${v ? 'Show' : 'Hide'} ${e.id}`) }), _jsx(Toggle, { label: "Locked", hint: "Protects it from viewport edits and the agent", checked: locked, disabled: playing, onChange: (v) => studio.editor.setLocked([e.id], v) }), _jsx(Toggle, { label: "Casts shadow", checked: e.castShadow, disabled: disabled, onChange: (v) => update({ castShadow: v }, `Set ${e.id} shadows`) })] }), _jsxs(Section, { title: "Transform", right: _jsx("button", { type: "button", className: "icon-btn icon-btn--sm", disabled: disabled, "aria-label": "Drop to the ground", "data-tip": "Drop to the ground", "data-tip-align": "end", onClick: () => studio.editor.dropToGround(), children: _jsx(Icon, { name: "ground" }) }), children: [_jsx(Vec3Field, { label: "Position", value: e.transform.position, disabled: disabled, onCommit: (v) => update({ transform: { position: v } }, `Move ${e.id}`) }), _jsx(Vec3Field, { label: "Rotation", value: e.transform.rotation, step: 5, disabled: disabled, onCommit: (v) => update({ transform: { rotation: v } }, `Rotate ${e.id}`) }), _jsx(Vec3Field, { label: "Scale", value: e.transform.scale, min: 0.001, disabled: disabled, onCommit: (v) => update({ transform: { scale: v } }, `Scale ${e.id}`) })] }), _jsx(ShapeSection, { e: e, world: world, update: update, disabled: disabled }), e.shape.kind !== 'none' && e.shape.kind !== 'asset' && _jsx(MaterialSection, { e: e, update: update, disabled: disabled }), _jsx(PhysicsSection, { e: e, update: update, disabled: disabled }), _jsx(JointSection, { e: e, world: world, update: update, disabled: disabled }), _jsx(LightSection, { e: e, update: update, disabled: disabled }), _jsx(BehaviorsSection, { e: e, update: update, disabled: disabled }), _jsx(RawJson, { e: e, disabled: disabled })] }, e.id));
});
/** Inspector for several selected entities: arrange, organise and batch tools. */
export const MultiInspector = memo(function MultiInspector({ ids, playing }) {
    const studio = useStudio();
    const world = useWorld();
    const ed = studio.editor;
    const anyLocked = ids.some((id) => world.entities[id]?.locked === true);
    const allHidden = ids.every((id) => world.entities[id]?.visible === false);
    const axisRow = (axis) => (_jsx(FieldRow, { label: `Along ${'XYZ'[axis]}`, children: _jsxs("div", { className: "btn-row", children: [_jsx("button", { type: "button", className: "icon-btn icon-btn--sm", disabled: playing, "aria-label": `Align ${'XYZ'[axis]} minimum`, "data-tip": "Align to minimum", onClick: () => ed.align(axis, 'min'), children: _jsx(Icon, { name: "alignStart" }) }), _jsx("button", { type: "button", className: "icon-btn icon-btn--sm", disabled: playing, "aria-label": `Align ${'XYZ'[axis]} centre`, "data-tip": "Align centres", onClick: () => ed.align(axis, 'center'), children: _jsx(Icon, { name: "alignCenter" }) }), _jsx("button", { type: "button", className: "icon-btn icon-btn--sm", disabled: playing, "aria-label": `Align ${'XYZ'[axis]} maximum`, "data-tip": "Align to maximum", onClick: () => ed.align(axis, 'max'), children: _jsx(Icon, { name: "alignEnd" }) }), _jsx("button", { type: "button", className: "icon-btn icon-btn--sm", disabled: playing || ids.length < 3, "aria-label": `Distribute along ${'XYZ'[axis]}`, "data-tip": "Distribute evenly (3 or more)", onClick: () => ed.distribute(axis), children: _jsx(Icon, { name: "distribute" }) })] }) }, axis));
    return (_jsxs("div", { className: "inspector", "data-testid": "multi-inspector", children: [_jsxs(Section, { title: "Arrange", children: [axisRow(0), axisRow(1), axisRow(2), _jsx("div", { className: "add-row", children: _jsxs("button", { type: "button", className: "btn btn--sm", disabled: playing, onClick: () => ed.dropToGround(), children: [_jsx(Icon, { name: "ground" }), " Drop to ground"] }) })] }), _jsx(Section, { title: "Organise", children: _jsxs("div", { className: "btn-grid", children: [_jsxs("button", { type: "button", className: "btn btn--sm", disabled: playing, onClick: () => ed.group(), "data-kbd": "\u2318G", children: [_jsx(Icon, { name: "group" }), " Group"] }), _jsxs("button", { type: "button", className: "btn btn--sm", disabled: playing, onClick: () => ed.duplicate(), children: [_jsx(Icon, { name: "copy" }), " Duplicate"] }), _jsxs("button", { type: "button", className: "btn btn--sm", disabled: playing, onClick: () => ed.setHidden(ids, !allHidden), children: [_jsx(Icon, { name: allHidden ? 'eye' : 'eyeOff' }), " ", allHidden ? 'Show' : 'Hide'] }), _jsxs("button", { type: "button", className: "btn btn--sm", disabled: playing, onClick: () => ed.setLocked(ids, !anyLocked), children: [_jsx(Icon, { name: anyLocked ? 'unlock' : 'lock' }), " ", anyLocked ? 'Unlock' : 'Lock'] }), _jsxs("button", { type: "button", className: "btn btn--sm btn--danger", disabled: playing, onClick: () => ed.deleteSelection(), children: [_jsx(Icon, { name: "trash" }), " Delete"] })] }) }), _jsxs(Section, { title: "Material", children: [_jsxs("p", { className: "section__note", children: ["Apply to all ", ids.length, " objects."] }), _jsx("div", { className: "preset-grid", children: MATERIAL_LIBRARY.map((m) => (_jsx("button", { type: "button", className: "preset-swatch", style: { ['--swatch']: m.swatch }, disabled: playing, "aria-label": m.name, "data-tip": m.name, onClick: () => ed.applyMaterial(ids, { ...m.spec, color: m.spec.color ?? null, roughness: m.spec.roughness ?? null, metalness: m.spec.metalness ?? null }, `Apply ${m.name} to ${ids.length} objects`) }, m.id))) })] })] }));
});
