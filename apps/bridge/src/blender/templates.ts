/**
 * Fixed Python templates of the Aether-level Blender actions (export glb,
 * Cycles render, Cycles bake), run through the MCP server's
 * execute_blender_code. Every value is inserted as a JSON literal (valid
 * Python), so inputs can never change the code's structure. Each prints one
 * `AETHER_RESULT {json}` line; the file it writes is under the bridge's own
 * data folder.
 */

/** Marker of the result line. */
export const RESULT_MARKER = 'AETHER_RESULT ';

const py = (v: string | number | boolean): string => (typeof v === 'boolean' ? (v ? 'True' : 'False') : JSON.stringify(v));

/** Export the scene (or selection) as one self-contained GLB. */
export function exportGlbCode(outPath: string, o: { selection_only?: boolean }): string {
  return `import bpy, json, os
out = ${py(outPath)}
bpy.ops.export_scene.gltf(
    filepath=out,
    export_format='GLB',
    use_selection=${py(o.selection_only === true)},
    export_apply=True,
    export_cameras=False,
    export_lights=False,
    export_extras=False,
)
print(${py(RESULT_MARKER)} + json.dumps({"path": out, "bytes": os.path.getsize(out)}))
`;
}

/** Render the scene camera with Cycles to a PNG (render settings restored afterwards). */
export function renderCode(outPath: string, o: { width?: number; height?: number; samples?: number }): string {
  return `import bpy, json
scene = bpy.context.scene
if scene.camera is None:
    raise RuntimeError("The scene has no camera to render from.")
r = scene.render
saved = (r.engine, r.resolution_x, r.resolution_y, r.resolution_percentage, r.filepath, r.image_settings.file_format, scene.cycles.samples)
try:
    r.engine = 'CYCLES'
    r.resolution_x = ${py(o.width ?? 1280)}
    r.resolution_y = ${py(o.height ?? 720)}
    r.resolution_percentage = 100
    scene.cycles.samples = ${py(o.samples ?? 64)}
    r.image_settings.file_format = 'PNG'
    r.filepath = ${py(outPath)}
    bpy.ops.render.render(write_still=True)
finally:
    r.engine, r.resolution_x, r.resolution_y, r.resolution_percentage, r.filepath, r.image_settings.file_format, scene.cycles.samples = saved
print(${py(RESULT_MARKER)} + json.dumps({"path": ${py(outPath)}}))
`;
}

/** Bake one mesh object with Cycles into a new image (UVs made if missing), saved as PNG; temporary nodes removed. */
export function bakeCode(outPath: string, o: { object: string; type?: string; size?: number; samples?: number }): string {
  return `import bpy, json
scene = bpy.context.scene
obj = bpy.data.objects.get(${py(o.object)})
if obj is None or obj.type != 'MESH':
    raise RuntimeError("No mesh object named " + ${py(o.object)})
if bpy.context.object is not None and bpy.context.object.mode != 'OBJECT':
    bpy.ops.object.mode_set(mode='OBJECT')
for other in bpy.context.selected_objects:
    other.select_set(False)
obj.hide_set(False)
obj.select_set(True)
bpy.context.view_layer.objects.active = obj
if not obj.data.uv_layers:
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project()
    bpy.ops.object.mode_set(mode='OBJECT')
if not obj.material_slots:
    obj.data.materials.append(bpy.data.materials.new(obj.name + " material"))
img = bpy.data.images.new("Aether bake " + obj.name, ${py(o.size ?? 1024)}, ${py(o.size ?? 1024)}, alpha=False)
added = []
for slot in obj.material_slots:
    mat = slot.material
    if mat is None:
        continue
    mat.use_nodes = True
    node = mat.node_tree.nodes.new('ShaderNodeTexImage')
    node.image = img
    mat.node_tree.nodes.active = node
    added.append((mat, node))
saved = (scene.render.engine, scene.cycles.samples)
try:
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = ${py(o.samples ?? 64)}
    bpy.ops.object.bake(type=${py(o.type ?? 'COMBINED')}, margin=4, use_clear=True)
    img.filepath_raw = ${py(outPath)}
    img.file_format = 'PNG'
    img.save()
finally:
    scene.render.engine, scene.cycles.samples = saved
    for mat, node in added:
        mat.node_tree.nodes.remove(node)
print(${py(RESULT_MARKER)} + json.dumps({"path": ${py(outPath)}, "image": img.name}))
`;
}

/** The JSON of the last result line in `text`, or null. */
export function parseResult(text: string): Record<string, unknown> | null {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const at = lines[i]!.indexOf(RESULT_MARKER);
    if (at < 0) continue;
    try {
      const v = JSON.parse(lines[i]!.slice(at + RESULT_MARKER.length)) as unknown;
      return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return null;
}
