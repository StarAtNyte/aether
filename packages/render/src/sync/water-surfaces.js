/**
 * Where the water of a world is: the horizontal surfaces of its water entities (pure, no three.js). The renderer uses
 * them to put ripples where something enters the water, to find the camera under the surface, to choose the one body
 * the planar reflection mirrors and to size waves by scale; the level tools use the same list to place fish.
 */
import { findWaterBodies, isWaterEntity as isWater, waterAt } from '@aether/core';
import { inferWaterKind } from '../materials/water-params';
/** True for an entity drawn as water. */
export const isWaterEntity = isWater;
/** The scale class of a water entity: the material's own `waterKind`, else from its size and names. */
export function waterKindOf(e) {
    const named = e.material?.waterKind;
    if (named)
        return named;
    const s = e.shape;
    let w = 10;
    let d = 10;
    if (s.kind === 'primitive') {
        w = (s.size[0] ?? 1) * Math.abs(e.transform.scale[0] ?? 1);
        d = (s.primitive === 'cylinder' ? (s.size[2] ?? s.size[0] ?? 1) : (s.size[2] ?? 1)) * Math.abs(e.transform.scale[2] ?? 1);
    }
    return inferWaterKind(w, d, [e.id, e.name, ...e.tags]);
}
/** The material spec to draw a water entity with: names the scale class when the spec does not. */
export function withWaterKind(spec, e) {
    if (!spec || spec.preset !== 'water' || spec.waterKind)
        return spec;
    return { ...spec, waterKind: waterKindOf(e) };
}
/** Surfaces of every water entity with a primitive shape (planes, boxes, cylinders), largest first, each with its scale class. */
export function findWaterSurfaces(world) {
    return findWaterBodies(world).map((b) => ({ ...b, kind: waterKindOf(world.entities[b.id]) }));
}
/** The surface containing the point `(x, z)` whose height is nearest `y`, or null. */
export function surfaceAt(surfaces, x, z, y) {
    return waterAt(surfaces, x, z, y);
}
