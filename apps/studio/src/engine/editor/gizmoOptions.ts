/**
 * Map the editor's gizmo settings (and a held "invert snapping" modifier)
 * to renderer gizmo options.
 */
import type { GizmoOptions } from '@aether/render';
import type { GizmoSettings } from '../../state/store';

/** Renderer options for the settings; `invert` flips snapping (Ctrl held while dragging). */
export function gizmoOptionsOf(s: GizmoSettings, invert: boolean): GizmoOptions {
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
