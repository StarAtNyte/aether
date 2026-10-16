/** Renderer options for the settings; `invert` flips snapping (Ctrl held while dragging). */
export function gizmoOptionsOf(s, invert) {
    const snap = s.snap !== invert;
    return {
        space: s.space,
        pivot: s.pivot,
        translationSnap: snap ? s.grid : null,
        rotationSnapDeg: snap ? s.angle : null,
        scaleSnap: snap ? s.scaleStep : null,
        surfaceSnap: s.surface,
        vertexSnap: s.vertex,
    };
}
